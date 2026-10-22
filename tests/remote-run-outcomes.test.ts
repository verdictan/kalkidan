import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ChatOutcomes, hostOutcomes } from '../electron/chat-outcomes';
import { chatOutcomeOf, failureReason, outcomeLabel } from '../src/domain/chat-outcome';
import { RunOutcomeLog } from '../electron/operations/run-outcomes';
import type { ChatRun } from '../src/types';

const run = (changes: Partial<ChatRun>): ChatRun => ({
  id: 'run-1',
  agent: 'codex',
  sessionId: 's1',
  status: 'completed',
  messages: [],
  activity: '',
  ...changes,
});

async function temporary(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'kalkidan-run-outcomes-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('the host log keeps one file for each run and gives the latest run of each chat', async (t) => {
  const root = join(await temporary(t), 'run-outcomes');
  const log = new RunOutcomeLog(root, 3);
  // No folder yet: no outcomes.
  assert.deepEqual(await log.list(), []);
  await log.finished(
    {
      state: run({ id: 'r1', status: 'failed', error: 'timed out' }),
      sessionId: 's1',
      create: false,
    },
    '2026-10-01T10:00:00.000Z',
  );
  await log.finished(
    { state: run({ id: 'r2' }), sessionId: 's1', create: false },
    '2026-10-01T11:00:00.000Z',
  );
  await log.finished(
    {
      state: run({ id: 'r3', agent: 'claude', sessionId: 's2', status: 'stopped' }),
      sessionId: 's2',
      create: false,
    },
    '2026-10-01T09:00:00.000Z',
  );
  // A running run and a draft that did not save have no outcome.
  await log.finished({
    state: run({ id: 'r4', status: 'running' }),
    sessionId: 's1',
    create: false,
  });
  await log.finished({ state: run({ id: 'r5', sessionId: '' }), sessionId: '', create: true });
  assert.deepEqual((await readdir(root)).sort(), ['r1.json', 'r2.json', 'r3.json']);
  assert.deepEqual(
    (await log.list()).map((row) => [row.agent, row.id, row.outcome, row.runId]),
    [
      ['codex', 's1', 'completed', 'r2'],
      ['claude', 's2', 'stopped', 'r3'],
    ],
  );
  // The host does not know the desktop ID of the host, so the records have no host.
  assert.equal((await log.list())[0].hostId, undefined);
  // A damaged file, a file of a different run and other files are ignored.
  await writeFile(join(root, 'bad.json'), '{not json');
  await writeFile(join(root, 'moved.json'), await readFile(join(root, 'r2.json'), 'utf8'));
  await writeFile(join(root, 'note.txt'), 'x');
  await writeFile(join(root, 'large.json'), 'x'.repeat(5000));
  assert.equal((await log.list()).length, 2);
  // The log removes the oldest runs when it has more than its limit.
  await log.finished(
    { state: run({ id: 'r6', sessionId: 's3' }), sessionId: 's3', create: false },
    '2026-10-01T12:00:00.000Z',
  );
  const names = await readdir(root);
  assert.equal(names.includes('r6.json'), true);
  await log.list();
  const kept = (await readdir(root)).filter((name) => /^r\d\.json$/.test(name)).sort();
  assert.deepEqual(kept, ['r1.json', 'r2.json', 'r6.json']);
  // A file that the log cannot remove stays, and the list still works.
  await log.finished(
    { state: run({ id: 'r7', sessionId: 's4' }), sessionId: 's4', create: false },
    '2026-10-01T13:00:00.000Z',
  );
  await chmod(root, 0o500);
  try {
    assert.equal((await log.list()).length, 3);
  } finally {
    await chmod(root, 0o700);
  }
  assert.ok((await readdir(root)).includes('r1.json'));
  // A folder that cannot be read is an error.
  await assert.rejects(new RunOutcomeLog(join(root, 'r1.json')).list(), /ENOTDIR/);
});

