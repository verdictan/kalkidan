import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  contextUsage,
  contextUsageLimits,
  normalizeUsage,
  readCounts,
  recordContextUsage,
} from '../electron/storage/context-usage';
import { resourceRevision } from '../electron/storage/resource-revision';
import { createProjectPrompt } from '../electron/projects/prompt';
import { TrackerRegistry } from '../electron/trackers/registry';
import type { ContextUsage, MemoryEntry } from '../src/domain/memory';
import { backendLoader } from './helpers/backend-loader';

const fact = (n: number) => ({ id: String(n).padStart(64, 'a'), topic: 'Topic ' + n });

async function project() {
  const root = await mkdtemp(join(tmpdir(), 'kalkidan-context-'));
  return { root, done: () => rm(root, { recursive: true, force: true }) };
}

test('context usage records what each chat read and counts the chats per item', async () => {
  const { root, done } = await project();
  try {
    assert.deepEqual(await contextUsage(root, 'codex', 'chat-1'), { memory: [], docs: [] });
    assert.deepEqual(await readCounts(root), { memory: {}, docs: {} });
    const revision = await resourceRevision(root, 'memory');
    assert.equal(
      await recordContextUsage(root, 'codex', 'chat-1', {
        memory: [fact(1), { ...fact(2), title: 'Run the tests' }, fact(1)],
        docs: [{ docId: 'auth', title: 'Auth flow', heading: 'Tokens' }],
      }),
      true,
    );
    // A second turn of the same chat adds new items and keeps the earlier items.
    await recordContextUsage(root, 'codex', 'chat-1', {
      memory: [fact(1)],
      docs: [{ docId: 'auth', title: 'Auth flow', heading: 'Refresh' }],
    });
    await recordContextUsage(root, 'claude', 'chat-2', { memory: [fact(2)], docs: [] });
    assert.deepEqual(await contextUsage(root, 'codex', 'chat-1'), {
      memory: [fact(1), { ...fact(2), title: 'Run the tests' }],
      docs: [
        { docId: 'auth', title: 'Auth flow', heading: 'Tokens' },
        { docId: 'auth', title: 'Auth flow', heading: 'Refresh' },
      ],
    });
    // Two passages of one page count as one chat.
    assert.deepEqual(await readCounts(root), {
      memory: { [fact(1).id]: 1, [fact(2).id]: 2 },
      docs: { auth: 1 },
    });
    // The same session ID of the other agent is another chat.
    assert.deepEqual(await contextUsage(root, 'claude', 'chat-1'), { memory: [], docs: [] });
    // The usage file does not change the memory revision, so Memory does not reload.
    assert.equal(await resourceRevision(root, 'memory'), revision);
    // Nothing read: nothing is written.
    assert.equal(
      await recordContextUsage(root, 'codex', 'chat-3', { memory: [], docs: [] }),
      false,
    );
  } finally {
    await done();
  }
});

test('context usage rejects bad sessions and keeps the file bounded', async () => {
  const { root, done } = await project();
  try {
    await assert.rejects(contextUsage(root, 'codex', '../x'), /Invalid session/);
    await assert.rejects(contextUsage(root, 'other', 'x'), /Invalid session/);
    await assert.rejects(
      recordContextUsage(root, 'codex', 'a b', { memory: [fact(1)], docs: [] }),
      /Invalid session/,
    );
    let tick = 0;
    const clock = () => new Date(Date.UTC(2026, 0, 1, 0, 0, tick++)).toISOString();
    for (let i = 0; i < contextUsageLimits.chats + 3; i++)
      await recordContextUsage(root, 'codex', 'chat-' + i, { memory: [fact(1)], docs: [] }, clock);
    const stored = JSON.parse(await readFile(join(root, 'memory', '.context-usage.json'), 'utf8'));
    assert.equal(Object.keys(stored).length, contextUsageLimits.chats);
    // The oldest chats go first.
    assert.ok(!('codex:chat-0' in stored));
    assert.ok('codex:chat-' + (contextUsageLimits.chats + 2) in stored);
    assert.equal((await readCounts(root)).memory[fact(1).id], contextUsageLimits.chats);
    // Many items in one chat are cut to the limit.
    const many = normalizeUsage({
      memory: Array.from({ length: 100 }, (_, i) => fact(i)),
      docs: Array.from({ length: 100 }, (_, i) => ({ docId: 'd' + i, title: 'T' })),
    });
    assert.equal(many.memory.length, contextUsageLimits.items);
    assert.equal(many.docs.length, contextUsageLimits.items);
    // Bad values are dropped, and long text is cut.
    assert.deepEqual(
      normalizeUsage({
        memory: [{ id: 'x' }, null, { id: 'y', topic: 't'.repeat(500) }],
        docs: [{ docId: 'd' }, 'bad'],
      }),
      { memory: [{ id: 'y', topic: 't'.repeat(contextUsageLimits.text) }], docs: [] },
    );
    assert.deepEqual(normalizeUsage(undefined), { memory: [], docs: [] });
  } finally {
    await done();
  }
});

