import { useRef, useState } from 'react';
import type { TrackerField } from '../domain/tracker';
import {
  projectFieldValue,
  type ProjectBatchRequest,
  type ProjectBatchResult,
} from '../domain/project-batch';
import type { ProjectFieldValue } from '../domain/github-mutations';
import { projectFieldText } from '../domain/project-view';
import { batchStateLabel, plural } from '../domain/planning-labels';
import { Button } from './ui/button';
import { CheckboxRow } from './ui/checkbox';
import { DialogBody, DialogFooter } from './ui/dialog';
import { Input } from './ui/input';
import { SectionHeader } from './ui/page-header';
import { showToast } from './ui/toast';
import {
  fieldChangeText,
  ErrorAlert,
  notifyGitHubWrites,
  ReviewRow,
  SelectedTasks,
  TaskTitle,
  type PlanningToolProps,
  FormSelect,
} from './planning-kit';
import { errorMessage } from '../lib/errors';

/** The field types that the batch tool can write. */
const batchFieldTypes = ['TEXT', 'NUMBER', 'DATE', 'SINGLE_SELECT', 'MULTI_SELECT', 'ITERATION'];
export const batchLimit = 50;

function readRequest(key: string): ProjectBatchRequest | undefined {
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null');
    return saved &&
      typeof saved.id === 'string' &&
      Array.isArray(saved.changes) &&
      saved.changes.length <= batchLimit &&
      saved.changes.every(
        (change: { itemId?: string; fieldId?: string }) =>
          typeof change?.itemId === 'string' && typeof change?.fieldId === 'string',
      )
      ? saved
      : undefined;
  } catch {
    return undefined;
  }
}

