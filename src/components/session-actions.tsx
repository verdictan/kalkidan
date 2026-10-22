import { useEffect, useState } from 'react';
import { LoaderCircle } from 'lucide-react';
import type { API, Session, SessionOrganization } from '../types';
import { errorMessage } from '../lib/errors';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { showToast } from './ui/toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

type SaveSession = (changes: SessionOrganization) => Promise<void>;

/** The app API: the desktop bridge, or the browser preview data. */
async function appAPI(): Promise<Pick<API, 'updateSession'>> {
  return window.workspace || (await import('../demo')).demo;
}

/** Saves organization changes of a session with the default API. */
async function saveWith(session: Session, changes: SessionOrganization, api?: API) {
  await (api || (await appAPI())).updateSession(session.agent, session.id, changes);
}

export const sessionTitle = (session: Session) => session.organization?.title || session.title;

/**
 * The one rename dialog: chats and projects use it. "Rename…" opens it. The field starts with
 * the current name, and Rename saves the new name.
 */
export function RenameDialog({
  open,
  title,
  label,
  value: initial,
  description,
  onOpenChange,
  save,
}: {
  open: boolean;
  /** "Rename chat" or "Rename project". */
  title: string;
  /** The accessible name of the field, such as "Chat name". */
  label: string;
  /** The current name. */
  value: string;
  description?: string;
  onOpenChange: (open: boolean) => void;
  /** Saves the new name. A rejection shows its message under the field. */
  save: (name: string) => Promise<void>;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setValue(initial);
    setError('');
  }, [open, initial]);
  async function submit() {
    if (!value.trim() || busy) return;
    setBusy(true);
    setError('');
    try {
      await save(value.trim());
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Input
            autoFocus
            aria-label={label}
            placeholder={label}
            value={value}
            aria-invalid={!!error || undefined}
            onChange={(e) => setValue(e.target.value)}
          />
          {error && (
            <p role="alert" className="field-error break-words">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!value.trim()}>
              {busy && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The rename dialog of a chat. The sidebar, the chat list and the chat menu use it. Without
 * `save`, the dialog saves the new name with `api.updateSession`.
 */
export function RenameSessionDialog({
  session,
  open,
  onOpenChange,
  api,
  save,
  onRenamed,
}: {
  session: Session | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api?: API;
  /** Saves the change. Use it for a session that the agent has not created yet. */
  save?: SaveSession;
  /** Called after the name is saved, for example to read the session list again. */
  onRenamed?: (title: string) => void;
}) {
  return (
    <RenameDialog
      open={open && !!session}
      title="Rename chat"
      label="Chat name"
      description="This name shows in the sidebar and in the chat list."
      value={session ? sessionTitle(session) : ''}
      onOpenChange={onOpenChange}
      save={async (title) => {
        if (!session) return;
        if (save) await save({ title });
        else await saveWith(session, { title }, api);
        onRenamed?.(title);
      }}
    />
  );
}

/**
 * The one notes UI for a chat. Every chat menu opens it with "Notes…". The chat header shows
 * the note. Without `save`, the dialog saves the note with `api.updateSession`.
 */
export function NotesDialog({
  session,
  open,
  onOpenChange,
  api,
  save,
  onSaved,
}: {
  session: Session | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api?: API;
  /** Saves the change. Use it for a session that the agent has not created yet. */
  save?: SaveSession;
  /** Called after the note is saved, for example to read the session list again. */
  onSaved?: (notes: string) => void;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open || !session) return;
    setValue(session.organization?.notes || '');
    setError('');
  }, [open, session?.agent, session?.id]);
  async function submit() {
    if (!session || busy) return;
    setBusy(true);
    setError('');
    try {
      const notes = value.trim();
      if (save) await save({ notes });
      else await saveWith(session, { notes }, api);
      onSaved?.(notes);
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open && !!session} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Notes</DialogTitle>
          <DialogDescription>
            Kalkidan keeps the note. The chat header shows it. The agent does not see it.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <Textarea
            autoFocus
            rows={4}
            maxLength={20000}
            aria-label="Notes"
            placeholder="Where you stopped, next steps…"
            value={value}
            aria-invalid={!!error || undefined}
            onChange={(e) => setValue(e.target.value)}
          />
          {error && (
            <p role="alert" className="field-error break-words">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit">
              {busy && <LoaderCircle className="animate-spin" aria-hidden="true" />}
              Save notes
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The one way to archive a session: archive it at once, then show a toast with Undo and
 * View archived. Rejects when the archive is not saved, so the caller can show the error.
 */
export async function archiveSessionWithUndo(
  session: Session,
  options: {
    api?: API;
    /** Saves the change. Use it for a session that the agent has not created yet. */
    save?: SaveSession;
    /** Opens the archived sessions. Without it, the toast has no View archived button. */
    onViewArchived?: () => void;
    /** Called after the archive and after an undo, for example to read the sessions again. */
    onChange?: () => void;
  } = {},
): Promise<void> {
  const save: SaveSession = options.save || ((changes) => saveWith(session, changes, options.api));
  await save({ archived: true });
  options.onChange?.();
  showToast({
    message: 'Chat archived',
    actions: [
      {
        label: 'Undo',
        onClick: () =>
          void save({ archived: false })
            .then(() => {
              options.onChange?.();
              showToast('Chat restored');
            })
            .catch((e) =>
              showToast({
                message: 'Could not restore the chat: ' + errorMessage(e),
                tone: 'error',
              }),
            ),
      },
      ...(options.onViewArchived
        ? [{ label: 'View archived', onClick: options.onViewArchived }]
        : []),
    ],
  });
}
