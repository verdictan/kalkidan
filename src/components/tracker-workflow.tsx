import { useEffect, useRef, useState } from 'react';
import type { TrackerAPI } from '../api/contracts';
import type { TaskPhase, TrackerBoard, TrackerConnection } from '../domain/tracker';
import { Choice } from './choice';
import { Alert, AlertDescription } from './ui/alert';
import { showToast } from './ui/toast';
import { SettingsRow, SettingsRows } from './project-settings-sections';
import { errorMessage } from '../lib/errors';

type Mapping = Record<TaskPhase, string> & { field: string };
/** The value of a step that has no saved status and whose default name is not on the board. */
const stay = 'none';

const steps: { phase: TaskPhase; label: string }[] = [
  { phase: 'progress', label: 'When a chat starts work' },
  { phase: 'review', label: 'When a pull request opens' },
  { phase: 'done', label: 'When you approve the work' },
];

/**
 * Automatic status changes: the status that Kalkidan sets on the board when a chat reaches each
 * step. Each choice saves at once, and the toast has Undo. A step without a saved status uses the
 * provider default only when the board has a status with that name. Otherwise the step shows
 * "Don't move".
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
  /** The status names that the provider uses for a step without a saved status. */
  defaults?: Partial<Record<TaskPhase, string>>;
  onSaved(): Promise<void> | void;
}) {
  const mapping = connection.statusMapping || {};
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
  /** The status that a step without a saved status uses, if the board has it. */
  const fallback = (phase: TaskPhase) => {
    const name = defaults?.[phase]?.trim().toLowerCase();
    return name ? statuses.find((status) => status.label.trim().toLowerCase() === name) : undefined;
  };
  /** The value that the choice shows: the saved status, the matching default, or "Don't move". */
  const shown = (phase: TaskPhase) => {
    const saved = value[phase];
    if (saved !== 'default' && statuses.some((status) => status.value === saved)) return saved;
    return fallback(phase)?.value || stay;
  };
  const options = (phase: TaskPhase) =>
    shown(phase) === stay
      ? [
          { value: stay, label: "Don't move", description: 'No matching status. The task stays.' },
          ...statuses,
        ]
      : statuses;
  async function write(next: Mapping) {
    await api.trackerConfigure(
      groupId,
      {
        ...(next.progress !== 'default' ? { progress: next.progress } : {}),
        ...(next.review !== 'default' ? { review: next.review } : {}),
        ...(next.done !== 'default' ? { done: next.done } : {}),
      },
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
  function choose(phase: TaskPhase, next: string) {
    if (next === shown(phase)) return;
    // "Don't move" and the matching default both mean "no saved status".
    const saved = next === stay || next === fallback(phase)?.value ? 'default' : next;
    if (saved === value[phase]) return;
    void change({ [phase]: saved });
  }
  return (
    <SettingsRows title="Automatic status changes">
      {error && (
        <Alert variant="destructive" size="sm" className="my-2">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {fields.length > 1 && (
        <SettingsRow label="Status field">
          <Choice
            className="w-40"
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
      {steps.map((step) => (
        <SettingsRow key={step.phase} label={step.label}>
          <Choice
            className="w-40"
            size="sm"
            label={step.label}
            value={shown(step.phase)}
            onChange={(next) => choose(step.phase, next)}
            options={options(step.phase)}
            disabled={busy}
          />
        </SettingsRow>
      ))}
    </SettingsRows>
  );
}
