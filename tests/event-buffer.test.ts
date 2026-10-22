import test from 'node:test';
import assert from 'node:assert/strict';
import { RuntimeEvidence } from '../electron/verdictan/evidence';
import { eventBufferEnvironment, eventBufferLimits } from '../electron/verdictan/event-buffer';
import { managedErrors, managedRefusal } from '../src/domain/verdictan';
import { eventBufferWarning } from '../src/domain/conversation';

const scope = { schema_version: 1, runtime_id: 'runtime', session_id: 'session' };
const page = (events: unknown[], extra = {}) => ({
  ...scope,
  generation_id: 'generation',
  cursor: `generation:${events.length}`,
  gap: false,
  reconciliation_required: false,
  has_more: false,
  retention_seconds: eventBufferLimits.expirySeconds,
  events,
  ...extra,
});
const snapshot = (requests: unknown[] = []) => ({
  ...scope,
  authority: 'verdictan-control-plane',
  consistency: 'repeatable-read-page',
  absence_means: 'unknown_or_not_ingested',
  replay_executes_requests: false,
  requests,
  has_more: false,
});
const event = (sequence: number, request: string, verdict = 'allow') => ({
  schema_version: 1,
  generation_id: 'generation',
  session_id: 'session',
  request_id: request,
  correlation_id: request,
  sequence: String(sequence),
  event: 'policy.decision',
  data: { verdict },
});

test('the event buffer limits are defined, and the disk limit goes to each gateway', () => {
  assert.deepEqual(eventBufferLimits, {
    eventsPerSession: 256,
    sessions: 128,
    expirySeconds: 900,
    eventsPerPage: 100,
    rowsPerConversation: 300,
    diskBytes: 200_000_000,
    diskExpirySeconds: 2_592_000,
    fullPolicy: 'drop_oldest_non_usage',
  });
  assert.deepEqual(eventBufferEnvironment(), {
    VERDICTAN_EVENT_WAL_MAX_BYTES: '200000000',
    VERDICTAN_EVENT_WAL_FULL_POLICY: 'drop_oldest_non_usage',
    VERDICTAN_EVENT_WAL_MAX_AGE_SECONDS: '2592000',
  });
});

test('a full gateway buffer drops old events, and Kalkidan reconciles instead of guessing', async () => {
  let reply: any;
  let snapshots = 0;
  const feed = new RuntimeEvidence(
    'runtime',
    'session',
    async (kind) => {
      if (kind === 'events') return reply;
      snapshots++;
      return snapshot([
        {
          request_id: 'evicted',
          review: null,
          review_authority: 'account_broker',
          policy: { verdict: 'deny', audit_state: 'ingested' },
        },
      ]);
    },
    () => {},
  );
  reply = page([event(1, 'first')]);
  await feed.poll();
  assert.equal(snapshots, 1, 'the first read reconciles');
  // The session made more requests than the buffer keeps. The gateway dropped sequences 2..300
  // and reports the gap. Kalkidan reads the authoritative snapshot again.
  reply = page([event(301, 'newest')], { gap: true, reconciliation_required: true });
  await feed.poll();
  assert.equal(snapshots, 2);
  const rows = feed.status().requests;
  assert.deepEqual(rows.map((row) => [row.id, row.policy]).sort(), [
    ['evicted', 'deny'],
    ['newest', 'allow'],
  ]);
  assert.equal(feed.status().status, 'current');
  // A jump in the sequence without the gap flag also reconciles.
  reply = page([event(303, 'later')]);
  await feed.poll();
  assert.equal(snapshots, 3);
});

test('expired events are a gap, and a reply with another expiry is refused', async () => {
  let reply: any = page([event(1, 'one')]);
  const feed = new RuntimeEvidence(
    'runtime',
    'session',
    async (kind) => (kind === 'events' ? reply : snapshot()),
    () => {},
  );
  await feed.poll();
  // Fifteen minutes later, the old cursor is outside the buffer. The gateway says so.
  reply = page([], { gap: true, reconciliation_required: true, generation_id: 'generation' });
  await feed.poll();
  assert.equal(feed.status().status, 'current');
  assert.deepEqual(feed.status().requests, [], 'unknown rows stay unknown, not free or allowed');
  reply = page([], { retention_seconds: 3600 });
  await feed.poll();
  assert.equal(feed.status().status, 'unavailable');
  reply = page(
    Array.from({ length: eventBufferLimits.eventsPerPage + 1 }, (_, i) => event(i + 1, 'r')),
  );
  await feed.poll();
  assert.equal(feed.status().status, 'unavailable');
});

