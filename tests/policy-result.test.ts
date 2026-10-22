import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  addPolicyRecords,
  canRetry,
  parsePolicyResult,
  parsePolicyReview,
  returnAction,
  remotePolicyRecords,
  reviewConsoleLink,
  validPolicyRecord,
  type PolicyResult,
} from '../src/domain/policy-result';
import { PolicyResults } from '../electron/policy-results';
import type { ChatRun } from '../src/types';
import { PolicyReviews } from '../electron/verdictan/policy-review';
import type {
  DesktopClient,
  DesktopOperation,
  DesktopParameters,
} from '../electron/verdictan/protocol';

const requestId = '0123456789abcdef0123456789abcdef';
const organization = '11111111-2222-4333-8444-555555555555';
const escalationId = `esc_${organization}_${requestId}`;
const link = `https://console.eu.verdictan.com/inbox?review=${escalationId}`;
const inspected = (changes: Record<string, unknown> = {}) => ({
  escalation_id: escalationId,
  request_id: requestId,
  status: 'queued',
  resolution: null,
  reason_code: 'needs_review',
  policy_version: 'cfgv_7',
  console_url: link,
  actions: [],
  retry: 'denied',
  revision: 'rev1',
  replays_request: false,
  changes_policy: false,
  retry_requires_new_evaluation: true,
  ...changes,
});

test('a block shows the policy message, code, version and request ID, with no retry', () => {
  const result = parsePolicyResult({
    headers: { 'x-verdictan-verdict': 'BLOCK', 'x-request-id': requestId },
    body: JSON.stringify({
      error: { message: 'Customer data\nis not allowed.' },
      verdictan: { decision: { verdict: 'BLOCK', reason_code: 'pii', config_version: 'v3' } },
    }),
  });
  assert.deepEqual(result, {
    decision: 'refused',
    retry: 'denied',
    requestId,
    reasonCode: 'pii',
    policyVersion: 'v3',
    reason: 'Customer data is not allowed.',
  });
  assert.equal(canRetry(result!), false);
});

test('only values that the server sent and that are safe show', () => {
  const result = parsePolicyResult({
    headers: {
      'x-verdictan-verdict': 'ESCALATE',
      'x-request-id': 'not a request id',
      'x-verdictan-reason-code': '<script>',
      'x-verdictan-config-version': 'v'.repeat(500),
    },
  });
  // No request ID means no review to wait for, so the policy permits no retry.
  assert.deepEqual(result, { decision: 'escalated', retry: 'denied' });
  assert.equal(parsePolicyResult({ headers: { 'x-verdictan-verdict': 'ALLOW' } }), undefined);
  assert.equal(parsePolicyResult({ body: '{"error":{"message":"rate limit"}}' }), undefined);
  assert.equal(parsePolicyResult({ body: 'not json' }), undefined);
});

test('the Console link must be the exact review record in the account region', () => {
  assert.equal(reviewConsoleLink(link, 'eu', escalationId), link);
  for (const [value, region, id] of [
    [link, 'us', escalationId],
    [link, 'global', escalationId],
    [link, 'eu', `esc_${organization}_${'f'.repeat(32)}`],
    [link.replace('https:', 'http:'), 'eu', escalationId],
    [link.replace('console.eu', 'console.eu.verdictan.com.evil.example'), 'eu', escalationId],
    [link.replace('https://', 'https://user:pass@'), 'eu', escalationId],
    [link.replace('.com/', '.com:8443/'), 'eu', escalationId],
    [link.replace('/inbox', '/settings'), 'eu', escalationId],
    [`${link}&prompt=run`, 'eu', escalationId],
    [`${link}#run`, 'eu', escalationId],
    ['javascript:alert(1)', 'eu', escalationId],
    [link, 'eu', '../inbox'],
  ])
    assert.equal(reviewConsoleLink(value, region, id), undefined, String(value));
});

