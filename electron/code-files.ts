import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants, type Stats } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { exec } from './core';
import { pathContains } from './platform';
import { listMentionFiles } from './projects/mention-files';
import {
  cleanCodePath,
  codeFileLimits,
  type CodeFile,
  type CodeFileList,
  type CodeFileWriteResult,
  type CodeLineChanges,
  type CodeSearchMatch,
  type CodeSearchResult,
} from '../src/domain/code-files';

const outside = 'The file is outside the repository.';
// Windows has no O_NOFOLLOW. There, the inode check after open still refuses a swapped file.
const noFollow = constants.O_NOFOLLOW ?? 0;
// Git must not run programs from the repository configuration while it reads files.
const gitSafe = ['-c', 'core.fsmonitor=false', '--no-pager', '--literal-pathspecs'];

/** The real path of a repository root. The root must be an absolute folder. */
export async function codeRoot(cwd: unknown) {
  if (typeof cwd !== 'string' || !isAbsolute(cwd) || cwd.includes('\0'))
    throw new Error('Choose a repository.');
  const root = await realpath(cwd);
  if (!(await stat(root)).isDirectory()) throw new Error('The repository is not a folder.');
  return root;
}

/**
 * The real path of a file in the root. The path must be relative and stay in the root after
 * Kalkidan follows symbolic links. Files in `.git` are refused, also through a link.
 */
export async function codeFilePath(root: string, path: unknown) {
  const clean = cleanCodePath(path);
  if (!clean) throw new Error(outside);
  const target = join(root, clean);
  if (!pathContains(root, target)) throw new Error(outside);
  let canonical: string;
  try {
    canonical = await realpath(target);
  } catch (error: any) {
    if (error?.code === 'ENOENT') throw new Error('The file is not found.');
    throw error;
  }
  if (!pathContains(root, canonical)) throw new Error(outside);
  const inside = relative(root, canonical);
  if (!inside || !cleanCodePath(inside)) throw new Error(outside);
  return { path: clean, canonical };
}

function sameFile(a: Stats, b: Stats) {
  return a.dev === b.dev && a.ino === b.ino;
}

/**
 * Opens the checked file without following a link. The open file must be the file that the
 * check found, so a link that replaces the file after the check is refused.
 */
async function openChecked(canonical: string, flags: number) {
  const expected = await stat(canonical);
  // A pipe or a device can block the open. Only regular files are opened.
  if (!expected.isFile()) throw new Error('This is not a file.');
  const file = await open(canonical, flags | noFollow);
  try {
    const info = await file.stat();
    if (!sameFile(info, expected)) throw new Error(outside);
    if (!info.isFile()) throw new Error('This is not a file.');
    return { file, info };
  } catch (error) {
    await file.close();
    throw error;
  }
}

async function readAll(file: Awaited<ReturnType<typeof open>>, size: number) {
  const buffer = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const { bytesRead } = await file.read(buffer, offset, size - offset, offset);
    if (!bytesRead) break;
    offset += bytesRead;
  }
  return buffer.subarray(0, offset);
}

/** Reads a checked file. Null when it is larger than `max`. */
async function readChecked(canonical: string, max: number) {
  const { file, info } = await openChecked(canonical, constants.O_RDONLY);
  try {
    return info.size > max ? null : await readAll(file, info.size);
  } finally {
    await file.close();
  }
}

function revisionOf(bytes: Buffer) {
  return createHash('sha256').update(bytes).digest('hex');
}

function isBinary(bytes: Buffer) {
  return bytes.subarray(0, 8192).includes(0);
}

/** The files of a repository, relative to the root. */
export async function listCodeFiles(cwd: string): Promise<CodeFileList> {
  const root = await codeRoot(cwd);
  const list = await listMentionFiles(root, codeFileLimits.files);
  return { files: list.files.filter((file) => cleanCodePath(file)), truncated: list.truncated };
}

