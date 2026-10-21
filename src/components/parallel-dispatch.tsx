import { useEffect, useState } from 'react';
import type { API, TrackerBoard, Project } from '../types';
import type { DispatchPlan } from '../domain/parallel-dispatch';
import { Button } from './ui/button';
import { errorMessage } from '../lib/errors';

export function ParallelDispatchPanel({
  api,
  groupId,
  board,
}: {
  api: API;
  groupId: string;
  board: TrackerBoard;
}) {
  const [open, setOpen] = useState(false);
  const [repositories, setRepositories] = useState<Project[]>([]);
  const [selected, setSelected] = useState<Record<string, string>>({});
  const [agent, setAgent] = useState<'codex' | 'claude'>('codex');
  const [concurrency, setConcurrency] = useState(2);
  const [plan, setPlan] = useState<DispatchPlan>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    let disposed = false;
    void api
      .snapshot()
      .then((snapshot) => {
        if (disposed) return;
        const group = snapshot.groups?.find((group) => group.id === groupId);
        setRepositories(snapshot.projects.filter((repo) => group?.repoIds.includes(repo.id)));
      })
      .catch((failure) => {
        if (!disposed) setError(errorMessage(failure));
      });
    const saved = localStorage.getItem(`kalkidan.dispatch.${groupId}`);
    if (saved)
      void api
        .dispatchStatus(saved)
        .then((value) => {
          if (!disposed) setPlan(value);
        })
        .catch((failure) => {
          if (!disposed) setError(errorMessage(failure));
        });
    return () => {
      disposed = true;
    };
  }, [api, groupId, open]);
  useEffect(() => {
    if (!open || !plan || !['running', 'paused'].includes(plan.state)) return;
    let disposed = false,
      pending = false;
    const timer = setInterval(() => {
      if (pending) return;
      pending = true;
      void api
        .dispatchStatus(plan.id)
        .then((value) => {
          if (!disposed) setPlan(value);
        })
        .catch((failure) => {
          if (!disposed) setError(errorMessage(failure));
        })
        .finally(() => {
          pending = false;
        });
    }, 2000);
    return () => {
      disposed = true;
      clearInterval(timer);
    };
  }, [api, plan?.id, plan?.state, open]);
  async function act(action: () => Promise<DispatchPlan>) {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const value = await action();
      setPlan(value);
      localStorage.setItem(`kalkidan.dispatch.${groupId}`, value.id);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <details className="border-t py-3" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Automatic agent dispatch</summary>
      {open && (
        <div className="grid gap-3 py-3">
          <p className="help-text">
            Select up to 20 issues and their repositories. Review the prompts before starting. Each
            agent can edit its own worktree. Work starts as slots become available.
          </p>
          {!plan && (
            <>
              <label>
                Agent{' '}
                <select
                  value={agent}
                  onChange={(event) => setAgent(event.target.value as typeof agent)}
                >
                  <option value="codex">Codex</option>
                  <option value="claude">Claude Code</option>
                </select>
              </label>
              <label>
                Parallel agents{' '}
                <select
                  value={concurrency}
                  onChange={(event) => setConcurrency(Number(event.target.value))}
                >
                  {[1, 2, 3, 4].map((n) => (
                    <option key={n}>{n}</option>
                  ))}
                </select>
              </label>
              {board.items
                .filter((item) => item.kind === 'Issue')
                .map((item) => (
                  <label key={item.id} className="flex items-center justify-between gap-3">
                    {item.title}
                    <select
                      aria-label={`Repository for ${item.title}`}
                      value={selected[item.id] || ''}
                      onChange={(event) =>
                        setSelected({ ...selected, [item.id]: event.target.value })
                      }
                    >
                      <option value="">Do not dispatch</option>
                      {repositories.map((repo) => (
                        <option key={repo.id} value={repo.id}>
                          {repo.name}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              <Button
                disabled={busy || !Object.values(selected).some(Boolean)}
                onClick={() =>
                  void act(() =>
                    api.dispatchPrepare({
                      id: crypto.randomUUID(),
                      groupId,
                      agent,
                      concurrency,
                      tasks: Object.entries(selected)
                        .filter(([, id]) => id)
                        .map(([taskId, repositoryId]) => ({ taskId, repositoryId })),
                    }),
                  )
                }
              >
                Prepare dispatch
              </Button>
            </>
          )}
          {plan && (
            <>
              <p role="status">
                Dispatch: {plan.state} · {plan.concurrency} parallel agents
              </p>
              {plan.rows.map((row) => (
                <article key={row.operationId} className="grid gap-2 border-t py-2">
                  <strong>{row.title}</strong>
                  <p>
                    {row.state} · {row.branch}
                  </p>
                  {row.message && <p>{row.message}</p>}
                  {['uncertain', 'failed', 'dispatching'].includes(row.state) && (
                    <div className="grid gap-2">
                      <Button
                        disabled={busy}
                        onClick={() =>
                          void act(() => api.dispatchReconcile(plan.id, row.taskId, false))
                        }
                      >
                        Inspect owned session
                      </Button>
                      <details>
                        <summary>Release task reservation</summary>
                        <p>
                          Inspect session history first. This closes the reservation without
                          replaying a prompt. Active sessions must stop first.
                        </p>
                        <Button
                          disabled={busy}
                          onClick={() =>
                            void act(() => api.dispatchReconcile(plan.id, row.taskId, true))
                          }
                        >
                          I inspected the session — release task
                        </Button>
                      </details>
                    </div>
                  )}
                  <details>
                    <summary>Agent prompt</summary>
                    <pre className="whitespace-pre-wrap">{row.prompt}</pre>
                  </details>
                </article>
              ))}
              {['review', 'paused'].includes(plan.state) && (
                <Button disabled={busy} onClick={() => void act(() => api.dispatchStart(plan.id))}>
                  {plan.state === 'paused' ? 'Resume reviewed queue' : 'Start reviewed tasks'}
                </Button>
              )}
              {!['completed', 'canceled'].includes(plan.state) && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void act(() => api.dispatchCancel(plan.id))}
                >
                  Cancel dispatch and stop its agents
                </Button>
              )}
              {['completed', 'canceled'].includes(plan.state) && (
                <Button
                  variant="outline"
                  onClick={() => {
                    localStorage.removeItem(`kalkidan.dispatch.${groupId}`);
                    setPlan(undefined);
                  }}
                >
                  Prepare another dispatch
                </Button>
              )}
            </>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </details>
  );
}
