import { useEffect, useRef, useState } from 'react';
import type { API, TrackerBoard } from '../types';
import type { TaskUsageHistory } from '../domain/conversation';
import { evidenceStateLabel, runPhaseLabel } from '../domain/planning-labels';
import { fullTime } from '../lib/relative-time';
import { Button } from './ui/button';
import { EmptyState } from './ui/empty-state';
import { SectionHeader } from './ui/page-header';
import { ErrorAlert, ReviewRow, ToolSection, FormSelect } from './planning-kit';
import { errorMessage } from '../lib/errors';

const unknown = (value: string | null) => value ?? 'Unknown';

/** Saved usage and policy records of the managed-agent runs of one task. */
export function TaskUsageHistoryPanel({
  api,
  groupId,
  board,
  initialTaskId,
}: {
  api: API;
  groupId: string;
  board: TrackerBoard;
  /** Selects this task, loads its runs and scrolls the section into view. */
  initialTaskId?: string;
}) {
  const [task, setTask] = useState(''),
    [history, setHistory] = useState<TaskUsageHistory[]>(),
    [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const section = useRef<HTMLElement>(null);
  function load(id: string) {
    setTask(id);
    setHistory(undefined);
    if (!id) return;
    setBusy(true);
    setError('');
    void api
      .taskUsageHistory(groupId, id)
      .then(setHistory)
      .catch((failure) => setError(errorMessage(failure)))
      .finally(() => setBusy(false));
  }
  // A usage chip of a chat opens Insights at its task.
  useEffect(() => {
    if (!initialTaskId || !board.items.some((item) => item.id === initialTaskId)) return;
    load(initialTaskId);
    const element = section.current;
    element?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    element?.querySelector<HTMLElement>('[role="combobox"]')?.focus({ preventScroll: true });
    // Only a new task ID selects again. Board refreshes keep the user's choice.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTaskId]);
  return (
    <section ref={section} aria-labelledby="usage-title" className="grid gap-3">
      <SectionHeader
        title={<span id="usage-title">Usage</span>}
        actions={
          task ? (
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => load(task)}>
              Refresh
            </Button>
          ) : undefined
        }
      />
      <p className="form-help">
        The usage and policy records that this computer saved for managed-agent runs. Kalkidan keeps
        the last 100 runs. “Unknown” shows when there is no record of a value. Your provider sends
        the bill.
      </p>
      <label className="form-label max-w-[360px]">
        Task
        <FormSelect
          label="Task"
          className="w-full"
          value={task}
          disabled={busy}
          onChange={load}
          options={board.items.map((item) => ({ value: item.id, label: item.title }))}
        />
      </label>
      <ErrorAlert>{error}</ErrorAlert>
      {busy && <p className="form-help">Loading runs…</p>}
      {history?.length === 0 && (
        <EmptyState compact>No saved runs for this task and account.</EmptyState>
      )}
      {!!history?.length && (
        <div className="review-list">
          {history.map((run, runIndex) => (
            <ReviewRow
              key={run.runId}
              // Run and host IDs are internal. Show the run number and the kind of host.
              title={`Run ${runIndex + 1} on ${run.hostId ? 'an SSH host' : 'this computer'}`}
              meta={`Updated ${fullTime(new Date(run.updatedAt).toISOString())}`}
              status={runPhaseLabel(run.phase)}
            >
              {!run.evidence.length && (
                <p className="text-xs leading-4 text-muted-foreground">
                  Kalkidan saved no usage records for this run.
                </p>
              )}
              {run.evidence.map((snapshot, index) => (
                <ToolSection
                  key={index}
                  defaultOpen={index === run.evidence.length - 1}
                  title={fullTime(new Date(snapshot.observedAt).toISOString())}
                  aside={
                    <span className="text-xs text-muted-foreground">
                      {evidenceStateLabel(snapshot.value.status)}
                      {snapshot.value.finalized ? ' · Final' : ''}
                    </span>
                  }
                >
                  {snapshot.value.requests.map((request) => (
                    <dl key={request.id} className="meta-list">
                      <dt>Policy</dt>
                      <dd>{unknown(request.policy)}</dd>
                      <dt>Usage</dt>
                      <dd>{unknown(request.usage)}</dd>
                      <dt>Cost</dt>
                      <dd>
                        {request.billing === 'subscription'
                          ? 'Included in your subscription'
                          : request.actualCost === null
                            ? 'Unknown'
                            : `${request.actualCost} ${request.currency ?? ''}`.trim()}
                      </dd>
                      <dt>Tokens</dt>
                      <dd>{unknown(request.tokens)}</dd>
                      <dt>Audit record</dt>
                      <dd>{unknown(request.audit)}</dd>
                    </dl>
                  ))}
                </ToolSection>
              ))}
            </ReviewRow>
          ))}
        </div>
      )}
    </section>
  );
}
