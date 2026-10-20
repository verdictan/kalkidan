import { useEffect, useRef, useState } from 'react';
import {
  Pencil,
  Pin,
  MessageSquarePlus,
  GitFork,
  Share2,
  Copy,
  AppWindow,
  ExternalLink,
  Archive,
  GitCommitHorizontal,
  LoaderCircle,
} from 'lucide-react';
import type { API, Session, SessionOrganization } from '../types';
import type { WorkingStatus } from '../api/contracts';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { MoreButton } from './ui/more-button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuShortcut,
} from './ui/dropdown-menu';
import { ConfirmDialog } from './confirm-dialog';
import {
  fileManagerName,
  hasPrimaryModifier,
  isMac,
  isTypingTarget,
  plural,
  shortcutLabel,
} from '../lib/platform';
import { errorMessage } from '../lib/errors';

// On Windows and Linux, AltGr sends Ctrl+Alt, so Ctrl+Alt shortcuts do not arrive.
// There the session shortcuts use Ctrl+Shift. Ctrl+Shift+R is not used because it
// reloads the page.
const sessionKeys = isMac
  ? { modifiers: ['mod', 'alt'] as const, rename: 'R', pin: 'P', side: 'S' }
  : { modifiers: ['mod', 'shift'] as const, rename: 'E', pin: 'P', side: 'S' };
const shortcuts = {
  rename: shortcutLabel([...sessionKeys.modifiers], sessionKeys.rename),
  pin: shortcutLabel([...sessionKeys.modifiers], sessionKeys.pin),
  side: shortcutLabel([...sessionKeys.modifiers], sessionKeys.side),
  archive: shortcutLabel(['mod', 'shift'], 'A'),
};
/** True when the key press has the second session modifier: Option on macOS, Shift elsewhere. */
function sessionModifier(e: KeyboardEvent) {
  return isMac ? e.altKey && !e.shiftKey : e.shiftKey && !e.altKey;
}

