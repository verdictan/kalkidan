import { words, type PlanningLabel } from './planning-labels';
import { isOpaqueId, serviceName } from './verdictan';

/**
 * The Verdictan history of one task or one chat. Verdictan owns this history. It is one history
 * for chats and tasks. The backend resolves the scope, so the renderer never sends or sees IDs.
 */
export type ManagedHistoryScope =
  | { kind: 'task'; groupId: string; taskId: string }
  | { kind: 'conversation'; agent: string; sessionId: string };
/** A scope and, for the next page, the opaque cursor of the previous page. */
export type ManagedHistoryTarget = ManagedHistoryScope & { cursor?: string };

/** One request of the history. A null value is unknown. It is never zero. */
export interface ManagedHistoryEntry {
  time: string | null;
  decision: string | null;
  reason: string | null;
  review: string | null;
  provider: string | null;
  model: string | null;
  agent: string | null;
  inputTokens: string | null;
  outputTokens: string | null;
  cachedInputTokens: string | null;
  totalTokens: string | null;
  cost: string | null;
  currency: string | null;
  settlement: string | null;
  /** True when a late settlement completed an authorization that the ledger released. */
  corrected: boolean;
  releasedAt: string | null;
  settledAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  latencyMs: string | null;
  /** True when Verdictan recorded an audit record. The record ID is not shown. */
  audited: boolean;
}

export interface ManagedHistoryPage {
  entries: ManagedHistoryEntry[];
  /** Opaque. Send it back to read the next page. Null on the last page. */
  cursor: string | null;
  /** The first page fixes this time. Load again without a cursor to see later requests. */
  asOf: string | null;
  observedAt: string;
  /** `task-history` is the earlier operation. It is used only for one release. */
  source: 'history' | 'task-history';
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
/** A count or an amount as text. Unknown values stay null. */
function amount(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && /^-?\d{1,30}(?:\.\d{1,20})?$/.test(value)) return value;
  return null;
}
function time(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value))
    ? value
    : null;
}
/** A short word from the service, for example "allow". IDs and unsafe text stay null. */
function word(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 80 || !/^[A-Za-z0-9][\w .:/-]*$/.test(value))
    return null;
  return isOpaqueId(value) ? null : value;
}

/** Changes `history.list` items to safe display values. It removes every ID. */
export function historyEntries(items: unknown): ManagedHistoryEntry[] {
  if (!Array.isArray(items)) return [];
  return items.map((value) => {
    const item = record(value);
    const usage = record(item.usage);
    const settlement = record(item.settlement);
    const timings = record(item.timings);
    const reviewStatus = word(item.review_decision) || word(item.review_status);
    const currency =
      typeof usage.currency === 'string' && /^[A-Z]{3}$/.test(usage.currency)
        ? usage.currency
        : null;
    const cost = amount(usage.measured_cost);
    return {
      time: time(item.timestamp) || time(timings.first_event_at),
      decision: word(item.decision_outcome),
      reason: word(item.reason_code),
      review: reviewStatus,
      provider: word(item.provider),
      model: serviceName(item.model) ? word(item.model) : null,
      agent: word(item.agent_kind),
      inputTokens: amount(usage.input_tokens),
      outputTokens: amount(usage.output_tokens),
      cachedInputTokens: amount(usage.cached_input_tokens),
      totalTokens: amount(usage.total_tokens),
      // A cost without a currency is not a known cost.
      cost: currency ? cost : null,
      currency: cost === null ? null : currency,
      settlement: word(settlement.state) || word(usage.settlement_state),
      corrected: settlement.corrected === true,
      releasedAt: time(settlement.released_at),
      settledAt: time(settlement.settled_at),
      startedAt: time(timings.started_at),
      completedAt: time(timings.completed_at),
      latencyMs: amount(timings.latency_ms),
      audited: typeof item.audit_id === 'string' && item.audit_id.length > 0,
    };
  });
}

/**
 * Adds the next page. The first page fixes `asOf`, so pages do not overlap. Restart without a
 * cursor to see later requests and corrections to requests on earlier pages.
 */
export function appendHistory(previous: ManagedHistoryPage, next: ManagedHistoryPage) {
  return {
    ...next,
    asOf: previous.asOf ?? next.asOf,
    entries: [...previous.entries, ...next.entries],
  };
}

const unknown = (value: string | null) => value ?? 'Unknown';
const count = (value: string | null) =>
  value === null ? 'unknown' : Number(value).toLocaleString('en-US');
/** The badge for the policy decision of one request. */
export function historyDecisionLabel(entry: ManagedHistoryEntry): PlanningLabel {
  const decision = entry.decision?.toLowerCase();
  if (!decision) return { label: 'Decision unknown', tone: 'muted' };
  if (['allow', 'allowed', 'approve', 'approved'].includes(decision))
    return { label: 'Allowed', tone: 'success' };
  if (['deny', 'denied', 'block', 'blocked', 'reject', 'rejected'].includes(decision))
    return { label: 'Denied', tone: 'destructive' };
  if (decision.includes('review') || decision === 'escalate')
    return { label: 'Review', tone: 'warning' };
  return { label: words(decision), tone: 'secondary' };
}
/**
 * The visible details of one request: plain words and numbers only. A null value shows as
 * "Unknown". The cost is the measured cost from Verdictan. It is not a provider charge.
 */
export function historyDetails(entry: ManagedHistoryEntry): [string, string][] {
  const time = (value: string | null) =>
    value === null ? 'Unknown' : new Date(Date.parse(value)).toLocaleString();
  return [
    ['Reason', entry.reason ? words(entry.reason) : 'Unknown'],
    ...(entry.review ? ([['Review', words(entry.review)]] as [string, string][]) : []),
    ['Model', unknown(entry.model)],
    [
      'Tokens',
      `${count(entry.totalTokens)} in total · ${count(entry.inputTokens)} in · ${count(
        entry.outputTokens,
      )} out · ${count(entry.cachedInputTokens)} cached`,
    ],
    [
      'Cost',
      entry.cost === null || entry.currency === null
        ? 'Unknown'
        : `${entry.cost} ${entry.currency}`,
    ],
    [
      'Settlement',
      (entry.settlement ? words(entry.settlement) : 'Unknown') +
        (entry.corrected ? ' · Corrected after release' : ''),
    ],
    ['Started', time(entry.startedAt)],
    ['Completed', time(entry.completedAt)],
    ['Duration', entry.latencyMs === null ? 'Unknown' : `${count(entry.latencyMs)} ms`],
    ['Audit record', entry.audited ? 'Recorded' : 'Unknown'],
  ];
}
