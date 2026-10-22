import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeEvidence } from '../electron/verdictan/evidence';
const scope = { schema_version: 1, runtime_id: 'runtime', session_id: 'session' };
const eventPage = (events: unknown[] = [], extra = {}) => ({
  ...scope,
  generation_id: 'generation',
  cursor: 'cursor',
  gap: false,
  reconciliation_required: false,
  has_more: false,
  retention_seconds: 900,
  events,
  ...extra,
});
const snapshot = (requests: unknown[] = [], extra = {}) => ({
  ...scope,
  authority: 'verdictan-control-plane',
  consistency: 'repeatable-read-page',
  absence_means: 'unknown_or_not_ingested',
  replay_executes_requests: false,
  requests,
  has_more: false,
  ...extra,
});
const event = (sequence: string, kind: string, data: object, request_id = 'request') => ({
  schema_version: 1,
  generation_id: 'generation',
  session_id: 'session',
  request_id,
  correlation_id: 'correlation',
  sequence,
  event: kind,
  data,
});

test('evidence reconciles authoritative usage and never projects private event fields', async () => {
  const feed = new RuntimeEvidence(
    'runtime',
    'session',
    async (kind) =>
      kind === 'events'
        ? eventPage([event('1', 'policy.decision', { verdict: 'allow', prompt: 'private' })])
        : snapshot([
            {
              request_id: 'request',
              review: null,
              review_authority: 'account_broker',
              policy: { verdict: 'allow', audit_state: 'ingested' },
              usage: {
                state: 'settled',
                actual_cost: '0.001',
                currency: 'USD',
                total_tokens: '42',
                provider_charge: 'not_reported',
                credential: 'private',
              },
            },
          ]),
    () => {},
  );
  await feed.poll();
  assert.deepEqual(feed.status().requests, [
    {
      id: 'request',
      policy: 'allow',
      audit: 'ingested',
      usage: 'settled',
      actualCost: '0.001',
      currency: 'USD',
      tokens: '42',
    },
  ]);
  assert.doesNotMatch(JSON.stringify(feed.status()), /private|credential|prompt/);
  assert.equal(feed.status().status, 'current');
});
test('duplicate sequences are ignored, and gaps reconcile without executing requests', async () => {
  let records = [event('1', 'policy.decision', { verdict: 'allow' })],
    reconciliations = 0;
  const feed = new RuntimeEvidence(
    'runtime',
    'session',
    async (kind) => {
      if (kind === 'events') return eventPage(records);
      reconciliations++;
      return snapshot();
    },
    () => {},
  );
  await feed.poll();
  records = [event('1', 'policy.decision', { verdict: 'deny' })];
  await feed.poll();
  assert.equal(feed.status().requests[0].policy, 'allow');
  assert.equal(reconciliations, 1);
  records = [event('3', 'usage.settled', {})];
  await feed.poll();
  assert.equal(reconciliations, 2);
});
test('cross-session and cyclic snapshot responses stay unavailable', async () => {
  const foreign = new RuntimeEvidence(
    'runtime',
    'session',
    async () => eventPage([], { session_id: 'different' }),
    () => {},
  );
  await foreign.poll();
  assert.equal(foreign.status().status, 'unavailable');
  assert.deepEqual(foreign.status().requests, []);
  let calls = 0;
  const cyclic = new RuntimeEvidence(
    'runtime',
    'session',
    async (kind) => {
      calls++;
      return kind === 'events'
        ? eventPage()
        : snapshot([], { has_more: true, next_cursor: 'repeated' });
    },
    () => {},
  );
  await cyclic.poll();
  assert.equal(cyclic.status().status, 'unavailable');
  assert.equal(calls, 3);
});
test('finalization cancels the old read and performs one final reconciliation', async () => {
  let reads = 0,
    aborted = false;
  const feed = new RuntimeEvidence(
    'runtime',
    'session',
    async (kind, _cursor, signal) => {
      reads++;
      if (reads === 1)
        return new Promise((_resolve, reject) =>
          signal!.addEventListener(
            'abort',
            () => {
              aborted = true;
              reject(Error('aborted'));
            },
            { once: true },
          ),
        );
      return kind === 'events' ? eventPage() : snapshot();
    },
    () => {},
  );
  const pending = feed.poll();
  const first = feed.stop(),
    second = feed.stop();
  assert.equal(first, second);
  await Promise.all([pending, first]);
  assert.equal(aborted, true);
  assert.equal(reads, 3);
  assert.equal(feed.status().finalized, true);
  assert.equal(feed.status().status, 'current');
});

test('a response that arrives after cancellation cannot update evidence', async () => {
  const controller = new AbortController();
  const feed = new RuntimeEvidence(
    'runtime',
    'session',
    async () => {
      controller.abort();
      return snapshot([{ request_id: 'late', review: null, review_authority: 'account_broker' }]);
    },
    () => {},
  );
  await assert.rejects(feed.reconcile(controller.signal), { name: 'AbortError' });
  assert.deepEqual(feed.status().requests, []);
});

test('a run that ends before its usage settles reads the token count once more', async () => {
  const reads: string[] = [];
  const feed = new RuntimeEvidence(
    'runtime',
    'session',
    async (kind) => {
      reads.push(kind);
      // The usage of the Codex request is still open when the turn ends.
      if (kind === 'events')
        return eventPage([event('1', 'usage.updated', { usage_status: 'reserved' })]);
      // The token count arrives after the first read.
      const late = reads.filter((read) => read === 'snapshot').length > 1;
      return snapshot([
        {
          request_id: 'request',
          review: null,
          review_authority: 'account_broker',
          usage: {
            state: 'reserved',
            ...(late ? { total_tokens: '1234' } : {}),
            provider_charge: 'not_reported',
            billing: 'user_subscription',
          },
        },
      ]);
    },
    () => {},
  );
  await feed.poll();
  assert.equal(feed.status().requests[0].tokens, null);
  await feed.stop();
  assert.equal(reads.at(-1), 'snapshot');
  assert.equal(feed.status().requests[0].tokens, '1234');
  assert.equal(feed.status().status, 'current');
  assert.equal(feed.status().finalized, true);
});

test('a run whose usage has its tokens does not read the snapshot again', async () => {
  const reads: string[] = [];
  const feed = new RuntimeEvidence(
    'runtime',
    'session',
    async (kind) => {
      reads.push(kind);
      return kind === 'events' ? eventPage() : snapshot();
    },
    () => {},
  );
  await feed.poll();
  const before = reads.filter((read) => read === 'snapshot').length;
  await feed.stop();
  assert.equal(reads.filter((read) => read === 'snapshot').length, before);
});
