// The policy result of a refused or escalated managed request: the safe reason, the policy
// version, the request and review IDs, the Console review link, and the permitted next steps.
// The server decides what each user can see and do. This module only shows what it sent.

/** The region of a Verdictan account. Each region has one Console origin. */
export type PolicyRegion = 'eu' | 'us';
export const consoleOrigins: Record<PolicyRegion, string> = {
  eu: 'https://console.eu.verdictan.com',
  us: 'https://console.us.verdictan.com',
};
export const isPolicyRegion = (value: unknown): value is PolicyRegion =>
  value === 'eu' || value === 'us';

/** A gateway request ID: 32 lowercase hexadecimal characters. */
export const isRequestId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
/**
 * A review (escalation) ID of the control plane: `esc_<organization UUID>_<request ID>`. Older
 * records can use a UUID.
 */
export const isReviewId = (value: unknown): value is string =>
  typeof value === 'string' &&
  (/^esc_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[0-9a-f]{32}$/.test(value) ||
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value));
const token = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
const safeToken = (value: unknown) =>
  typeof value === 'string' && token.test(value) ? value : undefined;
/** Short plain text from the server. Control characters and long text are removed. */
function safeText(value: unknown, limit = 300) {
  if (typeof value !== 'string') return undefined;
  // Control characters and line separators become spaces.
  const clean = Array.from(value, (char) => {
    const code = char.charCodeAt(0);
    return code < 0x20 || (code >= 0x7f && code <= 0x9f) || code === 0x2028 || code === 0x2029
      ? ' '
      : char;
  })
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return clean ? clean.slice(0, limit) : undefined;
}

/**
 * What the policy permits after the result. `after_review`: a new request can go after a
 * reviewer approves. `denied`: the policy does not permit a new request. The client never
 * assumes a permission, so a block and an unknown result are both `denied`.
 */
export type RetryPolicy = 'after_review' | 'denied';

/** The policy result of one gateway request. Each field is present only when the server sent it. */
export interface PolicyResult {
  decision: 'refused' | 'escalated';
  /** The gateway request ID. The account broker finds the review with it. */
  requestId?: string;
  /** The policy message in plain words. A refusal has it. */
  reason?: string;
  /** A stable reason code, for example `pii_detected`. */
  reasonCode?: string;
  /** The policy (configuration) version that made the decision. */
  policyVersion?: string;
  retry: RetryPolicy;
}

type Headers = Record<string, string | string[] | undefined>;
const header = (headers: Headers, name: string) => {
  const value = headers[name];
  return Array.isArray(value) ? value[0] : value;
};
const record = (value: unknown) =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;

/**
 * Reads the policy result of a gateway response. The gateway sends the decision in the
 * `x-verdictan-*` headers and in the `verdictan` body extension. A block is HTTP 400. An
 * escalation is HTTP 200 with an empty answer. Other responses return undefined. Unknown, long
 * or unsafe values are dropped, never shown.
 */
export function parsePolicyResult(input: {
  headers?: Headers;
  body?: string;
}): PolicyResult | undefined {
  const headers = input.headers || {};
  let body: Record<string, unknown> | undefined;
  try {
    body = record(input.body ? JSON.parse(input.body) : undefined);
  } catch {
    body = undefined;
  }
  const decision = record(record(body?.verdictan)?.decision);
  const verdict = String(header(headers, 'x-verdictan-verdict') || decision?.verdict || '');
  if (verdict !== 'BLOCK' && verdict !== 'ESCALATE') return undefined;
  const escalated = verdict === 'ESCALATE';
  const result: PolicyResult = {
    decision: escalated ? 'escalated' : 'refused',
    retry: escalated ? 'after_review' : 'denied',
  };
  const requestId = [decision?.request_id, header(headers, 'x-request-id')].find(isRequestId);
  if (requestId) result.requestId = requestId;
  const reasonCode = safeToken(header(headers, 'x-verdictan-reason-code') ?? decision?.reason_code);
  if (reasonCode) result.reasonCode = reasonCode;
  const policyVersion = safeToken(
    header(headers, 'x-verdictan-config-version') ?? decision?.config_version,
  );
  if (policyVersion) result.policyVersion = policyVersion;
  const reason = escalated ? undefined : safeText(record(body?.error)?.message);
  if (reason) result.reason = reason;
  // Without a request ID, no review can be found. A retry then has no approval to wait for.
  if (!result.requestId) result.retry = 'denied';
  return result;
}

/** The states of a review. Other values show as `unknown`. */
export type ReviewStatus = 'pending' | 'claimed' | 'approved' | 'denied' | 'resolved' | 'unknown';
/** A decision of a reviewer. */
export type ReviewDecision = 'approve' | 'deny';
/** A review that waits for a reviewer. */
export const openReview = (status: ReviewStatus) => status === 'pending' || status === 'claimed';

