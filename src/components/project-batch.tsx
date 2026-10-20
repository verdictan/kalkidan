import { useRef, useState } from 'react';
import type { API, TrackerBoard } from '../types';
import {
  projectFieldValue,
  type ProjectBatchRequest,
  type ProjectBatchResult,
} from '../domain/project-batch';
import type { ProjectFieldValue } from '../domain/github-mutations';
import { projectFieldText } from '../domain/project-view';
import { FieldEditor } from './github-item-editor';
import { Button } from './ui/button';
import { errorMessage } from '../lib/errors';
export function ProjectBatch({
  api,
  groupId,
  board,
  onSaved,
}: {
  api: API;
  groupId: string;
  board: TrackerBoard;
  onSaved: () => Promise<void>;
}) {
  const storageKey = `kalkidan-field-batch:${groupId}:${board.project.id}`;
  const [selected, setSelected] = useState<string[]>([]),
    [fieldId, setFieldId] = useState('');
  const [request, setRequest] = useState<ProjectBatchRequest | undefined>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey) || 'null');
      return saved &&
        typeof saved.id === 'string' &&
        Array.isArray(saved.changes) &&
        saved.changes.length <= 50 &&
        saved.changes.every(
          (change: { itemId?: string; fieldId?: string }) =>
            typeof change?.itemId === 'string' && typeof change?.fieldId === 'string',
        )
        ? saved
        : undefined;
    } catch {
      return undefined;
    }
  });
  const [result, setResult] = useState<ProjectBatchResult>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [open, setOpen] = useState(false);
  const fields = (board.fields || []).filter((field) =>
    ['TEXT', 'NUMBER', 'DATE', 'SINGLE_SELECT', 'MULTI_SELECT', 'ITERATION'].includes(
      field.dataType,
    ),
  );
  const field = fields.find((field) => field.id === fieldId);
  async function prepare(value: ProjectFieldValue) {
    if (!field || !selected.length) return;
    if (selected.some((id) => !board.items.some((item) => item.id === id))) {
      setError('A selected task was removed. Select the current tasks again.');
      setSelected([]);
      return;
    }
    setError('');
    setResult(undefined);
    const next = {
      id: crypto.randomUUID(),
      changes: selected.map((itemId) => ({
        itemId,
        fieldId: field.id,
        before: projectFieldValue(
          board.items.find((item) => item.id === itemId)!,
          field.id,
        ),
        value,
      })),
    };
    try {
      localStorage.setItem(storageKey, JSON.stringify(next));
      setRequest(next);
    } catch {
      setError(
        'Cannot save the batch recovery record. Enable local storage before changing fields.',
      );
    }
  }
  function describe(fieldId: string, value: ProjectFieldValue) {
    if (value === null) return 'No value';
    const definition = fields.find((field) => field.id === fieldId);
    if ('singleSelectOptionId' in value)
      return (
        definition?.options?.find((option) => option.id === value.singleSelectOptionId)?.name ||
        value.singleSelectOptionId
      );
    if ('iterationId' in value)
      return (
        definition?.iterations?.find((option) => option.id === value.iterationId)?.title ||
        value.iterationId
      );
    if ('multiSelectOptionIds' in value)
      return (
        value.multiSelectOptionIds
          .map((id) => definition?.options?.find((option) => option.id === id)?.name || id)
          .join(', ') || 'No value'
      );
    return String(Object.values(value)[0]);
  }
  async function apply() {
    if (!request || pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      setResult(await api.trackerBatch(groupId, request));
      await onSaved();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return (
    <details className="border-t py-3" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>Batch fields and iteration planning</summary>
      {open && (
        <div className="grid gap-3 py-3">
          <p className="help-text">
            Select up to 50 tasks. Review the exact field changes before applying them. Each result
            is independent. Issue state and pull requests stay unchanged.
          </p>
          {!request ? (
            <>
              <label className="form-label">
                Field
                <select
                  aria-label="Batch field"
                  value={fieldId}
                  onChange={(event) => setFieldId(event.target.value)}
                >
                  <option value="">Choose field</option>
                  {fields.map((field) => (
                    <option key={field.id} value={field.id}>
                      {field.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="grid max-h-64 gap-2 overflow-auto">
                {board.items.map((item) => (
                  <label key={item.id} className="flex gap-2">
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
                    {field && (
                      <span className="text-muted-foreground">
                        {' '}
                        · {projectFieldText(item, field) || 'No value'}
                      </span>
                    )}
                  </label>
                ))}
              </div>
              {field && (
                <FieldEditor
                  key={field.id}
                  field={field}
                  item={{ id: 'preview', title: '', body: '' }}
                  disabled={!selected.length || !board.writable}
                  onSave={prepare}
                  saveLabel="Review batch"
                />
              )}
            </>
          ) : (
            <>
              <h4>Review {request.changes.length} field changes</h4>
              {request.changes.map((change) => (
                <div key={`${change.itemId}:${change.fieldId}`} className="border-b pb-2 text-sm">
                  <strong>
                    {board.items.find((item) => item.id === change.itemId)?.title || change.itemId}
                  </strong>
                  <p>
                    {fields.find((field) => field.id === change.fieldId)?.name || change.fieldId}:{' '}
                    {describe(change.fieldId, change.before)} →{' '}
                    {describe(change.fieldId, change.value)}
                  </p>
                </div>
              ))}
              <Button
                disabled={
                  busy || !board.writable || result?.rows.every((row) => row.state === 'confirmed')
                }
                onClick={() => void apply()}
              >
                {busy
                  ? 'Checking field results…'
                  : result
                    ? 'Resume and inspect batch'
                    : 'Apply reviewed batch'}
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => {
                  localStorage.removeItem(storageKey);
                  setRequest(undefined);
                  setResult(undefined);
                  setSelected([]);
                }}
              >
                Start a new batch
              </Button>
              {result?.rows.map((row) => (
                <p key={`${row.itemId}:${row.fieldId}`} role="status">
                  {board.items.find((item) => item.id === row.itemId)?.title || row.itemId}:{' '}
                  {row.state}
                  {row.message ? ` · ${row.message}` : ''}
                </p>
              ))}
              <p className="help-text">
                Resuming never repeats a confirmed or uncertain write. A conflict requires a new
                reviewed batch.
              </p>
            </>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
      )}
    </details>
  );
}
