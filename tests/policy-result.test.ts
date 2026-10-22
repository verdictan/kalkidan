import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canRetry,
  parsePolicyResult,
  parsePolicyReview,
  returnAction,
  reviewConsoleLink,
  type PolicyResult,
} from '../src/domain/policy-result';
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
