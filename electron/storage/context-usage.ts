import { constants } from 'node:fs';
import { lstat, open } from 'node:fs/promises';
import { join } from 'node:path';
import { writeJSON } from './atomic-json';
import { memoryDirectory } from './project-memory';
import { withDirectoryLock } from './directory-lock';
import type { ContextUsage } from '../../src/domain/memory';

/** The limits keep the usage file small. The oldest chats go first. */
export const contextUsageLimits = { chats: 500, items: 40, text: 160, fileBytes: 1024 * 1024 };
// The SHA-256 of "kalkidan-context-usage". The usage file has its own lock, not the memory lock.
const lockKey = 'af41f85a8c3df101e61141c838afa9f1d782136587025af00ae25d11cf6c6712';
const sessionPattern = /^[a-zA-Z0-9_-]{1,160}$/;
const agentPattern = /^(codex|claude)$/;

interface Stored extends ContextUsage {
  updatedAt: string;
}
type UsageFile = Record<string, Stored>;

const empty = (): ContextUsage => ({ memory: [], docs: [] });
const text = (value: unknown) =>
  typeof value === 'string' && value.trim()
    ? value.trim().slice(0, contextUsageLimits.text)
    : undefined;
const key = (agent: string, id: string) => {
  if (!agentPattern.test(agent) || !sessionPattern.test(id)) throw new Error('Invalid session');
  return agent + ':' + id;
};

/** Removes duplicates and bad values, and keeps the first items up to the limit. */
export function normalizeUsage(value: unknown): ContextUsage {
  const usage = empty();
  if (!value || typeof value !== 'object') return usage;
  const input = value as Partial<Record<keyof ContextUsage, unknown>>;
  const memoryIds = new Set<string>();
  for (const item of Array.isArray(input.memory) ? input.memory : []) {
    const id = text(item?.id);
    const topic = text(item?.topic);
    if (!id || !topic || memoryIds.has(id) || usage.memory.length >= contextUsageLimits.items)
      continue;
    memoryIds.add(id);
    const title = text(item.title);
    usage.memory.push({ id, topic, ...(title ? { title } : {}) });
  }
  const docKeys = new Set<string>();
  for (const item of Array.isArray(input.docs) ? input.docs : []) {
    const docId = text(item?.docId);
    const title = text(item?.title);
    const heading = text(item?.heading);
    const docKey = docId + '\n' + (heading || '');
    if (!docId || !title || docKeys.has(docKey) || usage.docs.length >= contextUsageLimits.items)
      continue;
    docKeys.add(docKey);
    usage.docs.push({ docId, title, ...(heading ? { heading } : {}) });
  }
  return usage;
}

async function readUsage(directory: string): Promise<UsageFile> {
  let file;
  try {
    file = await open(
      join(directory, '.context-usage.json'),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
  } catch (error: any) {
    if (error.code === 'ENOENT') return {};
    throw error;
  }
  try {
    const buffer = Buffer.alloc(contextUsageLimits.fileBytes + 1);
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
    if (bytesRead > contextUsageLimits.fileBytes) return {};
    const value = JSON.parse(buffer.subarray(0, bytesRead).toString('utf8'));
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result: UsageFile = {};
    for (const [name, entry] of Object.entries(value as Record<string, any>)) {
      const [agent, id] = name.split(':');
      if (!agentPattern.test(agent || '') || !sessionPattern.test(id || '')) continue;
      result[name] = {
        ...normalizeUsage(entry),
        updatedAt: typeof entry?.updatedAt === 'string' ? entry.updatedAt : '',
      };
    }
    return result;
  } catch (error) {
    // A damaged usage file holds only counts. Start again rather than block chats.
    if (error instanceof SyntaxError) return {};
    throw error;
  } finally {
    await file.close();
  }
}

async function directoryOf(root: string) {
  if ((await lstat(root)).isSymbolicLink())
    throw new Error('Project root cannot be a symbolic link.');
  return memoryDirectory(root);
}

/**
 * Records what an agent read in one chat: memory facts and doc passages. New items join the
 * items of earlier turns of the same chat. The write is atomic and the file is bounded.
 */
export async function recordContextUsage(
  root: string,
  agent: string,
  id: string,
  read: ContextUsage,
  now = () => new Date().toISOString(),
) {
  const name = key(agent, id);
  const added = normalizeUsage(read);
  if (!added.memory.length && !added.docs.length) return false;
  const directory = await directoryOf(root);
  return withDirectoryLock(
    directory,
    async (assertOwned) => {
      const usage = await readUsage(directory);
      const before = usage[name] || empty();
      const merged = normalizeUsage({
        memory: [...before.memory, ...added.memory],
        docs: [...before.docs, ...added.docs],
      });
      usage[name] = { ...merged, updatedAt: now() };
      const kept = Object.entries(usage)
        .sort(([, a], [, b]) => b.updatedAt.localeCompare(a.updatedAt))
        .slice(0, contextUsageLimits.chats);
      assertOwned();
      await writeJSON(join(directory, '.context-usage.json'), Object.fromEntries(kept));
      return true;
    },
    lockKey,
  );
}

/** What the agent read in one chat. Empty when nothing was recorded. */
export async function contextUsage(root: string, agent: string, id: string) {
  const name = key(agent, id);
  const usage = await readUsage(await directoryOf(root));
  const { memory, docs } = usage[name] || empty();
  return { memory, docs } satisfies ContextUsage;
}

/** How many chats read each memory entry and each doc page. */
export async function readCounts(root: string) {
  const usage = await readUsage(await directoryOf(root));
  const counts = {
    memory: {} as Record<string, number>,
    docs: {} as Record<string, number>,
  };
  for (const entry of Object.values(usage)) {
    for (const id of new Set(entry.memory.map((item) => item.id)))
      counts.memory[id] = (counts.memory[id] || 0) + 1;
    for (const id of new Set(entry.docs.map((item) => item.docId)))
      counts.docs[id] = (counts.docs[id] || 0) + 1;
  }
  return counts;
}
