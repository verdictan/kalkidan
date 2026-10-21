import { Fragment, useEffect, useRef, useState } from 'react';
import type { API } from '../api/contracts';
import {
  appendHistory,
  historyDecisionLabel,
  historyDetails,
  type ManagedHistoryPage,
  type ManagedHistoryScope,
} from '../domain/managed-history';
import { fullTime } from '../lib/relative-time';
import { errorMessage } from '../lib/errors';
import { Button } from './ui/button';
import { EmptyState } from './ui/empty-state';
import { ActionRow, ErrorAlert, ReviewRow } from './planning-kit';

/**
 * The Verdictan history of one task or one chat: one row for each request. Verdictan owns this
 * history. It loads when the target changes. "Load again" starts without a cursor, so late
 * settlement corrections show.
 */
export function ManagedHistoryView({ api, target }: { api: API; target?: ManagedHistoryScope }) {
  const [page, setPage] = useState<ManagedHistoryPage>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const key = target ? JSON.stringify(target) : '';
  const current = useRef(key);
  current.current = key;
  async function load(cursor?: string) {
    if (!target) return;
    const requested = key;
    setBusy(true);
    setError('');
    try {
      const next = await api.managedHistory({ ...target, ...(cursor ? { cursor } : {}) });
      if (current.current !== requested) return;
      setPage((previous) => (cursor && previous ? appendHistory(previous, next) : next));
    } catch (failure) {
      if (current.current === requested) setError(errorMessage(failure));
    } finally {
      if (current.current === requested) setBusy(false);
    }
  }
  useEffect(() => {
    setPage(undefined);
    setError('');
    if (key) void load();
    // Only a new target loads again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <div className="grid gap-3" aria-busy={busy}>
      <p className="form-help">
        Verdictan keeps one history for chats and tasks. A missing value is unknown. This is not a
        bill.
      </p>
      <ActionRow>
        <Button variant="outline" size="sm" disabled={busy || !target} onClick={() => void load()}>
          {page ? 'Load again' : 'Load history'}
        </Button>
      </ActionRow>
      <ErrorAlert>{error}</ErrorAlert>
      {busy && !page && <p className="form-help">Loading the history…</p>}
      {page && (
        <p className="form-help">
          Requests until {fullTime(page.asOf || page.observedAt) || 'now'}. Load again to see later
          requests and corrections.
        </p>
      )}
      {page && page.entries.length === 0 && (
        <EmptyState compact>No requests. Verdictan may not have them yet.</EmptyState>
      )}
      {!!page?.entries.length && (
        <div className="review-list">
          {page.entries.map((entry, index) => (
            <ReviewRow
              key={index}
              // Request IDs are internal. Show the request number and its time.
              title={`Request ${index + 1}`}
              meta={entry.time ? fullTime(entry.time) : 'Time unknown'}
              status={historyDecisionLabel(entry)}
            >
              <dl className="meta-list">
                {historyDetails(entry).map(([label, value]) => (
                  <Fragment key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </Fragment>
                ))}
              </dl>
            </ReviewRow>
          ))}
        </div>
      )}
      {page?.cursor && (
        <ActionRow>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void load(page.cursor!)}
          >
            Next page
          </Button>
        </ActionRow>
      )}
    </div>
  );
}
