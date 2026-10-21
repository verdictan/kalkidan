import { useCallback, useEffect, useRef, useState } from 'react';
import type { API, TrackerBoard } from '../types';
import {
  canRevertMutation,
  mutationLabel,
  mutationStateLabels,
  type GitHubMutationHistory,
  type GitHubMutationRow,
} from '../domain/project-batch';
import type { PlanningLabel } from '../domain/planning-labels';
import { plural } from '../domain/planning-labels';
import { fullTime, relativeTime } from '../lib/relative-time';
import { Button } from './ui/button';
import { EmptyState } from './ui/empty-state';
import { SectionHeader } from './ui/page-header';
import { showToast } from './ui/toast';
import {
  describeFieldValue,
  ErrorAlert,
  ExternalTextLink,
  githubWritesEvent,
  openInsights,
  ReviewRow,
  TaskTitle,
} from './planning-kit';

export { notifyGitHubWrites } from './planning-kit';
import { errorMessage } from '../lib/errors';

/**
 * For the Tasks page: shows "Check 1 GitHub change" when writes have no confirmed result. It
 * checks when the page opens and after each write. It shows the toast again only when the
 * count changes.
 */
export function useUncertainWritesToast(api: API, groupId: string, enabled = true) {
  const shown = useRef(-1);
  const [count, setCount] = useState(0);
  useEffect(() => {
    if (!enabled || typeof api.trackerMutationHistory !== 'function') return;
    let disposed = false;
    const check = () =>
      void api
        .trackerMutationHistory(groupId)
        .then((rows) => {
          if (disposed) return;
          const value = rows.filter((row) => row.state === 'unknown-outcome').length;
          setCount(value);
          if (value > 0 && value !== shown.current)
            showToast({
              message: `Check ${plural(value, 'GitHub change')}. Kalkidan could not confirm the result.`,
              actions: [{ label: 'Review', onClick: () => openInsights(groupId) }],
              duration: 10000,
            });
          shown.current = value;
        })
        .catch(() => {
          // The history is a hint here. The Insights page shows the error.
        });
    const handle = (event: Event) => {
      if ((event as CustomEvent<{ groupId?: string }>).detail?.groupId === groupId) check();
    };
    check();
    window.addEventListener(githubWritesEvent, handle);
    return () => {
      disposed = true;
      window.removeEventListener(githubWritesEvent, handle);
    };
  }, [api, groupId, enabled]);
  return count;
}

const stateTones: Record<GitHubMutationRow['state'], PlanningLabel['tone']> = {
  writing: 'secondary',
  confirmed: 'success',
  rejected: 'destructive',
  'unknown-outcome': 'warning',
  reviewed: 'muted',
};

/** The GitHub writes of this project, newest first, with review and revert actions. */
export function GitHubWriteHistory({
  api,
  groupId,
  board,
  onOpenTask,
}: {
  api: API;
  groupId: string;
  board: TrackerBoard;
  onOpenTask: (itemId: string) => void;
}) {
  const [rows, setRows] = useState<GitHubMutationHistory>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const pending = useRef(false);
  const run = useCallback(
    async (action: () => Promise<GitHubMutationHistory | void>, done?: string) => {
      if (pending.current) return;
      pending.current = true;
      setBusy(true);
      setError('');
      try {
        const value = await action();
        setRows(value || (await api.trackerMutationHistory(groupId)));
        if (done) showToast(done);
      } catch (failure) {
        setError(errorMessage(failure));
      } finally {
        pending.current = false;
        setBusy(false);
      }
    },
    [api, groupId],
  );
  useEffect(() => {
    void run(() => api.trackerMutationHistory(groupId));
    const handle = (event: Event) => {
      if ((event as CustomEvent<{ groupId?: string }>).detail?.groupId === groupId)
        void run(() => api.trackerMutationHistory(groupId));
    };
    window.addEventListener(githubWritesEvent, handle);
    return () => window.removeEventListener(githubWritesEvent, handle);
  }, [api, groupId, run]);
  const unknown = rows?.filter((row) => row.state === 'unknown-outcome').length || 0;
  const field = (id?: string) => board.fields?.find((field) => field.id === id);
  const item = (id?: string) =>
    [...board.items, ...(board.archivedItems || [])].find((item) => item.id === id);
  return (
    <section aria-labelledby="write-history-title">
      <SectionHeader
        title={<span id="write-history-title">GitHub changes</span>}
        count={rows?.length}
        actions={<ExternalTextLink href={board.project.url}>Open board on GitHub</ExternalTextLink>}
      />
      <p className="form-help">
        {unknown
          ? `Kalkidan could not confirm ${plural(unknown, 'change')}. Kalkidan does not send these changes again. Check each one on GitHub.`
          : 'The changes that Kalkidan sent to GitHub for this project.'}
      </p>
      <ErrorAlert>{error}</ErrorAlert>
      {rows && !rows.length && !error && (
        <EmptyState compact>Kalkidan has not changed this board on GitHub.</EmptyState>
      )}
      {!!rows?.length && (
        <div className="review-list">
          {[...rows].reverse().map((row) => {
            const task = item(row.detail?.itemId);
            const definition = field(row.detail?.fieldId);
            const changed =
              row.detail?.before !== undefined && row.detail.value !== undefined
                ? `${definition?.name || 'Field'}: ${describeFieldValue(definition, row.detail.before)} → ${describeFieldValue(definition, row.detail.value)}`
                : definition
                  ? `Field: ${definition.name}`
                  : '';
            const time = new Date(row.updatedAt).toISOString();
            return (
              <ReviewRow
                key={row.id}
                title={
                  <>
                    {mutationLabel(row)}
                    {task && (
                      <>
                        <span className="font-normal text-muted-foreground"> on </span>
                        <TaskTitle title={task.title} onOpen={() => onOpenTask(task.id)} />
                      </>
                    )}
                  </>
                }
                meta={
                  [changed, row.revertedBy ? 'Reverted' : ''].filter(Boolean).join(' · ') ||
                  undefined
                }
                status={{ label: mutationStateLabels[row.state], tone: stateTones[row.state] }}
                aside={
                  <time dateTime={time} title={fullTime(time)}>
                    {relativeTime(time)}
                  </time>
                }
              >
                {(row.state === 'unknown-outcome' ||
                  (canRevertMutation(row) && typeof api.trackerMutationRevert === 'function')) && (
                  <div className="review-row-actions">
                    {row.state === 'unknown-outcome' && (
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void run(
                            () => api.trackerMutationHistory(groupId, row.id),
                            'Marked as checked on GitHub.',
                          )
                        }
                      >
                        I checked this on GitHub
                      </Button>
                    )}
                    {canRevertMutation(row) && typeof api.trackerMutationRevert === 'function' && (
                      <Button
                        size="xs"
                        variant="outline"
                        disabled={busy || !board.writable}
                        onClick={() =>
                          void run(
                            async () => {
                              await api.trackerMutationRevert!(groupId, row.id);
                              window.dispatchEvent(
                                new CustomEvent(githubWritesEvent, { detail: { groupId } }),
                              );
                            },
                            `Reverted the change to ${definition?.name || 'the field'}.`,
                          )
                        }
                      >
                        Revert this change
                      </Button>
                    )}
                  </div>
                )}
              </ReviewRow>
            );
          })}
        </div>
      )}
    </section>
  );
}