/** The current state of a review, from `review.inspect`. */
export interface PolicyReview {
  requestId: string;
  /** The review (escalation) ID in the control plane. */
  escalationId: string;
  status: ReviewStatus;
  /** The validated Console link of this exact review. */
  consoleUrl?: string;
  reasonCode?: string;
  policyVersion?: string;
  /** True when the policy permits a new request now. The gateway still evaluates it. */
  retryAllowed: boolean;
  /** The review actions that the server permits for this user. The UI shows only these. */
  actions: ReviewDecision[];
  /** The revision for a review decision. Present with `actions`. */
  revision?: string;
  observedAt: string;
}

/**
 * The exact Console link of one review in one region, or undefined. The link must use the
 * Console origin of the region, the `/inbox` path, and only the `review` parameter with the
 * same review ID. A link with credentials, a fragment, another host, a port, or another path
 * fails.
 */
export function reviewConsoleLink(
  value: unknown,
  region: unknown,
  escalationId: unknown,
): string | undefined {
  if (!isPolicyRegion(region) || !isReviewId(escalationId)) return undefined;
  if (typeof value !== 'string' || value.length > 512 || value.includes('#')) return undefined;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const params = [...url.searchParams];
  if (
    url.origin !== consoleOrigins[region] ||
    url.username ||
    url.password ||
    url.pathname !== '/inbox' ||
    params.length !== 1 ||
    params[0][0] !== 'review' ||
    params[0][1] !== escalationId
  )
    return undefined;
  return `${consoleOrigins[region]}/inbox?review=${escalationId}`;
}

/** The review status from the control plane state and resolution. */
function reviewStatus(status: unknown, resolution: unknown): ReviewStatus {
  if (status === 'queued') return 'pending';
  if (status === 'claimed') return 'claimed';
  if (status !== 'resolved') return 'unknown';
  if (resolution === 'allow') return 'approved';
  if (resolution === 'block' || resolution === 'rejected') return 'denied';
  return 'resolved';
}

/** Reads a `review.inspect` or `review.resolve` result. Throws for a result about another request. */
export function parsePolicyReview(
  data: Record<string, unknown>,
  region: unknown,
  requestId: string,
  observedAt = new Date().toISOString(),
): PolicyReview {
  if (!isRequestId(requestId) || data.request_id !== requestId || !isReviewId(data.escalation_id))
    throw new Error('The review result is for a different request.');
  // The broker never replays the request and never changes the policy.
  if (
    data.replays_request !== false ||
    data.changes_policy !== false ||
    data.retry_requires_new_evaluation !== true
  )
    throw new Error('The review result is not valid.');
  const status = reviewStatus(data.status, data.resolution);
  const review: PolicyReview = {
    requestId,
    escalationId: data.escalation_id,
    status,
    // Only an approved review permits a new request. The gateway evaluates it again.
    retryAllowed: status === 'approved' && data.retry === 'allowed',
    actions: [],
    observedAt,
  };
  const consoleUrl = reviewConsoleLink(data.console_url, region, data.escalation_id);
  if (consoleUrl) review.consoleUrl = consoleUrl;
  const reasonCode = safeToken(data.reason_code);
  if (reasonCode) review.reasonCode = reasonCode;
  const policyVersion = safeToken(data.policy_version);
  if (policyVersion) review.policyVersion = policyVersion;
  // The server lists the actions of this reviewer. A closed review has no actions.
  const actions = Array.isArray(data.actions) ? data.actions : [];
  const revision = safeToken(data.revision);
  if (openReview(status) && revision) {
    review.actions = (['approve', 'deny'] as ReviewDecision[]).filter((action) =>
      actions.includes(action),
    );
    if (review.actions.length) review.revision = revision;
  }
  return review;
}

/**
 * True when the UI can offer "Try again". The policy must permit it: an escalated request with
 * an approved review of the same request. A refused request has no retry. A retry is always a
 * new request, so the gateway evaluates it against the current policy.
 */
export function canRetry(result: PolicyResult, review?: PolicyReview) {
  return (
    result.retry === 'after_review' &&
    !!review &&
    review.requestId === result.requestId &&
    review.retryAllowed
  );
}

/**
 * What the app does when the user comes back from the Console. It only reads the review status
 * again. It never sends a prompt, never runs a command, and never retries the request.
 */
export type ReturnAction = { kind: 'refresh'; requestId: string } | { kind: 'none' };
export function returnAction(
  pending: { requestId?: string; openedConsole: boolean } | undefined,
): ReturnAction {
  if (!pending?.openedConsole || !isRequestId(pending.requestId)) return { kind: 'none' };
  return { kind: 'refresh', requestId: pending.requestId };
}

/** Words for a review status. */
export const reviewStatusWords: Record<ReviewStatus, string> = {
  pending: 'Waiting for a reviewer',
  claimed: 'A reviewer has the review',
  approved: 'Approved',
  denied: 'Denied',
  resolved: 'Closed',
  unknown: 'Status not known',
};
