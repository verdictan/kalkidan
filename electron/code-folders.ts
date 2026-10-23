import { lstat, readdir, realpath, stat } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * The usual places for code in the home folder. The scan reads only these. It never reads
 * folders that macOS protects (Desktop, Documents, Downloads, iCloud), so it asks for no access.
 */
export const codeFolderRoots = [
  'code',
  'Code',
  'Developer',
  'dev',
  'src',
  'Projects',
  'projects',
  'repos',
  'git',
  'GitHub',
  'workspace',
];

/** Folders that never contain a repository that the user works on. */
const skipped = new Set(['node_modules', 'vendor', 'dist', 'build', 'target', 'Pods', '.venv']);

/** A folder with code that the first composer offers as a chip, for example "atlas · 3 repos". */
export interface FoundCodeFolder {
  /** The folder name, for example "atlas". */
  name: string;
  path: string;
  /** 1 for a repository. For a folder that holds repositories, the number of them. */
  repos: number;
  /** The last change of the folder, in ms. The newest folders come first. */
  modifiedAt: number;
}

export interface FindCodeFoldersOptions {
  /** The folder names under `home` to read. */
  roots?: string[];
  /** The maximum number of folders to return. */
  limit?: number;
  /** The maximum number of folders to read. This keeps the scan fast on a large disk. */
  folderLimit?: number;
}

async function hasGit(folder: string) {
  try {
    const entry = await lstat(join(folder, '.git'));
    return entry.isDirectory() || entry.isFile();
  } catch {
    return false;
  }
}

/** The subfolders of a folder that can hold code: no hidden folders, links or build output. */
async function subfolders(folder: string) {
  try {
    const entries = await readdir(folder, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .filter((entry) => !skipped.has(entry.name))
      .map((entry) => join(folder, entry.name));
  } catch {
    return [];
  }
}

async function modified(path: string) {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return 0;
  }
}

/**
 * Finds folders with code in the usual places of the home folder, two levels deep: each Git
 * repository directly in a root, and each folder in a root that holds Git repositories. It
 * does not start Git and reads at most `folderLimit` folders. The newest folders come first.
 */
export async function findCodeFolders(
  home: string,
  { roots = codeFolderRoots, limit = 6, folderLimit = 400 }: FindCodeFoldersOptions = {},
): Promise<FoundCodeFolder[]> {
  let reads = 0;
  const seen = new Set<string>();
  const found: FoundCodeFolder[] = [];
  for (const root of roots) {
    const rootPath = join(home, root);
    let real: string;
    try {
      if (!(await stat(rootPath)).isDirectory()) continue;
      // On a file system that ignores case, "code" and "Code" are the same folder.
      real = await realpath(rootPath);
    } catch {
      continue;
    }
    if (seen.has(real)) continue;
    seen.add(real);
    if (++reads > folderLimit) break;
    for (const child of await subfolders(rootPath)) {
      if (reads >= folderLimit) break;
      const name = child.slice(rootPath.length + 1);
      if (await hasGit(child)) {
        found.push({ name, path: child, repos: 1, modifiedAt: await modified(child) });
        continue;
      }
      reads++;
      let repos = 0;
      for (const inner of await subfolders(child)) if (await hasGit(inner)) repos++;
      if (repos) found.push({ name, path: child, repos, modifiedAt: await modified(child) });
    }
  }
  return found.sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, Math.max(0, limit));
}
