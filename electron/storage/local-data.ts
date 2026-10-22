import { constants } from 'node:fs';
import { copyFile, lstat, mkdir, open, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import {
  localDataLimitBytes,
  type LocalDataCategory,
  type LocalDataDeletion,
  type LocalDataExport,
  type LocalDataUsage,
} from '../../src/domain/data-policy';

/** The age below which Kalkidan never removes a log, so that a running operation keeps it. */
const logGraceMs = 24 * 60 * 60 * 1000;
/** A walk stops after this number of entries. The size is then a lower limit. */
const walkLimit = 500_000;

/** The Chromium cache folders in the data folder and in each `Partitions/<name>` folder. */
const chromiumCaches = new Set([
  'Cache',
  'Code Cache',
  'GPUCache',
  'DawnCache',
  'DawnGraphiteCache',
  'DawnWebGPUCache',
  'GrShaderCache',
  'ShaderCache',
  'Shared Dictionary',
]);
/** The top-level entries of each category. Other entries are `other`. */
const topLevel: Record<string, LocalDataCategory> = {
  'managed-agent-homes': 'chat-history',
  'sessions.json': 'chat-history',
  'chat-outcomes.json': 'chat-history',
  'verdictan-bindings.json': 'chat-history',
  projects: 'projects',
  docs: 'projects',
  'projects.json': 'projects',
  'project-groups.json': 'projects',
  browser: 'browser',
  Partitions: 'browser',
  'Local Storage': 'browser',
  'Session Storage': 'browser',
  IndexedDB: 'browser',
  WebStorage: 'browser',
  'Service Worker': 'browser',
  Cookies: 'browser',
  'Cookies-journal': 'browser',
  'preferences.json': 'settings',
  'appearance.json': 'settings',
  'remote-hosts.json': 'settings',
  'verdictan-region.json': 'settings',
  'agent-executables.json': 'settings',
  Preferences: 'settings',
  runtime: 'runtime',
  operations: 'logs',
  Crashpad: 'logs',
  logs: 'logs',
};
/** The JSON stores that an export copies as they are. None contains a credential. */
const exportedStores = [
  'projects.json',
  'project-groups.json',
  'sessions.json',
  'chat-outcomes.json',
  'preferences.json',
  'appearance.json',
  'remote-hosts.json',
  'verdictan-region.json',
  'verdictan-bindings.json',
  'agent-executables.json',
];
/** The files of an agent home that an export never copies. They can contain credentials. */
const secretNames = new Set(['auth.json', '.credentials.json', 'credentials.json', '.env']);

export interface LocalDataOptions {
  /** The data folder, `~/.kalkidan`. Kalkidan touches nothing outside it. */
  root: string;
  /** The disk limit in bytes. The default is the policy limit. */
  limit?: number;
  now?: () => number;
  /**
   * Clears the Chromium caches through Electron. Chromium uses the cache files while the app
   * runs, so Kalkidan does not remove them directly.
   */
  clearBrowserCaches?: () => Promise<void>;
}

interface Candidate {
  path: string;
  category: 'caches' | 'logs';
  mtime: number;
  remove: () => Promise<void>;
}

function inside(root: string, path: string) {
  const relation = relative(root, path);
  return relation !== '' && !relation.startsWith('..') && !relation.startsWith(sep);
}

/**
 * The local data of Kalkidan in the data folder: its size by category, the disk limit, export,
 * and deletion. All operations stay inside the data folder and never follow a symbolic link,
 * so they touch only files that Kalkidan created. Chat history is never removed automatically.
 */
export class LocalData {
  private readonly root: string;
  private task: Promise<unknown> = Promise.resolve();
  constructor(private options: LocalDataOptions) {
    this.root = resolve(options.root);
  }
  private get limit() {
    return this.options.limit ?? localDataLimitBytes;
  }
  private now() {
    return (this.options.now || Date.now)();
  }
  /** Runs one operation at a time, so that a limit check never races a deletion. */
  private serial<T>(work: () => Promise<T>): Promise<T> {
    const next = this.task.catch(() => {}).then(work);
    this.task = next;
    return next;
  }
  private categoryOf(path: string): LocalDataCategory {
    const parts = relative(this.root, path).split(sep);
    if (chromiumCaches.has(parts[0]) || (parts[0] === 'Partitions' && chromiumCaches.has(parts[2])))
      return 'caches';
    if (parts[0] === 'runtime' && parts[1] === 'verdictan' && parts[2] === 'versions')
      return 'runtime';
    return topLevel[parts[0]] || 'other';
  }
  /** The size of each file, by category. Symbolic links count as zero and are not followed. */
  private async walk(start: string, visit: (path: string, size: number, mtime: number) => void) {
    let count = 0;
    const pending = [start];
    while (pending.length && count < walkLimit) {
      const path = pending.pop()!;
      let info;
      try {
        info = await lstat(path);
      } catch {
        continue;
      }
      count++;
      if (info.isSymbolicLink()) continue;
      if (info.isDirectory()) {
        let names: string[] = [];
        try {
          names = await readdir(path);
        } catch {
          continue;
        }
        for (const name of names) pending.push(join(path, name));
      } else if (info.isFile()) visit(path, info.size, info.mtimeMs);
    }
  }
  usage(): Promise<LocalDataUsage> {
    return this.serial(() => this.measure());
  }
  private async measure(): Promise<LocalDataUsage> {
    const categories: Record<LocalDataCategory, number> = {
      'chat-history': 0,
      projects: 0,
      browser: 0,
      settings: 0,
      runtime: 0,
      caches: 0,
      logs: 0,
      other: 0,
    };
    let total = 0;
    await this.walk(this.root, (path, size) => {
      total += size;
      categories[this.categoryOf(path)] += size;
    });
    return {
      root: this.root,
      total,
      limit: this.limit,
      categories: (Object.keys(categories) as LocalDataCategory[]).map((category) => ({
        category,
        bytes: categories[category],
      })),
    };
  }
  /** The version folders that the runtime installation does not use. Unknown state keeps all. */
  private async unusedRuntimeVersions(): Promise<string[]> {
    const base = join(this.root, 'runtime', 'verdictan');
    let kept: Set<string>;
    try {
      const file = await open(
        join(base, 'installation.json'),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      let state: any;
      try {
        state = JSON.parse(await file.readFile('utf8'));
      } finally {
        await file.close();
      }
      // An update in progress can own any folder. Remove nothing until it ends.
      if (
        state?.operation &&
        !['completed', 'canceled', 'failed', 'rolled-back'].includes(state.operation.phase)
      )
        return [];
      kept = new Set(
        (['active', 'previous', 'staged'] as const)
          .map((key) => state?.[key]?.release?.sha256)
          .filter((value): value is string => typeof value === 'string'),
      );
      if (!kept.size) return [];
    } catch {
      return [];
    }
    let names: string[] = [];
    try {
      names = await readdir(join(base, 'versions'));
    } catch {
      return [];
    }
    return names.filter((name) => /^[0-9a-f]{64}$/.test(name) && !kept.has(name));
  }
  /** The logs and caches that Kalkidan can remove, oldest first. */
  private async candidates(): Promise<Candidate[]> {
    const found: Candidate[] = [];
    const cutoff = this.now() - logGraceMs;
    for (const folder of ['operations', 'Crashpad', 'logs']) {
      await this.walk(join(this.root, folder), (path, _size, mtime) => {
        if (mtime <= cutoff)
          found.push({ path, category: 'logs', mtime, remove: () => this.removeInside(path) });
      });
    }
    for (const name of await this.unusedRuntimeVersions()) {
      const path = join(this.root, 'runtime', 'verdictan', 'versions', name);
      try {
        const info = await lstat(path);
        if (info.isDirectory() && !info.isSymbolicLink())
          found.push({
            path,
            category: 'caches',
            mtime: info.mtimeMs,
            remove: () => this.removeInside(path),
          });
      } catch {
        // The folder is already gone.
      }
    }
    if (this.options.clearBrowserCaches) {
      let mtime = this.now();
      try {
        mtime = (await lstat(join(this.root, 'Cache'))).mtimeMs;
      } catch {
        // No cache folder yet. Clear it last.
      }
      found.push({
        path: join(this.root, 'Cache'),
        category: 'caches',
        mtime,
        remove: () => this.options.clearBrowserCaches!(),
      });
    }
    return found.sort((a, b) => a.mtime - b.mtime);
  }
  /** Removes a path inside the data folder. A symbolic link is removed, never its target. */
  private async removeInside(path: string) {
    const target = resolve(path);
    if (!inside(this.root, target)) throw new Error('Kalkidan removes only its own data.');
    await rm(target, { recursive: true, force: true });
  }
  /**
   * Keeps the data folder within the disk limit. When the folder is above the limit, Kalkidan
   * removes the oldest logs and caches first, until the folder is within the limit. It never
   * removes chat history, projects, browser data, or settings. When only these remain above the
   * limit, `overLimit` stays true, and Settings asks the user to delete data.
   */
  enforceLimit() {
    return this.serial(async () => {
      const before = (await this.measure()).total;
      let total = before;
      const removed: string[] = [];
      if (total > this.limit) {
        for (const candidate of await this.candidates()) {
          if (total <= this.limit) break;
          let size = 0;
          await this.walk(candidate.path, (_path, bytes) => (size += bytes));
          try {
            await candidate.remove();
          } catch {
            continue;
          }
          total -= size;
          removed.push(relative(this.root, candidate.path));
        }
        total = (await this.measure()).total;
      }
      return { before, after: total, limit: this.limit, removed, overLimit: total > this.limit };
    });
  }
  /**
   * Copies the Kalkidan data to a new folder in `destination`. The export contains the JSON
   * stores, the agent transcripts, the operation receipts, the project documents and memory in
   * the data folder, and the preview browser history. It never contains a credential, a saved
   * password, a cookie, the runtime, or the code of a repository.
   */
  export(destination: string): Promise<LocalDataExport> {
    return this.serial(async () => {
      const stamp = new Date(this.now()).toISOString().replace(/[:.]/g, '-');
      const folder = join(resolve(destination), `kalkidan-export-${stamp}`);
      if (inside(this.root, folder) || resolve(destination) === this.root)
        throw new Error('Select a folder outside the Kalkidan data folder.');
      await mkdir(folder, { mode: 0o700 });
      const files: string[] = [];
      const copy = async (source: string) => {
        const name = relative(this.root, source);
        const target = join(folder, name);
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await copyFile(source, target, constants.COPYFILE_EXCL);
        files.push(name);
      };
      for (const name of exportedStores) {
        const path = join(this.root, name);
        try {
          const info = await lstat(path);
          if (info.isFile() && !info.isSymbolicLink()) await copy(path);
        } catch {
          // The store does not exist yet.
        }
      }
      const transcript = (path: string) =>
        !secretNames.has(path.split(sep).pop() || '') && /\.(?:jsonl|json|md)$/.test(path);
      const pending: string[] = [];
      await this.walk(join(this.root, 'managed-agent-homes'), (path) => {
        if (transcript(path)) pending.push(path);
      });
      await this.walk(join(this.root, 'operations'), (path) => pending.push(path));
      await this.walk(join(this.root, 'docs'), (path) => pending.push(path));
      await this.walk(join(this.root, 'projects'), (path) => {
        const parts = relative(join(this.root, 'projects'), path).split(sep);
        // The code is in the repositories. Copy the documents and the memory only.
        if (parts[1] === 'docs' || parts[1] === 'memory' || parts[1] === '.kalkidan-project')
          pending.push(path);
      });
      for (const path of pending.sort()) await copy(path);
      try {
        const profile = JSON.parse(
          await readFile(join(this.root, 'browser', 'profile.json'), 'utf8'),
        );
        const history = { history: profile?.history ?? [], downloads: profile?.downloads ?? [] };
        await mkdir(join(folder, 'browser'), { mode: 0o700 });
        await writeFile(join(folder, 'browser', 'history.json'), JSON.stringify(history, null, 2), {
          mode: 0o600,
          flag: 'wx',
        });
        files.push(join('browser', 'history.json'));
      } catch {
        // No browser profile, or it is damaged. The export continues without it.
      }
      const manifest = {
        schema: 1,
        createdAt: new Date(this.now()).toISOString(),
        source: this.root,
        excluded: [
          'credentials (agent auth.json files, Verdictan account and runtime credentials)',
          'saved browser passwords and cookies',
          'Chromium caches and site storage',
          'the Verdictan runtime',
          'repository code and worktrees',
        ],
        files,
      };
      await writeFile(join(folder, 'manifest.json'), JSON.stringify(manifest, null, 2), {
        mode: 0o600,
        flag: 'wx',
      });
      return { path: folder, files: files.length };
    });
  }
  /**
   * Deletes data of one kind. `chat-history` removes the agent transcripts, the session notes,
   * the chat outcomes, and the conversation bindings; the caller clears the bindings with the
   * binding store, so that the installation and host identities stay. `caches-and-logs` removes
   * all logs, unused runtime versions, and the Chromium caches.
   */
  delete(kind: LocalDataDeletion) {
    return this.serial(async () => {
      const removed: string[] = [];
      if (kind === 'chat-history') {
        for (const name of ['managed-agent-homes', 'sessions.json', 'chat-outcomes.json']) {
          await this.removeInside(join(this.root, name));
          removed.push(name);
        }
      } else {
        for (const folder of ['operations', 'Crashpad', 'logs']) {
          await this.removeInside(join(this.root, folder));
          removed.push(folder);
        }
        for (const name of await this.unusedRuntimeVersions()) {
          await this.removeInside(join(this.root, 'runtime', 'verdictan', 'versions', name));
          removed.push(join('runtime', 'verdictan', 'versions', name));
        }
        if (this.options.clearBrowserCaches) {
          await this.options.clearBrowserCaches();
          removed.push('Cache');
        }
      }
      return { removed };
    });
  }
}

/** The entries in `~/.kalkidan` on an SSH host that Kalkidan made and removes with the host. */
const hostOwnedEntries = [
  'managed-agent-homes',
  'operations',
  // The socket folder of the helper. The helper stops after the removal.
  'run',
  'runtime',
  'docs',
  'verdictan-bindings.json',
  'agent-executables.json',
];

/**
 * Removes the Kalkidan data on an SSH host: the helper in `~/.local/share/kalkidan/agents`, and
 * the entries in `~/.kalkidan` that Kalkidan made. Project folders (`~/.kalkidan/projects`) stay,
 * because they can contain work of the user. A folder is removed only when it is then empty.
 * It never follows a symbolic link and never touches a path outside these folders.
 */
export async function removeHostData(home: string) {
  const root = join(resolve(home), '.kalkidan');
  const helper = join(resolve(home), '.local', 'share', 'kalkidan');
  const removed: string[] = [];
  const kept: string[] = [];
  const owned = async (path: string) => {
    try {
      return !(await lstat(path)).isSymbolicLink();
    } catch {
      return false;
    }
  };
  if (await owned(root)) {
    for (const name of hostOwnedEntries) {
      const path = join(root, name);
      try {
        await lstat(path);
      } catch {
        continue;
      }
      await rm(path, { recursive: true, force: true });
      removed.push(join('~/.kalkidan', name));
    }
    let rest: string[] = [];
    try {
      rest = await readdir(root);
    } catch {
      // The folder is gone.
    }
    // Lock files that the directory lock left behind belong to Kalkidan too.
    for (const name of rest.filter((entry) => entry.startsWith('.') && entry.endsWith('.lock')))
      await rm(join(root, name), { recursive: true, force: true });
    rest = rest.filter((entry) => !(entry.startsWith('.') && entry.endsWith('.lock')));
    if (rest.length) kept.push(...rest.map((name) => join('~/.kalkidan', name)));
    else {
      await rm(root, { recursive: true, force: true });
      removed.push('~/.kalkidan');
    }
  }
  if (await owned(join(helper, 'agents'))) {
    await rm(join(helper, 'agents'), { recursive: true, force: true });
    removed.push('~/.local/share/kalkidan/agents');
    try {
      if (!(await readdir(helper)).length) await rm(helper, { recursive: true, force: true });
    } catch {
      // Keep the folder.
    }
  }
  return { removed, kept };
}