test('a review result must be about the same request and must not replay it', () => {
  assert.throws(() =>
    parsePolicyReview(inspected({ request_id: 'f'.repeat(32) }), 'eu', requestId),
  );
  assert.throws(() => parsePolicyReview(inspected({ replays_request: true }), 'eu', requestId));
  assert.throws(() =>
    parsePolicyReview(inspected({ retry_requires_new_evaluation: false }), 'eu', requestId),
  );
  // A link that fails the check is dropped. The rest of the result still shows.
  const review = parsePolicyReview(
    inspected({ console_url: 'https://evil.example/inbox' }),
    'eu',
    requestId,
  );
  assert.equal(review.consoleUrl, undefined);
  assert.equal(review.status, 'pending');
});

test('review actions show only when the server lists them and the review is open', () => {
  const allowed = parsePolicyReview(
    inspected({ actions: ['approve', 'deny', 'delete'] }),
    'eu',
    requestId,
  );
  assert.deepEqual(allowed.actions, ['approve', 'deny']);
  assert.equal(allowed.revision, 'rev1');
  assert.deepEqual(parsePolicyReview(inspected(), 'eu', requestId).actions, []);
  const closed = parsePolicyReview(
    inspected({ status: 'resolved', resolution: 'block', actions: ['approve'] }),
    'eu',
    requestId,
  );
  assert.equal(closed.status, 'denied');
  assert.deepEqual(closed.actions, []);
  assert.equal(closed.revision, undefined);
});

test('a retry needs an escalation and an approved review that permits it', () => {
  const escalated: PolicyResult = { decision: 'escalated', retry: 'after_review', requestId };
  const pending = parsePolicyReview(inspected({ retry: 'allowed' }), 'eu', requestId);
  const approved = parsePolicyReview(
    inspected({ status: 'resolved', resolution: 'allow', retry: 'allowed' }),
    'eu',
    requestId,
  );
  const approvedNoRetry = parsePolicyReview(
    inspected({ status: 'resolved', resolution: 'allow' }),
    'eu',
    requestId,
  );
  assert.equal(canRetry(escalated), false);
  assert.equal(canRetry(escalated, pending), false);
  assert.equal(canRetry(escalated, approvedNoRetry), false);
  assert.equal(canRetry(escalated, approved), true);
  assert.equal(canRetry({ ...escalated, requestId: 'f'.repeat(32) }, approved), false);
  assert.equal(canRetry({ decision: 'refused', retry: 'denied', requestId }, approved), false);
});

test('coming back from the Console only reads the review status', () => {
  assert.deepEqual(returnAction(undefined), { kind: 'none' });
  assert.deepEqual(returnAction({ requestId, openedConsole: false }), { kind: 'none' });
  assert.deepEqual(returnAction({ requestId: 'x', openedConsole: true }), { kind: 'none' });
  const action = returnAction({ requestId, openedConsole: true });
  assert.deepEqual(action, { kind: 'refresh', requestId });
  // The only action is a read. No action sends a message or runs a command.
  assert.deepEqual(Object.keys(action).sort(), ['kind', 'requestId']);
});

function broker(
  data: Record<string, unknown>,
  capabilities = ['review.inspect', 'review.resolve'],
) {
  const calls: [DesktopOperation, DesktopParameters | undefined][] = [];
  const client = {
    request: async (operation: DesktopOperation, parameters?: DesktopParameters) => {
      calls.push([operation, parameters]);
      if (operation === 'capabilities')
        return {
          data: {
            cli_version: '0.6.11',
            protocol_min: 1,
            protocol_max: 1,
            capabilities,
            managed_execution_ready: true,
            tested_agents: [],
          },
        };
      return { data };
    },
  } as unknown as DesktopClient;
  const opened: string[] = [];
  const reviews = new PolicyReviews({
    client: async () => client,
    region: () => 'eu',
    openExternal: async (url) => opened.push(url),
  });
  return { calls, opened, reviews };
}

