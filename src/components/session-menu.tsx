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
  ExternalLink,
  FileText,
  GitPullRequest,
  ListTodo,
} from 'lucide-react';
import type { API, ProjectGroup, Session, SessionOrganization, TrackerItem } from '../types';
import type { WorkingFile, WorkingStatus } from '../api/contracts';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { MoreButton } from './ui/more-button';
import { Alert, AlertDescription } from './ui/alert';
import { Checkbox } from './ui/checkbox';
import { showToast } from './ui/toast';
import { Choice } from './choice';
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
import {
  closesTask,
  pullRequestBody as buildPullRequestBody,
  pullRequestNumber,
  type SessionPullRequest,
} from '../lib/pull-request';

/**
 * Sends a session command to the open chat view. The chat view sets `handled` when it acts on
 * the command. Returns true when it did.
 */
export function sendSessionCommand(command: string) {
  const detail: { command: string; handled?: boolean } = { command };
  window.dispatchEvent(new CustomEvent('kalkidan-session-command', { detail }));
  return !!detail.handled;
}

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
  // The chat view has the linked task, so its Commit dialog writes the task in the pull
  // request. This menu opens its own dialog only when no chat view takes the command.
  const commit = () => {
    if (repositoryId && !running) setDialog('commit');
  };
  const saveToDocs = () => {
    if (!sendSessionCommand('save-to-docs'))
      showToast({
        message: 'Add this code folder to a project to save chats to Docs.',
        tone: 'error',
      });
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
      else if (name === 'session-commit') {
        // Wait until all listeners ran. The chat view marks the command as handled.
        const detail = (event as CustomEvent<{ handled?: boolean }>).detail;
        setTimeout(() => {
          if (detail?.handled) return;
          detail.handled = true;
          handlers.current.commit();
        });
      }
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
        <Hint label="Chat actions">
          <DropdownMenuTrigger asChild>
            <MoreButton label="Chat actions" disabled={busy} />
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
          <DropdownMenuItem
            disabled={!repositoryId || running}
            onSelect={() => void sendSessionCommand('session-commit')}
          >
            <GitCommitHorizontal />
            Commit changes…
          </DropdownMenuItem>
          {session.organization?.pullRequest?.url && (
            <DropdownMenuItem onSelect={() => void sendSessionCommand('open-pull-request')}>
              <GitPullRequest />
              Open pull request
            </DropdownMenuItem>
          )}
          {session.organization?.taskId || session.task?.id ? (
            <DropdownMenuItem onSelect={() => void sendSessionCommand('open-linked-task')}>
              <ListTodo />
              Open linked task
            </DropdownMenuItem>
          ) : (
            <DropdownMenuItem
              disabled={running}
              onSelect={() => void sendSessionCommand('link-task')}
            >
              <ListTodo />
              Link task…
            </DropdownMenuItem>
          )}
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
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={saveToDocs}>
                <FileText />
                Save to Docs…
              </DropdownMenuItem>
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
              <DropdownMenuItem onSelect={() => action('copy-id')}>Copy chat ID</DropdownMenuItem>
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
          sessionTitle={title}
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
  sessionTitle,
  summary,
  task,
  group,
  onTaskChange,
  onReview,
  onCommitted,
  onPullRequest,
}: {
  api: API;
  repositoryId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The first commit message. The pull request title uses the first line. */
  message: string;
  /** The chat title. The pull request description names it. */
  sessionTitle: string;
  /** A short summary for the pull request description. */
  summary?: string;
  /** The linked task. An issue gets "Closes owner/repo#N" in the pull request. */
  task?: TrackerItem;
  /** The project of the task. Draft tasks can change to issues with it. */
  group?: ProjectGroup;
  /** Called with the task after it changed to an issue. */
  onTaskChange?: (task: TrackerItem) => void;
  /** Opens the Changes tool. The dialog closes first. */
  onReview?: () => void;
  /** Called after a commit, a branch change or a pull request. */
  onCommitted?: () => void;
  /** Called after a pull request opens. */
  onPullRequest?: (pullRequest: SessionPullRequest) => void;
}) {
  const [status, setStatus] = useState<WorkingStatus | null>(null);
  const [files, setFiles] = useState<WorkingFile[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState(initialMessage);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ commit?: string; url?: string } | null>(null);
  const submitting = useRef(false);
  const operationId = useRef<string | null>(null);
  const [newBranch, setNewBranch] = useState<string | null>(null);
  // A draft task cannot be closed by a pull request. It can change to an issue first.
  const draftTask = !!task && !closesTask(task) && task.kind === 'DraftIssue';
  const [repositories, setRepositories] = useState<string[] | null>(null);
  const [convertTo, setConvertTo] = useState('');
  const [converting, setConverting] = useState(false);
  const canConvert = draftTask && !!group && typeof api.trackerItemAction === 'function';
  useEffect(() => {
    if (!open || !canConvert || !group) return;
    let current = true;
    setRepositories(null);
    (api.trackerSettings ? api.trackerSettings(group.id) : Promise.reject(new Error()))
      .then((settings) => {
        if (!current) return;
        const names = settings.repositories.map((repository) => repository.nameWithOwner);
        setRepositories(names);
        setConvertTo((previous) => previous || names[0] || '');
      })
      .catch(() => current && setRepositories([]));
    return () => {
      current = false;
    };
  }, [open, canConvert, group?.id]);
  async function convertTask() {
    if (!task || !group || !convertTo.trim()) return;
    setConverting(true);
    setError('');
    try {
      await api.trackerItemAction(group.id, task.id, {
        kind: 'convert',
        repository: convertTo.trim(),
      });
      const board = await (api.trackerBoard
        ? api.trackerBoard(group.id, true)
        : Promise.resolve(null));
      const next = board?.items.find((item) => item.id === task.id);
      if (next) onTaskChange?.(next);
      showToast(`Changed “${task.title}” to an issue in ${convertTo.trim()}.`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setConverting(false);
    }
  }
  const pullRequestBody = buildPullRequestBody({
    title: message,
    summary,
    task,
    sessionTitle,
  });
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
    return { nextStatus, nextFiles };
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
    try {
      operationId.current = localStorage.getItem(`kalkidan-publish:${repositoryId}`);
    } catch {
      operationId.current = null;
    }
    const saved = operationId.current;
    void load()
      .then(async ({ nextStatus, nextFiles }) => {
        if (!saved) return;
        const operation = await api.gitPublishStatus(repositoryId, saved);
        if (!current || !operation) return;
        if (operation.phase === 'completed') {
          operationId.current = null;
          if (nextFiles?.length || nextStatus.changed + nextStatus.untracked > 0) return;
        }
        setResult({ commit: operation.commit, url: operation.url });
        if (operation.error) setError(operation.error);
        if (operation.phase === 'completed') operationId.current = null;
      })
      .catch((e) => current && setError(errorMessage(e)));
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
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      const isNew = !operationId.current;
      const id = (operationId.current ||= crypto.randomUUID());
      try {
        localStorage.setItem(`kalkidan-publish:${repositoryId}`, id);
      } catch {
        throw new Error(
          'Cannot save publish recovery information. Enable local storage before publishing.',
        );
      }
      const paths =
        files && chosen.length < files.length ? chosen.map((file) => file.path) : undefined;
      const operation = await api.gitPublish(repositoryId, {
        id,
        ...(isNew && commitCount && !result?.commit
          ? { commit: { message: message.trim(), files: paths } }
          : {}),
        ...(pullRequest
          ? { pullRequest: { title: message.trim().split('\n')[0], body: pullRequestBody } }
          : {}),
      });
      const next = { commit: operation.commit, url: operation.url };
      setResult(next);
      if (operation.error) throw new Error(operation.error);
      setResult(next);
      onCommitted?.();
      const number = next.url ? pullRequestNumber(next.url) : undefined;
      if (pullRequest && next.url) onPullRequest?.({ url: next.url, number, state: 'open' });
      const opened = pullRequest && next.url ? (number ? `PR #${number}` : 'a pull request') : '';
      if (next.commit || opened)
        showToast({
          message: next.commit
            ? `Committed ${next.commit.slice(0, 7)}${opened ? ` and opened ${opened}` : ''}.`
            : `Opened ${opened}.`,
          actions: next.url
            ? [{ label: 'Open', onClick: () => window.open(next.url, '_blank', 'noreferrer') }]
            : undefined,
        });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      await load(true).catch(() => {});
      submitting.current = false;
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
                      <Checkbox
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
          {draftTask && canPullRequest && !result?.url && (
            <Alert size="sm">
              <GitPullRequest aria-hidden="true" />
              <AlertDescription className="grid gap-2 text-xs">
                <span>
                  The task “{task!.title}” is a draft. A pull request cannot close a draft, so
                  Readiness cannot find the evidence.{' '}
                  {canConvert
                    ? 'Convert it to an issue first.'
                    : 'Convert it to an issue on the board first.'}
                </span>
                {canConvert && (
                  <div className="flex flex-wrap items-center gap-2">
                    {repositories && repositories.length > 0 ? (
                      <Choice
                        size="sm"
                        className="w-56"
                        label="Issue repository"
                        value={convertTo}
                        onChange={setConvertTo}
                        disabled={converting || busy}
                        options={repositories.map((name) => ({ value: name, label: name }))}
                      />
                    ) : (
                      <Input
                        size="sm"
                        aria-label="Issue repository"
                        placeholder="owner/repository"
                        className="w-56 min-w-0"
                        value={convertTo}
                        disabled={converting || busy || repositories === null}
                        onChange={(e) => setConvertTo(e.target.value)}
                      />
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={converting || busy || !/^[\w.-]+\/[\w.-]+$/.test(convertTo.trim())}
                      onClick={() => void convertTask()}
                    >
                      {converting ? 'Converting…' : 'Convert to issue first'}
                    </Button>
                  </div>
                )}
              </AlertDescription>
            </Alert>
          )}
          {task && closesTask(task) && canPullRequest && (
            <p className="form-help">
              The pull request closes {task.repository}#{task.number} when it merges.
            </p>
          )}
          {status && !changes && !result && (
            <p className="form-help">There are no changes to commit.</p>
          )}
          {result && (
            <p role="status" className="text-sm">
              {result.commit ? `Committed ${result.commit.slice(0, 7)}.` : 'No new commit.'}{' '}
              {result.url && (
                <a
                  className="text-link inline-flex items-center gap-1"
                  href={result.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open pull request
                  <ExternalLink className="size-3.5" aria-hidden="true" />
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
              {commitCount && !result?.commit
                ? 'Commit and open pull request'
                : 'Open pull request'}
            </Button>
          )}
          <Button
            disabled={busy || !status || !commitCount || !message.trim() || !!result?.commit}
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
