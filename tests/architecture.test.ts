import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runtimeConfig } from '../electron/config/runtime';
import { writeJSON } from '../electron/storage/atomic-json';
import { AgentRuntimes, type AgentRuntime } from '../electron/agents/runtime';
import { createProjectPrompt } from '../electron/projects/prompt';
import { TrackerRegistry } from '../electron/trackers/registry';
import { isTrackerConnection } from '../src/domain/tracker';
import type { Agent, ChatRun, Session } from '../src/types';

test('runtime configuration validates defaults and explicit overrides', () => {
  assert.equal(runtimeConfig({}).defaultTracker, 'github');
  assert.equal(
    runtimeConfig({
      KALKIDAN_DEFAULT_TRACKER: 'example',
      KALKIDAN_CODEX_PATH: '/tmp/codex',
      KALKIDAN_AGENT_REQUEST_TIMEOUT_MS: '12000',
    }).agentExecutable.codex,
    '/tmp/codex',
  );
  for (const env of [
    { KALKIDAN_CODEX_PATH: 'codex' },
    { KALKIDAN_AGENT_REQUEST_TIMEOUT_MS: 'NaN' },
    { KALKIDAN_AGENT_REQUEST_TIMEOUT_MS: '10' },
    { KALKIDAN_DEFAULT_TRACKER: '../plugin' },
  ])
    assert.throws(() => runtimeConfig(env));
  assert.equal(
    isTrackerConnection({
      provider: 'unknown-but-valid',
      project: { id: '1', title: 'Board', url: 'https://example.com' },
    }),
    true,
  );
  assert.equal(isTrackerConnection({ provider: 'example', project: null }), false);
});

test('atomic JSON writes create private files and leave no temporary artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kalkidan-storage-'));
  try {
    const file = join(root, 'nested', 'state.json');
    await writeJSON(file, { revision: 1 });
    await writeJSON(file, { revision: 2 });
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), { revision: 2 });
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.deepEqual(await readdir(join(root, 'nested')), ['state.json']);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('agent routing isolates runs, approvals, and shutdown by registered adapter', async () => {
  const calls: string[] = [];
  function adapter(agent: Agent): AgentRuntime {
    const state: ChatRun = {
      id: agent,
      sessionId: 'session',
      agent,
      status: 'running',
      messages: [],
      activity: '',
    };
    return {
      start: async () => state,
      status: (id) => {
        assert.equal(id, agent);
        return state;
      },
      stop: (id) => calls.push('stop:' + id),
      approve: (id) => calls.push('approve:' + id),
      stopAll: () => calls.push('all:' + agent),
      dispose: () => calls.push('dispose:' + agent),
    };
  }
  const runtimes = new AgentRuntimes([
    { id: 'codex', runtime: adapter('codex') },
    { id: 'claude', runtime: adapter('claude') },
  ]);
  for (const agent of ['codex', 'claude'] as const)
    await runtimes.start(
      { id: 'session', agent, cwd: '/tmp', title: '', updatedAt: '' },
      'Hello',
      false,
    );
  assert.equal(runtimes.status('claude').agent, 'claude');
  runtimes.approve('codex', 'request', false);
  runtimes.stop('claude');
  runtimes.dispose();
  assert.deepEqual(calls, ['approve:codex', 'stop:claude', 'dispose:codex', 'dispose:claude']);
  assert.throws(() => runtimes.status('codex'), /no longer available/);
  await assert.rejects(
    runtimes.start({ agent: 'missing' } as unknown as Session, 'Hello', false),
    /unavailable/,
  );
});

test('project prompt resolves the most specific repository on the correct host', async () => {
  const provider = { descriptor: { id: 'fake' } } as any;
  const prompt = createProjectPrompt({
    trackers: new TrackerRegistry([provider], 'fake'),
    groups: () => [{ id: 'g', name: 'Remote', repoIds: ['remote'] }],
    projects: () => [
      { id: 'local', name: 'Local', path: '/repo', notes: '', addedAt: '', favorite: false },
      {
        id: 'remote',
        name: 'Remote repo',
        path: '/repo',
        hostId: 'ssh',
        notes: '',
        addedAt: '',
        favorite: false,
      },
    ],
  });
  assert.equal(await prompt('/repo', 'Hello'), 'Hello');
  assert.match(await prompt('/repo/subdir', 'Hello', undefined, 'ssh'), /Remote repo/);
  await assert.rejects(prompt('/missing', 'Hello', { taskId: 'task' }), /no longer linked/);
});