/** Reads a text file. A large or binary file gives its size and a note, not its content. */
export async function readCodeFile(cwd: string, path: string): Promise<CodeFile> {
  const root = await codeRoot(cwd);
  const checked = await codeFilePath(root, path);
  const { file, info } = await openChecked(checked.canonical, constants.O_RDONLY);
  try {
    if (info.size > codeFileLimits.readBytes)
      return {
        path: checked.path,
        size: info.size,
        revision: `size:${info.size}:${info.mtimeMs}`,
        note: 'too-large',
      };
    const bytes = await readAll(file, info.size);
    const revision = revisionOf(bytes);
    if (isBinary(bytes))
      return { path: checked.path, size: bytes.length, revision, note: 'binary' };
    return { path: checked.path, size: bytes.length, revision, content: bytes.toString('utf8') };
  } finally {
    await file.close();
  }
}

/** The revision of a file on disk, or null when the file is gone. */
export async function codeFileRevision(cwd: string, path: string): Promise<string | null> {
  const root = await codeRoot(cwd);
  let checked;
  try {
    checked = await codeFilePath(root, path);
  } catch (error: any) {
    if (error?.message === 'The file is not found.') return null;
    throw error;
  }
  const { file, info } = await openChecked(checked.canonical, constants.O_RDONLY);
  try {
    if (info.size > codeFileLimits.readBytes) return `size:${info.size}:${info.mtimeMs}`;
    return revisionOf(await readAll(file, info.size));
  } finally {
    await file.close();
  }
}

/**
 * Saves the text of a file. Kalkidan writes only an existing file with one link, and only when
 * the file on disk is still the revision that the editor opened. Else nothing is written.
 */
export async function writeCodeFile(
  cwd: string,
  path: string,
  content: unknown,
  expectedRevision: unknown,
): Promise<CodeFileWriteResult> {
  if (typeof content !== 'string') throw new Error('The text is not valid.');
  if (typeof expectedRevision !== 'string' || !expectedRevision)
    throw new Error('Open the file again before you save it.');
  const bytes = Buffer.from(content, 'utf8');
  if (bytes.length > codeFileLimits.writeBytes)
    throw new Error('The file is too large to save here.');
  const root = await codeRoot(cwd);
  let checked;
  try {
    checked = await codeFilePath(root, path);
  } catch (error: any) {
    if (error?.message === 'The file is not found.')
      return { ok: false, conflict: true, revision: null };
    throw error;
  }
  const { file, info } = await openChecked(checked.canonical, constants.O_RDWR);
  try {
    if (info.nlink > 1) throw new Error('Kalkidan does not save a file with more than one link.');
    if (info.size > codeFileLimits.readBytes)
      throw new Error('The file is too large to save here.');
    const current = revisionOf(await readAll(file, info.size));
    if (current !== expectedRevision) return { ok: false, conflict: true, revision: current };
    await file.write(bytes, 0, bytes.length, 0);
    await file.truncate(bytes.length);
    return { ok: true, revision: revisionOf(bytes), size: bytes.length };
  } finally {
    await file.close();
  }
}

/** Reads the new-side line numbers of a `git diff -U0` output. */
export function changedLines(diff: string) {
  const lines: number[] = [];
  for (const match of diff.matchAll(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/gm)) {
    const start = Number(match[1]);
    const count = match[2] === undefined ? 1 : Number(match[2]);
    for (let line = start; line < start + count; line++) lines.push(line);
  }
  return lines;
}

async function git(root: string, args: string[]) {
  return (
    await exec('git', [...gitSafe, '-C', root, ...args], {
      timeout: 15000,
      maxBuffer: 16 * 1024 * 1024,
    })
  ).stdout;
}

/** The lines of a file that are different from the last commit. */
export async function codeFileChanges(cwd: string, path: string): Promise<CodeLineChanges> {
  const root = await codeRoot(cwd);
  const checked = await codeFilePath(root, path);
  const file = relative(root, checked.canonical).split('\\').join('/');
  const all = async () => {
    const bytes = await readChecked(checked.canonical, codeFileLimits.readBytes);
    if (!bytes || isBinary(bytes)) return [];
    const text = bytes.toString('utf8');
    const count = text.split('\n').length - (text.endsWith('\n') ? 1 : 0);
    return Array.from({ length: Math.max(count, 0) }, (_, index) => index + 1);
  };
  try {
    await git(root, ['ls-files', '--error-unmatch', '--', file]);
  } catch {
    // Not tracked, or not a Git repository: the whole file is new.
    return { path: checked.path, lines: await all(), untracked: true };
  }
  let diff: string;
  try {
    diff = await git(root, [
      'diff',
      '--no-ext-diff',
      '--no-textconv',
      '--no-color',
      '-U0',
      'HEAD',
      '--',
      file,
    ]);
  } catch {
    // No commit yet: the staged file is the whole change.
    return { path: checked.path, lines: await all(), untracked: true };
  }
  return { path: checked.path, lines: changedLines(diff), untracked: false };
}

