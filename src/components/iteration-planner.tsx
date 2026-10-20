import { useEffect, useRef, useState } from 'react';
import type { API, TrackerBoard, Session } from '../types';
import { planIteration, type IterationPlan } from '../domain/iteration-plan';
import type { IssueRelations } from '../domain/github-relations';
import type { ProjectBatchRequest, ProjectBatchResult } from '../domain/project-batch';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { errorMessage } from '../lib/errors';
export function IterationPlanner({
  api,
  groupId,
  board,
  sessions,
  onSaved,
  onOpen,
}: {
  api: API;
  groupId: string;
  board: TrackerBoard;
  sessions: Session[];
  onSaved: () => Promise<void>;
  onOpen: (id: string) => void;
}) {
  const key = `kalkidan-iteration-plan:${groupId}:${board.project.id}`;
  const [open, setOpen] = useState(false),
    [estimate, setEstimate] = useState(''),
    [priority, setPriority] = useState(''),
    [iterationField, setIterationField] = useState(''),
    [iteration, setIteration] = useState(''),
    [capacity, setCapacity] = useState(''),
    [repository, setRepository] = useState('');
  const [selected, setSelected] = useState<string[]>([]),
    [plan, setPlan] = useState<IterationPlan>(),
    [accepted, setAccepted] = useState<string[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<ProjectBatchResult>();
  const [request, setRequest] = useState<ProjectBatchRequest | undefined>(() => {
    try {
      const value = JSON.parse(localStorage.getItem(key) || 'null');
      return value &&
        typeof value.id === 'string' &&
        Array.isArray(value.changes) &&
        value.changes.length <= 50
        ? value
        : undefined;
    } catch {
      return undefined;
    }
  });
  const epoch = useRef(0),
    pending = useRef(false);
  useEffect(
    () => () => {
      epoch.current++;
    },
    [],
  );
  const fields = board.fields || [],
    iterations = fields.find((field) => field.id === iterationField)?.iterations || [];
  const repos = [
    ...new Set(board.items.flatMap((item) => (item.repository ? [item.repository] : []))),
  ];
  async function prepare() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setPlan(undefined);
    setAccepted([]);
    const token = ++epoch.current;
    try {
      const fresh = await api.trackerBoard(groupId, true);
      const relations: Record<string, IssueRelations | { error: string }> = {};
      const queue = [...selected];
      await Promise.all(
        Array.from({ length: Math.min(3, queue.length) }, async () => {
          while (queue.length && token === epoch.current) {
            const id = queue.shift()!;
            if (fresh.items.find((item) => item.id === id)?.kind !== 'Issue') continue;
            try {
              relations[id] = await api.trackerRelations(groupId, id);
            } catch (failure) {
              relations[id] = { error: errorMessage(failure) };
            }
          }
        }),
      );
      const value = planIteration(fresh, {
        itemIds: selected,
        estimateFieldId: estimate,
        priorityFieldId: priority || undefined,
        iterationFieldId: iterationField,
        iterationId: iteration,
        capacity: Number(capacity),
        relations,
        activeItemIds: sessions
          .filter((session) => !session.organization?.archived)
          .flatMap((session) =>
            session.organization?.taskId ? [session.organization.taskId] : [],
          ),
        repositories: repos
          .filter((repo) => !repository || repo === repository)
          .map((repo) => repo.toLowerCase()),
      });
      if (token === epoch.current) {
        setPlan(value);
        setAccepted(value.rows.filter((row) => row.change).map((row) => row.itemId));
      }
    } catch (failure) {
      if (token === epoch.current) setError(errorMessage(failure));
    } finally {
      pending.current = false;
      if (token === epoch.current) setBusy(false);
    }
  }
  async function apply() {
    if (pending.current) return;
    const next = request || {
      id: crypto.randomUUID(),
      changes:
        plan?.rows.flatMap((row) =>
          row.change && accepted.includes(row.itemId) ? [row.change] : [],
        ) || [],
    };
    if (!next.changes.length) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      localStorage.setItem(key, JSON.stringify(next));
      setRequest(next);
      setResult(await api.trackerBatch(groupId, next));
      await onSaved();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const select = (
    label: string,
    value: string,
    set: (value: string) => void,
    options: { id: string; name: string }[],
  ) => (
    <label className="form-label">
      {label}
      <select
        aria-label={label}
        value={value}
        disabled={busy}
        onChange={(event) => set(event.target.value)}
      >
        <option value="">Choose…</option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.name}
          </option>
        ))}
      </select>
    </label>
  );
  return (
    <details className="border-t py-3" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Plan an iteration</summary>
      {open && (
        <div className="grid gap-3 py-3">
          <p className="help-text">
            Select up to 50 issues. The proposal uses fresh dependency data, positive estimates, and
            your priority option order. It never assigns missing estimates as zero or treats a saved
            session as an exclusive lock.
          </p>
          {!request && (
            <fieldset disabled={busy || !!plan} className="grid gap-3">
              {select(
                'Estimate field',
                estimate,
                setEstimate,
                fields.filter((field) => field.dataType === 'NUMBER'),
              )}
              {select(
                'Priority field (optional)',
                priority,
                setPriority,
                fields.filter((field) => field.dataType === 'SINGLE_SELECT'),
              )}
              {select(
                'Iteration field',
                iterationField,
                (value) => {
                  setIterationField(value);
                  setIteration('');
                },
                fields.filter((field) => field.dataType === 'ITERATION'),
              )}
              {select(
                'Target iteration',
                iteration,
                setIteration,
                iterations.map((value) => ({
                  id: value.id,
                  name: `${value.title} · ${value.startDate}`,
                })),
              )}
              {select(
                'Repository (optional)',
                repository,
                setRepository,
                repos.map((repo) => ({ id: repo, name: repo })),
              )}
              <label className="form-label">
                Remaining capacity
                <Input
                  aria-label="Remaining capacity"
                  type="number"
                  min="0"
                  value={capacity}
                  onChange={(event) => setCapacity(event.target.value)}
                />
              </label>
              <div className="grid max-h-64 gap-2 overflow-auto">
                {board.items.map((item) => (
                  <label key={item.id}>
                    <input
                      type="checkbox"
                      checked={selected.includes(item.id)}
                      disabled={!selected.includes(item.id) && selected.length >= 50}
                      onChange={(event) =>
                        setSelected(
                          event.target.checked
                            ? [...selected, item.id]
                            : selected.filter((id) => id !== item.id),
                        )
                      }
                    />
                    {item.title}
                  </label>
                ))}
              </div>
              <Button
                disabled={
                  !board.writable || !selected.length || !estimate || !iteration || !capacity
                }
                onClick={() => void prepare()}
              >
                Prepare allocation
              </Button>
            </fieldset>
          )}
          {plan && (
            <>
              <p>
                Proposed capacity: {plan.used} of {plan.capacity}. Uncheck tasks to apply a smaller
                batch.
              </p>
              {plan.rows.map((row) => (
                <div key={row.itemId} className="grid gap-1 border-b pb-2">
                  {row.change && (
                    <label>
                      <input
                        type="checkbox"
                        checked={accepted.includes(row.itemId)}
                        disabled={busy || !!request}
                        onChange={(event) =>
                          setAccepted(
                            event.target.checked
                              ? [...accepted, row.itemId]
                              : accepted.filter((id) => id !== row.itemId),
                          )
                        }
                      />{' '}
                      Assign {row.title}
                    </label>
                  )}
                  <Button
                    variant="bare"
                    className="justify-start"
                    onClick={() => onOpen(row.itemId)}
                  >
                    {row.title}
                  </Button>
                  <p className="help-text">
                    {row.estimate === undefined ? 'No estimate' : `Estimate: ${row.estimate}`} ·{' '}
                    {row.reason}
                  </p>
                </div>
              ))}
            </>
          )}
          {(plan || request) && (
            <>
              <Button
                disabled={
                  busy ||
                  !board.writable ||
                  (!request && !accepted.length) ||
                  result?.rows.every((row) => row.state === 'confirmed')
                }
                onClick={() => void apply()}
              >
                {request ? 'Resume allocation' : 'Apply selected allocation'}
              </Button>
              <Button
                disabled={busy}
                variant="outline"
                onClick={() => {
                  localStorage.removeItem(key);
                  setRequest(undefined);
                  setPlan(undefined);
                  setResult(undefined);
                }}
              >
                Start a new proposal
              </Button>
            </>
          )}
          {request && !plan && (
            <p>
              {request.changes.length} previously reviewed field changes are ready for recovery.
            </p>
          )}
          {result?.rows.map((row) => (
            <p key={`${row.itemId}:${row.fieldId}`} role="status">
              {board.items.find((item) => item.id === row.itemId)?.title || row.itemId}: {row.state}{' '}
              {row.message}
            </p>
          ))}
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </details>
  );
}
