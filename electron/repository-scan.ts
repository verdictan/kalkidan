import { lstat, readdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, isAbsolute, join, resolve } from 'node:path';

/** Folders that never contain a repository that the user works on. */
const skipped = new Set(['node_modules', 'vendor', 'dist', 'build', 'target', 'Pods', '.venv']);

export interface ScannedRepository {
  path: string;
  name: string;
  branch?: string;
}
export interface RepositoryScan {
  root: string;
  rootIsRepository: boolean;
  repositories: ScannedRepository[];
  /** True when the scan stopped at the repository or folder limit. */
  truncated: boolean;
}
export interface ScanOptions {
  /** The deepest subfolder level to examine. The root is level 0. */
  depth?: number;
  /** The maximum number of repositories to return. */
  limit?: number;
  /** The maximum number of folders to read. This keeps a scan of a large folder fast. */
  folderLimit?: number;
}

/** Returns 'directory' or 'file' for the `.git` entry of a folder, or null when it has none. */
async function gitEntry(folder: string) {
  try {
    const entry = await lstat(join(folder, '.git'));
    if (entry.isDirectory()) return 'directory';
    if (entry.isFile()) return 'file';
  } catch {
    /* The folder has no .git entry or it cannot be read. */
  }
  return null;
}

/**
 * Reads the current branch from the HEAD file. It does not start Git. A worktree or a
 * submodule has a `.git` file that names the Git directory.
 */
export async function readBranch(folder: string): Promise<string | undefined> {
  try {
    let gitDirectory = join(folder, '.git');
    if ((await lstat(gitDirectory)).isFile()) {
      const pointer = /^gitdir:\s*(.+)$/m.exec(await readFile(gitDirectory, 'utf8'))?.[1]?.trim();
      if (!pointer) return undefined;
      gitDirectory = isAbsolute(pointer) ? pointer : resolve(folder, pointer);
    }
    const head = (await readFile(join(gitDirectory, 'HEAD'), 'utf8')).trim();
    const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head)?.[1];
    return ref || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Finds Git repositories in a folder. The root counts when it has a `.git` folder or file.
 * The scan reads subfolders breadth first to `depth` levels. It skips hidden folders, symbolic
 * links, and folders such as node_modules. It does not go into a repository that it finds.
 * When the root is a repository, it also finds separate repositories in the root, which are
 * folders with their own `.git` folder. Submodules and worktrees have a `.git` file, so the
 * scan does not include them there.
 */
export async function scanRepositories(
  path: string,
  { depth = 3, limit = 200, folderLimit = 20000 }: ScanOptions = {},
): Promise<RepositoryScan> {
  if (typeof path !== 'string' || !path) throw new Error('Choose a folder.');
  let root: string;
  try {
    root = await realpath(path);
  } catch {
    throw new Error('This folder does not exist.');
  }
  if (!(await stat(root)).isDirectory()) throw new Error('Choose a folder.');
  const rootIsRepository = (await gitEntry(root)) !== null;
  const repositories: ScannedRepository[] = [];
  if (rootIsRepository)
    repositories.push({ path: root, name: basename(root), branch: await readBranch(root) });
  let truncated = false;
  let folders = 0;
  let level: string[] = [root];
  for (let current = 1; current <= depth && level.length && !truncated; current++) {
    const next: string[] = [];
    for (const parent of level) {
      if (folders++ >= folderLimit) {
        truncated = true;
        break;
      }
      let entries;
      try {
        entries = await readdir(parent, { withFileTypes: true });
      } catch {
        continue; // A folder without read permission is not an error for the scan.
      }
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.') || skipped.has(entry.name)) continue;
        const folder = join(parent, entry.name);
        const kind = await gitEntry(folder);
        if (kind && (!rootIsRepository || kind === 'directory')) {
          if (repositories.length >= limit) {
            truncated = true;
            break;
          }
          repositories.push({ path: folder, name: entry.name, branch: await readBranch(folder) });
        } else if (!kind) next.push(folder);
      }
      if (truncated) break;
    }
    level = next;
  }
  repositories.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return { root, rootIsRepository, repositories, truncated };
}
