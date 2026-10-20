import { mkdir, lstat, readdir, open } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import type { ProjectMemory } from '../../src/domain/memory';

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
      pages.push({
        name: entry.name,
        content: buffer.subarray(0, bytesRead).toString('utf8'),
        updatedAt: info.mtime.toISOString(),
        truncated: bytesRead < info.size,
      });
    } finally {
      await file.close();
    }
  }
  return { pages, limited: entries.length > pages.length };
}