export function SessionMenu({
  api,
  session,
  saved,
  running,
  update,
  branch,
  archive,
  repositoryId,
}: {
  api: API;
  session: Session;
  saved: boolean;
  running: boolean;
  /** The repository entry of the session checkout. Commit needs it. */
  repositoryId?: string;
  update: (changes: SessionOrganization) => Promise<void>;
  branch: (fork: boolean, worktree?: string) => Promise<void>;
  archive: () => void;
}) {
  const [dialog, setDialog] = useState<'rename' | 'worktree' | 'archive' | 'commit' | null>(null);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const statusTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(statusTimer.current), []);
  function showStatus(text: string) {
    clearTimeout(statusTimer.current);
    setStatus(text);
    statusTimer.current = setTimeout(() => setStatus(''), 3000);
  }
  async function perform(fn: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    try {
      const result = await fn();
      if (typeof result === 'string') showStatus(result);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const rename = () => {
    setValue(session.organization?.title || session.title);
    setDialog('rename');
  };
  const pin = () => perform(() => update({ pinned: !session.organization?.pinned }));
  const doArchive = () =>
    perform(async () => {
      await update({ archived: true });
      setDialog(null);
      archive();
    });
  const confirmArchive = () => setDialog('archive');
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!hasPrimaryModifier(e) || isTypingTarget(e.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (sessionModifier(e) && e.code === 'Key' + sessionKeys.rename) {
        e.preventDefault();
        rename();
      }
      if (sessionModifier(e) && e.code === 'Key' + sessionKeys.pin) {
        e.preventDefault();
        void pin();
      }
      if (sessionModifier(e) && e.code === 'Key' + sessionKeys.side) {
        e.preventDefault();
        void perform(() => branch(false));
      }
      if (e.shiftKey && !e.altKey && e.code === 'KeyA' && !running) {
        e.preventDefault();
        confirmArchive();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  const action = (kind: Parameters<API['sessionAction']>[1]) =>
    void perform(() => api.sessionAction(session, kind));
  return (
    <>
      {status && (
        <span role="status" className="session-menu-status text-xs text-muted-foreground">
          {status}
        </span>
      )}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <MoreButton label="Session actions" disabled={busy} />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem onSelect={rename}>
            <Pencil />
            Rename…<DropdownMenuShortcut>{shortcuts.rename}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void pin()}>
            <Pin />
            {session.organization?.pinned ? 'Unpin' : 'Pin'}
            <DropdownMenuShortcut>{shortcuts.pin}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void perform(() => branch(false))}>
            <MessageSquarePlus />
            New side session<DropdownMenuShortcut>{shortcuts.side}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={!saved || running}>
              <GitFork />
              Fork
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onSelect={() => void perform(() => branch(true))}>
                In current checkout
              </DropdownMenuItem>
              <DropdownMenuItem
                onSelect={() => {
                  setValue('');
                  setDialog('worktree');
                }}
              >
                In a new worktree…
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem
            disabled={!repositoryId || running}
            onSelect={() => setDialog('commit')}
          >
            <GitCommitHorizontal />
            Commit changes…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={!saved || running}>
              <Share2 />
              Share
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onSelect={() => action('markdown')}>
                Export Markdown…
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => action('html')}>Export HTML…</DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={!saved}>
              <Copy />
              Copy
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem disabled={running} onSelect={() => action('copy-transcript')}>
                Session as Markdown
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => action('copy-id')}>Session ID</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => action('copy-path')}>
                Repository path
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem disabled={!saved} onSelect={() => action('window')}>
            <AppWindow />
            Open in new window
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={!saved || !!session.hostId}>
              <ExternalLink />
              Open in
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              {(['finder', 'vscode', 'cursor'] as const).map((target, i) => (
                <DropdownMenuItem key={target} onSelect={() => action(target)}>
                  {[fileManagerName(), 'VS Code', 'Cursor'][i]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={running} onSelect={confirmArchive}>
            <Archive />
            Archive…<DropdownMenuShortcut>{shortcuts.archive}</DropdownMenuShortcut>
          </DropdownMenuItem>
          {!saved && (
            <p className="px-2 py-2 text-xs text-muted-foreground">
              Send the first message to unlock export and fork.
            </p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {error && (
        <Dialog open onOpenChange={() => setError('')}>
          <DialogContent size="sm" role="alertdialog">
            <DialogHeader>
              <DialogTitle className="text-destructive">Could not complete action</DialogTitle>
              <DialogDescription className="break-words">{error}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button onClick={() => setError('')}>Close</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
      {repositoryId && (
        <CommitDialog
          api={api}
          repositoryId={repositoryId}
          open={dialog === 'commit'}
          onOpenChange={(open) => !open && setDialog(null)}
          message={session.organization?.title || session.title}
          pullRequestBody={`Changes from the Kalkidan session "${session.organization?.title || session.title}".`}
        />
      )}
      <ConfirmDialog
        open={dialog === 'archive'}
        busy={busy}
        title="Archive session"
        description="Hide this session from the sidebar. You can restore it from the repository’s archived sessions."
        confirmLabel="Archive session"
        onCancel={() => setDialog(null)}
        onConfirm={() => void doArchive()}
      >
        <p className="truncate text-sm font-medium">
          {session.organization?.title || session.title}
        </p>
      </ConfirmDialog>
      <Dialog
        open={dialog === 'rename' || dialog === 'worktree'}
        onOpenChange={(open) => !open && setDialog(null)}
      >
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>
              {dialog === 'rename' ? 'Rename session' : 'Fork in a new worktree'}
            </DialogTitle>
            <DialogDescription>
              {dialog === 'rename'
                ? 'This name appears in Kalkidan’s session list.'
                : 'Create a branch and inherit this session’s history. The agent fork is created when you send your first message.'}
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void perform(async () => {
                if (dialog === 'rename') await update({ title: value.trim() });
                else await branch(true, value.trim());
                setDialog(null);
              });
            }}
          >
            <Input
              autoFocus
              aria-label={dialog === 'rename' ? 'Session name' : 'Branch name'}
              placeholder={dialog === 'rename' ? 'Session name' : 'feature/new-direction'}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button disabled={busy || !value.trim()} type="submit">
                {dialog === 'rename' ? 'Save name' : 'Create fork'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Commits all changes in a checkout. On a branch other than the default branch, it can also
 * push the branch and open a pull request.
 */
export function CommitDialog({
  api,
  repositoryId,
  open,
  onOpenChange,
  message: initialMessage,
  pullRequestBody,
}: {
  api: API;
  repositoryId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The first commit message. The pull request title uses the first line. */
  message: string;
  pullRequestBody: string;
}) {
  const [status, setStatus] = useState<WorkingStatus | null>(null);
  const [message, setMessage] = useState(initialMessage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ commit?: string; url?: string } | null>(null);
  useEffect(() => {
    if (!open) return;
    let current = true;
    setStatus(null);
    setError('');
    setResult(null);
    setMessage(initialMessage);
    api
      .workingStatus(repositoryId)
      .then((value) => current && setStatus(value))
      .catch((e) => current && setError(errorMessage(e)));
    return () => {
      current = false;
    };
  }, [open, api, repositoryId]);
  const changes = status ? status.changed + status.untracked : 0;
  const canPullRequest = !!status && status.branch !== status.defaultBranch;
  async function submit(pullRequest: boolean) {
    setBusy(true);
    setError('');
    try {
      const next: { commit?: string; url?: string } = {};
      if (changes) next.commit = (await api.gitCommit(repositoryId, message.trim())).commit;
      if (pullRequest) {
        const title = message.trim().split('\n')[0];
        next.url = (await api.gitPullRequest(repositoryId, title, pullRequestBody)).url;
      }
      setResult(next);
      setStatus(await api.workingStatus(repositoryId).catch(() => status));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>Commit changes</DialogTitle>
          <DialogDescription>
            Commit all changed and untracked files in this checkout.
          </DialogDescription>
        </DialogHeader>
        <p className="text-sm text-muted-foreground" role="status">
          {status ? (
            <>
              <span className="font-medium text-foreground">{status.branch}</span> ·{' '}
              {plural(status.changed, 'changed file')} ·{' '}
              {plural(status.untracked, 'untracked file')}
            </>
          ) : error ? null : (
            <span className="inline-flex items-center gap-2">
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
              Reading changes…
            </span>
          )}
        </p>
        <label className="form-label">
          Commit message
          <Textarea
            rows={3}
            value={message}
            disabled={busy || !changes}
            onChange={(e) => setMessage(e.target.value)}
          />
        </label>
        {status && !changes && !result && (
          <p className="text-xs text-muted-foreground">There are no changes to commit.</p>
        )}
        {result && (
          <p role="status" className="text-sm">
            {result.commit ? `Committed ${result.commit.slice(0, 7)}.` : 'No new commit.'}{' '}
            {result.url && (
              <a className="text-link underline" href={result.url} target="_blank" rel="noreferrer">
                Open pull request
              </a>
            )}
          </p>
        )}
        {error && (
          <p role="alert" className="field-error break-words">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {result ? 'Close' : 'Cancel'}
          </Button>
          {canPullRequest && (
            <Button
              variant="outline"
              disabled={busy || !status || (!!changes && !message.trim()) || !!result?.url}
              onClick={() => void submit(true)}
            >
              {changes ? 'Commit and open pull request' : 'Open pull request'}
            </Button>
          )}
          <Button
            disabled={busy || !status || !changes || !message.trim()}
            onClick={() => void submit(false)}
          >
            {busy ? 'Working…' : 'Commit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
