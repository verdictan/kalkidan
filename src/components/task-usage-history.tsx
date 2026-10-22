import { useEffect, useMemo, useRef, useState } from 'react';
import { History } from 'lucide-react';
import type { API, Session, TrackerBoard } from '../types';
import {
  addDecimal,
  projectUsageLimits,
  summarizeProjectUsage,
  type ProjectUsage,
} from '../domain/project-usage';
import type { TaskUsageHistory } from '../domain/conversation';
import { evidenceStateLabel, plural, runPhaseLabel } from '../domain/planning-labels';
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
  taskId,
}: {
  /** The task to show. With it, the task filter is outside this panel and the panel has no header. */
  taskId?: string;
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
  useEffect(() => {
    if (taskId !== undefined) load(taskId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId]);
  const controlled = taskId !== undefined;
  return (
    <section ref={section} aria-label="Task usage" className="grid gap-3">
      {!controlled && (
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
      )}
      {!controlled && (
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
      )}
      <ErrorAlert>{error}</ErrorAlert>
      {busy && <p className="form-help">Loading runs…</p>}
      {history?.length === 0 && (
        <EmptyState compact icon={<History />} title="No runs for this task"></EmptyState>
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

/** "$6.10" for US dollars, else "6.10 EUR". Several currencies join with " + ". */
function costText(cost: Record<string, string>) {
  return Object.entries(cost)
    .filter(([, amount]) => Number(amount) > 0)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, amount]) => {
      const [whole, fraction = ''] = amount.split('.');
      // Two decimals at least, as on an invoice. Longer fractions stay as they are.
      const value = `${whole}.${fraction.padEnd(2, '0')}`;
      return currency.toUpperCase() === 'USD' ? `$${value}` : `${value} ${currency}`;
    })
    .join(' + ');
}

export interface TaskUsage {
  requests: number;
  /** "19 requests · $6.10", or "3 requests" when the cost is not known. */
  text: string;
}

/**
 * The managed-agent usage of each task, by task ID: the requests and the cost of the chats that
 * are linked to the task. One `projectUsage` read for the project; it reads again when the
 * linked chats change. A task without usage is not in the result.
 */
export function useTaskUsage(api: API, groupId: string, sessions: Session[]) {
  const linked = sessions
    .filter((session) => session.organization?.taskId && !session.organization.archived)
    .slice(0, projectUsageLimits.chats);
  const key = linked.map((session) => `${session.agent}:${session.id}`).join(',');
  const [usage, setUsage] = useState<ProjectUsage>();
  useEffect(() => {
    if (!linked.length || typeof api.projectUsage !== 'function') {
      setUsage(undefined);
      return;
    }
    let live = true;
    api
      .projectUsage(
        groupId,
        linked.map((session) => ({ agent: session.agent, sessionId: session.id })),
      )
      .then((value) => {
        if (live) setUsage(value);
      })
      .catch(() => {
        // Usage is extra information on a card. Without it, the card shows no usage.
        if (live) setUsage(undefined);
      });
    return () => {
      live = false;
    };
    // The key holds the linked chats.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, groupId, key]);
  return useMemo(() => {
    const result: Record<string, TaskUsage> = {};
    if (!usage) return result;
    const summary = summarizeProjectUsage(usage, Date.now());
    const totals: Record<string, { requests: number; cost: Record<string, string> }> = {};
    for (const chat of summary.chats) {
      const taskId = linked.find(
        (session) => session.agent === chat.agent && session.id === chat.sessionId,
      )?.organization?.taskId;
      if (!taskId) continue;
      const total = (totals[taskId] ||= { requests: 0, cost: {} });
      total.requests += chat.requests;
      for (const [currency, amount] of Object.entries(chat.cost))
        total.cost[currency] = addDecimal(total.cost[currency] ?? '0', amount);
    }
    for (const [taskId, total] of Object.entries(totals)) {
      if (!total.requests) continue;
      const cost = costText(total.cost);
      result[taskId] = {
        requests: total.requests,
        text: [plural(total.requests, 'request'), cost].filter(Boolean).join(' · '),
      };
    }
    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usage, key]);
}
