import { useEffect, useRef, useState } from 'react';
import {
  Pencil,
  Pin,
  PanelRight,
  CopyPlus,
  Share2,
  Copy,
  AppWindow,
  FolderOpen,
  Archive,
  GitCommitHorizontal,
  GitBranchPlus,
  LoaderCircle,
  Code,
} from 'lucide-react';
import type { API, Session, SessionOrganization } from '../types';
import type { WorkingFile, WorkingStatus } from '../api/contracts';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { MoreButton } from './ui/more-button';
import { Alert, AlertDescription } from './ui/alert';
import { showToast } from './ui/toast';
import {
  Dialog,
  DialogBody,
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
import { Hint } from './hint';
import { RenameSessionDialog, archiveSessionWithUndo } from './session-actions';
import {
  fileManagerName,
  hasPrimaryModifier,
  isMac,
  isTypingTarget,
  pathBasename,
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
/** The text that explains a branch copy. Use it once in each flow that makes one. */
export const branchCopyHelp =
  'A branch copy is a separate folder on its own branch, so the agent’s changes stay apart from your work.';

export function SessionMenu({
  api,
  session,
  saved,
  running,
  update,
  branch,
  archive,
  repositoryId,
  onViewArchived,
  onReviewChanges,
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
  /** Opens the archived sessions. The archive toast shows View archived when it is set. */
  onViewArchived?: () => void;
  /** Opens the Changes tool. The commit dialog links to it. */
  onReviewChanges?: () => void;
}) {
  const [dialog, setDialog] = useState<'rename' | 'worktree' | 'commit' | null>(null);
  const [value, setValue] = useState('');
  const [preview, setPreview] = useState<{ base: string; path: string } | null>(null);
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
  const title = session.organization?.title || session.title;
  const rename = () => setDialog('rename');
  const pin = () => perform(() => update({ pinned: !session.organization?.pinned }));
  const sideChat = () => perform(() => branch(false));
  const doArchive = () => {
    if (running) return;
    void perform(async () => {
      await archiveSessionWithUndo(session, { save: update, onViewArchived });
      archive();
    });
  };
  const commit = () => {
    if (repositoryId && !running) setDialog('commit');
  };
  const duplicateOnBranch = () => {
    setValue('');
    setPreview(null);
    setDialog('worktree');
  };
  // Shows where the branch copy starts and where its folder goes.
  useEffect(() => {
    const name = value.trim();
    if (dialog !== 'worktree' || !name || !repositoryId || !api.worktreePreview) {
      setPreview(null);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      api
        .worktreePreview(repositoryId, name)
        .then((next) => current && setPreview(next))
        .catch(() => current && setPreview(null));
    }, 250);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [dialog, value, repositoryId, api]);
  // The latest handlers, for the listeners below.
  const handlers = useRef({ rename, pin, sideChat, doArchive, commit });
  handlers.current = { rename, pin, sideChat, doArchive, commit };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!hasPrimaryModifier(e) || isTypingTarget(e.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (sessionModifier(e) && e.code === 'Key' + sessionKeys.rename) {
        e.preventDefault();
        handlers.current.rename();
      }
      if (sessionModifier(e) && e.code === 'Key' + sessionKeys.pin) {
        e.preventDefault();
        void handlers.current.pin();
      }
      if (sessionModifier(e) && e.code === 'Key' + sessionKeys.side) {
        e.preventDefault();
        void handlers.current.sideChat();
      }
      if (e.shiftKey && !e.altKey && e.code === 'KeyA' && !running) {
        e.preventDefault();
        handlers.current.doArchive();
      }
    };
    // The application menu sends the session commands. Only the open session menu is mounted.
    const command = (event: Event) => {
      const name = (event as CustomEvent<{ command?: string }>).detail?.command;
      if (name === 'session-rename') handlers.current.rename();
      else if (name === 'session-pin') void handlers.current.pin();
      else if (name === 'session-side-chat') void handlers.current.sideChat();
      else if (name === 'session-archive') handlers.current.doArchive();
      else if (name === 'session-commit') handlers.current.commit();
    };
    window.addEventListener('keydown', key);
    window.addEventListener('kalkidan-session-command', command);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('kalkidan-session-command', command);
    };
  }, [running]);
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
        <Hint label="Session actions">
          <DropdownMenuTrigger asChild>
            <MoreButton label="Session actions" disabled={busy} />
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent align="end" className="w-80">
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
          <DropdownMenuItem onSelect={() => void sideChat()}>
            <PanelRight />
            Open a second chat beside this one
            <DropdownMenuShortcut>{shortcuts.side}</DropdownMenuShortcut>
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={!saved || running}>
              <CopyPlus />
              Duplicate chat
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-64">
              <DropdownMenuItem onSelect={() => void perform(() => branch(true))}>
                Continue here
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!repositoryId} onSelect={duplicateOnBranch}>
                Continue on a new branch…
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem disabled={!repositoryId || running} onSelect={commit}>
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
          <DropdownMenuItem disabled={!saved || running} onSelect={() => action('copy-transcript')}>
            <Copy />
            Copy chat as Markdown
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!saved} onSelect={() => action('window')}>
            <AppWindow />
            Open in new window
          </DropdownMenuItem>
          <DropdownMenuItem disabled={!saved || !!session.hostId} onSelect={() => action('finder')}>
            <FolderOpen />
            Show folder in {fileManagerName()}
          </DropdownMenuItem>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger disabled={!saved}>
              <Code />
              Developer
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent>
              <DropdownMenuItem onSelect={() => action('copy-id')}>
                Copy session ID
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => action('copy-path')}>
                Copy folder path
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!!session.hostId} onSelect={() => action('vscode')}>
                Open in VS Code
              </DropdownMenuItem>
              <DropdownMenuItem disabled={!!session.hostId} onSelect={() => action('cursor')}>
                Open in Cursor
              </DropdownMenuItem>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={running} onSelect={doArchive}>
            <Archive />
            Archive<DropdownMenuShortcut>{shortcuts.archive}</DropdownMenuShortcut>
          </DropdownMenuItem>
          {!saved && (
            <p className="px-2 py-2 text-xs text-muted-foreground">
              Send the first message to unlock export and duplicate.
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
          message={title}
          pullRequestBody={`Changes from the Kalkidan session "${title}".`}
          onReview={
            onReviewChanges ||
            (() =>
              window.dispatchEvent(
                new CustomEvent('kalkidan-session-command', {
                  detail: { command: 'session-changes' },
                }),
              ))
          }
        />
      )}
      <RenameSessionDialog
        session={session}
        open={dialog === 'rename'}
        onOpenChange={(open) => !open && setDialog(null)}
        save={update}
      />
      <Dialog open={dialog === 'worktree'} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Continue on a new branch</DialogTitle>
            <DialogDescription>
              The duplicate chat keeps this chat’s history and works in a branch copy.{' '}
              {branchCopyHelp}
            </DialogDescription>
          </DialogHeader>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              void perform(async () => {
                await branch(true, value.trim());
                setDialog(null);
              });
            }}
          >
            <label className="form-label">
              Branch name
              <Input
                autoFocus
                placeholder="feature/new-direction"
                value={value}
                onChange={(e) => setValue(e.target.value)}
              />
            </label>
            {preview && (
              <p className="form-help break-words">
                Starts from {preview.base}. Folder: {preview.path}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialog(null)}>
                Cancel
              </Button>
              <Button disabled={busy || !value.trim()} type="submit">
                Duplicate chat
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}

