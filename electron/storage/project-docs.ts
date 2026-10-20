import { DocsRetrievalIndex, docSearchTerms } from './docs-retrieval';
import { mkdir, readdir, readFile, writeFile, rename, rm, lstat, open } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import type { DeletedProjectDoc, ProjectDoc, ProjectDocMetadata } from '../../src/domain/docs';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
/** Returns the sibling order of a page header, or nothing when the header has no valid order. */
const orderOf = (value: unknown) =>
  typeof value === 'number' && Number.isFinite(value) ? { order: value } : {};
export class ProjectDocs {
  private queues = new Map<string, Promise<unknown>>();
  private bodies = new Map<string, { stamp: string; doc: ProjectDoc }>();
  private headers = new Map<string, { stamp: string; meta: ProjectDocMetadata }>();
  private activeSearches = new Set<string>();
  private searchIndexes = new Map<string, DocsRetrievalIndex>();
  readonly metrics = { bodyReads: 0, headerReads: 0 };
  private stamp(info: Awaited<ReturnType<typeof lstat>>) {
    return [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs].join(':');
  }
  constructor(
    private root: string,
    private validGroup: (id: string) => boolean,
    private resolveDirectory?: (id: string) => Promise<string>,
  ) {}
  private async directory(group: string) {
    if (!/^[\w-]+$/.test(group) || !this.validGroup(group)) throw new Error('Project not found');
    const dir = this.resolveDirectory ? await this.resolveDirectory(group) : join(this.root, group);
    await mkdir(dir, { recursive: true, mode: 0o700 });
    if ((await lstat(dir)).isSymbolicLink())
      throw new Error('Docs folder cannot be a symbolic link');
    return dir;
  }
  private file(dir: string, id: string) {
    if (!/^[\w-]+$/.test(id)) throw new Error('Invalid page ID');
    return join(dir, id + '.md');
  }
  private async read(dir: string, id: string): Promise<ProjectDoc> {
    const path = this.file(dir, id);
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error('Page cannot be a symbolic link');
    const stamp = this.stamp(info);
    const cached = this.bodies.get(path);
    if (cached?.stamp === stamp) {
      this.bodies.delete(path);
      this.bodies.set(path, cached);
      return structuredClone(cached.doc);
    }
    this.metrics.bodyReads++;
    const text = await readFile(path, 'utf8');
    const end = text.indexOf('\n');
    if (!text.startsWith('<!-- kalkidan ') || end < 0)
      throw new Error('Invalid page metadata: ' + id);
    const meta = JSON.parse(text.slice(14, end - 4));
    const doc: ProjectDoc = {
      id,
      title: meta.title,
      parentId: meta.parentId,
      ...orderOf(meta.order),
      markdown: text.slice(end + 1),
      revision: hash(text),
    };
    // Only cache a stable read; external edits must invalidate the entry.
    if (this.stamp(await lstat(path)) === stamp) {
      this.bodies.delete(path);
      this.bodies.set(path, { stamp, doc });
      if (this.bodies.size > 32) this.bodies.delete(this.bodies.keys().next().value!);
    }
    return structuredClone(doc);
  }
  async list(group: string) {
    const dir = await this.directory(group);
    const files = await readdir(dir);
    return Promise.all(
      files
        .filter((f) => f.endsWith('.md'))
        .sort()
        .map((f) => this.read(dir, f.slice(0, -3))),
    );
  }
  /** Refresh changed pages only. Deleted and trashed pages leave the index immediately. */
  async search(group: string, query: string) {
    if (typeof query !== 'string') throw new Error('Enter a document search query.');
    const dir = await this.directory(group);
    if (!docSearchTerms(query).length) return [];
    return this.change(group, async () => {
      let index = this.searchIndexes.get(dir);
      if (!index) index = new DocsRetrievalIndex();
      this.searchIndexes.delete(dir);
      this.searchIndexes.set(dir, index);
      this.activeSearches.add(dir);
      try {
        const names = (await readdir(dir)).filter((name) => name.endsWith('.md')).sort();
        const ids = new Set(names.map((name) => name.slice(0, -3)));
        for (const id of index.stamps.keys()) if (!ids.has(id)) index.remove(id);
        for (const id of ids) {
          const info = await lstat(this.file(dir, id));
          if (info.isSymbolicLink()) throw new Error('Page cannot be a symbolic link');
          const stamp = this.stamp(info);
          if (index.stamps.get(id) !== stamp) index.update(await this.read(dir, id), stamp);
        }
        return index.search(query);
      } finally {
        this.activeSearches.delete(dir);
        for (const [key, cached] of this.searchIndexes) {
          if (this.searchIndexes.size <= 8) break;
          if (!this.activeSearches.has(key)) {
            cached.close();
            this.searchIndexes.delete(key);
          }
        }
      }
    });
  }
  async get(group: string, id: string) {
    return this.read(await this.directory(group), id);
  }
  async metadata(group: string): Promise<ProjectDocMetadata[]> {
    const dir = await this.directory(group);
    const names = (await readdir(dir)).filter((name) => name.endsWith('.md')).sort();
    const result: ProjectDocMetadata[] = [];
    for (const name of names) {
      const path = join(dir, name);
      const info = await lstat(path);
      if (info.isSymbolicLink()) throw new Error('Page cannot be a symbolic link');
      const stamp = this.stamp(info);
      const cached = this.headers.get(path);
      if (cached?.stamp === stamp) {
        result.push({ ...cached.meta });
        continue;
      }
      this.metrics.headerReads++;
      const file = await open(path, 'r');
      let header = '';
      try {
        const buffer = Buffer.alloc(1024);
        const decoder = new StringDecoder('utf8');
        let offset = 0;
        while (!header.includes('\n') && offset < 16384) {
          const { bytesRead } = await file.read(buffer, 0, buffer.length, offset);
          if (!bytesRead) break;
          header += decoder.write(buffer.subarray(0, bytesRead));
          offset += bytesRead;
        }
      } finally {
        await file.close();
      }
      const end = header.indexOf('\n');
      if (!header.startsWith('<!-- kalkidan ') || end < 0)
        throw new Error('Invalid page metadata: ' + name);
      const value = JSON.parse(header.slice(14, end - 4));
      const meta: ProjectDocMetadata = {
        id: name.slice(0, -3),
        title: value.title,
        parentId: value.parentId,
        ...orderOf(value.order),
      };
      if (this.stamp(await lstat(path)) === stamp) this.headers.set(path, { stamp, meta });
      result.push(meta);
    }
    const valid = new Set(names.map((name) => join(dir, name)));
    for (const path of this.headers.keys())
      if (path.startsWith(dir + '/') && !valid.has(path)) this.headers.delete(path);
    return result;
  }
  private change<T>(group: string, action: () => Promise<T>): Promise<T> {
    const task = (this.queues.get(group) || Promise.resolve()).catch(() => {}).then(action);
    this.queues.set(group, task);
    const clean = () => {
      if (this.queues.get(group) === task) this.queues.delete(group);
    };
    task.then(clean, clean);
    return task;
  }
  private async write(dir: string, doc: ProjectDoc) {
    if (!doc.title.trim() || doc.title.length > 200 || doc.markdown.length > 2000000)
      throw new Error('Enter a title up to 200 characters and content under 2 MB');
    const { order: requested, ...rest } = doc;
    const order = orderOf(requested);
    const text =
      '<!-- kalkidan ' +
      JSON.stringify({ title: doc.title.trim(), parentId: doc.parentId, ...order }) +
      ' -->\n' +
      doc.markdown;
    const file = this.file(dir, doc.id);
    const temp = file + '.' + randomUUID() + '.tmp';
    try {
      await writeFile(temp, text, { mode: 0o600 });
      await rename(temp, file);
    } finally {
      await rm(temp, { force: true });
    }
    return { ...rest, ...order, title: doc.title.trim(), revision: hash(text) };
  }
  create(group: string, title: string, parentId: string | null) {
    return this.change(group, async () => {
      const dir = await this.directory(group);
      if (parentId) await this.read(dir, parentId);
      return this.write(dir, { id: randomUUID(), title, parentId, markdown: '', revision: '' });
    });
  }
  save(group: string, doc: ProjectDoc) {
    return this.change(group, async () => {
      const dir = await this.directory(group);
      const previous = await this.read(dir, doc.id);
      if (previous.revision !== doc.revision)
        throw new Error(
          'This page changed on disk. Reopen it before saving to avoid overwriting changes.',
        );
      const visited = new Set([doc.id]);
      let parent = previous.parentId === doc.parentId ? null : doc.parentId;
      while (parent) {
        if (visited.has(parent)) throw new Error('A page cannot be nested inside itself');
        visited.add(parent);
        const page = await this.read(dir, parent);
        parent = page.parentId;
      }
      return this.write(dir, doc);
    });
  }
  delete(group: string, id: string, revision: string) {
    return this.change(group, async () => {
      const dir = await this.directory(group);
      const doc = await this.read(dir, id);
      if (doc.revision !== revision)
        throw new Error('Page changed on disk. Reload before deleting.');
      if ((await this.metadata(group)).some((p) => p.parentId === id))
        throw new Error('Move or delete child pages first.');
      const trash = join(dir, '.trash');
      await mkdir(trash, { recursive: true });
      await rename(this.file(dir, id), join(trash, id + '-' + Date.now() + '.md'));
    });
  }
  /** Lists deleted pages, newest first. */
  async trash(group: string): Promise<DeletedProjectDoc[]> {
    const trash = join(await this.directory(group), '.trash');
    let names: string[];
    try {
      names = await readdir(trash);
    } catch (error: any) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
    const result: DeletedProjectDoc[] = [];
    for (const name of names) {
      const match = name.match(/^([\w-]+)-(\d+)\.md$/);
      if (!match) continue;
      try {
        const doc = await this.read(trash, match[1] + '-' + match[2]);
        result.push({
          trashId: match[1] + '-' + match[2],
          id: match[1],
          title: doc.title,
          deletedAt: Number(match[2]),
        });
      } catch {
        // Skip files in the trash that are not Kalkidan pages.
      }
    }
    return result.sort((a, b) => b.deletedAt - a.deletedAt);
  }
  /** Moves a deleted page back. It goes to the top level if its parent no longer exists. */
  restore(group: string, trashId: string) {
    return this.change(group, async () => {
      const match = /^([\w-]+)-(\d+)$/.exec(trashId);
      if (!match) throw new Error('Invalid deleted page');
      const dir = await this.directory(group);
      const trash = join(dir, '.trash');
      const deleted = await this.read(trash, trashId);
      const pages = await this.metadata(group);
      const id = pages.some((p) => p.id === match[1]) ? randomUUID() : match[1];
      const parentId =
        deleted.parentId && pages.some((p) => p.id === deleted.parentId) ? deleted.parentId : null;
      const doc = await this.write(dir, { ...deleted, id, parentId });
      await rm(this.file(trash, trashId), { force: true });
      return doc;
    });
  }
}
