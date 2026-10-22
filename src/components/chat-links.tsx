// Parts of the chat view that connect a chat to tasks, pull requests, docs and Settings.
import { useEffect, useState, type ReactNode } from 'react';
import { CircleAlert, FileText, LogIn, Plus, RefreshCw, Settings, Shuffle } from 'lucide-react';
import { trackerConnection } from '../domain/tracker';
import { trackerClient } from '../lib/tracker-client';
import { errorMessage } from '../lib/errors';
import type { AgentError } from '../lib/agent-errors';
import type { API, ProjectGroup, TrackerItem } from '../types';
import { ChatCard } from './chat-card';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Alert, AlertDescription } from './ui/alert';
import { CheckboxRow } from './ui/checkbox';
import { showToast } from './ui/toast';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Choice } from './choice';
import { DocPagePicker } from './doc-page-picker';

/** Sends one of the cross-view events. The shell and the project pages listen for them. */
export function dispatchApp(name: string, detail: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}
/**
 * Opens the fork dialog of a saved chat. The app shell listens for it. Every surface uses it:
 * the chat menus, the read-only notice, and other views that offer Fork.
 */
export const forkChat = (session: { agent: string; id: string }) =>
  dispatchApp('kalkidan-fork-chat', { agent: session.agent, id: session.id });
/** Opens Settings. `anchor` is the element that gets focus, for example one setup step. */
export const openSettings = (section?: string, anchor?: string) =>
  dispatchApp('kalkidan-open-settings', {
    ...(section ? { section } : {}),
    ...(anchor ? { anchor } : {}),
  });
export const openTask = (groupId: string, itemId: string) =>
  dispatchApp('kalkidan-open-task', { groupId, itemId });
/** Opens a project page. Pages, memory and insights are sections of Knowledge. */
export const openProjectPage = (
  groupId: string,
  page: 'board' | 'tasks' | 'chats' | 'knowledge',
  extra: Record<string, unknown> = {},
) => dispatchApp('kalkidan-open-project-page', { groupId, page, ...extra });
export const openExternal = (url: string) => window.open(url, '_blank', 'noreferrer');

/** Starts the Verdictan sign-in. The sign-in flow shows the waiting screen. */
export const startSignIn = () => dispatchApp('kalkidan-sign-in', { intent: 'login' });
/** Checks the managed agents account again. The account strip above the page listens. */
export const checkStatusEvent = 'kalkidan-check-status';
export const requestCheckStatus = () => dispatchApp(checkStatusEvent, {});

/**
 * The action buttons for a chat error. The fix (Sign in or a Settings page) is the filled
 * button, "Try again" is outline and "Use another agent" is ghost. A retryable error shows
 * "Try again" first.
 */
export function AgentErrorActions({
  error,
  onRetry,
  onChangeAgent,
  busy,
}: {
  error: AgentError;
  onRetry?: () => void;
  onChangeAgent?: () => void;
  busy?: boolean;
}) {
  const action = error.action;
  const buttons: ReactNode[] = [];
  const fix =
    action &&
    (action.kind === 'settings' ||
      action.kind === 'install' ||
      action.kind === 'sign-in' ||
      action.kind === 'check-status');
  // A retryable error shows "Try again" first. The fix is then the second choice.
  const retryFirst = !!error.retryFirst && !!onRetry;
  const retryButton = (filled: boolean) => (
    <Button
      key="retry"
      size="sm"
      variant={filled ? 'default' : 'outline'}
      disabled={busy}
      onClick={onRetry}
    >
      <RefreshCw aria-hidden="true" />
      {busy ? 'Sending…' : 'Try again'}
    </Button>
  );
  if (onRetry && retryFirst) buttons.push(retryButton(true));
  if (fix)
    buttons.push(
      <Button
        key="fix"
        size="sm"
        variant={buttons.length ? 'outline' : 'default'}
        onClick={() =>
          action.kind === 'sign-in'
            ? startSignIn()
            : action.kind === 'check-status'
              ? requestCheckStatus()
              : openSettings(action.section, action.anchor)
        }
      >
        {action.kind === 'sign-in' ? (
          <LogIn aria-hidden="true" />
        ) : action.kind === 'check-status' ? (
          <RefreshCw aria-hidden="true" />
        ) : (
          <Settings aria-hidden="true" />
        )}
        {action.label}
      </Button>,
    );
  if (onRetry && !retryFirst) buttons.push(retryButton(!buttons.length));
  if (onChangeAgent)
    buttons.push(
      <Button key="agent" size="sm" variant="ghost" disabled={busy} onClick={onChangeAgent}>
        <Shuffle aria-hidden="true" />
        Use another agent
      </Button>,
    );
  if (!buttons.length) return null;
  return <div className="flex flex-wrap gap-2">{buttons}</div>;
}

