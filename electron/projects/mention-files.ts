import { lstat, open, readdir, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { exec } from '../core';
import { pathContains } from '../platform';
import {
  mentionLimits,
  type MentionFileContent,
  type MentionFileList,
} from '../../src/domain/mentions';

// Folders that a folder walk does not open. Git repositories use their ignore rules instead.
const skipped = new Set(['node_modules', 'dist', 'build', 'target', 'vendor']);

async function folderRoot(cwd: unknown) {
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw new Error('Choose a code folder.');
  const root = await realpath(cwd);
  if (!(await stat(root)).isDirectory()) throw new Error('The code folder is not a folder.');
  return root;
}

/** Files that are not in a Git repository: a bounded walk that skips hidden folders. */
async function walk(root: string, limit: number) {
  const files: string[] = [];
  const queue: { path: string; depth: number }[] = [{ path: '', depth: 0 }];
  while (queue.length && files.length < limit) {
    const { path, depth } = queue.shift()!;
    let entries;
    try {
      entries = await readdir(join(root, path), { withFileTypes: true });
    } catch {
      continue;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const child = path ? `${path}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (depth < 8 && !skipped.has(entry.name)) queue.push({ path: child, depth: depth + 1 });
      } else if (entry.isFile()) {
        files.push(child);
        if (files.length >= limit) break;
      }
    }
  }
  return { files, truncated: files.length >= limit || queue.length > 0 };
}

/**
 * The files in a code folder, relative to the folder. Git repositories give their tracked and
 * not ignored files. Other folders give the result of a bounded walk.
 */
export async function listMentionFiles(
  cwd: string,
  limit: number = mentionLimits.files,
): Promise<MentionFileList> {
  const root = await folderRoot(cwd);
  let output: string;
  try {
    output = (
      await exec(
        'git',
        ['-C', root, 'ls-files', '--cached', '--others', '--exclude-standard', '-z'],
        { timeout: 15000, maxBuffer: 32 * 1024 * 1024 },
      )
    ).stdout;
  } catch {
    const result = await walk(root, Math.min(limit, 5000));
    return { files: result.files, truncated: result.truncated };
  }
  const all = [...new Set(output.split('\0').filter(Boolean))];
  return { files: all.slice(0, limit), truncated: all.length > limit };
}

/** Rejects a path that is absolute or that goes up out of the folder. */
function relativePath(value: unknown) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > mentionLimits.id ||
    value.includes('\0') ||
    isAbsolute(value) ||
    /^[A-Za-z]:/.test(value) ||
    value.split(/[\\/]/).includes('..')
  )
    throw new Error('The file is outside the code folder.');
  return value;
}

/**
 * Reads a file in a code folder for a mention. The file must stay in the folder after Kalkidan
 * follows symbolic links. Large and binary files give their path and size only.
 */
export async function readMentionFile(cwd: string, path: string): Promise<MentionFileContent> {
  const root = await folderRoot(cwd);
  const relative = relativePath(path);
  const target = resolve(root, relative);
  if (!pathContains(root, target)) throw new Error('The file is outside the code folder.');
  await lstat(target);
  const canonical = await realpath(target);
  if (!pathContains(root, canonical)) throw new Error('The file is outside the code folder.');
  const info = await stat(canonical);
  if (!info.isFile()) throw new Error('The mention is not a file.');
  if (info.size > mentionLimits.fileBytes)
    return { path: relative, size: info.size, note: 'The file is too large to attach.' };
  const file = await open(canonical, 'r');
  try {
    const buffer = Buffer.alloc(info.size);
    const { bytesRead } = await file.read(buffer, 0, info.size, 0);
    const bytes = buffer.subarray(0, bytesRead);
    if (bytes.includes(0))
      return { path: relative, size: info.size, note: 'Binary file. No text is attached.' };
    const text = bytes.toString('utf8');
    return {
      path: relative,
      size: info.size,
      content: text.slice(0, mentionLimits.fileCharacters),
      ...(text.length > mentionLimits.fileCharacters ? { truncated: true } : {}),
    };
  } finally {
    await file.close();
  }
}