test('the review service checks the request ID and region before it asks the broker', async () => {
  const f = broker(inspected());
  await assert.rejects(f.reviews.inspect('../../etc', 'eu'), /desktop\.invalid_review/);
  await assert.rejects(f.reviews.inspect(requestId, 'us'), /desktop\.review_region_mismatch/);
  assert.equal(f.calls.length, 0);
  const review = await f.reviews.inspect(requestId, 'eu');
  assert.equal(review.escalationId, escalationId);
  assert.deepEqual(f.calls[1], ['review.inspect', { request_id: requestId }]);
});

test('an old runtime without the review operations shows no review', async () => {
  const f = broker(inspected(), []);
  await assert.rejects(f.reviews.inspect(requestId, 'eu'), /desktop\.operation_unsupported/);
  assert.equal(f.calls.length, 1);
});

test('the Console opens only the checked link from the broker', async () => {
  const good = broker(inspected());
  await good.reviews.open(requestId, 'eu');
  assert.deepEqual(good.opened, [link]);
  const bad = broker(inspected({ console_url: `${link}&next=https://evil.example` }));
  await assert.rejects(bad.reviews.open(requestId, 'eu'), /desktop\.review_link_unavailable/);
  assert.deepEqual(bad.opened, []);
});

test('a review decision sends the reviewer fields and never a URL or a prompt', async () => {
  const f = broker(inspected({ status: 'resolved', resolution: 'allow', retry: 'allowed' }));
  await assert.rejects(
    f.reviews.decide(requestId, 'eu', 'escalate', 'ok', 'rev1'),
    /desktop\.invalid_review/,
  );
  await assert.rejects(f.reviews.decide(requestId, 'eu', 'approve', ' ', 'rev1'));
  await assert.rejects(f.reviews.decide(requestId, 'eu', 'approve', 'ok', 'bad revision'));
  assert.equal(f.calls.length, 0);
  const review = await f.reviews.decide(requestId, 'eu', 'approve', ' Looks safe. ', 'rev1');
  assert.equal(review.status, 'approved');
  const [operation, parameters] = f.calls[1];
  assert.equal(operation, 'review.resolve');
  assert.equal(parameters?.request_id, requestId);
  const { operation_id, ...fields } = parameters!.fields!;
  assert.match(String(operation_id), /^[0-9a-f-]{36}$/);
  assert.deepEqual(fields, {
    decision: 'approve',
    reason: 'Looks safe.',
    expected_revision: 'rev1',
  });
  assert.equal(f.opened.length, 0);
});

test('a policy record keeps only the safe fields that the user saw', () => {
  const at = '2026-10-22T10:00:00.000Z';
  assert.deepEqual(
    validPolicyRecord({
      decision: 'escalated',
      retry: 'after_review',
      requestId,
      reasonCode: 'needs_review',
      policyVersion: 'cfgv_7',
      region: 'eu',
      at,
      escalationId,
      prompt: 'Read the customer table.',
      status: 'approved',
    }),
    {
      decision: 'escalated',
      retry: 'after_review',
      requestId,
      reasonCode: 'needs_review',
      policyVersion: 'cfgv_7',
      region: 'eu',
      at,
    },
  );
  // A refusal never permits a retry, whatever the stored value says.
  assert.equal(
    validPolicyRecord({ decision: 'refused', retry: 'after_review', at })?.retry,
    'denied',
  );
  for (const bad of [
    null,
    { decision: 'allowed', retry: 'denied', at },
    { decision: 'refused', retry: 'denied', at: 'yesterday' },
    { decision: 'refused', retry: 'denied', at, requestId: '../x' },
  ])
    assert.equal(validPolicyRecord(bad), undefined);
});

