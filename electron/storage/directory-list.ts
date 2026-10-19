import { readdir, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';

export async function listDirectory(value: string = '~') {
  if (typeof value !== 'string') throw new Error('Enter a folder path.');
  const expanded =
    value === '~' ? homedir() : value.startsWith('~/') ? join(homedir(), value.slice(2)) : value;
  if (!isAbsolute(expanded)) throw new Error('Enter an absolute path or a path starting with ~/.');
  let path: string;
  try {
    path = await realpath(expanded);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') {
      throw new Error(
        `Folder not found: ${value}. Check the spelling and letter case, or open the parent folder.`,
      );
    }
    if (code === 'EACCES' || code === 'EPERM') {
      throw new Error(`Cannot open folder: ${value}. Check your access permissions.`);
    }
    throw error;
  }
  if (!(await stat(path)).isDirectory()) throw new Error('Choose a folder, not a file.');
  const entries = await readdir(path, { withFileTypes: true });
  // Symlinks are resolved only when opened, avoiding a stat call for every entry.
  return {
    path,
    parent: dirname(path),
    entries: entries
      .map((entry) => ({
        name: entry.name,
        path: join(path, entry.name),
        kind: entry.isDirectory()
          ? ('directory' as const)
          : entry.isSymbolicLink()
            ? ('symlink' as const)
            : ('file' as const),
      }))
      .sort(
        (a, b) =>
          Number(b.kind === 'directory') - Number(a.kind === 'directory') ||
          a.name.localeCompare(b.name),
      ),
  };
}