/** The secondary note and the code of a chat error, in a fold. "Details" shows them. */
export function AgentErrorNote({ note, code }: { note?: string; code?: string }) {
  if (!note && !code) return null;
  return (
    <details className="agent-error-details">
      <summary>Details</summary>
      {note && <span>{note}</span>}
      {code && (
        <span>
          Code: <code className="font-mono">{code}</code>
        </span>
      )}
    </details>
  );
}

/**
 * The card under a message that did not reach the agent: "{agent} could not start", the cause
 * in plain words and its actions. Only the icon is red.
 */
export function SendFailure({
  agentName,
  error,
  onRetry,
  onChangeAgent,
  busy,
  unsaved,
}: {
  /** The name of the agent, for example "Codex". */
  agentName: string;
  error: AgentError;
  onRetry?: () => void;
  onChangeAgent?: () => void;
  busy?: boolean;
  /** The agent did not start, so the chat has no saved session. It closes when the app quits. */
  unsaved?: boolean;
}) {
  return (
    <ChatCard
      as="div"
      role="alert"
      tone="danger"
      icon={CircleAlert}
      title={`${agentName} could not start`}
    >
      <p className="chat-card-body">
        {error.message}
        {unsaved && ' This chat is saved after the agent starts.'}
      </p>
      <AgentErrorActions
        error={error}
        onRetry={onRetry}
        onChangeAgent={onChangeAgent}
        busy={busy}
      />
      <AgentErrorNote note={error.note} code={error.code} />
    </ChatCard>
  );
}

/**
 * Links a task to the chat, or makes a new task from the chat and links it. A new task is a
 * draft item on the GitHub Projects board.
 */
