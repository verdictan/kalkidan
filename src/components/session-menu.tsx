import { forkChat } from './chat-links';
import { useEffect, useRef, useState } from 'react';
import { ChevronDown, GitCommitHorizontal, GitPullRequestDraft, LoaderCircle } from 'lucide-react';
import type { API, ProjectGroup, Session, SessionOrganization, TrackerItem } from '../types';
import type { WorkingStatus } from '../api/contracts';
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
import { showToast } from './ui/toast';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { ChatActionsDropdown } from './chat-action-menu';
import { NotesDialog, RenameSessionDialog, archiveSessionWithUndo } from './session-actions';
import { ManagedHistoryView } from './managed-history';
import { hasPrimaryModifier, isTypingTarget, platform } from '../lib/platform';
import { errorMessage } from '../lib/errors';
import {
  closesTask,
  hasBranchWork,
  pullRequestBody,
  pullRequestNumber,
  pullRequestTitle,
  suggestedBranch,
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

/**
 * The event that the open chat view sends with what only it knows, for example that its linked
 * task can be marked done. The chat also sends its task link and pull request: a new chat saves
 * them with its first message, so the saved chat can show them later than the chat view.
 */
export const chatMenuStateEvent = 'kalkidan-chat-menu-state';
export interface ChatViewMenuState {
  canMarkDone: boolean;
  /** The chat that sends the state. The menu of another chat ignores the task and the PR. */
  sessionId?: string;
  linkedTask?: boolean;
  pullRequestNumber?: number;
  pullRequest?: boolean;
  /** The chat is read only. The menu shows "Allow file edits" then. */
  readOnly?: boolean;
}
let lastChatMenuState: ChatViewMenuState = { canMarkDone: false };
/** The visible chat view calls it. The menu reads the last value when it mounts. */
export function reportChatMenuState(state: ChatViewMenuState) {
  lastChatMenuState = state;
  window.dispatchEvent(new CustomEvent(chatMenuStateEvent, { detail: state }));
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
  'mark-task-done',
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
  board,
  onViewArchived,
}: {
  api: API;
  session: Session;
  saved: boolean;
  running: boolean;
  /** The repository entry of the session checkout. Commit needs it. */
  repositoryId?: string;
  /** True when the code folder of the chat is in a project. Missing: not known. */
  inProject?: boolean;
  /** True when the project has a task board. False hides Link task. Missing: not known. */
  board?: boolean;
  update: (changes: SessionOrganization) => Promise<void>;
  branch: (fork: boolean, worktree?: string) => Promise<void>;
  archive: () => void;
  /** Opens the archived sessions. The archive toast shows View archived when it is set. */
  onViewArchived?: () => void;
}) {
  const [dialog, setDialog] = useState<'rename' | 'notes' | 'history' | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  // True when Git reports no changed files. Unknown (undefined) does not block Commit.
  const [noChanges, setNoChanges] = useState<boolean>();
  // True when Git reports no changes and no commits for a pull request.
  const [noBranchWork, setNoBranchWork] = useState<boolean>();
  // The chat view tells whether its linked task can be marked done now.
  const [view, setView] = useState(lastChatMenuState);
  const canMarkDone = view.canMarkDone;
  useEffect(() => {
    setView(lastChatMenuState);
    const read = (event: Event) =>
      setView((event as CustomEvent<ChatViewMenuState>).detail || { canMarkDone: false });
    window.addEventListener(chatMenuStateEvent, read);
    return () => window.removeEventListener(chatMenuStateEvent, read);
  }, [session.id]);
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
  const state: ChatActionState = sessionActionState(session, {
    open: true,
    saved,
    running,
    usageHistory: typeof api.managedHistory === 'function',
    repository: !!repositoryId,
    project: inProject,
    board,
    noChanges,
    noBranchWork,
    canMarkDone,
    ...(view.sessionId === session.id
      ? {
          linkedTask: !!view.linkedTask,
          pullRequest: !!view.pullRequest,
          ...(view.readOnly !== undefined ? { readOnly: view.readOnly } : {}),
          ...(view.pullRequestNumber ? { pullRequestNumber: view.pullRequestNumber } : {}),
        }
      : {}),
  });
  const groups = chatActionMenu('header', state, platform);
  const action = (kind: Parameters<API['sessionAction']>[1]) =>
    void perform(() => api.sessionAction(session, kind));
  const doArchive = () =>
    void perform(async () => {
      await archiveSessionWithUndo(session, { save: update, onViewArchived });
      archive();
    });
  /** The code of the actions that this menu runs itself. */
  const local: ChatActionTarget = {
    'open-window': () => action('window'),
    rename: () => setDialog('rename'),
    pin: () => void perform(() => update({ pinned: !session.organization?.pinned })),
    notes: () => setDialog('notes'),
    fork: () => forkChat(session),
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
    // Commit and the pull request live in the Changes tab of the tool pane.
    if (id === 'commit' || id === 'create-pull-request') {
      if (repositoryId) sendSessionCommand('session-changes');
    } else if (id === 'save-to-docs')
      showToast({
        message: 'Add this code folder to a project to save chats to Docs.',
        tone: 'error',
      });
    else if (id === 'link-task') showToast({ message: 'Connect a board on the Tasks page first.' });
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
    </>
  );
}

