import { lstat, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';

/** Compare file identities without transferring document or memory contents. */
export async function resourceRevision(root: string, kind: 'docs' | 'memory') {
  if (!['docs', 'memory'].includes(kind)) throw new Error('Invalid project resource.');
  const directory = join(root, kind);
  try {
    if ((await lstat(directory)).isSymbolicLink())
      throw new Error('Resource folder cannot be a symbolic link.');
  } catch (error: any) {
    if (error.code === 'ENOENT') return 'missing';
    throw error;
  }
  const entries = (await readdir(directory, { withFileTypes: true }))
    .filter(
      (entry) =>
        entry.name.endsWith('.md') ||
        (kind === 'memory' && entry.name === '.extraction-state.json'),
    )
    .sort((a, b) => a.name.localeCompare(b.name));
  const stamps: string[] = [];
  // Bound open filesystem requests, including very large libraries.
  for (let i = 0; i < entries.length; i += 8) {
    stamps.push(
      ...(await Promise.all(
        entries.slice(i, i + 8).map(async (entry) => {
          const info = await lstat(join(directory, entry.name));
          if (info.isSymbolicLink()) return JSON.stringify([entry.name, 'link']);
          return JSON.stringify([
            entry.name,
            info.dev,
            info.ino,
            info.size,
            info.mtimeMs,
            info.ctimeMs,
          ]);
        }),
      )),
    );
  }
  return createHash('sha256').update(stamps.join('\n')).digest('hex');
}
