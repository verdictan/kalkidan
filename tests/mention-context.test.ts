import test from 'node:test';
import assert from 'node:assert/strict';
import { createProjectPrompt } from '../electron/projects/prompt';
import { mentionContext, mentionHeader } from '../electron/projects/mentions';
import { TrackerRegistry } from '../electron/trackers/registry';
import { visibleUserText } from '../electron/transcript';
import { mentionLimits, mentionToken, type Mention } from '../src/domain/mentions';
import type { MemoryEntry } from '../src/domain/memory';

const memoryEntry = (id: string, content: string) =>
  ({ id, topic: 'Conventions', content }) as MemoryEntry;

function setup(options: { board?: boolean } = {}) {
  const group = {
    id: 'atlas',
    name: 'Atlas',
    repoIds: ['repo'],
    ...(options.board
      ? { tracker: { provider: 'fake', project: { id: 'P', url: 'https://example.test/p' } } }
      : {}),
  };
  const calls: string[] = [];
  const trackers = new TrackerRegistry(
    [
      {
        descriptor: { id: 'fake' },
        board: async () => {
          calls.push('board');
          return {
            items: [
              {
                id: 't1',
                title: 'Ship login',
                status: 'Todo',
                url: 'https://example.test/1',
                body: 'b'.repeat(10000),
              },
            ],
          };
        },
      } as any,
    ],
    'fake',
  );
  const prompt = createProjectPrompt({
    trackers,
    projects: () => [
      { id: 'repo', name: 'Repo', path: '/repo', notes: '', addedAt: '', favorite: false },
    ],
    groups: () => [group as any],
    mentionFile: async (cwd, path, hostId) => {
      calls.push(`file:${cwd}:${path}:${hostId ?? ''}`);
      if (path.includes('..')) throw new Error('The file is outside the code folder.');
      return { path, size: 20, content: 'export const a = 1;' };
    },
    readDoc: async (_group, id) => {
      calls.push('doc:' + id);
      return { id, title: 'Auth flow', markdown: 'd'.repeat(20000), revision: 'r1' };
    },
    memoryEntries: async () => {
      calls.push('memory');
      return [memoryEntry('m1', 'Use two spaces.')];
    },
    chatMessages: async (_group, agent, id) => {
      calls.push(`chat:${agent}:${id}`);
      return {
        title: 'Fix login',
        messages: Array.from({ length: 20 }, (_, i) => ({
          id: String(i),
          role: i % 2 ? ('assistant' as const) : ('user' as const),
          text: `message ${i} ` + 'z'.repeat(2000),
        })),
      };
    },
  });
  return { prompt, calls };
}

test('mention context sits in the wrapper, before "User request:", and restores as user text', async () => {
  const { prompt, calls } = setup({ board: true });
  const file = mentionToken({ kind: 'file', id: 'src/a.ts', label: 'a.ts' });
  const doc = mentionToken({ kind: 'doc', id: 'p1', label: 'Auth flow' });
  const task = mentionToken({ kind: 'task', id: 't1', label: 'Ship login' });
  const memory = mentionToken({ kind: 'memory', id: 'm1', label: 'Conventions' });
  const chat = mentionToken({ kind: 'chat', id: 'claude:s1', label: 'Fix login' });
  const text = `Check ${file} ${doc} ${task} ${memory} ${chat}`;
  const result = await prompt('/repo/src', text);
  const at = result.lastIndexOf('\n\nUser request:\n');
  assert.ok(result.indexOf(mentionHeader) > 0 && result.indexOf(mentionHeader) < at);
  assert.equal(visibleUserText(result), text);
  const items = JSON.parse(result.slice(result.indexOf(mentionHeader) + mentionHeader.length, at));
  assert.deepEqual(
    items.map((item: any) => item.kind),
    ['file', 'doc', 'task', 'memory', 'chat'],
  );
  assert.equal(items[0].content, 'export const a = 1;');
  assert.equal(items[1].content.length, mentionLimits.doc);
  assert.equal(items[1].truncated, true);
  assert.equal(items[2].status, 'Todo');
  assert.equal(items[2].url, 'https://example.test/1');
  assert.equal(items[2].body.length, mentionLimits.task);
  assert.equal(items[3].content, 'Use two spaces.');
  assert.ok(items[4].lastMessages.length <= mentionLimits.chatMessages);
  assert.ok(
    items[4].lastMessages.reduce((size: number, m: any) => size + m.text.length, 0) <=
      mentionLimits.chat,
  );
  assert.equal(items[4].lastMessages.at(-1).text.startsWith('message 19'), true);
  assert.equal(items[4].earlierMessages, true);
  assert.ok(calls.includes('file:/repo/src:src/a.ts:'));
  assert.ok(calls.includes('chat:claude:s1'));
  // One board read serves the task context.
  assert.equal(calls.filter((call) => call === 'board').length, 1);
});

