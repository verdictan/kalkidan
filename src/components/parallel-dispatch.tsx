import { useEffect, useRef, useState } from 'react';
import type { Agent, Project, TrackerItem } from '../types';
import type { DispatchPlan } from '../domain/parallel-dispatch';
import { agentCatalog } from '../config/agents';
import { dispatchRowStateLabel, dispatchStateLabel, plural } from '../domain/planning-labels';
import { readPreferredAgent } from '../lib/agent-preference';
import { pathBasename } from '../lib/platform';
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';
import { DialogBody, DialogFooter } from './ui/dialog';
import { SectionHeader } from './ui/page-header';
import { SegmentedControl } from './ui/segmented-control';
import { showToast } from './ui/toast';
import {
  ErrorAlert,
  ReviewRow,
  SelectedTasks,
  StatusBadge,
  TaskTitle,
  ToolSection,
  type PlanningToolProps,
  FormSelect,
} from './planning-kit';
import { errorMessage } from '../lib/errors';

export const dispatchLimit = 20;
const storageKey = (groupId: string) => `kalkidan.dispatch.${groupId}`;

/** The code folder for a task: the folder with the same name as the task repository. */
export function repoForTask(item: Pick<TrackerItem, 'repository'>, repos: Project[]) {
  if (!item.repository) return undefined;
  const name = pathBasename(item.repository).toLowerCase();
  return repos.find(
    (repo) => repo.name.toLowerCase() === name || pathBasename(repo.path).toLowerCase() === name,
  );
}

function readSaved(groupId: string) {
  try {
    return localStorage.getItem(storageKey(groupId)) || '';
  } catch {
    return '';
  }
}

/**
 * Run tasks in parallel: each issue starts in its own branch copy with its own chat. The user
 * reviews the prompts first. With `autoPrepare`, the prompts are prepared when the tool opens.
 */