/** One input for a new field value: a select, a group of check boxes or a text box. */
function FieldValueInput({
  field,
  value,
  onChange,
  disabled,
}: {
  field: TrackerField;
  value: string | string[];
  onChange: (value: string | string[]) => void;
  disabled?: boolean;
}) {
  if (field.dataType === 'MULTI_SELECT') {
    const values = Array.isArray(value) ? value : [];
    return (
      <fieldset className="grid gap-2" disabled={disabled}>
        <legend className="form-label mb-2">New value</legend>
        {field.options?.map((option) => (
          <CheckboxRow
            key={option.id}
            label={option.name}
            checked={values.includes(option.id)}
            onChange={(event) =>
              onChange(
                event.target.checked
                  ? [...values, option.id]
                  : values.filter((id) => id !== option.id),
              )
            }
          />
        ))}
      </fieldset>
    );
  }
  const choices =
    field.dataType === 'SINGLE_SELECT'
      ? field.options
      : field.dataType === 'ITERATION'
        ? field.iterations?.map((iteration) => ({ id: iteration.id, name: iteration.title }))
        : undefined;
  return (
    <label className="form-label">
      New value
      {choices ? (
        <FormSelect
          label="New value"
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={onChange}
          options={[
            { value: '', label: 'No value' },
            ...choices.map((option) => ({ value: option.id, label: option.name })),
          ]}
        />
      ) : (
        <Input
          aria-label="New value"
          type={
            field.dataType === 'NUMBER' ? 'number' : field.dataType === 'DATE' ? 'date' : 'text'
          }
          value={typeof value === 'string' ? value : ''}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </label>
  );
}

function toFieldValue(field: TrackerField, value: string | string[]): ProjectFieldValue {
  if (field.dataType === 'MULTI_SELECT')
    return { multiSelectOptionIds: (Array.isArray(value) ? value : []).sort() };
  if (value === '' || Array.isArray(value)) return null;
  if (field.dataType === 'SINGLE_SELECT') return { singleSelectOptionId: value };
  if (field.dataType === 'ITERATION') return { iterationId: value };
  if (field.dataType === 'NUMBER') return { number: Number(value) };
  if (field.dataType === 'DATE') return { date: value };
  return { text: value };
}

/** Edit fields of several tasks: choose a field and a value, review each change, then apply. */
export function FieldsTool({
  api,
  group,
  board,
  items,
  onRemove,
  onOpenTask,
  onClose,
  onSaved,
}: PlanningToolProps) {
  const storageKey = `kalkidan-field-batch:${group.id}:${board.project.id}`;
  const [fieldId, setFieldId] = useState(''),
    [value, setValue] = useState<string | string[]>('');
  const [request, setRequest] = useState(() => readRequest(storageKey));
  const [result, setResult] = useState<ProjectBatchResult>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const fields = (board.fields || []).filter((field) => batchFieldTypes.includes(field.dataType));
  const field = fields.find((field) => field.id === fieldId);
  const tooMany = items.length > batchLimit;
  const title = (id: string) => board.items.find((item) => item.id === id)?.title || 'Removed task';
  const fieldOf = (id: string) => board.fields?.find((field) => field.id === id);

  function review() {
    if (!field || !items.length || tooMany) return;
    if (field.dataType === 'NUMBER' && value !== '' && !Number.isFinite(Number(value))) {
      setError('Enter a number.');
      return;
    }
    setError('');
    setResult(undefined);
    const next = {
      id: crypto.randomUUID(),
      changes: items.map((item) => ({
        itemId: item.id,
        fieldId: field.id,
        before: projectFieldValue(item, field.id),
        value: toFieldValue(field, value),
      })),
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setRequest(next);
    } catch {
      setError('Kalkidan cannot save a recovery record. Turn on local storage, then try again.');
    }
  }
  function restart() {
    try {
      localStorage.removeItem(storageKey);
    } catch {
      // Storage can be unavailable. The record then stays until the next start.
    }
    setRequest(undefined);
    setResult(undefined);
    setError('');
  }
  async function apply() {
    if (!request || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      const value = await api.trackerBatch(group.id, request);
      setResult(value);
      onSaved();
      const saved = value.rows.filter((row) => row.state === 'confirmed').length;
      const unknown = value.rows.filter((row) => row.state === 'unknown-outcome').length;
      const name = fieldOf(request.changes[0]?.fieldId)?.name || 'the field';
      if (saved) showToast(`Changed ${name} on ${plural(saved, 'task')}.`);
      if (unknown) notifyGitHubWrites(group.id, unknown);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const finished = !!result?.rows.every((row) => row.state === 'confirmed');
  const rowState = (itemId: string, fieldId: string) =>
    result?.rows.find((row) => row.itemId === itemId && row.fieldId === fieldId)?.state;
  return (
    <>
      <DialogBody className="grid content-start gap-4">
        {!request ? (
          <>
            <SelectedTasks items={items} onRemove={onRemove} limit={batchLimit} />
            <div className="planning-form-grid">
              <label className="form-label">
                Field
                <FormSelect
                  label="Field"
                  value={fieldId}
                  disabled={busy}
                  onChange={(id) => {
                    setFieldId(id);
                    setValue('');
                  }}
                  options={fields.map((field) => ({ value: field.id, label: field.name }))}
                />
              </label>
              {field && (
                <FieldValueInput
                  key={field.id}
                  field={field}
                  value={value}
                  onChange={setValue}
                  disabled={busy}
                />
              )}
            </div>
            {field && items.length > 0 && (
              <section className="grid gap-1" aria-label="Current values">
                <SectionHeader size="sm" as="h4" title="Current values" />
                <div className="review-list">
                  {items.slice(0, batchLimit).map((item) => (
                    <ReviewRow
                      key={item.id}
                      title={<TaskTitle title={item.title} onOpen={() => onOpenTask(item.id)} />}
                      meta={`${field.name}: ${projectFieldText(item, field) || 'No value'}`}
                    />
                  ))}
                </div>
              </section>
            )}
            {!board.writable && (
              <p className="form-help">You can only read this board. Ask the owner for access.</p>
            )}
          </>
        ) : (
          <section className="grid gap-1" aria-label="Changes to review">
            <SectionHeader
              size="sm"
              as="h4"
              title={result ? 'Results' : 'Review the changes'}
              count={request.changes.length}
            />
            <div className="review-list">
              {request.changes.map((change) => {
                const state = rowState(change.itemId, change.fieldId);
                const definition = fieldOf(change.fieldId);
                return (
                  <ReviewRow
                    key={`${change.itemId}:${change.fieldId}`}
                    title={
                      <TaskTitle
                        title={title(change.itemId)}
                        onOpen={() => onOpenTask(change.itemId)}
                      />
                    }
                    meta={fieldChangeText(definition, change.before, change.value)}
                    status={state ? batchStateLabel(state) : undefined}
                  />
                );
              })}
            </div>
            {(!result || result.rows.some((row) => row.state === 'unknown-outcome')) && (
              <p className="form-help mt-2">
                {result
                  ? 'Kalkidan does not send a change again when its result is not confirmed. Check it on GitHub.'
                  : 'Each change is written alone. Issue state and pull requests do not change.'}
              </p>
            )}
          </section>
        )}
        <ErrorAlert>{error}</ErrorAlert>
      </DialogBody>
      <DialogFooter>
        {!request ? (
          <>
            <Button variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              disabled={busy || !field || !items.length || tooMany || !board.writable}
              onClick={review}
            >
              Review {plural(Math.min(items.length, batchLimit), 'change')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" disabled={busy} onClick={restart}>
              Start again
            </Button>
            {finished ? (
              <Button onClick={onClose}>Done</Button>
            ) : (
              <Button disabled={busy || !board.writable} onClick={() => void apply()}>
                {busy
                  ? 'Applying…'
                  : result
                    ? 'Try again'
                    : `Apply ${plural(request.changes.length, 'change')}`}
              </Button>
            )}
          </>
        )}
      </DialogFooter>
    </>
  );
}
