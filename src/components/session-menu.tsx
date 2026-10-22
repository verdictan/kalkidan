import { useEffect, useId, useRef, useState } from 'react';
import { GitBranchPlus, LoaderCircle, ExternalLink, GitPullRequest } from 'lucide-react';
import type { API, ProjectGroup, Session, SessionOrganization, TrackerItem } from '../types';
import type { WorkingFile, WorkingStatus } from '../api/contracts';
import {
  chatAction,
  chatActionAvailability,
  chatActionForCommand,
  chatActionForKey,
  chatActionMenu,
  sessionActionState,
  type ChatActionId,
  type ChatActionState,
  type ChatActionTarget,
  type ChatMenuItem,
} from '../domain/chat-actions';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
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
import { ChatActionsDropdown } from './chat-action-menu';
import { NotesDialog, RenameSessionDialog, archiveSessionWithUndo } from './session-actions';
import { ManagedHistoryView } from './managed-history';
import {
  hasPrimaryModifier,
  isTypingTarget,
  pathBasename,
  platform,
  plural,
} from '../lib/platform';
import { errorMessage } from '../lib/errors';
import {
  closesTask,
  hasBranchWork,
  pullRequestActionLabel,
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

/** The text that explains a branch copy. Use it once in each flow that makes one. */
export const branchCopyHelp =
  'A branch copy is a separate folder on its own branch, so the agent’s changes stay apart from your work.';

/**
 * The chat view runs these actions, because it has the linked task and the pull request. The
 * menu sends their commands. When no chat view takes a command, the menu runs a fallback.
 */
const chatViewActions = new Set<ChatActionId>([
  'commit',
  'create-pull-request',
  'link-task',
  'open-linked-task',
  'open-pull-request',
  'save-to-docs',
]);

export function SessionMenu({
  api,
  session,
  saved,
  running,
  update,
  branch,
  archive,
  repositoryId,
  inProject,
  onViewArchived,
  onReviewChanges,
}: {
  api: API;
  session: Session;
  saved: boolean;
  running: boolean;
  /** The repository entry of the session checkout. Commit needs it. */
  repositoryId?: string;
  /** True when the code folder of the chat is in a project. Missing: not known. */
  inProject?: boolean;
  update: (changes: SessionOrganization) => Promise<void>;
  branch: (fork: boolean, worktree?: string) => Promise<void>;
  archive: () => void;
  /** Opens the archived sessions. The archive toast shows View archived when it is set. */
  onViewArchived?: () => void;
  /** Opens the Changes tool. The commit dialog links to it. */
  onReviewChanges?: () => void;
}) {
  const [dialog, setDialog] = useState<
    'rename' | 'notes' | 'worktree' | 'commit' | 'pull-request' | 'history' | null
  >(null);
  const [value, setValue] = useState('');
  const [preview, setPreview] = useState<{ base: string; path: string } | null>(null);
  const worktreeForm = useId();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  // True when Git reports no changed files. Unknown (undefined) does not block Commit.
  const [noChanges, setNoChanges] = useState<boolean>();
  // True when Git reports no changes and no commits for a pull request.
  const [noBranchWork, setNoBranchWork] = useState<boolean>();
  const statusTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(statusTimer.current), []);
  function showStatus(text: string) {
    clearTimeout(statusTimer.current);
    setStatus(text);
    statusTimer.current = setTimeout(() => setStatus(''), 3000);
  }
  async function perform(fn: () => Promise<unknown>) {
    setBusy(true);
    try {
      const result = await fn();
      if (typeof result === 'string') showStatus(result);
    } catch (e) {
      // An error stays until the user closes it.
      showToast({ message: 'Could not complete the action: ' + errorMessage(e), tone: 'error' });
    } finally {
      setBusy(false);
    }
  }
  /** Reads if the checkout has changes to commit. */
  const readChanges = useRef(() => {});
  readChanges.current = () => {
    if (!repositoryId || typeof api.workingStatus !== 'function') return;
    Promise.resolve()
      .then(() => api.workingStatus(repositoryId))
      .then((working) => {
        setNoChanges(!!working && working.changed + working.untracked === 0);
        setNoBranchWork(!!working && !hasBranchWork(working));
      })
      .catch(() => {
        setNoChanges(undefined);
        setNoBranchWork(undefined);
      });
  };
  // Read again when a run ends, because the agent can change files.
  useEffect(() => readChanges.current(), [api, repositoryId, running]);
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
  const title = session.organization?.title || session.title;
  const state: ChatActionState = sessionActionState(session, {
    open: true,
    saved,
    running,
    usageHistory: typeof api.managedHistory === 'function',
    repository: !!repositoryId,
    project: inProject,
    noChanges,
    noBranchWork,
  });
  const groups = chatActionMenu('header', state, platform);
  const action = (kind: Parameters<API['sessionAction']>[1]) =>
    void perform(() => api.sessionAction(session, kind));
  const doArchive = () =>
    void perform(async () => {
      await archiveSessionWithUndo(session, { save: update, onViewArchived });
      archive();
    });
  const duplicateOnBranch = () => {
    setValue('');
    setPreview(null);
    setDialog('worktree');
  };
  /** The code of the actions that this menu runs itself. */
  const local: ChatActionTarget = {
    'open-beside': () => void perform(() => branch(false)),
    'open-window': () => action('window'),
    rename: () => setDialog('rename'),
    pin: () => void perform(() => update({ pinned: !session.organization?.pinned })),
    notes: () => setDialog('notes'),
    'duplicate-here': () => void perform(() => branch(true)),
    'duplicate-branch': duplicateOnBranch,
    'show-folder': () => action('finder'),
    'export-markdown': () => action('markdown'),
    'export-html': () => action('html'),
    'copy-markdown': () => action('copy-transcript'),
    'usage-history': () => setDialog('history'),
    'copy-id': () => action('copy-id'),
    'copy-path': () => action('copy-path'),
    'open-vscode': () => action('vscode'),
    'open-cursor': () => action('cursor'),
    archive: doArchive,
  };
  /** Runs when no chat view took a command of `chatViewActions`. */
  function fallback(id: ChatActionId) {
    if (id === 'commit') {
      if (repositoryId) setDialog('commit');
    } else if (id === 'create-pull-request') {
      if (repositoryId) setDialog('pull-request');
    } else if (id === 'save-to-docs')
      showToast({
        message: 'Add this code folder to a project to save chats to Docs.',
        tone: 'error',
      });
    else if (id === 'link-task')
      showToast({ message: 'Connect a task board to this project first.', tone: 'error' });
    else if (id === 'open-pull-request' && session.organization?.pullRequest?.url)
      window.open(session.organization.pullRequest.url, '_blank', 'noreferrer');
  }
  /**
   * Runs an action, or tells the user why it cannot run now. `fromCommand` is true when a
   * session command asks for the action, so the action must not send the command again.
   */
  function runAction(id: ChatActionId, fromCommand = false) {
    const available = chatActionAvailability(id, state);
    if (available !== true) {
      showToast({ message: available });
      return;
    }
    if (chatViewActions.has(id)) {
      // The listener below runs the fallback when no chat view takes the command.
      const name = chatAction(id)?.command;
      if (!fromCommand && name) sendSessionCommand(name);
      return;
    }
    local[id]?.();
  }
  const runItem = (item: ChatMenuItem) => runAction(item.id);
  // The latest code, for the listeners below.
  const latest = useRef({ runAction, fallback, state });
  latest.current = { runAction, fallback, state };
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (!hasPrimaryModifier(e) || isTypingTarget(e.target)) return;
      if (document.querySelector('[role="dialog"]')) return;
      const found = chatActionForKey(e, platform);
      if (!found) return;
      e.preventDefault();
      latest.current.runAction(found.id);
    };
    // The menu bar, the palette and the chat rows send the session commands. Only the menu of
    // the open chat is mounted.
    const command = (event: Event) => {
      const detail = (event as CustomEvent<{ command?: string; handled?: boolean }>).detail;
      const found = detail?.command ? chatActionForCommand(detail.command) : undefined;
      if (!found) return;
      if (!chatViewActions.has(found.id)) {
        latest.current.runAction(found.id, true);
        return;
      }
      if (chatActionAvailability(found.id, latest.current.state) !== true) {
        // The chat view must not act on a blocked action. The menu tells the user why.
        detail!.handled = true;
        latest.current.runAction(found.id, true);
        return;
      }
      // Wait until all listeners ran. The chat view marks the command as handled.
      setTimeout(() => {
        if (detail!.handled) return;
        detail!.handled = true;
        latest.current.fallback(found.id);
      });
    };
    window.addEventListener('keydown', key);
    window.addEventListener('kalkidan-session-command', command);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('kalkidan-session-command', command);
    };
  }, []);
  // The Chat menu of the menu bar shows the state of the open chat of the focused window.
  const menuState = JSON.stringify(state);
  useEffect(() => {
    const setState = api.setChatMenuState?.bind(api);
    if (!setState) return;
    const report = () => {
      if (document.hasFocus()) void setState(JSON.parse(menuState)).catch(() => {});
    };
    report();
    window.addEventListener('focus', report);
    return () => {
      window.removeEventListener('focus', report);
      if (document.hasFocus()) void setState(null).catch(() => {});
    };
  }, [api, menuState]);
  return (
    <>
      {status && (
        <span role="status" className="session-menu-status text-xs text-muted-foreground">
          {status}
        </span>
      )}
      <ChatActionsDropdown
        label="Chat actions"
        disabled={busy}
        groups={groups}
        onRun={runItem}
        onOpenChange={(open) => open && readChanges.current()}
      />
      {repositoryId && (
        <CommitDialog
          api={api}
          repositoryId={repositoryId}
          open={dialog === 'commit' || dialog === 'pull-request'}
          intent={dialog === 'pull-request' ? 'pull-request' : 'commit'}
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
      <Dialog open={dialog === 'history'} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent size="lg" layout="scroll">
          <DialogHeader>
            <DialogTitle>Usage history</DialogTitle>
            <DialogDescription>
              The policy decision, model, tokens, time and cost of each agent request in this chat.
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            {dialog === 'history' && (
              <ManagedHistoryView
                api={api}
                target={{ kind: 'conversation', agent: session.agent, sessionId: session.id }}
              />
            )}
          </DialogBody>
        </DialogContent>
      </Dialog>
      <RenameSessionDialog
        session={session}
        open={dialog === 'rename'}
        onOpenChange={(open) => !open && setDialog(null)}
        save={update}
      />
      <NotesDialog
        session={session}
        open={dialog === 'notes'}
        onOpenChange={(open) => !open && setDialog(null)}
        save={update}
      />
      <Dialog open={dialog === 'worktree'} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent size="md" layout="scroll">
          <DialogHeader>
            <DialogTitle>Continue on a new branch</DialogTitle>
            <DialogDescription>
              The duplicate chat keeps this chat’s history and works in a branch copy.{' '}
              {branchCopyHelp}
            </DialogDescription>
          </DialogHeader>
          <DialogBody>
            <form
              id={worktreeForm}
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
              {preview && <p className="form-help break-words">Starts from {preview.base}.</p>}
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDialog(null)}>
              Cancel
            </Button>
            <Button form={worktreeForm} disabled={busy || !value.trim()} type="submit">
              Duplicate chat
            </Button>
          </DialogFooter>
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
  intent = 'commit',
}: {
  api: API;
  repositoryId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** "pull-request" opens the dialog as "Create pull request". The steps are the same. */
  intent?: 'commit' | 'pull-request';
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
      const opened =
        pullRequest && next.url ? (number ? `pull request #${number}` : 'a pull request') : '';
      if (next.commit || opened)
        showToast({
          message: next.commit
            ? `Committed ${next.commit.slice(0, 7)}${opened ? ` and created ${opened}` : ''}.`
            : `Created ${opened}.`,
          actions: next.url
            ? [
                {
                  label: 'View pull request',
                  onClick: () => window.open(next.url, '_blank', 'noreferrer'),
                },
              ]
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
          <DialogTitle>
            {intent === 'pull-request' ? 'Create pull request' : 'Commit changes'}
          </DialogTitle>
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
          {status && !changes && !result && (
            <Alert size="sm" role="status">
              <AlertDescription className="text-xs">
                {canPullRequest
                  ? `No changes to commit. Create a pull request from the commits on ${status.branch}.`
                  : 'No changes to commit. Change files, then commit again.'}
              </AlertDescription>
            </Alert>
          )}
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
                  {pullRequestActionLabel({
                    url: result.url,
                    number: pullRequestNumber(result.url),
                  })}
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
          {result && !error ? (
            <Button disabled={busy} onClick={() => onOpenChange(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              {/* On a branch, the pull request is the main step. On the default branch, only a
                  commit is possible until the changes move to a new branch. */}
              <Button
                variant={canPullRequest ? 'outline' : 'default'}
                disabled={busy || !status || !commitCount || !message.trim() || !!result?.commit}
                onClick={() => void submit(false)}
              >
                {busy && !canPullRequest
                  ? 'Working…'
                  : files && !allSelected
                    ? `Commit ${plural(commitCount, 'file')}`
                    : 'Commit'}
              </Button>
              {canPullRequest && (
                <Button
                  disabled={busy || !status || (!!commitCount && !message.trim()) || !!result?.url}
                  onClick={() => void submit(true)}
                >
                  {busy
                    ? 'Working…'
                    : commitCount && !result?.commit
                      ? 'Commit and create pull request'
                      : 'Create pull request'}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