test('a chat keeps every policy result, one per request, oldest first', () => {
  const other = 'f'.repeat(32);
  const list = addPolicyRecords(
    [{ decision: 'refused', retry: 'denied', requestId, at: '2026-10-22T10:00:00.000Z' }],
    [
      {
        decision: 'escalated',
        retry: 'after_review',
        requestId: other,
        at: '2026-10-22T10:02:00.000Z',
      },
      {
        decision: 'refused',
        retry: 'denied',
        requestId,
        reasonCode: 'pii',
        at: '2026-10-22T10:01:00.000Z',
      },
      { decision: 'nope' },
    ],
  );
  assert.deepEqual(
    list.map((record) => [record.requestId, record.reasonCode]),
    [
      [requestId, 'pii'],
      [other, undefined],
    ],
  );
  const many = Array.from({ length: 30 }, (_, index) => ({
    decision: 'refused',
    retry: 'denied',
    at: new Date(Date.UTC(2026, 9, 22, 10, index)).toISOString(),
  }));
  const kept = addPolicyRecords([], many, 20);
  assert.equal(kept.length, 20);
  assert.equal(kept[0].at, many[10].at);
});

test('results from another computer get the region of this desktop', () => {
  const at = '2026-10-22T10:00:00.000Z';
  assert.deepEqual(
    remotePolicyRecords(
      [{ decision: 'escalated', retry: 'after_review', requestId, region: 'us', at, token: 'x' }],
      'eu',
    ),
    [{ decision: 'escalated', retry: 'after_review', requestId, region: 'eu', at }],
  );
  assert.deepEqual(
    remotePolicyRecords([{ decision: 'refused', retry: 'denied', region: 'us', at }], undefined),
    [{ decision: 'refused', retry: 'denied', at }],
  );
  assert.equal(remotePolicyRecords('not a list', 'eu'), undefined);
  assert.equal(remotePolicyRecords([{ bad: true }], 'eu'), undefined);
});

test('saved policy results stay after a restart and hold only safe fields', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'kalkidan-policy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'policy-results.json');
  const store = new PolicyResults(file);
  await store.load();
  const run = (changes: Partial<ChatRun>, extra: Record<string, unknown> = {}) => ({
    state: {
      id: 'run-1',
      agent: 'codex' as const,
      status: 'completed' as const,
      sessionId: 'saved-1',
      sessionReady: true,
      ...changes,
    },
    sessionId: 'saved-1',
    create: false,
    ...extra,
  });
  const first = {
    decision: 'refused',
    retry: 'denied',
    requestId,
    reason: 'No customer data.',
    at: '2026-10-22T10:00:00.000Z',
  };
  const second = {
    decision: 'escalated',
    retry: 'after_review',
    requestId: 'f'.repeat(32),
    region: 'eu',
    at: '2026-10-22T10:05:00.000Z',
    escalationId,
    prompt: 'secret prompt',
  };
  await store.finished(run({ policies: [first as any] }));
  await store.finished(run({ id: 'run-2', policies: [second as any] }));
  // A remote chat ID has the host prefix.
  await store.finished(run({ policies: [first as any] }, { hostId: 'host1' }));
  // A new chat that did not save its session keeps nothing.
  await store.finished(
    run({ sessionReady: false, sessionId: 'draft-1', policies: [first as any] }, { create: true }),
  );
  const raw = await readFile(file, 'utf8');
  assert.doesNotMatch(raw, /secret prompt|escalationId|esc_/);
  const restarted = new PolicyResults(file);
  await restarted.load();
  assert.deepEqual(
    restarted.list('codex', 'saved-1').map((record) => record.requestId),
    [requestId, 'f'.repeat(32)],
  );
  assert.equal(restarted.list('codex', 'saved-1')[0].reason, 'No customer data.');
  assert.equal(restarted.list('codex', 'host1::saved-1').length, 1);
  assert.deepEqual(restarted.list('codex', 'draft-1'), []);
  assert.deepEqual(restarted.list('codex', '../x'), []);
  await writeFile(file, '{bad json');
  const damaged = new PolicyResults(file);
  await damaged.load();
  assert.deepEqual(damaged.list('codex', 'saved-1'), []);
});