export function TaskLinkDialog({
  api,
  group,
  open,
  onOpenChange,
  items,
  loading,
  loadError,
  current,
  chat,
  onSave,
}: {
  api: API;
  group: ProjectGroup;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: TrackerItem[];
  loading: boolean;
  loadError: string;
  current: string;
  /** The text for a new task. */
  chat: { title: string; firstMessage: string; summary: string };
  /** Saves the link. `created` is the new task, when the dialog made one. */
  onSave: (taskId: string, created?: TrackerItem) => Promise<void>;
}) {
  const [mode, setMode] = useState<'link' | 'create'>('link');
  const [choice, setChoice] = useState(current);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setMode('link');
    setChoice(current);
    setError('');
  }, [open, current]);
  function startCreate() {
    setTitle(chat.title.slice(0, 256));
    setBody(
      [
        chat.firstMessage.trim(),
        chat.summary.trim() && `## Summary from the chat\n\n${chat.summary.trim()}`,
      ]
        .filter(Boolean)
        .join('\n\n')
        .slice(0, 20000),
    );
    setError('');
    setMode('create');
  }
  async function save() {
    setBusy(true);
    setError('');
    try {
      await onSave(choice);
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function create() {
    const connection = trackerConnection(group);
    if (!connection) return;
    setBusy(true);
    setError('');
    try {
      const client = trackerClient(api, connection.provider);
      const id = await client.draft(group.id, title.trim(), body);
      const board = await client.board(group.id, true);
      const item =
        (typeof id === 'string' && board.items.find((entry) => entry.id === id)) ||
        [...board.items].reverse().find((entry) => entry.title === title.trim());
      if (!item) throw new Error('The task was made, but Kalkidan cannot find it on the board.');
      await onSave(item.id, item);
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const failed = error || loadError;
  return (
    <Dialog open={open} onOpenChange={(value) => !busy && onOpenChange(value)}>
      <DialogContent size="md" layout="scroll">
        <DialogHeader>
          <DialogTitle>{mode === 'link' ? 'Link a task' : 'New task from this chat'}</DialogTitle>
          <DialogDescription>
            {mode === 'link'
              ? 'The agent gets the task as context. General chats can stay unlinked.'
              : 'Kalkidan adds a draft item to the board and links it to this chat.'}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          {mode === 'link' ? (
            <div className="grid gap-2">
              <Choice
                className="w-full"
                label="Chat task"
                value={choice}
                onChange={setChoice}
                disabled={busy || loading}
                options={[
                  { value: '', label: loading ? 'Loading tasks…' : 'No task' },
                  ...items.map((item) => ({ value: item.id, label: item.title })),
                ]}
              />
              <Button
                variant="ghost"
                size="sm"
                className="justify-self-start"
                disabled={busy}
                onClick={startCreate}
              >
                <Plus aria-hidden="true" />
                New task from this chat…
              </Button>
            </div>
          ) : (
            <div className="grid gap-4">
              <label className="form-label">
                Title
                <Input
                  autoFocus
                  value={title}
                  maxLength={256}
                  disabled={busy}
                  onChange={(e) => setTitle(e.target.value)}
                />
              </label>
              <label className="form-label">
                Description
                <Textarea
                  rows={6}
                  value={body}
                  maxLength={20000}
                  disabled={busy}
                  onChange={(e) => setBody(e.target.value)}
                />
                <span className="form-help">
                  The first message and the last answer of the chat. Edit them as necessary.
                </span>
              </label>
            </div>
          )}
          {failed && (
            <p role="alert" className="field-error">
              {failed}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          {mode === 'create' ? (
            <>
              <Button variant="outline" disabled={busy} onClick={() => setMode('link')}>
                Back
              </Button>
              <Button disabled={busy || !title.trim()} onClick={() => void create()}>
                {busy ? 'Creating…' : 'Create and link task'}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button disabled={busy || loading || !!loadError} onClick={() => void save()}>
                Save task link
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Saves the whole chat or the last answer as a new doc page. */
export function SaveToDocsDialog({
  api,
  groupId,
  open,
  onOpenChange,
  chatTitle,
  wholeChat,
  lastAnswer,
}: {
  api: API;
  groupId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chatTitle: string;
  /** The chat as Markdown. */
  wholeChat: string;
  /** The last answer as Markdown. Empty when there is no answer. */
  lastAnswer: string;
}) {
  const [content, setContent] = useState<'chat' | 'answer'>('chat');
  const [title, setTitle] = useState('');
  const [parent, setParent] = useState<{ id: string; title: string } | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setContent(lastAnswer && !wholeChat ? 'answer' : 'chat');
    setTitle(chatTitle.slice(0, 120));
    setParent(null);
    setError('');
  }, [open]);
  async function save() {
    setBusy(true);
    setError('');
    try {
      const page = await api.docsCreate(groupId, title.trim(), parent?.id || null);
      const markdown = content === 'answer' ? lastAnswer : wholeChat;
      const saved = await api.docsSave(groupId, { ...page, markdown });
      onOpenChange(false);
      showToast({
        message: `Saved “${saved.title || title.trim()}” to Docs.`,
        actions: [
          {
            label: 'Open',
            onClick: () =>
              openProjectPage(groupId, 'knowledge', { section: 'pages', docId: saved.id }),
          },
        ],
      });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const empty = content === 'answer' ? !lastAnswer.trim() : !wholeChat.trim();
  return (
    <>
      <Dialog open={open} onOpenChange={(value) => !busy && onOpenChange(value)}>
        <DialogContent size="md" layout="scroll">
          <DialogHeader>
            <DialogTitle>Save to Docs</DialogTitle>
            <DialogDescription>
              Make a new doc page in this project from the chat.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            <fieldset className="grid gap-2" disabled={busy}>
              <legend className="form-label mb-1">Content</legend>
              <CheckboxRow
                type="radio"
                name="save-to-docs-content"
                label="Whole chat"
                description="All messages, with the author of each message."
                checked={content === 'chat'}
                disabled={!wholeChat.trim()}
                onChange={() => setContent('chat')}
              />
              <CheckboxRow
                type="radio"
                name="save-to-docs-content"
                label="Last answer"
                description="Only the last answer from the agent."
                checked={content === 'answer'}
                disabled={!lastAnswer.trim()}
                onChange={() => setContent('answer')}
              />
            </fieldset>
            <label className="form-label">
              Page title
              <Input
                value={title}
                maxLength={120}
                disabled={busy}
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            <div className="grid gap-1">
              <span className="form-label">Parent page</span>
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-sm">
                  {parent ? parent.title || 'Untitled' : 'None (top level)'}
                </span>
                {parent && (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setParent(null)}>
                    Clear
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => setPickerOpen(true)}
                >
                  <FileText aria-hidden="true" />
                  Choose…
                </Button>
              </div>
            </div>
            {error && (
              <Alert variant="destructive" size="sm">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button disabled={busy || !title.trim() || empty} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save page'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <DocPagePicker
        api={api}
        groupId={groupId}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        title="Choose the parent page"
        onPick={(doc) => setParent(doc)}
      />
    </>
  );
}

// A session command can arrive before the chat view that handles it is visible, for example
// from the sidebar menu right after it opens a chat. Keep the last command that no view
// handled for a short time, so the next visible chat view can run it.
const commandLifetime = 2000;
let queuedCommand: { command: string; at: number } | null = null;
if (typeof window !== 'undefined')
  window.addEventListener('kalkidan-session-command', (event) => {
    const detail = (event as CustomEvent<{ command?: string; handled?: boolean }>).detail;
    const command = detail?.command;
    if (!command) return;
    // Wait for the views that decide after a tick, for example the Session menu fallback.
    setTimeout(() => {
      queuedCommand = detail.handled ? null : { command, at: Date.now() };
    }, 50);
  });

/** Returns the session command that no chat view handled in the last 2 seconds, once. */
export function takeQueuedSessionCommand() {
  const queued = queuedCommand;
  queuedCommand = null;
  return queued && Date.now() - queued.at < commandLifetime ? queued.command : null;
}
