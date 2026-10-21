import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, readFile, realpath, rename, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { writeJSON } from './atomic-json';
import { memoryDirectory } from './project-memory';
import { withDirectoryLock } from './directory-lock';
import type {
  MemoryCandidate,
  MemoryEntry,
  MemorySource,
  MemoryWriteResult,
} from '../../src/domain/memory';

const hash = (text: string) => createHash('sha256').update(text).digest('hex');
const normalized = (text: string) =>
  text.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();
export const memoryLimits = {
  entries: 200,
  fileBytes: 64 * 1024,
  bytes: 1024 * 1024,
  content: 2000,
  retrieval: 4800,
  results: 3,
};
const prefix = '<!-- kalkidan-memory ';
const queues = new Map<string, Promise<unknown>>();
export interface MemoryScope {
  root: string;
  sessionId: string;
  turnId: string;
  sources(): MemorySource[];
}
export function unsafeMemory(value: string) {
  return /(?:-----BEGIN .*PRIVATE KEY-----|\b(?:sk-|gh[pousr]_|github_pat_)[A-Za-z0-9_-]{16,}|\b(?:password|secret|api[_ -]?key|access[_ -]?token)\s*[:=]\s*\S+|ignore (?:all |the )?(?:previous|system) instructions)/i.test(
    value,
  );
}
/** The backend binds the root and sources. Tool arguments cannot change either. */
export class ManagedMemory {
  constructor(
    private scope: MemoryScope,
    private changed: () => void = () => {},
    private now = () => new Date().toISOString(),
  ) {}
  private async directory() {
    if ((await lstat(this.scope.root)).isSymbolicLink())
      throw new Error('Project root cannot be a symbolic link.');
    const root = await realpath(this.scope.root);
    return memoryDirectory(root);
  }
  private async load(directory: string) {
    const names = (await readdir(directory)).filter((name) => name.endsWith('.md')).sort();
    if (names.length > memoryLimits.entries)
      throw new Error('Memory has too many files. Consolidate the library before saving.');
    const index = await this.index(directory);
    const entries: { name: string; entry: MemoryEntry; text: string }[] = [];
    let total = 0;
    for (const name of names) {
      const file = await open(join(directory, name), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await file.stat();
        if (
          !info.isFile() ||
          info.size > memoryLimits.fileBytes ||
          (total += info.size) > memoryLimits.bytes
        )
          throw new Error('Memory exceeds its supported size. No files were changed.');
        const buffer = Buffer.alloc(memoryLimits.fileBytes + 1);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        const text = buffer.subarray(0, bytesRead).toString('utf8');
        if (Buffer.byteLength(text) > memoryLimits.fileBytes)
          throw new Error('Memory file grew during reading.');
        if (bytesRead !== info.size) throw new Error('Memory changed during reading. Retry.');
        const end = text.indexOf('\n');
        let entry: MemoryEntry;
        if (text.startsWith(prefix)) {
          if (end < 0 || !text.slice(0, end).endsWith(' -->'))
            throw new Error('Truncated memory metadata.');
          const meta = JSON.parse(text.slice(prefix.length, end - 4));
          if (
            meta.version !== 1 ||
            !/^[a-f0-9]{64}$/.test(meta.id) ||
            typeof meta.topic !== 'string' ||
            !Array.isArray(meta.supersedes) ||
            !meta.source ||
            !Array.isArray(meta.source.references)
          )
            throw new Error('Invalid memory metadata.');
          const content = text.slice(end + 1);
          entry = {
            ...meta,
            content,
            revision: hash(text),
            provenance:
              meta.contentHash === hash(content) && index[meta.id] === hash(text)
                ? meta.provenance
                : 'external',
          };
        } else {
          entry = {
            version: 1,
            id: hash(name),
            topic: name.replace(/\.md$/, ''),
            content: text,
            revision: hash(text),
            provenance: 'legacy',
            source: { sessionId: '', turnId: '', references: [] },
            createdAt: info.birthtime.toISOString(),
            updatedAt: info.mtime.toISOString(),
            supersedes: [],
          };
        }
        entries.push({ name, entry, text });
      } finally {
        await file.close();
      }
    }
    return entries;
  }
  private async index(directory: string): Promise<Record<string, string>> {
    try {
      const file = await open(
        join(directory, '.managed-index.json'),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const buffer = Buffer.alloc(65537);
        const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
        if (bytesRead > 65536) throw new Error('Memory index exceeds its size limit.');
        const value = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
        if (
          !value ||
          Array.isArray(value) ||
          typeof value !== 'object' ||
          Object.entries(value).some(
            ([id, revision]) =>
              !/^[a-f0-9]{64}$/.test(id) ||
              typeof revision !== 'string' ||
              !/^[a-f0-9]{64}$/.test(revision),
          )
        )
          throw new Error('Invalid memory index.');
        return value;
      } finally {
        await file.close();
      }
    } catch (error: any) {
      if (error.code === 'ENOENT') return {};
      throw error;
    }
  }
  async list() {
    const directory = await this.directory();
    return withDirectoryLock(directory, async () =>
      (await this.load(directory)).map(({ entry }) => entry),
    );
  }
  /**
   * Marks an entry as wrong. The file moves to the `.forgotten` folder, so agents no longer get
   * it, and `.forgotten/log.json` keeps a record. Rejects when the entry changed.
   */
  async forget(id: string, revision: string) {
    if (typeof id !== 'string' || !/^[a-f0-9]{64}$/.test(id) || typeof revision !== 'string')
      throw new Error('Invalid memory entry.');
    const directory = await this.directory();
    const action = (queues.get(directory) || Promise.resolve())
      .catch(() => {})
      .then(() =>
        withDirectoryLock(directory, async (assertOwned) => {
          const found = (await this.load(directory)).find(({ entry }) => entry.id === id);
          if (!found) throw new Error('Memory entry not found. Reload memory.');
          if (found.entry.revision !== revision)
            throw new Error('This memory entry changed. Reload memory and try again.');
          const archive = join(directory, '.forgotten');
          await mkdir(archive, { recursive: true, mode: 0o700 });
          if ((await lstat(archive)).isSymbolicLink())
            throw new Error('Memory archive cannot be a symbolic link.');
          const date = this.now();
          const name = date.replace(/[^0-9]/g, '').slice(0, 17) + '-' + found.name;
          const logFile = join(archive, 'log.json');
          let log: unknown[] = [];
          try {
            const value = JSON.parse(await readFile(logFile, 'utf8'));
            if (Array.isArray(value)) log = value.slice(-499);
          } catch (error: any) {
            if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
          }
          assertOwned();
          await rename(join(directory, found.name), join(archive, name));
          await writeJSON(logFile, [
            ...log,
            {
              id,
              topic: found.entry.topic,
              revision,
              file: name,
              forgottenAt: date,
              sessionId: found.entry.source.sessionId || undefined,
            },
          ]);
          const index = await this.index(directory);
          if (id in index) {
            delete index[id];
            await writeJSON(join(directory, '.managed-index.json'), index);
          }
          this.changed();
        }),
      );
    queues.set(directory, action);
    try {
      return await action;
    } finally {
      if (queues.get(directory) === action) queues.delete(directory);
    }
  }
  async read(id: string) {
    const entry = (await this.list()).find((value) => value.id === id);
    if (!entry) throw new Error('Memory entry not found.');
    return entry;
  }
  async search(query: string) {
    if (typeof query !== 'string' || query.length > 1000)
      throw new Error('Enter a memory query of up to 1,000 characters.');
    const words = normalized(query)
      .split(' ')
      .filter((word) => word.length > 1);
    if (!words.length) return [];
    const entries = await this.list();
    const superseded = new Set(entries.flatMap((entry) => entry.supersedes));
    let remaining = memoryLimits.retrieval;
    return entries
      .filter((entry) => !superseded.has(entry.id))
      .map((entry) => ({
        entry,
        score: words.filter((word) => normalized(entry.topic + ' ' + entry.content).includes(word))
          .length,
      }))
      .filter(({ score }) => score)
      .sort((a, b) => b.score - a.score || a.entry.id.localeCompare(b.entry.id))
      .slice(0, memoryLimits.results)
      .map(({ entry }) => {
        const excerpt = entry.content.slice(0, Math.min(memoryLimits.content, remaining));
        remaining -= excerpt.length;
        return {
          id: entry.id,
          topic: entry.topic,
          revision: entry.revision,
          provenance: entry.provenance,
          excerpt,
        };
      });
  }
  async upsert(candidate: MemoryCandidate): Promise<MemoryWriteResult> {
    candidate = structuredClone(candidate);
    if (
      !candidate ||
      typeof candidate.topic !== 'string' ||
      !candidate.topic.trim() ||
      candidate.topic.length > 120 ||
      typeof candidate.content !== 'string' ||
      !candidate.content.trim() ||
      candidate.content.length > memoryLimits.content ||
      !Array.isArray(candidate.references) ||
      candidate.references.length > 5 ||
      (candidate.id !== undefined && !/^[a-f0-9]{64}$/.test(candidate.id)) ||
      (candidate.supersedes !== undefined &&
        (!Array.isArray(candidate.supersedes) || candidate.supersedes.length > 5))
    )
      throw new Error('Invalid memory candidate.');
    if (unsafeMemory(candidate.content) || unsafeMemory(candidate.topic))
      return {
        status: 'deferred',
        reason: 'The candidate contains sensitive or instruction-like content.',
      };
    const sources = this.scope.sources();
    if (
      !candidate.references.length ||
      candidate.references.some(
        (reference) =>
          !reference ||
          typeof reference.quote !== 'string' ||
          !reference.quote.trim() ||
          reference.quote.length > 4000 ||
          unsafeMemory(reference.quote) ||
          !sources.some(
            (source) =>
              source.id === reference.id &&
              source.text
                .split(/\r?\n/)
                .some((line) => normalized(line) === normalized(reference.quote)),
          ),
      )
    )
      return { status: 'deferred', reason: 'The candidate needs exact references from this turn.' };
    // Extractive evidence is verifiable. Model summaries remain proposals until reviewed.
    if (
      !candidate.references.some(
        (reference) => normalized(reference.quote) === normalized(candidate.content),
      )
    )
      return {
        status: 'deferred',
        reason: 'The proposed fact is not directly supported by its source text.',
      };
    const directory = await this.directory();
    const action = (queues.get(directory) || Promise.resolve())
      .catch(() => {})
      .then(() =>
        withDirectoryLock(directory, async (assertOwned): Promise<MemoryWriteResult> => {
          const all = await this.load(directory);
          const existing = candidate.id
            ? all.find(({ entry }) => entry.id === candidate.id)
            : undefined;
          if (candidate.id && (!existing || existing.entry.revision !== candidate.expectedRevision))
            return {
              status: 'conflict',
              id: candidate.id,
              revision: existing?.entry.revision || '',
            };
          const duplicate = all.find(
            ({ entry }) => normalized(entry.content) === normalized(candidate.content),
          );
          if (duplicate)
            return duplicate.entry.provenance === 'verified'
              ? { status: 'duplicate', entry: duplicate.entry }
              : { status: 'deferred', reason: 'Matching external or legacy content needs review.' };
          for (const target of candidate.supersedes || []) {
            if (!target || typeof target.id !== 'string' || target.id === candidate.id)
              throw new Error('Invalid supersession.');
            const old = all.find(({ entry }) => entry.id === target.id)?.entry;
            if (!old || old.revision !== target.revision)
              return { status: 'conflict', id: target.id, revision: old?.revision || '' };
            const seen = new Set<string>();
            const visit = (id: string): boolean => {
              if (id === candidate.id) return true;
              if (seen.has(id)) return false;
              seen.add(id);
              return (all.find(({ entry }) => entry.id === id)?.entry.supersedes || []).some(visit);
            };
            if (visit(target.id)) throw new Error('Memory supersession cannot contain a cycle.');
            if (old.provenance !== 'verified')
              return {
                status: 'deferred',
                reason: 'External and legacy facts need review before supersession.',
              };
          }
          if (existing?.entry.provenance === 'external' || existing?.entry.provenance === 'legacy')
            return {
              status: 'deferred',
              reason: 'Preserve external and legacy content. Save a separate sourced entry.',
            };
          if (!existing && all.length >= memoryLimits.entries)
            throw new Error('Memory entry limit reached.');
          const date = this.now();
          const entry: MemoryEntry = {
            version: 1,
            id: existing?.entry.id || hash(randomUUID()),
            topic: candidate.topic.trim(),
            content: candidate.content.trim(),
            revision: '',
            provenance: 'verified',
            source: {
              sessionId: this.scope.sessionId,
              turnId: this.scope.turnId,
              references: candidate.references,
            },
            createdAt: existing?.entry.createdAt || date,
            updatedAt: date,
            supersedes: candidate.supersedes?.map(({ id }) => id) || [],
          };
          const { content, revision: _revision, ...meta } = entry;
          const text =
            prefix + JSON.stringify({ ...meta, contentHash: hash(content) }) + ' -->\n' + content;
          if (Buffer.byteLength(text) > memoryLimits.fileBytes)
            throw new Error('Memory entry size limit reached.');
          if (
            all.reduce((total, value) => total + Buffer.byteLength(value.text), 0) -
              Buffer.byteLength(existing?.text || '') +
              Buffer.byteLength(text) >
            memoryLimits.bytes
          )
            throw new Error('Memory library size limit reached.');
          const target = join(directory, existing?.name || entry.id + '.md');
          const temporary = join(directory, '.' + randomUUID() + '.tmp');
          try {
            const file = await open(
              temporary,
              constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
              0o600,
            );
            try {
              await file.writeFile(text);
              await file.sync();
            } finally {
              await file.close();
            }
            // Detect an external edit that arrived while the temporary file was written.
            if (existing) {
              const latest = (await this.load(directory)).find(
                ({ entry }) => entry.id === existing.entry.id,
              )?.entry;
              if (latest?.revision !== existing.entry.revision)
                return { status: 'conflict', id: entry.id, revision: latest?.revision || '' };
            }
            assertOwned();
            await rename(temporary, target);
          } finally {
            await rm(temporary, { force: true });
          }
          entry.revision = hash(text);
          const index = await this.index(directory);
          assertOwned();
          await writeJSON(join(directory, '.managed-index.json'), {
            ...index,
            [entry.id]: entry.revision,
          });
          this.changed();
          return { status: 'saved', entry };
        }),
      );
    queues.set(directory, action);
    try {
      return await action;
    } finally {
      if (queues.get(directory) === action) queues.delete(directory);
    }
  }
}

/** Memory of a project root for the UI. It reads and forgets entries. It cannot save them. */
export function projectMemory(root: string, changed?: () => void) {
  return new ManagedMemory({ root, sessionId: '', turnId: '', sources: () => [] }, changed);
}
