import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Popover } from 'radix-ui';
import type { API, TrackerBoard } from '../types';
import {
  canRevertMutation,
  mutationLabel,
  mutationStateLabels,
  type GitHubMutationHistory,
  type GitHubMutationRow,
} from '../domain/project-batch';
import type { PlanningLabel } from '../domain/planning-labels';
import { fullTime, relativeTime } from '../lib/relative-time';
import { History } from 'lucide-react';
import { Button } from './ui/button';
import { EmptyState } from './ui/empty-state';
import { SectionHeader } from './ui/page-header';
import { showToast } from './ui/toast';
import { menuCollisionPadding, menuContentClass } from './ui/menu-styles';
import { cn } from '../lib/utils';
import {
  ErrorAlert,
  fieldChangeText,
  ExternalTextLink,
  githubWritesEvent,
  ReviewRow,
  TaskTitle,
} from './planning-kit';

export { notifyGitHubWrites } from './planning-kit';
import { errorMessage } from '../lib/errors';

// Kalkidan warns only about writes that the user made since the app started. Older writes
// stay in the history on the Insights page.
const sessionStart = Date.now();

/**
 * The GitHub writes of this session that have no confirmed result. It checks when the page
 * opens and after each write. The board "⋯" menu shows a dot and "Check" for these writes.
 */
export function useUncertainWriteRows(api: API, groupId: string, enabled = true) {
  const [rows, setRows] = useState<GitHubMutationHistory>([]);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!enabled || typeof api.trackerMutationHistory !== 'function') {
      setRows([]);
      return;
    }
    let disposed = false;
    const check = () =>
      void api
        .trackerMutationHistory(groupId)
        .then((history) => {
          if (!disposed)
            setRows(
              history.filter(
                (row) => row.state === 'unknown-outcome' && row.updatedAt >= sessionStart,
              ),
            );
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
  }, [api, groupId, enabled, revision]);
  const reload = useCallback(() => setRevision((value) => value + 1), []);
  return { rows, reload };
}

/** The number of GitHub writes of this session that have no confirmed result. */
export function useUncertainWrites(api: API, groupId: string, enabled = true) {
  return useUncertainWriteRows(api, groupId, enabled).rows.length;
}

/** @deprecated Use `useUncertainWrites`. Kept for older callers. */
export const useUncertainWritesToast = useUncertainWrites;

/** "1 change may not have reached GitHub" for the board "⋯" menu. */
export function uncertainWritesText(count: number) {
  return count === 1
    ? '1 change may not have reached GitHub'
    : `${count} changes may not have reached GitHub`;
}

/**
 * A popover at the board "⋯" button: the writes of this session that have no confirmed
 * result, each with "Mark as checked", and a link to the board on GitHub.
 */
export function UncertainWritesPopover({
  api,
  groupId,
  board,
  rows,
  open,
  onOpenChange,
  onChecked,
  onOpenTask,
  children,
}: {
  api: API;
  groupId: string;
  board: TrackerBoard;
  rows: GitHubMutationHistory;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Called after "Mark as checked", so that the count loads again. */
  onChecked: () => void;
  onOpenTask: (itemId: string) => void;
  /** The anchor, for example the "⋯" button. */
  children: ReactNode;
}) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const item = (id?: string) =>
    [...board.items, ...(board.archivedItems || [])].find((value) => value.id === id);
  useEffect(() => {
    if (open) setError('');
    else if (!rows.length) setBusy('');
  }, [open, rows.length]);
  useEffect(() => {
    if (open && !rows.length) onOpenChange(false);
  }, [open, rows.length, onOpenChange]);
  async function check(id: string) {
    setBusy(id);
    setError('');
    try {
      await api.trackerMutationHistory(groupId, id);
      window.dispatchEvent(new CustomEvent(githubWritesEvent, { detail: { groupId } }));
      onChecked();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy('');
    }
  }
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Anchor asChild>{children}</Popover.Anchor>
      <Popover.Portal>
        <Popover.Content
          align="end"
          sideOffset={6}
          collisionPadding={menuCollisionPadding}
          aria-label="Changes to check"
          className={cn(menuContentClass, 'grid w-80 gap-1 p-2')}
        >
          <p className="px-1 pt-1 text-sm font-semibold">{uncertainWritesText(rows.length)}</p>
          <ul className="m-0 grid list-none gap-1 p-0">
            {rows.map((row) => {
              const task = item(row.detail?.itemId);
              const time = new Date(row.updatedAt).toISOString();
              return (
                <li key={row.id} className="flex min-h-10 items-center gap-2 rounded-sm px-1">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm">
                      {mutationLabel(row)}
                      {task && (
                        <>
                          <span className="text-muted-foreground"> on </span>
                          <TaskTitle
                            title={task.title}
                            onOpen={() => {
                              onOpenChange(false);
                              onOpenTask(task.id);
                            }}
                          />
                        </>
                      )}
                    </div>
                    <time
                      className="block text-xs text-muted-foreground"
                      dateTime={time}
                      title={fullTime(time)}
                    >
                      {relativeTime(time)}
                    </time>
                  </div>
                  <Button
                    size="xs"
                    variant="outline"
                    disabled={!!busy}
                    onClick={() => void check(row.id)}
                  >
                    Mark as checked
                  </Button>
                </li>
              );
            })}
          </ul>
          <ErrorAlert>{error}</ErrorAlert>
          <div className="px-1 pt-1 pb-1 text-sm">
            <ExternalTextLink href={board.project.url}>Open board on GitHub</ExternalTextLink>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
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
  embedded = false,
}: {
  api: API;
  groupId: string;
  board: TrackerBoard;
  onOpenTask: (itemId: string) => void;
  /** The page around it shows the title and the GitHub link, so leave out the section header. */
  embedded?: boolean;
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
    <section
      aria-labelledby={embedded ? undefined : 'write-history-title'}
      aria-label={embedded ? 'GitHub changes' : undefined}
    >
      {!embedded && (
        <SectionHeader
          title={<span id="write-history-title">GitHub changes</span>}
          count={rows?.length}
          actions={
            <ExternalTextLink href={board.project.url}>Open board on GitHub</ExternalTextLink>
          }
        />
      )}
      {!!unknown && (
        <p className="form-help">
          {uncertainWritesText(unknown)}. Check {unknown === 1 ? 'it' : 'each one'} on GitHub.
        </p>
      )}
      <ErrorAlert>{error}</ErrorAlert>
      {rows && !rows.length && !error && (
        <EmptyState compact icon={<History />} title="No GitHub changes" />
      )}
      {!!rows?.length && (
        <div className="review-list">
          {[...rows].reverse().map((row) => {
            const task = item(row.detail?.itemId);
            const definition = field(row.detail?.fieldId);
            const changed =
              row.detail?.before !== undefined && row.detail.value !== undefined
                ? fieldChangeText(definition, row.detail.before, row.detail.value)
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
                        Mark as checked
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