test('host outcomes get the desktop session ID and the desktop clock', () => {
  const now = Date.parse('2026-10-01T12:00:00.000Z');
  const records = hostOutcomes(
    'h1',
    {
      // The host clock is 10 minutes behind the desktop clock.
      now: '2026-10-01T11:50:00.000Z',
      outcomes: [
        {
          agent: 'codex',
          id: 's1',
          outcome: 'completed',
          at: '2026-10-01T11:40:00.000Z',
          runId: 'r1',
        },
        { agent: 'codex', id: 'other::s1', outcome: 'completed', at: '2026-10-01T11:40:00.000Z' },
        {
          agent: 'codex',
          id: 's2',
          hostId: 'h2',
          outcome: 'stopped',
          at: '2026-10-01T11:40:00.000Z',
        },
        {
          agent: 'codex',
          id: 's3',
          outcome: 'failed',
          reason: 'raw text',
          at: '2026-10-01T11:40:00.000Z',
        },
        'nonsense',
      ],
    },
    now,
  );
  assert.deepEqual(records, [
    {
      agent: 'codex',
      id: 'h1::s1',
      outcome: 'completed',
      at: '2026-10-01T11:50:00.000Z',
      hostId: 'h1',
      runId: 'r1',
    },
  ]);
  // Without a host time, the times stay. A time out of range is ignored.
  assert.equal(
    hostOutcomes(
      'h1',
      {
        outcomes: [
          { agent: 'codex', id: 's1', outcome: 'stopped', at: '2026-10-01T11:40:00.000Z' },
        ],
      },
      now,
    )[0].at,
    '2026-10-01T11:40:00.000Z',
  );
  assert.deepEqual(
    hostOutcomes(
      'h1',
      {
        now: '-200000-01-01T00:00:00.000Z',
        outcomes: [
          { agent: 'codex', id: 's1', outcome: 'stopped', at: '2026-10-01T11:40:00.000Z' },
        ],
      },
      8.64e15,
    ),
    [],
  );
  for (const value of [null, 'text', { outcomes: 'x' }, { now: 'x' }])
    assert.deepEqual(hostOutcomes('h1', value, now), []);
  assert.deepEqual(hostOutcomes('../h', { outcomes: [] }, now), []);
});

test('recovered outcomes replace a lost run and never a newer outcome', async (t) => {
  const root = await temporary(t);
  const file = join(root, 'chat-outcomes.json');
  const store = new ChatOutcomes(file);
  const now = Date.parse('2026-10-01T12:00:00.000Z');
  const recover = (outcomes: unknown[]) =>
    store.recover('h1', { now: '2026-10-01T12:00:00.000Z', outcomes }, now);
  // The desktop saw the connection close during run r1.
  await store.record({
    agent: 'codex',
    id: 'h1::s1',
    hostId: 'h1',
    outcome: 'failed',
    reason: 'transport_lost',
    at: '2026-10-01T11:00:00.000Z',
    runId: 'r1',
  });
  // The run continued on the host and completed. The host time can be earlier.
  assert.equal(
    await recover([
      {
        agent: 'codex',
        id: 's1',
        outcome: 'completed',
        at: '2026-10-01T10:59:00.000Z',
        runId: 'r1',
      },
    ]),
    true,
  );
  assert.equal(store.get('codex', 'h1::s1')?.outcome, 'completed');
  // The same outcome again changes nothing and does not write the file again.
  assert.equal(
    await recover([
      {
        agent: 'codex',
        id: 's1',
        outcome: 'completed',
        at: '2026-10-01T10:59:00.000Z',
        runId: 'r1',
      },
    ]),
    false,
  );
  // A run that ended when the app was closed: the desktop has no record of it.
  assert.equal(
    await recover([
      {
        agent: 'claude',
        id: 's2',
        outcome: 'failed',
        reason: 'api_error',
        at: '2026-10-01T11:30:00.000Z',
        runId: 'r2',
      },
    ]),
    true,
  );
  assert.deepEqual(store.get('claude', 'h1::s2'), {
    outcome: 'failed',
    reason: 'api_error',
    at: '2026-10-01T11:30:00.000Z',
  });
  // An older run of the host does not replace a newer outcome of the desktop.
  await store.record({
    agent: 'codex',
    id: 'h1::s1',
    hostId: 'h1',
    outcome: 'failed',
    reason: 'transport_lost',
    at: '2026-10-01T11:45:00.000Z',
    runId: 'r3',
  });
  assert.equal(
    await recover([
      {
        agent: 'codex',
        id: 's1',
        outcome: 'completed',
        at: '2026-10-01T11:00:00.000Z',
        runId: 'r1',
      },
    ]),
    false,
  );
  assert.equal(store.get('codex', 'h1::s1')?.reason, 'transport_lost');
  // The host also marks a run that ended because the connection closed. That keeps the outcome.
  assert.equal(
    await recover([
      {
        agent: 'codex',
        id: 's1',
        outcome: 'failed',
        reason: 'transport_lost',
        at: '2026-10-01T11:46:00.000Z',
        runId: 'r3',
      },
    ]),
    false,
  );
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.deepEqual(
    saved.outcomes.map((row: any) => [row.id, row.outcome, row.runId]),
    [
      ['h1::s1', 'failed', 'r3'],
      ['h1::s2', 'failed', 'r2'],
    ],
  );
});

test('a run that the helper stopped without an app has its own reason', () => {
  assert.equal(failureReason({ errorCode: 'unattended_limit' }), 'unattended_limit');
  assert.deepEqual(
    chatOutcomeOf({ status: 'failed', errorCode: 'unattended_limit' }, '2026-10-01T10:00:00.000Z'),
    { outcome: 'failed', reason: 'unattended_limit', at: '2026-10-01T10:00:00.000Z' },
  );
  assert.equal(
    outcomeLabel({ outcome: 'failed', reason: 'unattended_limit' }),
    'The last run failed. The run stopped on the SSH host because no app was connected for too long.',
  );
});