/**
 * The ship footer of the Changes tab (CH-B2): the generated pull request title, the branch line
 * "kal/sign-in-tests → main" and one brown split button. "Create pull request" commits all
 * changed files, pushes the branch and opens the pull request. The arrow has "Create draft pull
 * request" and "Commit only". On the default branch, Kalkidan makes a branch first. There is no
 * dialog.
 */
export function ShipFooter({
  api,
  repositoryId,
  sessionTitle,
  summary,
  task,
  group,
  onTaskChange,
  onCommitted,
  onPullRequest,
  pullRequest,
  refresh = 0,
}: {
  api: API;
  repositoryId: string;
  /** The chat title. The pull request title starts from it. */
  sessionTitle: string;
  /** A short summary for the pull request description: the last answer. */
  summary?: string;
  /** The linked task. An issue gets "Closes owner/repo#N" in the pull request. */
  task?: TrackerItem;
  /** The project of the task. A draft task can change to an issue with it. */
  group?: ProjectGroup;
  onTaskChange?: (task: TrackerItem) => void;
  /** Called after a commit, a branch change or a pull request. */
  onCommitted?: () => void;
  /** Called after a pull request opens. */
  onPullRequest?: (pullRequest: SessionPullRequest) => void;
  /** The pull request of the chat. With one, the footer commits new changes to it. */
  pullRequest?: SessionPullRequest;
  /** Increase it to read the branch again, for example after a run. */
  refresh?: number;
}) {
  const [status, setStatus] = useState<WorkingStatus | null>(null);
  const [title, setTitle] = useState(() => pullRequestTitle(sessionTitle));
  const edited = useRef(false);
  const [busy, setBusy] = useState<'pull-request' | 'draft' | 'commit' | null>(null);
  const [error, setError] = useState('');
  /** The commit of an operation that committed but did not open its pull request. */
  const [committed, setCommitted] = useState('');
  /** The last pull request kind, for Try again after a partial failure. */
  const lastKind = useRef<'pull-request' | 'draft'>('pull-request');
  const submitting = useRef(false);
  const operationId = useRef<string | null>(null);
  // The chat gets its title after the first answer. The field follows until the user types.
  useEffect(() => {
    if (!edited.current) setTitle(pullRequestTitle(sessionTitle));
  }, [sessionTitle]);
  const draftTask = !!task && !closesTask(task) && task.kind === 'DraftIssue';
  const canConvert = draftTask && !!group && typeof api.trackerItemAction === 'function';
  const [converting, setConverting] = useState(false);
  async function load() {
    const next = await api.workingStatus(repositoryId);
    setStatus(next);
    return next;
  }
  useEffect(() => {
    let current = true;
    try {
      operationId.current = localStorage.getItem(`kalkidan-publish:${repositoryId}`);
    } catch {
      operationId.current = null;
    }
    const saved = operationId.current;
    void load()
      .then(async () => {
        if (!saved) return;
        const operation = await api.gitPublishStatus(repositoryId, saved);
        if (!current || !operation) return;
        if (operation.error) setError(operation.error);
        setCommitted(operation.error && operation.commit && !operation.url ? operation.commit : '');
        if (operation.phase === 'completed') operationId.current = null;
      })
      .catch((e) => current && setError(errorMessage(e)));
    return () => {
      current = false;
    };
  }, [api, repositoryId, refresh]);
  async function convertTask() {
    if (!task || !group) return;
    setConverting(true);
    setError('');
    try {
      const settings = api.trackerSettings ? await api.trackerSettings(group.id) : null;
      const repository = settings?.repositories[0]?.nameWithOwner;
      if (!repository) throw new Error('Connect a repository to the board first.');
      await api.trackerItemAction(group.id, task.id, { kind: 'convert', repository });
      const board = api.trackerBoard ? await api.trackerBoard(group.id, true) : null;
      const next = board?.items.find((item) => item.id === task.id);
      if (next) onTaskChange?.(next);
      showToast(`Changed “${task.title}” to an issue in ${repository}.`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setConverting(false);
    }
  }
  const changes = status ? status.changed + status.untracked : 0;
  const onDefault = !!status && status.branch === status.defaultBranch;
  const newBranch = onDefault ? suggestedBranch(title || sessionTitle) : '';
  const name = title.trim();
  async function ship(kind: 'pull-request' | 'draft' | 'commit') {
    if (submitting.current || !name) return;
    submitting.current = true;
    setBusy(kind);
    setError('');
    setCommitted('');
    const opensPullRequest = kind !== 'commit' && !pullRequest;
    if (kind !== 'commit') lastKind.current = kind;
    try {
      // A pull request needs a branch. On the default branch, Kalkidan makes one first.
      if (opensPullRequest && onDefault) {
        await api.gitSwitchNewBranch(repositoryId, newBranch);
        onCommitted?.();
      }
      const isNew = !operationId.current;
      const id = (operationId.current ||= crypto.randomUUID());
      try {
        localStorage.setItem(`kalkidan-publish:${repositoryId}`, id);
      } catch {
        throw new Error(
          'Cannot save publish recovery information. Enable local storage before publishing.',
        );
      }
      const draft = kind === 'draft';
      const operation = await api.gitPublish(repositoryId, {
        id,
        ...(isNew && changes ? { commit: { message: name } } : {}),
        ...(opensPullRequest
          ? {
              pullRequest: {
                title: name,
                body: pullRequestBody({ title: name, summary, task, sessionTitle }),
                ...(draft ? { draft: true } : {}),
              },
            }
          : {}),
      });
      if (operation.error) {
        // The commit is saved, but the pull request did not open. Try again opens only the pull
        // request: the operation keeps its ID, so it does not commit again.
        if (operation.commit && opensPullRequest && !operation.url) {
          setCommitted(operation.commit);
          onCommitted?.();
        }
        throw new Error(operation.error);
      }
      operationId.current = null;
      try {
        localStorage.removeItem(`kalkidan-publish:${repositoryId}`);
      } catch {}
      onCommitted?.();
      const number = operation.url ? pullRequestNumber(operation.url) : undefined;
      if (opensPullRequest && operation.url)
        onPullRequest?.({
          url: operation.url,
          number,
          state: 'open',
          ...(draft ? { draft: true } : {}),
        });
      const what = draft ? 'draft pull request' : 'pull request';
      const opened =
        opensPullRequest && operation.url ? (number ? `${what} #${number}` : `a ${what}`) : '';
      if (operation.commit || opened)
        showToast({
          message: operation.commit
            ? `Committed ${operation.commit.slice(0, 7)}${opened ? ` and created ${opened}` : ''}.`
            : `Created ${opened}.`,
        });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      await load().catch(() => {});
      submitting.current = false;
      setBusy(null);
    }
  }
  const nothing = !!status && (pullRequest ? !changes : !hasBranchWork(status));
  const disabled = !!busy || !status || !name || nothing;
  const primary = pullRequest ? 'Commit and push' : 'Create pull request';
  return (
    <div className="ship-footer" role="group" aria-label="Ship changes">
      <input
        className="ship-title"
        aria-label={pullRequest ? 'Commit message' : 'Pull request title'}
        value={title}
        maxLength={256}
        disabled={!!busy}
        placeholder={pullRequest ? 'Commit message' : 'Pull request title'}
        onChange={(event) => {
          edited.current = true;
          setTitle(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && hasPrimaryModifier(event.nativeEvent) && !disabled) {
            event.preventDefault();
            void ship('pull-request');
          }
        }}
      />
      {draftTask && !pullRequest && (
        <p className="ship-note">
          The task “{task!.title}” is a draft. A pull request cannot close it.{' '}
          {canConvert && (
            <Button
              variant="link"
              disabled={converting || !!busy}
              onClick={() => void convertTask()}
            >
              {converting ? 'Converting…' : 'Convert to issue first'}
            </Button>
          )}
        </p>
      )}
      {error && committed ? (
        <div role="alert" className="ship-partial">
          <p className="ship-partial-title">
            Committed {committed.slice(0, 7)}. The pull request did not open.
          </p>
          <p className="field-error break-words">{error}</p>
          <Button
            size="sm"
            variant="outline"
            disabled={!!busy || !name}
            onClick={() => void ship(lastKind.current)}
          >
            Try again
          </Button>
        </div>
      ) : (
        error && (
          <p role="alert" className="field-error break-words">
            {error}
          </p>
        )
      )}
      <div className="ship-row">
        <span className="ship-branch" role="status">
          {!status ? (
            'Reading the branch…'
          ) : busy ? (
            <span className="inline-flex items-center gap-2">
              <LoaderCircle className="size-3.5 animate-spin" aria-hidden="true" />
              {busy === 'commit' ? 'Committing…' : 'Creating the pull request…'}
            </span>
          ) : nothing ? (
            pullRequest ? (
              'No new changes'
            ) : (
              'No changes or commits for a pull request'
            )
          ) : (
            <>
              {onDefault && !pullRequest ? newBranch : status.branch} → {status.defaultBranch}
            </>
          )}
        </span>
        <span className="ship-split">
          <Button
            size="sm"
            className="ship-primary"
            disabled={disabled}
            onClick={() => void ship(pullRequest ? 'commit' : 'pull-request')}
          >
            {primary}
          </Button>
          {!pullRequest && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  size="sm"
                  className="ship-more"
                  aria-label="More ways to ship"
                  disabled={!!busy || !status || !name}
                >
                  <ChevronDown aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={nothing} onSelect={() => void ship('draft')}>
                  <GitPullRequestDraft />
                  Create draft pull request
                </DropdownMenuItem>
                <DropdownMenuItem disabled={!changes} onSelect={() => void ship('commit')}>
                  <GitCommitHorizontal />
                  Commit only
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </span>
      </div>
    </div>
  );
}
