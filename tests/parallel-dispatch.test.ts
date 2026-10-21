import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { ParallelDispatch } from '../electron/operations/parallel-dispatch';
import type { ChatRun } from '../src/domain/conversation';
import type { DispatchRequest } from '../src/domain/parallel-dispatch';

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'dispatch-'));
  let identity = 'account-a',
    revision = '1',
    launches = 0,
    active = 0,
    maxActive = 0,
    failLaunch = false;
  const runs = new Map<string, ChatRun>();
  const effects = {
    identity: async () => identity,
    inspect: async () => ({ title: 'Task', prompt: 'Implement the task', revision }),
    checkout: async () => 'checkout',
    launch: async () => {
      launches++;
      if (failLaunch) throw Error('Connection lost');
      const run = { id: randomUUID(), status: 'running' } as ChatRun;
      runs.set(run.id, run);
      active++;
      maxActive = Math.max(active, maxActive);
      return run;
    },
    status: async (_request: unknown, row: { runId?: string }) => runs.get(row.runId!)!,
    stop: async (_request: unknown, row: { runId?: string }) => {
      runs.get(row.runId!)!.status = 'stopped';
      active--;
    },
  };
  const engine = new ParallelDispatch(root, effects);
  t.after(async () => {
    engine.close();
    await rm(root, { recursive: true, force: true });
  });
  const request: DispatchRequest = {
    id: randomUUID(),
    groupId: 'project',
    agent: 'codex',
    concurrency: 2,
    tasks: [1, 2, 3].map((n) => ({ taskId: `task-${n}`, repositoryId: 'repo' })),
  };
  return {
    engine,
    request,
    effects,
    root,
    runs,
    stats: () => ({ launches, maxActive }),
    setIdentity: (value: string) => {
      identity = value;
    },
    change: () => {
      revision = '2';
    },
    fail: () => {
      failLaunch = true;
    },
    complete: () => {
      for (const run of runs.values())
        if (run.status === 'running') {
          run.status = 'completed';
          active--;
        }
    },
  };
}
test('dispatch requires review, bounds concurrency, and reuses durable plan IDs', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.engine.prepare(f.request)).state, 'review');
  await f.engine.tick(f.request.id);
  assert.equal(f.stats().launches, 0);
  await f.engine.prepare(f.request);
  await f.engine.start(f.request.id);
  assert.equal(
    (await f.engine.tick(f.request.id)).rows.filter((row) => row.state === 'running').length,
    2,
  );
  f.complete();
  await f.engine.tick(f.request.id);
  assert.equal(f.stats().launches, 3);
  assert.equal(f.stats().maxActive, 2);
  f.complete();
  assert.equal((await f.engine.tick(f.request.id)).state, 'completed');
  await f.engine.start(f.request.id);
  await f.engine.tick(f.request.id);
  assert.equal(f.stats().launches, 3);
});
test('dispatch rejects duplicate tasks, changed plans, changed accounts, and stale review', async (t) => {
  const f = await fixture(t);
  await f.engine.prepare(f.request);
  await assert.rejects(f.engine.prepare({ ...f.request, id: randomUUID() }), /already belongs/);
  await assert.rejects(f.engine.prepare({ ...f.request, concurrency: 1 }), /different plan/);
  f.setIdentity('account-b');
  await assert.rejects(f.engine.start(f.request.id), /account/);
  f.setIdentity('account-a');
  f.change();
  await f.engine.start(f.request.id);
  assert.equal((await f.engine.tick(f.request.id)).state, 'paused');
  assert.equal(f.stats().launches, 0);
});
test('unknown launch outcomes never replay and retain duplicate-task claims after cancel', async (t) => {
  const f = await fixture(t);
  f.fail();
  await f.engine.prepare(f.request);
  await f.engine.start(f.request.id);
  const plan = await f.engine.tick(f.request.id);
  assert.equal(plan.rows[0].state, 'uncertain');
  const restart = new ParallelDispatch(f.root, f.effects);
  try {
    await restart.start(f.request.id);
    await restart.tick(f.request.id);
    assert.equal(f.stats().launches, 1);
    await restart.cancel(f.request.id);
    await assert.rejects(restart.prepare({ ...f.request, id: randomUUID() }), /already belongs/);
  } finally {
    restart.close();
  }
});
test('cancel stops owned sessions and releases unstarted tasks', async (t) => {
  const f = await fixture(t);
  await f.engine.prepare(f.request);
  await f.engine.start(f.request.id);
  await f.engine.tick(f.request.id);
  const plan = await f.engine.cancel(f.request.id);
  assert.ok(plan.rows.every((row) => row.state === 'canceled'));
  assert.equal((await f.engine.prepare({ ...f.request, id: randomUUID() })).state, 'review');
});

test('an account change while a worktree is prepared prevents native launch', async (t) => {
  const f = await fixture(t);
  await f.engine.prepare(f.request);
  f.effects.checkout = async () => {
    f.setIdentity('account-b');
    return 'checkout';
  };
  await f.engine.start(f.request.id);
  const result = await f.engine.tick(f.request.id);
  assert.equal(result.state, 'paused');
  assert.equal(f.stats().launches, 0);
});
test('concurrent plans cannot reserve the same task', async (t) => {
  const f = await fixture(t);
  const outcomes = await Promise.allSettled([
    f.engine.prepare(f.request),
    f.engine.prepare({ ...f.request, id: randomUUID() }),
  ]);
  assert.equal(outcomes.filter((outcome) => outcome.status === 'fulfilled').length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.status === 'rejected').length, 1);
});

test('uncertain dispatch is inspected and explicitly released without replay', async (t) => {
  const f = await fixture(t);
  const engine = new ParallelDispatch(f.root, {
    ...f.effects,
    reconcile: async () => ({ canRelease: true }),
  });
  t.after(() => engine.close());
  f.fail();
  await engine.prepare(f.request);
  await engine.start(f.request.id);
  await engine.tick(f.request.id);
  const inspected = await engine.reconcile(f.request.id, 'task-1');
  assert.equal(inspected.rows[0].state, 'uncertain');
  const released = await engine.reconcile(f.request.id, 'task-1', true);
  assert.equal(released.rows[0].state, 'canceled');
  assert.equal(f.stats().launches, 1);
});

test('recovery cannot release a live run or expose another account plan', async (t) => {
  const f = await fixture(t);
  const engine = new ParallelDispatch(f.root, {
    ...f.effects,
    reconcile: async () => ({
      run: { id: 'accepted', status: 'running' } as ChatRun,
      canRelease: false,
    }),
  });
  t.after(() => engine.close());
  f.fail();
  await engine.prepare(f.request);
  await engine.start(f.request.id);
  await engine.tick(f.request.id);
  await assert.rejects(engine.reconcile(f.request.id, 'task-1', true), /Stop the owned session/);
  await engine.cancel(f.request.id);
  const recovered = await engine.reconcile(f.request.id, 'task-1');
  assert.equal(recovered.state, 'paused');
  assert.equal(recovered.rows[0].runId, 'accepted');
  assert.equal(recovered.rows[0].state, 'running');
  f.setIdentity('another-account');
  await assert.rejects(engine.reconcile(f.request.id, 'task-1'), /account that prepared/);
});
