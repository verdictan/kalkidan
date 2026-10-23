import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applySubagentEvent,
  claudeSubagents,
  codexParentThread,
  codexSessionMeta,
  finishSubagents,
  subagentActiveMs,
} from '../electron/subagents';
import { history, nestCodexSubagents } from '../electron/history';
import type { SubagentSession } from '../src/domain/desktop';
import type { Session } from '../src/types';

const lines = (rows: unknown[]) => rows.map((row) => JSON.stringify(row)).join('\n') + '\n';

async function claudeHome() {
  const root = await mkdtemp(join(tmpdir(), 'kalkidan-subagents-'));
  const project = join(root, 'projects', '-work-atlas');
  await mkdir(join(project, 'session-1', 'subagents'), { recursive: true });
  const session = join(project, 'session-1.jsonl');
  await writeFile(
    session,
    lines([
      {
        type: 'user',
        sessionId: 'session-1',
        cwd: '/work/atlas',
        message: { role: 'user', content: 'Refine project navigation' },
      },
      {
        type: 'assistant',
        timestamp: '2026-10-01T10:00:00.000Z',
        message: {
          content: [
            {
              type: 'tool_use',
              id: 'toolu_1',
              name: 'Task',
              input: { description: 'Explore auth module', subagent_type: 'Explore', prompt: 'x' },
            },
            {
              type: 'tool_use',
              id: 'toolu_2',
              name: 'Agent',
              input: { description: 'Run the test suite', prompt: 'Run npm test' },
            },
            { type: 'tool_use', id: 'toolu_3', name: 'Bash', input: { command: 'ls' } },
          ],
        },
      },
      {
        type: 'user',
        isSidechain: true,
        message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_1' }] },
      },
      {
        type: 'user',
        toolUseResult: { agentId: 'b2', status: 'completed' },
        message: { content: [{ type: 'tool_result', tool_use_id: 'toolu_2', is_error: true }] },
      },
      'not json',
    ]),
  );
  const subagents = join(project, 'session-1', 'subagents');
  await writeFile(
    join(subagents, 'agent-a1.jsonl'),
    lines([
      {
        type: 'user',
        isSidechain: true,
        agentId: 'a1',
        timestamp: '2026-10-01T10:00:01.000Z',
        message: { role: 'user', content: 'Find where the auth module checks tokens' },
      },
    ]),
  );
  await writeFile(
    join(subagents, 'agent-b2.jsonl'),
    lines([
      {
        type: 'user',
        isSidechain: true,
        agentId: 'b2',
        timestamp: '2026-10-01T10:00:02.000Z',
        message: { role: 'user', content: 'Run npm test' },
      },
    ]),
  );
  await writeFile(join(subagents, 'agent-b2.meta.json'), '{}');
  return { root, session, subagents };
}

test('reads Claude Code subagents with their Task titles and results', async () => {
  const home = await claudeHome();
  try {
    const old = new Date(Date.now() - subagentActiveMs * 2);
    await utimes(join(home.subagents, 'agent-a1.jsonl'), old, old);
    const result = await claudeSubagents(home.session, 'session-1');
    assert.deepEqual(
      result.map(({ id, title, status, type }) => ({ id, title, status, type })),
      [
        // No result names a1, so it takes the free Task call. It stopped without a result.
        { id: 'a1', title: 'Explore auth module', status: 'stopped', type: 'Explore' },
        { id: 'b2', title: 'Run the test suite', status: 'failed', type: undefined },
      ],
    );
    // A subagent file that changed now works.
    const now = new Date();
    await utimes(join(home.subagents, 'agent-a1.jsonl'), now, now);
    assert.equal((await claudeSubagents(home.session, 'session-1'))[0].status, 'running');
  } finally {
    await rm(home.root, { recursive: true, force: true });
  }
});