test('mentions without a board, outside the folder, or outside a project are not attached', async () => {
  const { prompt, calls } = setup();
  const task = mentionToken({ kind: 'task', id: 't1', label: 'Ship login' });
  const escape = mentionToken({ kind: 'file', id: '../secret', label: 'secret' });
  const result = await prompt('/repo', `${task} ${escape}`);
  assert.match(result, /"kind":"task","label":"Ship login","unavailable"/);
  assert.match(result, /"kind":"file","label":"secret","unavailable"/);
  assert.ok(!calls.includes('board'));
  // A folder that is not in a project gets the message unchanged.
  assert.equal(await prompt('/other', `${task}`), task);
  // Without mentions, the prompt has no mention context.
  assert.ok(!(await prompt('/repo', 'hello')).includes(mentionHeader));
});

test('"@docs" search still works next to mentions', async () => {
  const group = { id: 'atlas', name: 'Atlas', repoIds: ['repo'] };
  const prompt = createProjectPrompt({
    trackers: new TrackerRegistry([{ descriptor: { id: 'fake' } } as any], 'fake'),
    projects: () => [
      { id: 'repo', name: 'Repo', path: '/repo', notes: '', addedAt: '', favorite: false },
    ],
    groups: () => [group],
    searchDocs: async () => [
      { id: '1', title: 'T', heading: 'H', revision: 'r', source: 'docs/1.md:L1', excerpt: 'e' },
    ],
    readDoc: async (_g, id) => ({ id, title: 'T', markdown: 'page' }),
  });
  const doc = mentionToken({ kind: 'doc', id: '1', label: 'T' });
  const result = await prompt('/repo', `@docs token ${doc}`);
  assert.match(result, /Retrieved project Docs/);
  assert.match(result, /"content":"page"/);
  assert.ok(result.endsWith(`User request:\n@docs token ${doc}`));
});

test('the mention context stays inside the total limit', async () => {
  const mentions: Mention[] = Array.from({ length: 10 }, (_, i) => ({
    kind: 'file',
    id: `f${i}`,
    label: `f${i}`,
  }));
  const context = await mentionContext(mentions, {
    file: async (path) => ({ path, size: 9000, content: 'q'.repeat(mentionLimits.fileCharacters) }),
  });
  assert.ok(context.length <= mentionLimits.total);
  const items = JSON.parse(context.slice(mentionHeader.length));
  assert.ok(items.some((item: any) => item.omitted));
  assert.ok(items.some((item: any) => item.content));
  // Missing readers make their mentions unavailable instead of failing the message.
  const missing = JSON.parse(
    (
      await mentionContext(
        [
          { kind: 'doc', id: '1', label: 'D' },
          { kind: 'chat', id: 'bad', label: 'C' },
          { kind: 'memory', id: 'gone', label: 'M' },
        ],
        { memory: async () => undefined },
      )
    ).slice(mentionHeader.length),
  );
  assert.deepEqual(
    missing.map((item: any) => Boolean(item.unavailable)),
    [true, true, true],
  );
  assert.equal(await mentionContext([], {}), '');
});