test('a damaged usage file starts again and a linked root is rejected', async () => {
  const { root, done } = await project();
  try {
    await recordContextUsage(root, 'codex', 'chat', { memory: [fact(1)], docs: [] });
    const file = join(root, 'memory', '.context-usage.json');
    await writeFile(file, '{not json');
    assert.deepEqual(await readCounts(root), { memory: {}, docs: {} });
    await writeFile(file, '[]');
    assert.deepEqual(await readCounts(root), { memory: {}, docs: {} });
    await writeFile(
      file,
      JSON.stringify({ 'bad key': { memory: [fact(1)] }, 'codex:ok': { memory: [fact(2)] } }),
    );
    assert.deepEqual(await readCounts(root), { memory: { [fact(2).id]: 1 }, docs: {} });
    await writeFile(file, 'x'.repeat(contextUsageLimits.fileBytes + 10));
    assert.deepEqual(await readCounts(root), { memory: {}, docs: {} });
    await recordContextUsage(root, 'codex', 'chat', { memory: [fact(3)], docs: [] });
    assert.deepEqual(await readCounts(root), { memory: { [fact(3).id]: 1 }, docs: {} });
    const link = root + '-link';
    await symlink(root, link);
    try {
      await assert.rejects(readCounts(link), /symbolic link/);
    } finally {
      await rm(link, { force: true });
    }
  } finally {
    await done();
  }
});

test('the project prompt collects the doc passages and mentioned items that it gives', async () => {
  const group = { id: 'atlas', name: 'Atlas', repoIds: ['repo'] };
  const prompt = createProjectPrompt({
    trackers: new TrackerRegistry([{ descriptor: { id: 'fake' } } as any], 'fake'),
    projects: () => [
      { id: 'repo', name: 'Repo', path: '/repo', notes: '', addedAt: '', favorite: false },
    ],
    groups: () => [group as any],
    searchDocs: async () => [
      {
        id: 'auth',
        title: 'Auth flow',
        heading: 'Tokens',
        revision: 'r',
        source: 's',
        excerpt: 'e',
      },
    ],
    readDoc: async (_group, id) => ({ id, title: 'Setup', markdown: 'm' }),
    memoryEntries: async () =>
      [{ id: 'm1', topic: 'Testing', content: 'Run npm test.\nThen lint.' }] as MemoryEntry[],
  });
  const read: ContextUsage = { memory: [], docs: [] };
  await prompt('/repo', '@docs how do tokens work', undefined, undefined, read);
  assert.deepEqual(read.docs, [{ docId: 'auth', title: 'Auth flow', heading: 'Tokens' }]);
  const mentions: ContextUsage = { memory: [], docs: [] };
  await prompt(
    '/repo',
    'Look at @[Setup](doc:setup) and @[Testing](memory:m1)',
    undefined,
    undefined,
    mentions,
  );
  assert.deepEqual(mentions.docs, [{ docId: 'setup', title: 'Setup' }]);
  assert.deepEqual(mentions.memory, [{ id: 'm1', topic: 'Testing', title: 'Run npm test.' }]);
});

test('the memory tools report the facts that the agent searched and read', async () => {
  let handler!: Function;
  const server = Object.assign(new EventEmitter(), {
    listen: (_port: number, _host: string, done: Function) => done(),
    address: () => ({ port: 9123 }),
    close() {},
    closeIdleConnections() {},
  });
  class Memory {
    search = async () => [{ id: 'a', topic: 'Tests', excerpt: 'Run npm test.\nMore.' }];
    read = async () => ({ id: 'b', topic: 'Style', revision: '1', content: 'Two spaces.' });
  }
  const { startMemoryTools } = backendLoader({
    'node:http': {
      createServer: (callback: Function) => {
        handler = callback;
        return server;
      },
    },
    [resolve('electron/storage/managed-memory.ts')]: { ManagedMemory: Memory },
  })('electron/agents/memory-tools.ts');
  const read: unknown[] = [];
  const tools = await startMemoryTools(
    { root: '/r', sessionId: 's', turnId: 't', sources: () => [] },
    undefined,
    (entries: unknown[]) => read.push(...entries),
  );
  const call = (name: string, args: unknown) =>
    handler(
      {
        url: new URL(tools.url).pathname,
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        async *[Symbol.asyncIterator]() {
          yield Buffer.from(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'tools/call',
              params: { name, arguments: args },
            }),
          );
        },
      },
      { writeHead() {}, end() {} },
    );
  await call('memory_search', { query: 'tests' });
  await call('memory_read', { id: 'b' });
  await call('memory_sources', {});
  assert.deepEqual(read, [
    { id: 'a', topic: 'Tests', title: 'Run npm test.' },
    { id: 'b', topic: 'Style', title: 'Two spaces.' },
  ]);
});
