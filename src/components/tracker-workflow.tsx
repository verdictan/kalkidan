import { useEffect, useRef, useState } from 'react';
import type { TrackerAPI } from '../api/contracts';
import type { TrackerBoard, TrackerConnection } from '../domain/tracker';
import { Choice } from './choice';
import { Alert, AlertDescription } from './ui/alert';
import { showToast } from './ui/toast';
import { SettingsRow, SettingsRows } from './project-settings-sections';
import { errorMessage } from '../lib/errors';

type Mapping = { progress: string; review: string; done: string; field: string };

/**
 * Automatic status changes: the status that Kalkidan sets on the board when a chat reaches each
 * step. Each choice saves at once, and the toast has Undo.
 */
export function TrackerWorkflowForm({
  api,
  groupId,
  connection,
  board,
  defaults,
  onSaved,
}: {
  api: Pick<TrackerAPI, 'trackerConfigure'>;
  groupId: string;
  connection: TrackerConnection;
  board: TrackerBoard;
  /** The status names that the provider sets when a choice is "Default". */
  defaults?: { progress: string; done: string; review?: string };
  onSaved(): Promise<void> | void;
}) {
  // The "review" step is new. Read it as an optional key until every provider sends it.
  const mapping = (connection.statusMapping || {}) as Partial<
    Record<'progress' | 'review' | 'done', string>
  >;
  const initial = (): Mapping => ({
    progress: mapping.progress || 'default',
    review: mapping.review || 'default',
    done: mapping.done || 'default',
    field: connection.statusFieldId || board.statusField?.id || '',
  });
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const latest = useRef(value);
  latest.current = value;
  // Take the saved values again when the project changes them from somewhere else.
  const key = `${mapping.progress}|${mapping.review}|${mapping.done}|${connection.statusFieldId}`;
  useEffect(() => {
    if (!busy) setValue(initial());
  }, [key]);
  const fields = board.fields?.filter((field) => field.dataType === 'SINGLE_SELECT') || [];
  const statuses =
    (fields.find((field) => field.id === value.field)?.options || board.statusField?.options)?.map(
      (option) => ({ value: option.id, label: option.name }),
    ) || [];
  const options = (name?: string) => [
    { value: 'default', label: name ? `Default (${name})` : 'Default' },
    ...statuses,
  ];
  async function write(next: Mapping) {
    await api.trackerConfigure(
      groupId,
      {
        ...(next.progress !== 'default' ? { progress: next.progress } : {}),
        ...(next.review !== 'default' ? { review: next.review } : {}),
        ...(next.done !== 'default' ? { done: next.done } : {}),
      } as TrackerConnection['statusMapping'],
      next.field || undefined,
    );
  }
  async function change(patch: Partial<Mapping>) {
    const previous = latest.current;
    const next = { ...previous, ...patch };
    setValue(next);
    setBusy(true);
    setError('');
    try {
      await write(next);
      await onSaved();
      showToast({
        message: 'Automatic status changes saved.',
        actions: [
          {
            label: 'Undo',
            onClick: () => {
              setValue(previous);
              void write(previous)
                .then(onSaved)
                .catch((failure) => setError(errorMessage(failure)));
            },
          },
        ],
      });
    } catch (failure) {
      setValue(previous);
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="grid gap-4">
      <p className="project-settings-row-help m-0">
        Kalkidan moves the task when a chat reaches each step.
      </p>
      {error && (
        <Alert variant="destructive" size="sm">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <SettingsRows label="Automatic status changes">
        {fields.length > 1 && (
          <SettingsRow label="Status field" help="The board field that holds the task status.">
            <Choice
              className="w-48"
              size="sm"
              label="Status field"
              value={value.field}
              onChange={(field) =>
                void change({ field, progress: 'default', review: 'default', done: 'default' })
              }
              options={fields.map((field) => ({ value: field.id, label: field.name }))}
              disabled={busy}
            />
          </SettingsRow>
        )}
        <SettingsRow label="When work starts" help="A chat starts work on the task.">
          <Choice
            className="w-48"
            size="sm"
            label="Status when work starts"
            value={value.progress}
            onChange={(progress) => void change({ progress })}
            options={options(defaults?.progress)}
            disabled={busy}
          />
        </SettingsRow>
        <SettingsRow
          label="When a pull request opens"
          help="A chat opens a pull request for the task."
        >
          <Choice
            className="w-48"
            size="sm"
            label="Status when a pull request opens"
            value={value.review}
            onChange={(review) => void change({ review })}
            options={
              defaults?.review
                ? options(defaults.review)
                : [{ value: 'default', label: 'No change' }, ...statuses]
            }
            disabled={busy}
          />
        </SettingsRow>
        <SettingsRow
          label="When you mark work complete"
          help="A task is done only when you approve it."
        >
          <Choice
            className="w-48"
            size="sm"
            label="Status when work completes"
            value={value.done}
            onChange={(done) => void change({ done })}
            options={options(defaults?.done)}
            disabled={busy}
          />
        </SettingsRow>
      </SettingsRows>
    </div>
  );
}
