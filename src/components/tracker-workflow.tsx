import { useEffect, useState } from 'react';
import type { TrackerAPI } from '../api/contracts';
import type { TrackerBoard, TrackerConnection } from '../domain/tracker';
import { Choice } from './choice';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';

export function TrackerWorkflow({
  api,
  groupId,
  connection,
  board,
  open,
  defaults,
  onOpenChange,
  onSaved,
}: {
  api: Pick<TrackerAPI, 'trackerConfigure'>;
  groupId: string;
  connection: TrackerConnection;
  board: TrackerBoard;
  open: boolean;
  /** The status names that the provider sets when a choice is "Default". */
  defaults?: { progress: string; done: string };
  onOpenChange(open: boolean): void;
  onSaved(): Promise<void>;
}) {
  const [progress, setProgress] = useState('default');
  const [done, setDone] = useState('default');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setProgress(connection.statusMapping?.progress || 'default');
      setDone(connection.statusMapping?.done || 'default');
      setError('');
    }
  }, [open, connection.statusMapping]);
  const statuses =
    board.statusField?.options.map((option) => ({ value: option.id, label: option.name })) || [];
  const options = (name?: string) => [
    { value: 'default', label: name ? `Default (${name})` : 'Default' },
    ...statuses,
  ];
  async function save() {
    setBusy(true);
    setError('');
    try {
      await api.trackerConfigure(groupId, {
        ...(progress !== 'default' ? { progress } : {}),
        ...(done !== 'default' ? { done } : {}),
      });
      await onSaved();
      onOpenChange(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(value) => !busy && onOpenChange(value)}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Status changes from sessions</DialogTitle>
          <DialogDescription>
            A session can move its task on the board. Choose the status for each step. A task is
            done only when you approve it.
          </DialogDescription>
        </DialogHeader>
        <label className="form-label">
          When work starts
          <Choice
            className="w-full"
            label="Status when work starts"
            value={progress}
            onChange={setProgress}
            options={options(defaults?.progress)}
            disabled={busy}
          />
        </label>
        <label className="form-label">
          When you mark work complete
          <Choice
            className="w-full"
            label="Status when work completes"
            value={done}
            onChange={setDone}
            options={options(defaults?.done)}
            disabled={busy}
          />
        </label>
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
