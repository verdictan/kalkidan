import { mkdir, readFile, writeFile, readdir, lstat, realpath } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';

export async function prepareProjectLocation(
  id: string,
  requested: string | undefined,
  base: string,
) {
  if (!/^[\w-]+$/.test(id)) throw new Error('Invalid project ID');
  const path = requested?.trim() || join(base, id);
  const expanded = path.startsWith('~/') ? join(homedir(), path.slice(2)) : path;
  if (!isAbsolute(expanded))
    throw new Error('Project location must be an absolute path or start with ~/.');
  await mkdir(expanded, { recursive: true });
  if ((await lstat(expanded)).isSymbolicLink())
    throw new Error('Choose a project folder, not a symbolic link.');
  const contents = await readdir(expanded);
  if (contents.length && !contents.includes('.kalkidan-project'))
    throw new Error('Choose an empty folder for this project.');
  const marker = join(expanded, '.kalkidan-project');
  if (contents.includes('.kalkidan-project') && (await lstat(marker)).isSymbolicLink())
    throw new Error('Project marker cannot be a symbolic link.');
  try {
    await writeFile(marker, id, { flag: 'wx', mode: 0o600 });
  } catch (error: any) {
    if (error.code !== 'EEXIST') throw error;
    if ((await readFile(marker, 'utf8')) !== id)
      throw new Error('This folder belongs to another project.');
  }
  for (const name of ['docs', 'repos', 'worktrees']) {
    const child = join(expanded, name);
    await mkdir(child, { recursive: true });
    if ((await lstat(child)).isSymbolicLink())
      throw new Error(name + ' must not be a symbolic link.');
  }
  return realpath(expanded);
}

// Keep the legacy files as a recovery copy; preserve exact bytes and revisions.
export async function legacyDocs(path: string): Promise<{ name: string; content: string }[]> {
  let entries;
  try {
    entries = await readdir(path, { withFileTypes: true });
  } catch (error: any) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }
  const result: { name: string; content: string }[] = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.md'))
      result.push({ name: entry.name, content: await readFile(join(path, entry.name), 'utf8') });
    else if (entry.name === '.trash' && entry.isDirectory())
      result.push(
        ...(await legacyDocs(join(path, '.trash'))).map((file) => ({
          ...file,
          name: '.trash/' + file.name,
        })),
      );
  }
  return result;
}
export async function importLegacyDocs(root: string, files: { name: string; content: string }[]) {
  for (const file of files) {
    if (!/^(?:\.trash\/)?[\w-]+\.md$/.test(file.name)) throw new Error('Invalid legacy document');
    if (file.name.startsWith('.trash/')) {
      await mkdir(join(root, 'docs', '.trash'), { recursive: true });
      if ((await lstat(join(root, 'docs', '.trash'))).isSymbolicLink())
        throw new Error('Invalid trash folder');
    }
    const target = join(root, 'docs', file.name);
    try {
      await writeFile(target, file.content, { flag: 'wx', mode: 0o600 });
    } catch (error: any) {
      if (error.code !== 'EEXIST') throw error;
      if ((await lstat(target)).isSymbolicLink()) throw new Error('Invalid legacy document target');
      if ((await readFile(target, 'utf8')) !== file.content)
        throw new Error('Document migration conflict: ' + file.name);
    }
  }
}

// Cache successful initialization briefly, and share concurrent preparation.
// Each host process owns its cache, so reconnecting to a new agent cannot reuse it.
export class ProjectLocationCache {
  readonly metrics = { preparations: 0 };
  private entries = new Map<
    string,
    { expires: number; value: Promise<string>; identity?: string }
  >();
  constructor(
    private base: string,
    private ttl = 30000,
  ) {}
  private async identity(root: string) {
    const [directory, marker] = await Promise.all([
      lstat(root),
      lstat(join(root, '.kalkidan-project')),
    ]);
    if (directory.isSymbolicLink() || marker.isSymbolicLink())
      throw new Error('Project location cannot be a symbolic link');
    return [
      directory.dev,
      directory.ino,
      marker.dev,
      marker.ino,
      marker.size,
      marker.mtimeMs,
      marker.ctimeMs,
    ].join(':');
  }
  async get(id: string, path?: string): Promise<string> {
    const key = JSON.stringify([id, path]);
    const existing = this.entries.get(key);
    if (existing && existing.expires > Date.now()) {
      try {
        const root = await existing.value;
        // Cheap identity checks detect replacement without repeating setup and marker reads.
        if (
          (await this.identity(
            path?.startsWith('~/') ? join(homedir(), path.slice(2)) : path || root,
          )) === existing.identity
        )
          return root;
      } catch (error) {
        this.entries.delete(key);
        throw error;
      }
      this.entries.delete(key);
    }
    this.metrics.preparations++;
    const entry: { expires: number; value: Promise<string>; identity?: string } = {
      expires: Date.now() + this.ttl,
      value: Promise.resolve(''),
    };
    entry.value = prepareProjectLocation(id, path, this.base).then(async (root) => {
      entry.identity = await this.identity(root);
      return root;
    });
    this.entries.set(key, entry);
    try {
      return await entry.value;
    } catch (error) {
      if (this.entries.get(key) === entry) this.entries.delete(key);
      throw error;
    }
  }
  invalidate(id: string, path?: string) {
    this.entries.delete(JSON.stringify([id, path]));
  }
}