test('the conversation keeps the newest rows when its list is full', async () => {
  const total = eventBufferLimits.rowsPerConversation + 25;
  const events = Array.from({ length: total }, (_, i) => event(i + 1, `request-${i + 1}`));
  let offset = 0;
  const feed = new RuntimeEvidence(
    'runtime',
    'session',
    async (kind) => {
      if (kind !== 'events') return snapshot();
      const part = events.slice(offset, offset + eventBufferLimits.eventsPerPage);
      offset += part.length;
      return page(part, { has_more: offset < total, cursor: `generation:${offset}` });
    },
    () => {},
  );
  await feed.poll();
  const rows = feed.status().requests;
  assert.equal(rows.length, eventBufferLimits.rowsPerConversation);
  assert.equal(rows[0].id, 'request-26');
  assert.equal(rows.at(-1)!.id, `request-${total}`);
});

test('a full durable event queue stops launches with clear words and allows a later retry', () => {
  assert.match(managedErrors['desktop.event_buffer_full'].message, /full/);
  const refusal = managedRefusal('desktop.event_buffer_full', { computer: 'build-host' });
  assert.match(refusal.message, /event buffer on build-host is full/);
  assert.match(refusal.message, /network connection of build-host/);
  assert.equal(refusal.retry, true);
  assert.equal(refusal.step, null);
});

test('removed policy records during the conversation show a warning, and earlier ones do not', async () => {
  let buffer: unknown = {
    policy: 'drop_oldest_non_usage',
    limit_bytes: 200_000_000,
    used_bytes: 190_000_000,
    dropped_events: 40,
    expired_events: 2,
    last_dropped_at: '2026-10-20T00:00:00+00:00',
  };
  const feed = new RuntimeEvidence(
    'runtime',
    'session',
    async (kind) => (kind === 'events' ? page([], { event_buffer: buffer }) : snapshot()),
    () => {},
  );
  await feed.poll();
  // The counts are for the whole queue. Removals before this conversation give no warning.
  assert.equal(feed.status().bufferWarning, undefined);
  buffer = { ...(buffer as object), dropped_events: 45 };
  await feed.poll();
  assert.deepEqual(feed.status().bufferWarning, { droppedEvents: 5, expiredEvents: 0 });
  buffer = { ...(buffer as object), dropped_events: 45, expired_events: 3 };
  await feed.poll();
  assert.deepEqual(feed.status().bufferWarning, { droppedEvents: 5, expiredEvents: 1 });
  // An older gateway sends no buffer state, and a malformed state is ignored.
  for (const value of [undefined, null, 'full', [1], { dropped_events: -1, expired_events: 1.5 }]) {
    const quiet = new RuntimeEvidence(
      'runtime',
      'session',
      async (kind) => (kind === 'events' ? page([], { event_buffer: value }) : snapshot()),
      () => {},
    );
    await quiet.poll();
    await quiet.poll();
    assert.equal(quiet.status().bufferWarning, undefined);
  }
});

test('the warning names the count and the cause, and says that usage records stay', () => {
  assert.equal(
    eventBufferWarning({ droppedEvents: 5, expiredEvents: 0 }),
    'Verdictan did not receive 5 policy records, because the event buffer was full. Usage records stay until Verdictan receives them. Check the network connection.',
  );
  assert.match(
    eventBufferWarning({ droppedEvents: 0, expiredEvents: 1 }),
    /1 policy record, because the records were older than 30 days/,
  );
  assert.match(
    eventBufferWarning({ droppedEvents: 2, expiredEvents: 1 }),
    /3 policy records, because the event buffer was full, and some records were older than 30 days/,
  );
});