function cleanQuery(value: unknown) {
  if (typeof value !== 'string') throw new Error('Type the text to find.');
  const query = value.replace(/[\r\n]/g, ' ');
  if (!query.trim() || query.length > codeFileLimits.query || query.includes('\0'))
    throw new Error('Type the text to find.');
  return query;
}

function matchText(text: string) {
  return text.length > codeFileLimits.matchText
    ? text.slice(0, codeFileLimits.matchText) + '…'
    : text;
}

/** Runs `git grep` and stops when it has enough matches. Null when Git cannot search. */
function gitGrep(root: string, query: string, ignoreCase: boolean) {
  return new Promise<CodeSearchResult | null>((resolve) => {
    const args = [
      ...gitSafe,
      '-C',
      root,
      'grep',
      '--untracked',
      '-I',
      '-n',
      '--column',
      '-z',
      '--no-color',
      '--fixed-strings',
      ...(ignoreCase ? ['-i'] : []),
      '-e',
      query,
    ];
    const child = spawn('git', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    const matches: CodeSearchMatch[] = [];
    let truncated = false;
    let rest = '';
    let done = false;
    const finish = (value: CodeSearchResult | null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => {
      truncated = true;
      child.kill();
      finish({ matches, truncated });
    }, 15000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      rest += chunk;
      const lines = rest.split('\n');
      rest = lines.pop() ?? '';
      for (const line of lines) {
        // -z: "path\0line\0column\0text".
        const [path, number, column, ...text] = line.split('\0');
        const clean = cleanCodePath(path);
        if (!clean || !number) continue;
        matches.push({
          path: clean,
          line: Number(number),
          column: Number(column) || 1,
          text: matchText(text.join('\0')),
        });
        if (matches.length >= codeFileLimits.matches) {
          truncated = true;
          child.kill();
          finish({ matches, truncated });
          return;
        }
      }
    });
    child.on('error', () => finish(null));
    child.on('close', (code) => {
      // 1: no match. 128 and others: not a Git repository or Git failed.
      if (code === 0 || code === 1 || code === null) finish({ matches, truncated });
      else finish(null);
    });
  });
}

/** Search without Git: reads the listed files one at a time, with the size limits. */
async function walkSearch(root: string, query: string, ignoreCase: boolean) {
  const needle = ignoreCase ? query.toLowerCase() : query;
  const { files } = await listMentionFiles(root, 5000);
  const matches: CodeSearchMatch[] = [];
  for (const file of files) {
    let checked;
    let bytes;
    try {
      checked = await codeFilePath(root, file);
      bytes = await readChecked(checked.canonical, codeFileLimits.searchFileBytes);
    } catch {
      continue;
    }
    if (!bytes || isBinary(bytes)) continue;
    const lines = bytes.toString('utf8').split('\n');
    for (let index = 0; index < lines.length; index++) {
      const line = ignoreCase ? lines[index].toLowerCase() : lines[index];
      const column = line.indexOf(needle);
      if (column < 0) continue;
      matches.push({
        path: checked.path,
        line: index + 1,
        column: column + 1,
        text: matchText(lines[index]),
      });
      if (matches.length >= codeFileLimits.matches) return { matches, truncated: true };
    }
  }
  return { matches, truncated: false };
}

/** Finds a fixed text in the repository. Case-insensitive unless the text has capitals. */
export async function searchCode(cwd: string, value: unknown): Promise<CodeSearchResult> {
  const root = await codeRoot(cwd);
  const query = cleanQuery(value);
  const ignoreCase = query === query.toLowerCase();
  return (await gitGrep(root, query, ignoreCase)) ?? walkSearch(root, query, ignoreCase);
}