export function DispatchTool({
  api,
  group,
  board,
  items,
  onRemove,
  onOpenTask,
  onClose,
  repos,
  autoPrepare,
}: PlanningToolProps & { autoPrepare?: boolean }) {
  const issues = items.filter((item) => item.kind === 'Issue');
  const others = items.filter((item) => item.kind !== 'Issue');
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [agent, setAgent] = useState<Agent>(readPreferredAgent);
  const [concurrency, setConcurrency] = useState(() =>
    autoPrepare ? Math.min(4, Math.max(1, issues.length)) : 2,
  );
  const [plan, setPlan] = useState<DispatchPlan>();
  const [loading, setLoading] = useState(() => !!readSaved(group.id));
  const [release, setRelease] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pending = useRef(false);
  const repoId = (item: TrackerItem) =>
    item.id in selected ? selected[item.id] : repoForTask(item, repos)?.id || '';
  const tasks = issues.slice(0, dispatchLimit).flatMap((item) => {
    const id = repoId(item);
    return id ? [{ taskId: item.id, repositoryId: id }] : [];
  });

  async function act(action: () => Promise<DispatchPlan>, done?: (plan: DispatchPlan) => string) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const value = await action();
      setPlan(value);
      try {
        localStorage.setItem(storageKey(group.id), value.id);
      } catch {
        // Storage can be unavailable. The run then does not show after a restart.
      }
      if (done) showToast(done(value));
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const prepare = () =>
    act(() =>
      api.dispatchPrepare({
        id: crypto.randomUUID(),
        groupId: group.id,
        agent,
        concurrency,
        tasks,
      }),
    );

  // A saved run shows first. A wave from the readiness check prepares its prompts at once.
  const started = useRef(false);
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const saved = readSaved(group.id);
    if (saved)
      void api
        .dispatchStatus(saved)
        .then((value) => {
          setPlan(value);
          if (
            autoPrepare &&
            ['completed', 'canceled'].includes(value.state) &&
            tasks.length === issues.length
          )
            void prepare();
        })
        .catch(() => {
          // The saved run is gone. Start a new one.
          if (autoPrepare && tasks.length && tasks.length === issues.length) void prepare();
        })
        .finally(() => setLoading(false));
    else if (autoPrepare && tasks.length && tasks.length === issues.length) void prepare();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!plan || !['running', 'paused'].includes(plan.state)) return;
    let disposed = false,
      polling = false;
    const timer = setInterval(() => {
      if (polling) return;
      polling = true;
      void api
        .dispatchStatus(plan.id)
        .then((value) => {
          if (!disposed) setPlan(value);
        })
        .catch((failure) => {
          if (!disposed) setError(errorMessage(failure));
        })
        .finally(() => {
          polling = false;
        });
    }, 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [api, plan?.id, plan?.state]);

  function clear() {
    try {
      localStorage.removeItem(storageKey(group.id));
    } catch {
      // Storage can be unavailable.
    }
    setPlan(undefined);
    setError('');
  }
  const ended = !!plan && ['completed', 'canceled'].includes(plan.state);
  const agentName = (id: string) => agentCatalog.find((value) => value.id === id)?.name || 'Agent';

  return (
    <>
      <DialogBody className="grid content-start gap-4">
        {loading && <p className="form-help">Loading the last run…</p>}
        {!loading && !plan && (
          <>
            <SelectedTasks
              items={issues}
              onRemove={onRemove}
              limit={dispatchLimit}
              label="Issues to run"
            />
            {others.length > 0 && (
              <Alert size="sm">
                <AlertDescription>
                  Only issues can run. Kalkidan leaves out {plural(others.length, 'other item')}.
                </AlertDescription>
              </Alert>
            )}
            <div className="planning-form-grid">
              <label className="form-label">
                Agent
                <FormSelect
                  label="Agent"
                  value={agent}
                  disabled={busy}
                  onChange={(value) => setAgent(value as Agent)}
                  options={agentCatalog.map((value) => ({ value: value.id, label: value.name }))}
                />
              </label>
              <div className="form-label">
                <span>Chats at the same time</span>
                <SegmentedControl
                  label="Chats at the same time"
                  className="w-fit"
                  value={String(concurrency)}
                  onChange={(value) => setConcurrency(Number(value))}
                  options={['1', '2', '3', '4'].map((value) => ({ value, label: value }))}
                />
              </div>
            </div>
            {issues.length > 0 && (
              <section className="grid gap-1" aria-label="Code folders">
                <SectionHeader size="sm" as="h4" title="Code folder for each issue" />
                <div className="review-list">
                  {issues.slice(0, dispatchLimit).map((item) => (
                    <ReviewRow
                      key={item.id}
                      title={<TaskTitle title={item.title} onOpen={() => onOpenTask(item.id)} />}
                      meta={item.repository || 'No repository'}
                      aside={
                        <FormSelect
                          label={`Code folder for ${item.title}`}
                          size="sm"
                          className="w-44"
                          value={repoId(item)}
                          disabled={busy}
                          onChange={(value) => setSelected({ ...selected, [item.id]: value })}
                          options={[
                            { value: '', label: 'Do not run' },
                            ...repos.map((repo) => ({ value: repo.id, label: repo.name })),
                          ]}
                        />
                      }
                    />
                  ))}
                </div>
                {!repos.length && (
                  <ErrorAlert>
                    This project has no code folders. Add a code folder, then try again.
                  </ErrorAlert>
                )}
              </section>
            )}
            <p className="form-help">
              Each issue gets its own branch copy and its own chat. The agent can edit files in that
              copy only. Chats start when a place is free.
            </p>
          </>
        )}
        {plan && (
          <>
            <div className="flex flex-wrap items-center gap-2" role="status">
              <StatusBadge value={dispatchStateLabel(plan.state)} />
              <span className="text-xs text-muted-foreground">
                {agentName(plan.agent)} · {plan.concurrency} at the same time
              </span>
            </div>
            <div className="review-list">
              {plan.rows.map((row) => (
                <ReviewRow
                  key={row.operationId}
                  title={<TaskTitle title={row.title} onOpen={() => onOpenTask(row.taskId)} />}
                  meta={
                    <>
                      Branch <code className="font-mono">{row.branch}</code>
                      {row.message ? ` · ${row.message}` : ''}
                    </>
                  }
                  status={dispatchRowStateLabel(row.state)}
                >
                  <ToolSection title="Prompt">
                    <pre className="planning-pre">{row.prompt}</pre>
                  </ToolSection>
                  {['uncertain', 'failed', 'dispatching'].includes(row.state) && (
                    <div className="grid gap-2">
                      <div className="review-row-actions">
                        <Button
                          size="xs"
                          variant="outline"
                          disabled={busy}
                          onClick={() =>
                            void act(() => api.dispatchReconcile(plan.id, row.taskId, false))
                          }
                        >
                          Check the chat
                        </Button>
                        <Button
                          size="xs"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setRelease(release === row.taskId ? '' : row.taskId)}
                        >
                          Release the task…
                        </Button>
                      </div>
                      {release === row.taskId && (
                        <Alert size="sm">
                          <AlertDescription>
                            Check the chat history first. This frees the task. Kalkidan does not
                            send the prompt again. Stop an active chat first.
                            <div className="flex justify-end gap-2 self-stretch">
                              <Button size="xs" variant="outline" onClick={() => setRelease('')}>
                                Cancel
                              </Button>
                              <Button
                                size="xs"
                                variant="destructive"
                                disabled={busy}
                                onClick={() =>
                                  void act(
                                    () => api.dispatchReconcile(plan.id, row.taskId, true),
                                    () => `Released ${row.title}.`,
                                  ).then(() => setRelease(''))
                                }
                              >
                                Release task
                              </Button>
                            </div>
                          </AlertDescription>
                        </Alert>
                      )}
                    </div>
                  )}
                </ReviewRow>
              ))}
            </div>
          </>
        )}
        <ErrorAlert>{error}</ErrorAlert>
      </DialogBody>
      <DialogFooter>
        {!plan ? (
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={busy || loading || !tasks.length || issues.length > dispatchLimit}
              onClick={() => void prepare()}
            >
              {busy ? 'Preparing prompts…' : `Review ${plural(tasks.length, 'prompt')}`}
            </Button>
          </>
        ) : ended ? (
          <>
            <Button variant="outline" onClick={clear}>
              Start a new run
            </Button>
            <Button onClick={onClose}>Done</Button>
          </>
        ) : (
          <>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                void act(
                  () => api.dispatchCancel(plan.id),
                  () => 'Stopped the run and its chats.',
                )
              }
            >
              {plan.state === 'review' ? 'Cancel run' : 'Stop all chats'}
            </Button>
            {['review', 'paused'].includes(plan.state) ? (
              <Button
                disabled={busy}
                onClick={() =>
                  void act(
                    () => api.dispatchStart(plan.id),
                    (value) =>
                      `Started ${plural(value.rows.length, 'chat')}. Each task runs in its own branch copy.`,
                  )
                }
              >
                {plan.state === 'paused' ? 'Resume' : `Start ${plural(plan.rows.length, 'chat')}`}
              </Button>
            ) : (
              <Button onClick={onClose}>Close</Button>
            )}
          </>
        )}
      </DialogFooter>
    </>
  );
}
