import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AgentStarts } from '../electron/operations/agent-start';
import type { ChatRun } from '../src/domain/conversation';
test('agent start receipts coalesce concurrent requests and prevent replay after restart or a lost response', async () => {
  const root = await mkdtemp(join(tmpdir(), 'agent-start-'));
  const id = '11111111-1111-4111-8111-111111111111';
  const run: ChatRun = {
    id: 'run',
    agent: 'codex',
    sessionId: 'session',
    status: 'running',
    messages: [],
    activity: 'Working',
  };
  let calls = 0;
  try {
    const service = new AgentStarts(root, () => run);
    const effect = async () => {
      calls++;
      return run;
    };
    const first = service.run(id, ['prompt'], effect);
    assert.equal(service.run(id, ['prompt'], effect), first);
    await assert.rejects(service.run(id, ['different'], effect), /different/);
    await first;
    assert.equal((await service.run(id, ['prompt'], effect)).id, 'run');
    const restarted = new AgentStarts(root, () => {
      throw Error('no owner');
    });
    await assert.rejects(restarted.run(id, ['prompt'], effect), /uncertain/);
    assert.equal(calls, 1);
    const failed = '22222222-2222-4222-8222-222222222222';
    await assert.rejects(
      service.run(failed, [], async () => {
        calls++;
        throw Error('lost response');
      }),
    );
    await assert.rejects(service.run(failed, [], effect), /uncertain/);
    assert.equal(calls, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
