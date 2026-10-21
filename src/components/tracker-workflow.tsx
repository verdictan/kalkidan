import { useEffect, useRef, useState } from 'react';
import type { TrackerAPI } from '../api/contracts';
import type { TrackerBoard, TrackerConnection } from '../domain/tracker';
import { Choice } from './choice';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';
import { showToast } from './ui/toast';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import { FooterActions, UpdatedNote, holdDialogFocus, useInitialFocus } from './dialog-parts';
import { errorMessage } from '../lib/errors';

type WorkflowProps = {
  api: Pick<TrackerAPI, 'trackerConfigure'>;
  groupId: string;
  connection: TrackerConnection;
  board: TrackerBoard;
  /** The status names that the provider sets when a choice is "Default". */
  defaults?: { progress: string; done: string; review?: string };
  onSaved(): Promise<void> | void;
};

/** The status automation form. The dialog gives the footer element for the Save button. */
export function TrackerWorkflowForm({
  api,
  groupId,
  connection,
  board,
  defaults,
  onSaved,
  footer,
  onDone,
}: WorkflowProps & {
  footer: HTMLElement | null;
  /** Called after a save. The standalone dialog closes. */
  onDone?(): void;
}) {
  // The "review" step is new. Read it as an optional key until every provider sends it.
  const mapping = (connection.statusMapping || {}) as Partial<
    Record<'progress' | 'review' | 'done', string>
  >;
  const initial = () => ({
    progress: mapping.progress || 'default',
    review: mapping.review || 'default',
    done: mapping.done || 'default',
    field: connection.statusFieldId || board.statusField?.id || '',
  });
  const [value, setValue] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState<number>();
  const root = useRef<HTMLDivElement>(null);
  useInitialFocus(root, true);
  // Take the saved values again when the project changes them from somewhere else.
  const key = `${mapping.progress}|${mapping.review}|${mapping.done}|${connection.statusFieldId}`;
  useEffect(() => {
    if (busy) return;
    setValue(initial());
    setSaved(initial());
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
  const dirty =
    value.progress !== saved.progress ||
    value.review !== saved.review ||
    value.done !== saved.done ||
    value.field !== saved.field;
  async function save() {
    setBusy(true);
    setError('');
    try {
      await api.trackerConfigure(
        groupId,
        {
          ...(value.progress !== 'default' ? { progress: value.progress } : {}),
          ...(value.review !== 'default' ? { review: value.review } : {}),
          ...(value.done !== 'default' ? { done: value.done } : {}),
        } as TrackerConnection['statusMapping'],
        value.field || undefined,
      );
      setSaved(value);
      setUpdatedAt(Date.now());
      await onSaved();
      showToast('Status automation saved.');
      onDone?.();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div ref={root} className="grid gap-4">
      {!!fields.length && (
        <label className="form-label">
          Workflow field
          <Choice
            className="w-full"
            label="Workflow field"
            value={value.field}
            onChange={(field) =>
              setValue({ field, progress: 'default', review: 'default', done: 'default' })
            }
            options={fields.map((field) => ({ value: field.id, label: field.name }))}
            disabled={busy}
          />
          <span className="form-help">The single select field that holds the task status.</span>
        </label>
      )}
      <label className="form-label">
        When work starts
        <Choice
          className="w-full"
          label="Status when work starts"
          value={value.progress}
          onChange={(progress) => setValue((current) => ({ ...current, progress }))}
          options={options(defaults?.progress)}
          disabled={busy}
        />
      </label>
      <label className="form-label">
        When a pull request opens
        <Choice
          className="w-full"
          label="Status when a pull request opens"
          value={value.review}
          onChange={(review) => setValue((current) => ({ ...current, review }))}
          options={
            defaults?.review
              ? options(defaults.review)
              : [{ value: 'default', label: 'No change' }, ...statuses]
          }
          disabled={busy}
        />
        <span className="form-help">A chat opens the pull request for its task.</span>
      </label>
      <label className="form-label">
        When you mark work complete
        <Choice
          className="w-full"
          label="Status when work completes"
          value={value.done}
          onChange={(done) => setValue((current) => ({ ...current, done }))}
          options={options(defaults?.done)}
          disabled={busy}
        />
        <span className="form-help">A task is done only when you approve it.</span>
      </label>
      {error && (
        <Alert variant="destructive" size="sm">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <FooterActions target={footer}>
        <UpdatedNote at={updatedAt} />
        <DialogClose asChild>
          <Button variant="outline" disabled={busy}>
            Cancel
          </Button>
        </DialogClose>
        <Button data-primary disabled={busy || !dirty} onClick={() => void save()}>
          {busy ? 'Saving…' : 'Save'}
        </Button>
      </FooterActions>
    </div>
  );
}

export function TrackerWorkflow({
  open,
  onOpenChange,
  ...props
}: WorkflowProps & {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" layout="scroll" onOpenAutoFocus={holdDialogFocus}>
        <DialogHeader>
          <DialogTitle>Status changes from chats</DialogTitle>
          <DialogDescription>
            A chat can move its task on the board. Choose the status for each step.
          </DialogDescription>
        </DialogHeader>
        <DialogBody>
          {open && (
            <TrackerWorkflowForm {...props} footer={footer} onDone={() => onOpenChange(false)} />
          )}
        </DialogBody>
        <DialogFooter ref={setFooter} className="empty:hidden" />
      </DialogContent>
    </Dialog>
  );
}