test('a session without a subagents folder has no subagents', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kalkidan-subagents-'));
  try {
    const session = join(root, 'session-2.jsonl');
    await writeFile(session, lines([{ type: 'user', message: { content: 'Hi' } }]));
    assert.deepEqual(await claudeSubagents(session, 'session-2'), []);
    assert.deepEqual(await claudeSubagents(join(root, 'none.jsonl'), 'none'), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the history scan adds subagents to Claude sessions and hides subagent files', async () => {
  const home = await claudeHome();
  try {
    const { sessions } = await history(join(home.root, 'codex-none'), home.root);
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].id, 'session-1');
    assert.deepEqual(
      sessions[0].subagents?.map((item) => item.title),
      ['Explore auth module', 'Run the test suite'],
    );
  } finally {
    await rm(home.root, { recursive: true, force: true });
  }
});

test('Codex threads that a thread spawned nest under that thread', async () => {
  assert.equal(
    codexParentThread({ source: { subagent: { thread_spawn: { parent_thread_id: 'p-1' } } } }),
    'p-1',
  );
  assert.equal(codexParentThread({ source: 'cli' }), undefined);
  assert.equal(codexParentThread({ parent_thread_id: '../bad' }), undefined);
  const now = Date.parse('2026-10-01T10:10:00.000Z');
  const session = (id: string, updatedAt: string): Session => ({
    id,
    agent: 'codex',
    cwd: '/work',
    title: id,
    updatedAt,
  });
  const sessions = [
    session('child-2', '2026-10-01T10:09:30.000Z'),
    session('parent', '2026-10-01T10:00:00.000Z'),
    session('child-1', '2026-10-01T09:00:00.000Z'),
    session('orphan', '2026-10-01T09:00:00.000Z'),
  ];
  const result = nestCodexSubagents(
    sessions,
    new Map([
      ['child-1', { parent: 'parent' }],
      ['child-2', { parent: 'parent', type: 'review' }],
      ['orphan', { parent: 'gone' }],
    ]),
    now,
  );
  assert.deepEqual(
    result.map((item) => item.id),
    ['parent', 'orphan'],
  );
  assert.deepEqual(
    result[0].subagents?.map(({ id, status, type }) => ({ id, status, type })),
    [
      { id: 'child-1', status: 'done', type: undefined },
      { id: 'child-2', status: 'running', type: 'review' },
    ],
  );
});

test('reads the Codex session_meta line', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kalkidan-codex-'));
  try {
    const path = join(root, 'rollout.jsonl');
    await writeFile(
      path,
      lines([
        {
          type: 'session_meta',
          payload: { id: 'c1', source: { subagent: { thread_spawn: { parent_thread_id: 'p' } } } },
        },
        { type: 'response_item' },
      ]),
    );
    assert.equal(codexParentThread(await codexSessionMeta(path)), 'p');
    assert.equal(await codexSessionMeta(join(root, 'missing.jsonl')), undefined);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('live run events add, update and finish subagents', () => {
  const list: SubagentSession[] = [];
  assert.equal(applySubagentEvent(list, null), false);
  assert.equal(
    applySubagentEvent(list, {
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            id: 't1',
            name: 'Task',
            input: { description: 'Explore auth module' },
          },
          { type: 'tool_use', id: 't2', name: 'Task', input: {} },
          { type: 'tool_use', id: 't3', name: 'Read', input: {} },
        ],
      },
    }),
    true,
  );
  assert.deepEqual(
    list.map(({ id, title, status }) => [id, title, status]),
    [
      ['t1', 'Explore auth module', 'running'],
      ['t2', 'Subagent', 'running'],
    ],
  );
  // Records of the subagent itself show what it does now.
  assert.equal(applySubagentEvent(list, { type: 'assistant', parent_tool_use_id: 't1' }), false);
  assert.equal(
    applySubagentEvent(list, {
      type: 'assistant',
      parent_tool_use_id: 't1',
      message: { content: [{ type: 'tool_use', id: 'x', name: 'Bash', input: {} }] },
    }),
    true,
  );
  assert.equal(list[0].activity, 'Using Bash');
  assert.equal(applySubagentEvent(list, { type: 'user', parent_tool_use_id: 'gone' }), false);
  assert.equal(
    applySubagentEvent(list, {
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 't1' }] },
    }),
    true,
  );
  assert.equal(list[0].status, 'done');
  assert.equal(list[0].activity, undefined);
  finishSubagents(list);
  assert.equal(list[1].status, 'stopped');
  finishSubagents(undefined);
});
