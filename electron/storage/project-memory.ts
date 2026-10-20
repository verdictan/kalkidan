import { mkdir, lstat, readdir, open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { join } from 'node:path';
import type { ProjectMemory } from '../../src/domain/memory';

export const memoryRuntimeId = randomUUID();

export async function memoryDirectory(root: string) {
  const directory = join(root, 'memory');
  await mkdir(directory, { recursive: true });
  if ((await lstat(directory)).isSymbolicLink())
    throw new Error('Memory folder must not be a symbolic link.');
  return directory;
}

export async function readProjectMemory(root: string): Promise<ProjectMemory> {
  const directory = await memoryDirectory(root);
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .sort((a, b) => a.name.localeCompare(b.name));
  const pages: ProjectMemory['pages'] = [];
  let remaining = 1024 * 1024;
  for (const entry of entries.slice(0, 200)) {
    const file = await open(join(directory, entry.name), constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const info = await file.stat();
      if (!info.isFile()) continue;
      const length = Math.min(info.size, 64 * 1024, remaining);
      if (!length) continue;
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await file.read(buffer, 0, length, 0);
      remaining -= bytesRead;
      const text = buffer.subarray(0, bytesRead).toString('utf8');
      const content =
        text.startsWith('<!-- kalkidan-memory ') && text.includes(' -->\n')
          ? text.slice(text.indexOf('\n') + 1)
          : text;
      const meta =
        text.startsWith('<!-- kalkidan-memory ') && text.includes(' -->\n')
          ? JSON.parse(text.slice('<!-- kalkidan-memory '.length, text.indexOf('\n') - 4))
          : undefined;
      pages.push({
        ...(typeof meta?.topic === 'string'
          ? { topic: meta.topic, provenance: meta.provenance }
          : {}),
        name: entry.name,
        content,
        updatedAt: info.mtime.toISOString(),
        truncated: bytesRead < info.size,
      });
    } finally {
      await file.close();
    }
  }
  let extraction: ProjectMemory['extraction'];
  try {
    const file = await open(
      join(directory, '.extraction-state.json'),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      if ((await file.stat()).size <= 8192) {
        const value = JSON.parse(await file.readFile('utf8'));
        if (
          ['queued', 'extracting', 'validating', 'saved', 'skipped', 'failed'].includes(
            value.status,
          )
        ) {
          extraction =
            ['queued', 'extracting', 'validating'].includes(value.status) &&
            value.runtimeId !== memoryRuntimeId
              ? {
                  ...value,
                  status: 'failed',
                  error:
                    'Extraction was interrupted. New completed turns can extract memory again.',
                }
              : value;
        }
      }
    } finally {
      await file.close();
    }
  } catch (error: any) {
    if (error.code !== 'ENOENT') throw error;
  }
  return { pages, limited: entries.length > pages.length, ...(extraction ? { extraction } : {}) };
}
