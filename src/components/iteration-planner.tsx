import { useEffect, useRef, useState } from 'react';
import { planIteration, type IterationPlan } from '../domain/iteration-plan';
import type { IssueRelations } from '../domain/github-relations';
import type { ProjectBatchRequest, ProjectBatchResult } from '../domain/project-batch';
import { batchStateLabel, plural } from '../domain/planning-labels';
import { Button } from './ui/button';
import { Checkbox } from './ui/checkbox';
import { DialogBody, DialogFooter } from './ui/dialog';
import { Input } from './ui/input';
import { SectionHeader } from './ui/page-header';
import { showToast } from './ui/toast';
import {
  ErrorAlert,
  notifyGitHubWrites,
  ReviewRow,
  SelectedTasks,
  TaskTitle,
  type PlanningToolProps,
  FormSelect,
} from './planning-kit';
import { errorMessage } from '../lib/errors';

export const iterationLimit = 50;

function readRequest(key: string): ProjectBatchRequest | undefined {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    return value &&
      typeof value.id === 'string' &&
      Array.isArray(value.changes) &&
      value.changes.length <= iterationLimit
      ? value
      : undefined;
  } catch {
    return undefined;
  }
}

/** Plan an iteration: propose which selected tasks fit the capacity, then assign them. */
export function IterationTool({
  api,
  group,
  board,
  items,
  onRemove,
  allTasks,
  onOpenTask,
  onClose,
  onSaved,
  sessions,
}: PlanningToolProps) {
  const key = `kalkidan-iteration-plan:${group.id}:${board.project.id}`;
  const fields = board.fields || [];
  const only = (type: string) => fields.filter((field) => field.dataType === type);
  // A board with one field of a type does not ask for it.
  const [estimate, setEstimate] = useState(() =>
    only('NUMBER').length === 1 ? only('NUMBER')[0].id : '',
  );
  const [priority, setPriority] = useState(''),
    [iterationField, setIterationField] = useState(() =>
      only('ITERATION').length === 1 ? only('ITERATION')[0].id : '',
    ),
    [iteration, setIteration] = useState(''),
    [capacity, setCapacity] = useState(''),
    [repository, setRepository] = useState('');
  const [plan, setPlan] = useState<IterationPlan>(),
    [accepted, setAccepted] = useState<string[]>([]),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState<ProjectBatchResult>();
  const [request, setRequest] = useState(() => readRequest(key));
  const epoch = useRef(0),
    pending = useRef(false);
  useEffect(
    () => () => {
      epoch.current++;
    },
    [],
  );
  const iterations = fields.find((field) => field.id === iterationField)?.iterations || [];
  const iterationTitle =
    iterations.find((value) => value.id === iteration)?.title ||
    iterations.find((value) =>
      request?.changes.some(
        (change) =>
          change.value && 'iterationId' in change.value && change.value.iterationId === value.id,
      ),
    )?.title ||
    'the iteration';
  const repos = [
    ...new Set(board.items.flatMap((item) => (item.repository ? [item.repository] : []))),
  ];
  const tooMany = items.length > iterationLimit;
  const title = (id: string) => board.items.find((item) => item.id === id)?.title || 'Removed task';

  async function propose() {
    if (pending.current || tooMany) return;
    pending.current = true;
    setBusy(true);
    setError('');
    setPlan(undefined);
    setAccepted([]);
    const token = ++epoch.current;
    const selected = items.map((item) => item.id);
    try {
      const fresh = await api.trackerBoard(group.id, true);
      const relations: Record<string, IssueRelations | { error: string }> = {};
      const queue = [...selected];
      await Promise.all(
        Array.from({ length: Math.min(3, queue.length) }, async () => {
          while (queue.length && token === epoch.current) {
            const id = queue.shift()!;
            if (fresh.items.find((item) => item.id === id)?.kind !== 'Issue') continue;
            try {
              relations[id] = await api.trackerRelations(group.id, id);
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
      const value = await api.trackerBatch(group.id, next);
      setResult(value);
      onSaved();
      const saved = value.rows.filter((row) => row.state === 'confirmed').length;
      const unknown = value.rows.filter((row) => row.state === 'unknown-outcome').length;
      if (saved) showToast(`Added ${plural(saved, 'task')} to ${iterationTitle}.`);
      if (unknown) notifyGitHubWrites(group.id, unknown);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  function restart() {
    try {
      localStorage.removeItem(key);
    } catch {
      // Storage can be unavailable. The record then stays until the next start.
    }
    setRequest(undefined);
    setPlan(undefined);
    setResult(undefined);
    setError('');
  }
  const field = (
    label: string,
    value: string,
    set: (value: string) => void,
    options: { id: string; name: string }[],
    optional = false,
  ) => (
    <label className="form-label">
      {label}
      <FormSelect
        label={label}
        value={value}
        disabled={busy}
        onChange={set}
        options={[
          ...(optional ? [{ value: '', label: 'None' }] : []),
          ...options.map((option) => ({ value: option.id, label: option.name })),
        ]}
      />
    </label>
  );
  const finished = !!result?.rows.every((row) => row.state === 'confirmed');
  const rowState = (itemId: string) => result?.rows.find((row) => row.itemId === itemId)?.state;
  const form = !request && !plan;
  // Without an iteration field there is nothing to plan. Show only that, with a link.
  if (form && !only('ITERATION').length)
    return (
      <>
        <DialogBody className="grid content-start gap-4">
          <p className="m-0 text-sm">Needs an Iteration field on GitHub.</p>
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button asChild>
            <a href={board.project.url} target="_blank" rel="noreferrer">
              Open board on GitHub
            </a>
          </Button>
        </DialogFooter>
      </>
    );
  return (
    <>
      <DialogBody className="grid content-start gap-4">
        {form && (
          <>
            <SelectedTasks
              all={allTasks}
              items={items}
              onRemove={onRemove}
              limit={iterationLimit}
            />
            <div className="planning-form-grid">
              {field(
                'Iteration field',
                iterationField,
                (value) => {
                  setIterationField(value);
                  setIteration('');
                },
                only('ITERATION'),
              )}
              {field(
                'Target iteration',
                iteration,
                setIteration,
                iterations.map((value) => ({
                  id: value.id,
                  name: `${value.title} · starts ${value.startDate}`,
                })),
              )}
              {field('Estimate field', estimate, setEstimate, only('NUMBER'))}
              <label className="form-label">
                Remaining capacity
                <Input
                  aria-label="Remaining capacity"
                  type="number"
                  min="0"
                  value={capacity}
                  disabled={busy}
                  onChange={(event) => setCapacity(event.target.value)}
                />
              </label>
              {field('Priority field', priority, setPriority, only('SINGLE_SELECT'), true)}
              {field(
                'Repository',
                repository,
                setRepository,
                repos.map((repo) => ({ id: repo, name: repo })),
                true,
              )}
            </div>
          </>
        )}
        {plan && !request && (
          <section className="grid gap-1" aria-label="Proposed plan">
            <SectionHeader
              size="sm"
              as="h4"
              title={`Proposal: ${plan.used} of ${plan.capacity} used`}
              count={accepted.length}
            />
            <div className="review-list">
              {plan.rows.map((row) => (
                <ReviewRow
                  key={row.itemId}
                  leading={
                    row.change ? (
                      <Checkbox
                        aria-label={`Add ${row.title}`}
                        checked={accepted.includes(row.itemId)}
                        disabled={busy}
                        onChange={(event) =>
                          setAccepted(
                            event.target.checked
                              ? [...accepted, row.itemId]
                              : accepted.filter((id) => id !== row.itemId),
                          )
                        }
                      />
                    ) : undefined
                  }
                  title={<TaskTitle title={row.title} onOpen={() => onOpenTask(row.itemId)} />}
                  meta={`${row.estimate === undefined ? 'No estimate' : `Estimate ${row.estimate}`} · ${row.reason}`}
                  status={
                    row.change
                      ? { label: 'Fits', tone: 'success' }
                      : { label: 'Left out', tone: 'muted' }
                  }
                />
              ))}
            </div>
          </section>
        )}
        {request && (
          <section className="grid gap-1" aria-label="Assignments">
            <SectionHeader
              size="sm"
              as="h4"
              title={result ? 'Results' : 'Assignments not applied yet'}
              count={request.changes.length}
            />
            <div className="review-list">
              {request.changes.map((change) => {
                const state = rowState(change.itemId);
                return (
                  <ReviewRow
                    key={change.itemId}
                    title={
                      <TaskTitle
                        title={title(change.itemId)}
                        onOpen={() => onOpenTask(change.itemId)}
                      />
                    }
                    meta={`Add to ${iterationTitle}`}
                    status={state ? batchStateLabel(state) : undefined}
                  />
                );
              })}
            </div>
          </section>
        )}
        <ErrorAlert>{error}</ErrorAlert>
      </DialogBody>
      <DialogFooter>
        {form ? (
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={
                busy ||
                tooMany ||
                !board.writable ||
                !items.length ||
                !estimate ||
                !iteration ||
                !capacity
              }
              onClick={() => void propose()}
            >
              {busy ? 'Checking tasks…' : 'Propose a plan'}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" disabled={busy} onClick={restart}>
              {request ? 'Start again' : 'Change settings'}
            </Button>
            {finished ? (
              <Button onClick={onClose}>Done</Button>
            ) : (
              <Button
                disabled={busy || !board.writable || (!request && !accepted.length)}
                onClick={() => void apply()}
              >
                {busy
                  ? 'Assigning…'
                  : request
                    ? result
                      ? 'Try again'
                      : `Assign ${plural(request.changes.length, 'task')}`
                    : `Add ${plural(accepted.length, 'task')} to ${iterationTitle}`}
              </Button>
            )}
          </>
        )}
      </DialogFooter>
    </>
  );
}
