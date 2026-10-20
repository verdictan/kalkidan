import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { TaskExecutions } from '../electron/operations/task-execution';
import type { ChatRun } from '../src/domain/conversation';
test('task recovery retains accepted work and reconciles an uncertain status without replay', async () => {
  const root = await mkdtemp(join(tmpdir(), 'task-execution-'));
  try {
    let status = 'todo',
      writes = 0;
    const effects = {
      inspect: async () => ({
        projectId: 'P',
        fieldId: 'F',
        sourceStatus: status,
        targetStatus: 'doing',
      }),
      write: async () => {
        writes++;
        status = 'doing';
        throw new Error('Lost reply');
      },
    };
    const service = new TaskExecutions(root, effects);
    const run: ChatRun = {
      id: 'run',
      agent: 'codex',
      sessionId: 'session',
      status: 'running',
      sessionReady: true,
      messages: [],
      activity: '',
    };
    const accepted = await service.start(
      'operation',
      { groupId: 'G', taskId: 'I' },
      async () => run,
    );
    assert.equal(accepted.taskExecution?.sync, 'confirmed');
    assert.equal(writes, 1);
    const restored = new TaskExecutions(root, effects);
    const completed = await restored.observe({ ...run, status: 'completed' });
    assert.equal(completed.taskExecution?.phase, 'ready-for-review');
    assert.equal((await restored.observe(run)).taskExecution?.phase, 'ready-for-review');
    assert.equal(writes, 1);
    assert.equal(status, 'doing', 'successful agent completion must not move the task to Done');
    await assert.rejects(
      restored.start('operation', { groupId: 'other', taskId: 'I' }, async () => run),
      /another project/,
    );
    // A crash after dispatch leaves a durable writing phase. Recovery observes only.
    const file = join(root, `${accepted.taskExecution!.id}.json`);
    const receipt = JSON.parse(await readFile(file, 'utf8'));
    receipt.sync = 'writing';
    delete receipt.checkedAt;
    await writeFile(file, JSON.stringify(receipt));
    assert.equal(
      (await new TaskExecutions(root, effects).observe(run)).taskExecution?.sync,
      'confirmed',
    );
    assert.equal(writes, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('external status and workflow changes do not overwrite GitHub or fail the accepted agent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'task-conflict-'));
  try {
    let reads = 0,
      writes = 0;
    const service = new TaskExecutions(root, {
      inspect: async () => ({
        projectId: 'P',
        fieldId: 'F',
        sourceStatus: ++reads === 1 ? 'todo' : 'external',
        targetStatus: 'doing',
      }),
      write: async () => {
        writes++;
      },
    });
    const run: ChatRun = {
      id: 'R',
      agent: 'claude',
      sessionId: 'S',
      status: 'running',
      sessionReady: true,
      messages: [],
      activity: '',
    };
    const accepted = await service.start('op', { groupId: 'G', taskId: 'I' }, async () => run);
    assert.equal(accepted.status, 'running');
    assert.equal(accepted.taskExecution?.sync, 'blocked');
    assert.match(accepted.taskExecution?.message || '', /externally/);
    await service.observe(run);
    assert.equal(writes, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
