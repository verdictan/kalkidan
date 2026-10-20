import { GitHubContentEditor } from './github-content-editor';
import { GitHubIssueRelations } from './github-issue-relations';
import { useRef, useState } from 'react';
import type { API, TrackerBoard, TrackerItem } from '../types';
import type { TrackerField } from '../domain/tracker';
import type { ProjectFieldValue, ProjectItemAction } from '../domain/github-mutations';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Choice } from './choice';
import { errorMessage } from '../lib/errors';

/** Edits stay local until Save. Failed writes retain the draft and require an explicit retry. */
export function GitHubItemEditor({
  api,
  groupId,
  board,
  item,
  onSaved,
}: {
  api: API;
  groupId: string;
  board: TrackerBoard;
  item: TrackerItem;
  onSaved: () => Promise<void>;
}) {
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(item.title);
  const [body, setBody] = useState(item.body);
  const [repository, setRepository] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  async function run(action: () => Promise<void>) {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
      await onSaved();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  const act = (action: ProjectItemAction) =>
    run(() => api.trackerItemAction(groupId, item.id, action));
  return (
    <section
      className="space-y-4 border-t pt-4"
      aria-label="GitHub item properties"
      aria-busy={busy}
    >
      {['Issue', 'PullRequest'].includes(item.kind || '') &&
        typeof api.trackerContent === 'function' && (
          <GitHubContentEditor
            key={item.id}
            api={api}
            groupId={groupId}
            itemId={item.id}
            onSaved={onSaved}
          />
        )}
      <h3 className="text-sm font-medium">Project fields</h3>
      {(board.fields || [])
        .filter((field) => field.id !== board.statusField?.id)
        .map((field) => (
          <FieldEditor
            key={`${item.id}:${field.id}`}
            field={field}
            item={item}
            disabled={busy}
            onSave={(value) => run(() => api.trackerField(groupId, item.id, field.id, value))}
          />
        ))}
      {item.kind === 'DraftIssue' && (
        <>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(!editing)}>
            {editing ? 'Close draft editor' : 'Edit draft'}
          </Button>
          {editing && (
            <div className="space-y-2">
              <Input
                aria-label="Draft title"
                value={title}
                maxLength={256}
                disabled={busy}
                onChange={(e) => setTitle(e.target.value)}
              />
              <Textarea
                aria-label="Draft description"
                value={body}
                maxLength={20000}
                disabled={busy}
                onChange={(e) => setBody(e.target.value)}
              />
              <Button
                size="sm"
                disabled={busy || !title.trim()}
                onClick={() => void act({ kind: 'edit-draft', title, body })}
              >
                Save draft
              </Button>
              <Input
                aria-label="Issue repository"
                placeholder="owner/repository"
                value={repository}
                disabled={busy}
                onChange={(e) => setRepository(e.target.value)}
              />
              <Button
                variant="outline"
                size="sm"
                disabled={busy || !repository}
                onClick={() => void act({ kind: 'convert', repository })}
              >
                Convert to issue
              </Button>
            </div>
          )}
        </>
      )}
      {item.kind === 'Issue' && typeof api.trackerRelations === 'function' && (
        <GitHubIssueRelations key={item.id} api={api} groupId={groupId} itemId={item.id} />
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => void act({ kind: item.archived ? 'unarchive' : 'archive' })}
        >
          {item.archived ? 'Restore item' : 'Archive item'}
        </Button>
        {!item.archived && (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => void act({ kind: 'reorder', afterId: null })}
          >
            Move to top
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => setConfirmRemove(!confirmRemove)}
        >
          Remove from project…
        </Button>
      </div>
      {confirmRemove && (
        <div className="space-y-2 rounded-md border p-3">
          <p className="text-sm">
            Remove this item from the GitHub project? Its issue or pull request will remain.
          </p>
          <Button
            size="sm"
            variant="destructive"
            disabled={busy}
            onClick={() => void act({ kind: 'remove' })}
          >
            Remove item
          </Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setConfirmRemove(false)}>
            Cancel
          </Button>
        </div>
      )}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </section>
  );
}
export function FieldEditor({
  field,
  item,
  disabled,
  onSave,
  saveLabel = 'Save',
}: {
  field: TrackerField;
  item: TrackerItem;
  disabled: boolean;
  onSave: (value: ProjectFieldValue) => Promise<void>;
  saveLabel?: string;
}) {
  const existing = item.fieldValues?.find(
    (value) => (value.field as { id?: string })?.id === field.id,
  );
  const key = (
    {
      TEXT: 'text',
      NUMBER: 'number',
      DATE: 'date',
      SINGLE_SELECT: 'optionId',
      ITERATION: 'iterationId',
    } as Record<string, string>
  )[field.dataType];
  const [value, setValue] = useState(String(existing?.[key] ?? ''));
  const [options, setOptions] = useState<string[]>(
    (existing?.options as { id: string }[] | undefined)?.map((option) => option.id) || [],
  );
  if (!key && field.dataType !== 'MULTI_SELECT')
    return <div className="text-xs text-muted-foreground">{field.name}: edit on GitHub</div>;
  function save() {
    if (field.dataType === 'MULTI_SELECT') return onSave({ multiSelectOptionIds: options });
    if (value === '') return onSave(null);
    const inputKey = field.dataType === 'SINGLE_SELECT' ? 'singleSelectOptionId' : key;
    return onSave({
      [inputKey]: field.dataType === 'NUMBER' ? Number(value) : value,
    } as ProjectFieldValue);
  }
  const choices =
    field.dataType === 'SINGLE_SELECT'
      ? field.options
      : field.iterations?.map((iteration) => ({ id: iteration.id, name: iteration.title }));
  return (
    <div className="space-y-1.5">
      <span className="text-xs text-muted-foreground">{field.name}</span>
      <div className="flex gap-2">
        {field.dataType === 'MULTI_SELECT' ? (
          <div className="grow">
            {field.options?.map((option) => (
              <label key={option.id} className="mr-3 inline-flex items-center gap-1 text-sm">
                <input
                  type="checkbox"
                  disabled={disabled}
                  checked={options.includes(option.id)}
                  onChange={(event) =>
                    setOptions(
                      event.target.checked
                        ? [...options, option.id]
                        : options.filter((id) => id !== option.id),
                    )
                  }
                />
                {option.name}
              </label>
            ))}
          </div>
        ) : choices ? (
          <Choice
            className="grow"
            label={field.name}
            value={value}
            disabled={disabled}
            onChange={setValue}
            options={[
              { value: '', label: 'No value' },
              ...choices.map((option) => ({ value: option.id, label: option.name })),
            ]}
          />
        ) : (
          <Input
            aria-label={field.name}
            type={
              field.dataType === 'NUMBER' ? 'number' : field.dataType === 'DATE' ? 'date' : 'text'
            }
            value={value}
            disabled={disabled}
            onChange={(event) => setValue(event.target.value)}
          />
        )}
        <Button
          size="sm"
          variant="outline"
          aria-label={`Save ${field.name}`}
          disabled={disabled}
          onClick={() => void save()}
        >
          {saveLabel}
        </Button>
        {field.dataType === 'MULTI_SELECT' && (
          <Button size="sm" variant="ghost" disabled={disabled} onClick={() => void onSave(null)}>
            Clear
          </Button>
        )}
      </div>
    </div>
  );
}
