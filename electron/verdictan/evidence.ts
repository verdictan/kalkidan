import type { GovernanceEvidence } from '../../src/domain/conversation';
import { DesktopProtocolError } from './protocol';
import { isSubscriptionBilling } from '../../src/domain/verdictan';
const safe = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,255}$/.test(v);
const measurement = (v: unknown) =>
  typeof v === 'string' && /^-?[0-9]{1,24}(?:\.[0-9]{1,24})?$/.test(v) ? v : null;
const events = new Set([
  'policy.decision',
  'request.attempt_authorized',
  'request.attempt_started',
  'request.attempt_transport',
  'usage.updated',
  'usage.settled',
  'usage.released',
  'audit.queued',
  'audit.delivery',
]);
/** A bounded projection. Missing data remains unknown and never authorizes a request. */
export class RuntimeEvidence {
  private state: GovernanceEvidence = { status: 'loading', requests: [] };
  private generation?: string;
  private sequence = 0n;
  private cursor?: string;
  private operation?: Promise<void>;
  private timer?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private started = false;
  private controller?: AbortController;
  private stopTask?: Promise<void>;
  constructor(
    private runtime: string,
    private session: string,
    private read: (
      kind: 'events' | 'snapshot',
      cursor?: string,
      signal?: AbortSignal,
    ) => Promise<any>,
    private changed: (value: GovernanceEvidence) => void,
  ) {}
  status() {
    return structuredClone(this.state);
  }
  private publish() {
    this.changed(this.status());
  }
  private scope(data: any) {
    if (
      data?.schema_version !== 1 ||
      data.runtime_id !== this.runtime ||
      data.session_id !== this.session
    )
      throw new DesktopProtocolError('desktop.evidence_scope_mismatch');
  }
  private row(id: string) {
    let row = this.state.requests.find((r) => r.id === id);
    if (!row) {
      if (this.state.requests.length >= 300) this.state.requests.shift();
      row = {
        id,
        policy: null,
        usage: null,
        audit: null,
        actualCost: null,
        currency: null,
        tokens: null,
      };
      this.state.requests.push(row);
    }
    return row;
  }
  async reconcile(signal: AbortSignal = AbortSignal.timeout(10000)) {
    this.state.status = 'reconciling';
    this.publish();
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 100; page++) {
      signal.throwIfAborted();
      const data = await this.read('snapshot', cursor, signal);
      signal.throwIfAborted();
      this.scope(data);
      if (
        data.authority !== 'verdictan-control-plane' ||
        data.consistency !== 'repeatable-read-page' ||
        data.absence_means !== 'unknown_or_not_ingested' ||
        data.replay_executes_requests !== false ||
        !Array.isArray(data.requests) ||
        data.requests.length > 100 ||
        typeof data.has_more !== 'boolean'
      )
        throw new DesktopProtocolError('desktop.snapshot_invalid');
      for (const item of data.requests) {
        if (
          !safe(item?.request_id) ||
          item.review !== null ||
          item.review_authority !== 'account_broker'
        )
          throw new DesktopProtocolError('desktop.snapshot_invalid');
        const row = this.row(item.request_id);
        if (item.policy) {
          if (item.policy.audit_state !== 'ingested')
            throw new DesktopProtocolError('desktop.snapshot_invalid');
          row.policy = safe(item.policy.verdict) ? item.policy.verdict : null;
          row.audit = 'ingested';
        }
        if (item.usage) {
          if (item.usage.provider_charge !== 'not_reported')
            throw new DesktopProtocolError('desktop.snapshot_invalid');
          row.usage = safe(item.usage.state) ? item.usage.state : null;
          // Subscription usage has no provider price. An internal zero debit is not a charge.
          const subscription = isSubscriptionBilling(item.usage);
          row.currency = !subscription && safe(item.usage.currency) ? item.usage.currency : null;
          // A cost without a currency is not an authoritative monetary charge.
          row.actualCost = row.currency ? measurement(item.usage.actual_cost) : null;
          row.tokens = measurement(item.usage.total_tokens);
          if (subscription) row.billing = 'subscription';
        }
      }
      if (!data.has_more) return;
      if (
        typeof data.next_cursor !== 'string' ||
        !data.next_cursor ||
        data.next_cursor.length > 1024 ||
        seen.has(data.next_cursor)
      )
        throw new DesktopProtocolError('desktop.snapshot_cursor_invalid');
      seen.add(data.next_cursor);
      cursor = data.next_cursor;
    }
    throw new DesktopProtocolError('desktop.snapshot_limit');
  }
  poll(timeout = 10000) {
    if (this.operation) return this.operation;
    this.controller = new AbortController();
    const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(timeout)]);
    return (this.operation = this.pollOnce(signal)
      .catch(() => {
        this.state.status = 'unavailable';
        this.publish();
      })
      .finally(() => {
        this.operation = undefined;
      }));
  }
  private async pollOnce(signal: AbortSignal) {
    const seen = new Set<string>();
    for (let page = 0; page < 10; page++) {
      signal.throwIfAborted();
      const data = await this.read('events', this.cursor, signal);
      signal.throwIfAborted();
      this.scope(data);
      if (
        !safe(data.generation_id) ||
        typeof data.cursor !== 'string' ||
        data.cursor.length > 256 ||
        typeof data.gap !== 'boolean' ||
        typeof data.reconciliation_required !== 'boolean' ||
        typeof data.has_more !== 'boolean' ||
        data.retention_seconds !== 900 ||
        !Array.isArray(data.events) ||
        data.events.length > 100
      )
        throw new DesktopProtocolError('desktop.events_invalid');
      const reset =
        !this.generation ||
        data.generation_id !== this.generation ||
        data.gap ||
        data.reconciliation_required;
      if (reset) {
        this.sequence = 0n;
        this.state.requests = [];
      }
      let reconcile = reset;
      for (const event of data.events) {
        if (
          event?.schema_version !== 1 ||
          event.generation_id !== data.generation_id ||
          event.session_id !== this.session ||
          !safe(event.request_id) ||
          !safe(event.correlation_id) ||
          !/^[1-9][0-9]{0,19}$/.test(event.sequence) ||
          !events.has(event.event) ||
          !event.data ||
          typeof event.data !== 'object' ||
          Array.isArray(event.data)
        )
          throw new DesktopProtocolError('desktop.events_invalid');
        const sequence = BigInt(event.sequence);
        if (sequence <= this.sequence) continue;
        if (this.sequence && sequence !== this.sequence + 1n) reconcile = true;
        this.sequence = sequence;
        const row = this.row(event.request_id),
          d = event.data;
        if (event.event === 'policy.decision') row.policy = safe(d.verdict) ? d.verdict : null;
        if (event.event === 'usage.updated') {
          row.usage = safe(d.usage_status) ? d.usage_status : 'unknown';
        }
        if (event.event === 'usage.settled' || event.event === 'usage.released') {
          row.usage = event.event.slice(6);
          reconcile = true;
        }
        if (event.event === 'audit.queued') row.audit = 'pending';
        if (event.event === 'audit.delivery') row.audit = safe(d.status) ? d.status : null;
      }
      if (reconcile) await this.reconcile(signal);
      this.generation = data.generation_id;
      this.cursor = data.cursor;
      if (!data.has_more) {
        this.state.status = 'current';
        this.publish();
        return;
      }
      if (seen.has(data.cursor)) throw new DesktopProtocolError('desktop.events_cursor_invalid');
      seen.add(data.cursor);
    }
    throw new DesktopProtocolError('desktop.events_limit');
  }
  start() {
    if (this.started || this.stopped) return;
    this.started = true;
    const next = async () => {
      await this.poll();
      if (!this.stopped) {
        this.timer = setTimeout(() => void next(), 2000);
        this.timer.unref?.();
      }
    };
    void next();
  }
  stop() {
    return (this.stopTask ??= this.stopOnce());
  }
  private async stopOnce() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.controller?.abort();
    await this.operation;
    await this.poll(5000);
    this.state.finalized = true;
    this.publish();
  }
}
