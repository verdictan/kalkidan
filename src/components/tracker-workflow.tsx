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
  onOpenChange,
  onSaved,
}: {
  api: Pick<TrackerAPI, 'trackerConfigure'>;
  groupId: string;
  connection: TrackerConnection;
  board: TrackerBoard;
  open: boolean;
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
  const options = [
    { value: 'default', label: 'Provider default' },
    ...(board.statusField?.options.map((option) => ({ value: option.id, label: option.name })) ||
      []),
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
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Task workflow</DialogTitle>
          <DialogDescription>
            Choose the statuses that sessions set on a task. A task is complete only when you
            approve it.
          </DialogDescription>
        </DialogHeader>
        <label className="form-label">
          When work starts
          <Choice
            label="Status when work starts"
            value={progress}
            onChange={setProgress}
            options={options}
            disabled={busy}
          />
        </label>
        <label className="form-label">
          When you mark work complete
          <Choice
            label="Status when work completes"
            value={done}
            onChange={setDone}
            options={options}
            disabled={busy}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={busy} onClick={() => void save()}>
            {busy ? 'Saving…' : 'Save workflow'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