const fileStatusLabel: Record<string, string> = {
  modified: 'Changed',
  added: 'Added',
  deleted: 'Deleted',
  renamed: 'Renamed',
  untracked: 'New',
  conflicted: 'Conflict',
};

/**
 * Commits the selected files in a checkout. On a branch other than the default branch, it can
 * also push the branch and open a pull request. On the default branch, it can move the changes
 * to a new branch first.
 */
export function CommitDialog({
  api,
  repositoryId,
  open,
  onOpenChange,
  message: initialMessage,
  pullRequestBody,
  onReview,
  onCommitted,
}: {
  api: API;
  repositoryId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The first commit message. The pull request title uses the first line. */
  message: string;
  pullRequestBody: string;
  /** Opens the Changes tool. The dialog closes first. */
  onReview?: () => void;
  /** Called after a commit, a branch change or a pull request. */
  onCommitted?: () => void;
}) {
  const [status, setStatus] = useState<WorkingStatus | null>(null);
  const [files, setFiles] = useState<WorkingFile[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState(initialMessage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ commit?: string; url?: string } | null>(null);
  const [newBranch, setNewBranch] = useState<string | null>(null);
  /** Reads the status and the files. A reload keeps the user's choice of files. */
  async function load(keep = false) {
    const [nextStatus, nextFiles] = await Promise.all([
      api.workingStatus(repositoryId),
      api.workingFiles ? api.workingFiles(repositoryId).catch(() => null) : Promise.resolve(null),
    ]);
    setStatus(nextStatus);
    setFiles(nextFiles);
    const paths = nextFiles?.map((file) => file.path) || [];
    setSelected((previous) =>
      keep ? new Set(paths.filter((path) => previous.has(path))) : new Set(paths),
    );
  }
  useEffect(() => {
    if (!open) return;
    let current = true;
    setStatus(null);
    setFiles(null);
    setError('');
    setResult(null);
    setNewBranch(null);
    setMessage(initialMessage);
    load().catch((e) => current && setError(errorMessage(e)));
    return () => {
      current = false;
    };
  }, [open, api, repositoryId]);
  const changes = files ? files.length : status ? status.changed + status.untracked : 0;
  const chosen = files ? files.filter((file) => selected.has(file.path)) : [];
  const commitCount = files ? chosen.length : changes;
  const onDefault = !!status && status.branch === status.defaultBranch;
  const canPullRequest = !!status && !onDefault;
  async function submit(pullRequest: boolean) {
    setBusy(true);
    setError('');
    try {
      const next: { commit?: string; url?: string } = {};
      if (commitCount) {
        // Commit all changes when every file is selected, so that Git also stages deletions
        // and renames the same way as before.
        const paths = files && chosen.length < files.length ? chosen.map((f) => f.path) : undefined;
        next.commit = (await api.gitCommit(repositoryId, message.trim(), paths)).commit;
      }
      if (pullRequest) {
        const title = message.trim().split('\n')[0];
        next.url = (await api.gitPullRequest(repositoryId, title, pullRequestBody)).url;
      }
      setResult(next);
      onCommitted?.();
      if (next.commit)
        showToast(
          `Committed ${next.commit.slice(0, 7)}${pullRequest ? ' and opened a pull request' : ''}.`,
        );
      await load().catch(() => {});
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function moveToBranch() {
    const name = newBranch?.trim();
    if (!name) return;
    setBusy(true);
    setError('');
    try {
      await api.gitSwitchNewBranch(repositoryId, name);
      setNewBranch(null);
      onCommitted?.();
      await load(true);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const allSelected = !!files && chosen.length === files.length;
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent size="md" layout="scroll">
        <DialogHeader>
          <DialogTitle>Commit changes</DialogTitle>
          <DialogDescription>
            {status ? (
              <>
                On <span className="font-medium text-foreground">{status.branch}</span> ·{' '}
                {plural(changes, 'changed file')}
              </>
            ) : error ? (
              'Select the files to commit.'
            ) : (
              <span className="inline-flex items-center gap-2" role="status">
                <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
                Reading changes…
              </span>
            )}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          {onDefault && !result?.url && (
            <Alert size="sm">
              <GitBranchPlus aria-hidden="true" />
              <AlertDescription className="grid gap-2 text-xs">
                <span>
                  You are on {status.branch}. To open a pull request, commit on a new branch.
                </span>
                {newBranch === null ? (
                  <Button
                    size="sm"
                    variant="outline"
                    className="justify-self-start"
                    disabled={busy}
                    onClick={() => setNewBranch('')}
                  >
                    Move changes to a new branch…
                  </Button>
                ) : (
                  <form
                    className="flex flex-wrap items-center gap-2"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void moveToBranch();
                    }}
                  >
                    <Input
                      autoFocus
                      size="sm"
                      aria-label="New branch name"
                      placeholder="feature/my-change"
                      className="w-56 min-w-0 flex-1"
                      value={newBranch}
                      onChange={(e) => setNewBranch(e.target.value)}
                    />
                    <Button size="sm" type="submit" disabled={busy || !newBranch.trim()}>
                      Move changes
                    </Button>
                    <Button
                      size="sm"
                      type="button"
                      variant="ghost"
                      disabled={busy}
                      onClick={() => setNewBranch(null)}
                    >
                      Cancel
                    </Button>
                  </form>
                )}
              </AlertDescription>
            </Alert>
          )}
          {!!files?.length && (
            <fieldset className="grid gap-1">
              <legend className="mb-1 flex w-full items-center justify-between gap-2 text-sm font-medium">
                Files to commit
                <span className="flex items-center gap-1">
                  {onReview && (
                    <Button
                      size="xs"
                      variant="ghost"
                      type="button"
                      onClick={() => {
                        onOpenChange(false);
                        onReview();
                      }}
                    >
                      Review changes
                    </Button>
                  )}
                  <Button
                    size="xs"
                    variant="ghost"
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      setSelected(new Set(allSelected ? [] : files.map((file) => file.path)))
                    }
                  >
                    {allSelected ? 'Clear all' : 'Select all'}
                  </Button>
                </span>
              </legend>
              <ul className="list-box commit-file-list" aria-label="Changed files">
                {files.map((file) => (
                  <li key={file.path} className="list-box-row">
                    <label className="commit-file" title={file.path}>
                      <input
                        type="checkbox"
                        className="size-4 shrink-0 accent-[var(--primary)]"
                        checked={selected.has(file.path)}
                        disabled={busy}
                        onChange={(e) =>
                          setSelected((previous) => {
                            const next = new Set(previous);
                            if (e.target.checked) next.add(file.path);
                            else next.delete(file.path);
                            return next;
                          })
                        }
                      />
                      <span className="commit-file-name">{pathBasename(file.path)}</span>
                      <span className="commit-file-path">
                        {file.path.slice(0, -pathBasename(file.path).length).replace(/[\\/]+$/, '')}
                      </span>
                      <span className="commit-file-status">
                        {fileStatusLabel[file.status] || file.status}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          {!files && onReview && !!changes && (
            <Button
              size="sm"
              variant="outline"
              className="justify-self-start"
              onClick={() => {
                onOpenChange(false);
                onReview();
              }}
            >
              Review changes
            </Button>
          )}
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
            <p className="form-help">There are no changes to commit.</p>
          )}
          {result && (
            <p role="status" className="text-sm">
              {result.commit ? `Committed ${result.commit.slice(0, 7)}.` : 'No new commit.'}{' '}
              {result.url && (
                <a
                  className="text-link underline"
                  href={result.url}
                  target="_blank"
                  rel="noreferrer"
                >
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
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            {result ? 'Close' : 'Cancel'}
          </Button>
          {canPullRequest && (
            <Button
              variant="outline"
              disabled={busy || !status || (!!commitCount && !message.trim()) || !!result?.url}
              onClick={() => void submit(true)}
            >
              {commitCount ? 'Commit and open pull request' : 'Open pull request'}
            </Button>
          )}
          <Button
            disabled={busy || !status || !commitCount || !message.trim()}
            onClick={() => void submit(false)}
          >
            {busy
              ? 'Working…'
              : files && !allSelected
                ? `Commit ${plural(commitCount, 'file')}`
                : 'Commit'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
