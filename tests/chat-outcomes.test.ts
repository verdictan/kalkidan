import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  chatOutcomeOf,
  chatRowStatus,
  failureReason,
  outcomeLabel,
} from '../src/domain/chat-outcome';
import { ChatOutcomes, outcomeRecord, validateOutcome } from '../electron/chat-outcomes';
import { SessionLibrary } from '../electron/session-library';
import { InteractiveChatRunner, type RunEnded } from '../electron/interactive-chat';
import { RemoteHosts } from '../electron/remote-hosts';
import { DesktopProtocolError } from '../electron/verdictan/protocol';
import type { ChatRun, Session } from '../src/types';

const at = '2026-10-01T10:00:00.000Z';
const run = (changes: Partial<ChatRun>): ChatRun => ({
  id: 'run-1',
  agent: 'codex',
  sessionId: 'saved-1',
  status: 'failed',
  messages: [],
  activity: '',
  ...changes,
});

async function temporary(t: test.TestContext) {
  const root = await mkdtemp(join(tmpdir(), 'kalkidan-outcomes-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('a run maps to an outcome with a safe reason only', () => {
  assert.equal(chatOutcomeOf(run({ status: 'running' }), at), undefined);
  assert.deepEqual(chatOutcomeOf(run({ status: 'completed' }), at), { outcome: 'completed', at });
  assert.deepEqual(chatOutcomeOf(run({ status: 'stopped' }), at), { outcome: 'stopped', at });
  assert.deepEqual(
    chatOutcomeOf(
      run({
        errorCode: 'managed_launch_blocked',
        managedCode: 'desktop.runtime_missing',
        error: 'Kalkidan runs agents only through managed Verdictan agents.',
      }),
      at,
    ),
    { outcome: 'refused', reason: 'desktop.runtime_missing', at },
  );
  // A blocked launch without a code still is a refusal, with the general code.
  assert.equal(
    chatOutcomeOf(run({ errorCode: 'managed_launch_blocked', error: 'Blocked.' }), at)?.reason,
    'desktop.launch_blocked',
  );
  const cases: [Partial<ChatRun>, string][] = [
    [{ errorCode: 'transport_lost', error: 'The remote connection was lost.' }, 'transport_lost'],
    [{ errorCode: 'session_busy' }, 'session_busy'],
    [{ errorCode: 'desktop.gateway_failed' }, 'desktop.gateway_failed'],
    [
      {
        error:
          'API Error: 409 This turn stopped after an earlier refusal: Budget exceeded for team secret-team (budget_exceeded)',
      },
      'gateway_refused',
    ],
    [{ error: 'Check failed. [desktop.readiness_failed]' }, 'desktop.readiness_failed'],
    [
      {
        error:
          'Some actions were denied by the agent permission policy. Review its configuration and ask the agent to retry.',
      },
      'permission_denied',
    ],
    [{ error: 'Agent timed out during initialize.' }, 'timeout'],
    [{ error: 'API Error: 529 {"type":"overloaded_error"}' }, 'api_error'],
    [{ error: 'Provider said: my private prompt text' }, 'agent_error'],
    [{}, 'agent_error'],
  ];
  for (const [changes, reason] of cases) {
    const outcome = chatOutcomeOf(run(changes), at);
    assert.equal(outcome?.outcome, 'failed');
    assert.equal(outcome?.reason, reason, JSON.stringify(changes));
    assert.equal(failureReason(changes), reason);
  }
});

test('outcome words are plain and never show provider text or codes', () => {
  const failed = outcomeLabel({ outcome: 'failed', reason: 'gateway_refused' });
  assert.equal(
    failed,
    'The last run failed. The Verdictan gateway stopped this turn after a refusal.',
  );
  assert.match(outcomeLabel({ outcome: 'failed', reason: 'transport_lost' }), /connection/);
  assert.match(
    outcomeLabel({ outcome: 'failed', reason: 'desktop.gateway_failed' }),
    /^The last run failed\. The connection to the Verdictan gateway stopped\. Try again\.$/,
  );
  assert.equal(
    outcomeLabel({ outcome: 'failed' }),
    'The last run failed. The agent stopped because of an error.',
  );
  const refused = outcomeLabel({ outcome: 'refused', reason: 'desktop.auth_required' });
  assert.equal(refused, 'Verdictan did not start the last run. Sign in to Verdictan.');
  assert.doesNotMatch(refused, /desktop\./);
  assert.match(outcomeLabel({ outcome: 'refused' }), /launch checks did not pass/);
});

test('live states come before outcomes, and outcomes come before an unseen run', () => {
  const failed = { outcome: 'failed' as const };
  const refused = { outcome: 'refused' as const };
  assert.equal(chatRowStatus({ live: 'running', outcome: failed }), 'running');
  assert.equal(chatRowStatus({ live: 'approval', outcome: refused, unseen: true }), 'approval');
  assert.equal(chatRowStatus({ live: 'question', outcome: failed }), 'question');
  assert.equal(chatRowStatus({ outcome: failed, unseen: true }), 'failed');
  assert.equal(chatRowStatus({ outcome: refused }), 'refused');
  // A completed or stopped latest run clears failed and refused.
  assert.equal(chatRowStatus({ outcome: { outcome: 'completed' }, unseen: true }), 'done');
  assert.equal(chatRowStatus({ outcome: { outcome: 'stopped' } }), undefined);
  assert.equal(chatRowStatus({}), undefined);
});

test('only a saved chat gets an outcome record', () => {
  // A new chat that was refused before it saved its session stays a draft.
  assert.equal(
    outcomeRecord({
      state: run({ errorCode: 'managed_launch_blocked', managedCode: 'desktop.auth_required' }),
      sessionId: 'new-1',
      create: true,
    }),
    undefined,
  );
  // A refused follow-up turn of a saved chat is kept.
  const followUp = outcomeRecord(
    {
      state: run({
        sessionId: 'saved-1',
        errorCode: 'managed_launch_blocked',
        managedCode: 'desktop.auth_required',
      }),
      sessionId: 'saved-1',
      create: false,
    },
    at,
  );
  assert.deepEqual(followUp, {
    agent: 'codex',
    id: 'saved-1',
    outcome: 'refused',
    reason: 'desktop.auth_required',
    at,
    runId: 'run-1',
  });
  // A new chat that saved its session and then failed is kept.
  const created = outcomeRecord({
    state: run({ sessionId: 'thread-9', sessionReady: true, error: 'API Error: 500' }),
    sessionId: 'draft-uuid',
    create: true,
  });
  assert.equal(created?.id, 'thread-9');
  assert.equal(created?.reason, 'api_error');
  // A remote chat uses the remote session ID of the renderer.
  const remote = outcomeRecord({
    state: run({ status: 'completed', sessionId: 'abc' }),
    sessionId: 'abc',
    create: false,
    hostId: 'host-1',
  });
  assert.equal(remote?.id, 'host-1::abc');
  assert.equal(remote?.hostId, 'host-1');
  assert.equal(
    outcomeRecord({ state: run({ status: 'running' }), sessionId: 'x', create: false }),
    undefined,
  );
});

test('the outcome store validates, bounds, persists and decorates', async (t) => {
  const root = await temporary(t);
  const file = join(root, 'chat-outcomes.json');
  const store = new ChatOutcomes(file, 3);
  await store.load();
  assert.deepEqual(store.list(), []);
  await store.record({
    agent: 'codex',
    id: 'a',
    outcome: 'failed',
    reason: 'timeout',
    at,
    runId: 'r1',
  });
  await store.record({
    agent: 'claude',
    id: 'h::b',
    hostId: 'h',
    outcome: 'refused',
    reason: 'desktop.auth_required',
    at: '2026-10-01T11:00:00.000Z',
  });
  // Invalid values are refused: unknown outcome, unsafe reason, bad IDs.
  for (const value of [
    { agent: 'codex', id: 'a', outcome: 'exploded', at },
    { agent: 'codex', id: 'a', outcome: 'failed', reason: 'Provider said: secret', at },
    { agent: 'codex', id: 'a', outcome: 'refused', reason: 'timeout', at },
    { agent: 'codex', id: '../a', outcome: 'failed', at },
    { agent: 'other', id: 'a', outcome: 'failed', at },
    { agent: 'codex', id: 'a', outcome: 'completed', reason: 'timeout', at },
    { agent: 'codex', id: 'a', outcome: 'failed', at: 'not a time' },
  ])
    await assert.rejects(store.record(value as any), /Invalid chat outcome/);
  // The same run writes once. An older outcome does not replace a newer one.
  await store.record({
    agent: 'codex',
    id: 'a',
    outcome: 'completed',
    at: '2026-10-02T00:00:00.000Z',
    runId: 'r1',
  });
  await store.record({
    agent: 'codex',
    id: 'a',
    outcome: 'completed',
    at: '2026-09-01T00:00:00.000Z',
  });
  assert.deepEqual(store.get('codex', 'a'), { outcome: 'failed', reason: 'timeout', at });
  // A new successful run clears the failed outcome.
  await store.record({
    agent: 'codex',
    id: 'a',
    outcome: 'completed',
    at: '2026-10-03T00:00:00.000Z',
    runId: 'r2',
  });
  assert.equal(store.get('codex', 'a')?.outcome, 'completed');
  const saved = JSON.parse(await readFile(file, 'utf8'));
  assert.equal(saved.version, 1);
  assert.equal(saved.outcomes.length, 2);
  // The newest outcomes stay when the store is full.
  for (const id of ['c', 'd'])
    await store.record({
      agent: 'codex',
      id,
      outcome: 'stopped',
      at: `2026-10-0${id === 'c' ? 4 : 5}T00:00:00.000Z`,
    });
  assert.equal(store.list().length, 3);
  assert.equal(store.get('claude', 'h::b'), undefined);
  const reloaded = new ChatOutcomes(file, 3);
  await reloaded.load();
  assert.deepEqual(
    reloaded.list().map((row) => row.id),
    ['d', 'c', 'a'],
  );
  const sessions = reloaded.decorate([
    { agent: 'codex' as const, id: 'a' },
    { agent: 'codex' as const, id: 'z' },
  ]);
  assert.equal(sessions[0].outcome?.outcome, 'completed');
  assert.equal('outcome' in sessions[1], false);
});

test('a damaged outcome file or entry does not stop the store', async (t) => {
  const root = await temporary(t);
  const file = join(root, 'chat-outcomes.json');
  await writeFile(file, '{not json');
  const damaged = new ChatOutcomes(file);
  await damaged.load();
  assert.deepEqual(damaged.list(), []);
  await writeFile(
    file,
    JSON.stringify({
      version: 1,
      outcomes: [
        { agent: 'codex', id: 'ok', outcome: 'failed', reason: 'api_error', at },
        { agent: 'codex', id: 'bad', outcome: 'failed', reason: 'raw provider text', at },
        'nonsense',
        { agent: 'codex', id: 'ok', outcome: 'completed', at: '2026-09-01T00:00:00.000Z' },
      ],
    }),
  );
  const partial = new ChatOutcomes(file);
  await partial.load();
  assert.deepEqual(
    partial.list().map((row) => [row.id, row.outcome]),
    [['ok', 'failed']],
  );
  assert.equal(validateOutcome(null), undefined);
});

test('the session library adds the outcome of each session', async (t) => {
  const root = await temporary(t);
  const outcomes = new ChatOutcomes(join(root, 'chat-outcomes.json'));
  await outcomes.record({ agent: 'codex', id: 's1', outcome: 'failed', reason: 'timeout', at });
  const library = new SessionLibrary(join(root, 'sessions.json'), outcomes);
  await library.load();
  const base = { agent: 'codex' as const, cwd: '/tmp', title: 't', updatedAt: at };
  const [failed, plain] = library.decorate([
    { ...base, id: 's1' },
    { ...base, id: 's2' },
  ]);
  assert.equal(failed.outcome?.reason, 'timeout');
  assert.equal(plain.outcome, undefined);
  assert.deepEqual(plain.organization, {});
});

test('the chat runner reports each ended run once, and not for internal runs', async () => {
  const session: Session = { id: 'saved-1', agent: 'codex', cwd: '/tmp', title: '', updatedAt: '' };
  const ended: RunEnded[] = [];
  const refuse = async () => {
    throw new DesktopProtocolError('desktop.auth_required');
  };
  const runner = new InteractiveChatRunner(
    async () => ({ path: '/bin/false', env: {} }),
    undefined,
    false,
    refuse,
    (value) => ended.push(structuredClone(value)),
  );
  const internal = new InteractiveChatRunner(
    async () => ({ path: '/bin/false', env: {} }),
    undefined,
    true,
    refuse,
    (value) => ended.push(structuredClone(value)),
  );
  try {
    const first = await runner.start(session, 'Hello', false);
    const second = await internal.start({ ...session, id: 'other' }, 'Hello', false, true);
    for (
      let i = 0;
      i < 200 && (ended.length < 1 || internal.status(second.id).status === 'running');
      i++
    )
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.equal(ended.length, 1);
    assert.equal(ended[0].state.id, first.id);
    assert.equal(ended[0].create, false);
    assert.equal(ended[0].sessionId, 'saved-1');
    const record = outcomeRecord(ended[0]);
    assert.equal(record?.outcome, 'refused');
    assert.equal(record?.reason, 'desktop.auth_required');
    assert.equal(record?.id, 'saved-1');
    runner.stop(first.id);
    assert.equal(ended.length, 1);
  } finally {
    runner.dispose();
    internal.dispose();
  }
});

test('a remote run reports its end once, and a lost connection reports transport loss', async (t) => {
  const root = await temporary(t);
  const hosts = new RemoteHosts(join(root, 'hosts.json'), join(root, 'agent.cjs'));
  const ended: { hostId: string; state: ChatRun; sessionId: string; create: boolean }[] = [];
  hosts.onRunEnded((value) => ended.push(structuredClone(value)));
  const replies = new Map<string, unknown>();
  const connection = {
    brokerPending: new Set<string>(),
    stderr: '',
    pending: new Map<
      string,
      { resolve: (v: any) => void; reject: (e: Error) => void; timer: any }
    >(),
    child: {
      kill() {},
      stdin: {
        end() {},
        write(line: string) {
          const { id, method } = JSON.parse(line);
          const entry = connection.pending.get(id)!;
          clearTimeout(entry.timer);
          connection.pending.delete(id);
          queueMicrotask(() => entry.resolve(structuredClone(replies.get(method))));
        },
      },
    },
  };
  (hosts as any).connections.set('h', connection);
  replies.set('chatStart', run({ id: 'r1', sessionId: 'abc', status: 'running' }));
  await hosts.call('h', 'chatStart', ['codex', 'abc', 'Hello']);
  assert.equal(ended.length, 0);
  replies.set(
    'chatStatus',
    run({ id: 'r1', sessionId: 'abc', status: 'failed', error: 'API Error: 500' }),
  );
  await hosts.call('h', 'chatStatus', ['r1']);
  await hosts.call('h', 'chatStatus', ['r1']);
  assert.equal(ended.length, 1);
  assert.equal(ended[0].create, false);
  assert.equal(outcomeRecord(ended[0])?.id, 'h::abc');
  assert.equal(outcomeRecord(ended[0])?.reason, 'api_error');
  // A refused new remote chat did not save a session: it gets no record.
  replies.set(
    'chatCreate',
    run({
      id: 'r2',
      sessionId: '',
      status: 'failed',
      errorCode: 'managed_launch_blocked',
      managedCode: 'desktop.auth_required',
    }),
  );
  await hosts.call('h', 'chatCreate', ['/work', 'codex', 'Hello']);
  assert.equal(ended.length, 2);
  assert.equal(ended[1].create, true);
  assert.equal(outcomeRecord(ended[1]), undefined);
  // A saved remote chat that runs when the connection closes continues on the host. It has no
  // outcome yet.
  replies.set(
    'chatStart',
    run({ id: 'r3', sessionId: 'def', status: 'running', sessionReady: true }),
  );
  await hosts.call('h', 'chatStart', ['codex', 'def', 'Hello']);
  (hosts as any).closeConnection('h');
  assert.equal(ended.length, 2);
  const detached = await hosts.call('h', 'chatStatus', ['r3']);
  assert.deepEqual([detached.status, detached.hostDetached], ['running', true]);
});

test('the store keeps finished runs, ignores drafts, and reports read errors', async (t) => {
  const root = await temporary(t);
  const file = join(root, 'chat-outcomes.json');
  const store = new ChatOutcomes(file);
  await store.finished({ state: run({ status: 'completed' }), sessionId: 'new', create: true });
  assert.deepEqual(store.list(), []);
  await store.finished({ state: run({ status: 'stopped' }), sessionId: 'saved-1', create: false });
  assert.equal(store.get('codex', 'saved-1')?.outcome, 'stopped');
  // A file without an outcome list gives an empty store.
  await writeFile(file, '[]');
  const empty = new ChatOutcomes(file);
  await empty.load();
  assert.deepEqual(empty.list(), []);
  // A file that cannot be read is an error. The caller logs it and continues.
  await assert.rejects(new ChatOutcomes(root).load(), /EISDIR|illegal operation/);
});
