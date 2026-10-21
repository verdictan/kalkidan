// Parts of the chat view that connect a chat to tasks, pull requests, docs and Settings.
import { useEffect, useState, type ReactNode } from 'react';
import {
  ChevronDown,
  ExternalLink,
  FileText,
  GitPullRequest,
  Link2Off,
  ListTodo,
  Plus,
  RefreshCw,
  Replace,
  Settings,
  Shuffle,
} from 'lucide-react';
import { trackerConnection } from '../domain/tracker';
import { trackerClient } from '../lib/tracker-client';
import { errorMessage } from '../lib/errors';
import type { AgentError } from '../lib/agent-errors';
import { pullRequestLabel, type SessionPullRequest } from '../lib/pull-request';
import type { API, ProjectGroup, TrackerItem } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Alert, AlertDescription } from './ui/alert';
import { CheckboxRow } from './ui/checkbox';
import { showToast } from './ui/toast';
import { menuDestructiveClass } from './ui/menu-styles';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Choice } from './choice';
import { Hint } from './hint';
import { DocPagePicker } from './doc-page-picker';

/** Sends one of the cross-view events. The shell and the project pages listen for them. */
export function dispatchApp(name: string, detail: Record<string, unknown>) {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}
/** Opens Settings. `anchor` is the element that gets focus, for example one setup step. */
export const openSettings = (section?: string, anchor?: string) =>
  dispatchApp('kalkidan-open-settings', {
    ...(section ? { section } : {}),
    ...(anchor ? { anchor } : {}),
  });
export const openTask = (groupId: string, itemId: string) =>
  dispatchApp('kalkidan-open-task', { groupId, itemId });
export const openProjectPage = (
  groupId: string,
  page: 'board' | 'tasks' | 'docs' | 'memory' | 'insights',
  extra: Record<string, unknown> = {},
) => dispatchApp('kalkidan-open-project-page', { groupId, page, ...extra });
export const openExternal = (url: string) => window.open(url, '_blank', 'noreferrer');

/** The linked task in the composer. A click opens the task. The menu changes or removes it. */
export function TaskChip({
  title,
  disabled,
  onOpen,
  onChange,
  onUnlink,
}: {
  title: string;
  disabled?: boolean;
  /** Opens the task sheet. Without it, the chip opens the menu only. */
  onOpen?: () => void;
  /** Opens the link dialog. Without it, Change task does not show. */
  onChange?: () => void;
  onUnlink: () => void;
}) {
  return (
    <span className="composer-task min-w-0" role="group" aria-label="Linked task">
      <Hint label={onOpen ? `Open task: ${title}` : `Task: ${title}`}>
        <Button
          variant="chip"
          className="min-w-0 rounded-r-none bg-secondary text-secondary-foreground"
          aria-label={`Open task: ${title}`}
          disabled={!onOpen}
          onClick={onOpen}
        >
          <ListTodo aria-hidden="true" />
          <span className="truncate">Task · {title}</span>
        </Button>
      </Hint>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="chip"
            className="w-6 rounded-l-none bg-secondary px-0 text-secondary-foreground has-[>svg]:px-0"
            aria-label="Task options"
            title="Task options"
          >
            <ChevronDown aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-52">
          {onOpen && (
            <DropdownMenuItem onSelect={onOpen}>
              <ExternalLink />
              Open task
            </DropdownMenuItem>
          )}
          {onChange && (
            <DropdownMenuItem disabled={disabled} onSelect={onChange}>
              <Replace />
              Change task…
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem
            className={menuDestructiveClass}
            disabled={disabled}
            onSelect={onUnlink}
          >
            <Link2Off />
            Unlink task
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

/** "PR #12 · Open" in the composer. A click opens the pull request on GitHub. */
export function PullRequestChip({ pr }: { pr: SessionPullRequest }) {
  const label = pullRequestLabel(pr);
  return (
    <Hint label="Open the pull request on GitHub">
      <Button
        variant="chip"
        className="min-w-0"
        data-state={pr.state}
        aria-label={`${label}. Open on GitHub`}
        onClick={() => openExternal(pr.url)}
      >
        <GitPullRequest
          aria-hidden="true"
          className={
            pr.state === 'merged'
              ? 'text-[var(--link)]'
              : pr.state === 'open'
                ? 'text-success'
                : undefined
          }
        />
        <span className="truncate">{label}</span>
      </Button>
    </Hint>
  );
}

/** The action buttons for a chat error: Settings, Try again, Change agent or How to install. */
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
  if (action && (action.kind === 'settings' || action.kind === 'install'))
    buttons.push(
      <Button key="settings" size="sm" onClick={() => openSettings(action.section, action.anchor)}>
        <Settings aria-hidden="true" />
        {action.label}
      </Button>,
    );
  if (onRetry)
    buttons.push(
      <Button
        key="retry"
        size="sm"
        variant={buttons.length ? 'outline' : 'default'}
        disabled={busy}
        onClick={onRetry}
      >
        <RefreshCw aria-hidden="true" />
        {busy ? 'Sending…' : 'Try again'}
      </Button>,
    );
  if (onChangeAgent)
    buttons.push(
      <Button key="agent" size="sm" variant="outline" disabled={busy} onClick={onChangeAgent}>
        <Shuffle aria-hidden="true" />
        Change agent
      </Button>,
    );
  if (!buttons.length) return null;
  return <div className="flex flex-wrap gap-2">{buttons}</div>;
}

/** The error under a message that was not sent, with its actions. */
export function SendFailure({
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
  return (
    <Alert variant="destructive" size="sm" className="chat-send-failure" role="alert">
      <AlertDescription className="grid gap-2 text-xs">
        <span>{error.message}</span>
        {error.code && (
          <span className="text-muted-foreground">
            Details: <code className="font-mono">{error.code}</code>
          </span>
        )}
        <AgentErrorActions
          error={error}
          onRetry={onRetry}
          onChangeAgent={onChangeAgent}
          busy={busy}
        />
      </AlertDescription>
    </Alert>
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
      <DialogContent size="md">
        <DialogHeader>
          <DialogTitle>{mode === 'link' ? 'Link a task' : 'New task from this chat'}</DialogTitle>
          <DialogDescription>
            {mode === 'link'
              ? 'The agent gets the task as context. General chats can stay unlinked.'
              : 'Kalkidan adds a draft item to the board and links it to this chat.'}
          </DialogDescription>
        </DialogHeader>
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
            onClick: () => openProjectPage(groupId, 'docs', { docId: saved.id }),
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

/** Mentions that the composer suggests after "@". */
export const composerMentions = [{ value: '@docs', description: 'Search project docs' }] as const;

/** The mention that the text before the caret starts, or null. Only the first word counts. */
export function mentionQuery(text: string) {
  const match = text.match(/^\s*@(\w*)$/);
  return match ? match[1].toLowerCase() : null;
}

/** The suggestions under the composer when the message starts with "@". */
export function MentionSuggestions({
  id,
  query,
  active,
  onPick,
}: {
  id: string;
  query: string;
  active: number;
  onPick: (value: string) => void;
}) {
  const options = composerMentions.filter((mention) => mention.value.slice(1).startsWith(query));
  if (!options.length) return null;
  return (
    <ul id={id} role="listbox" aria-label="Mentions" className="composer-mentions">
      {options.map((mention, index) => (
        <li
          key={mention.value}
          id={`${id}-${index}`}
          role="option"
          aria-selected={index === active}
          className="composer-mention"
          onMouseDown={(event) => {
            event.preventDefault();
            onPick(mention.value);
          }}
        >
          <span className="font-mono text-xs">{mention.value}</span>
          <span className="text-xs text-muted-foreground">{mention.description}</span>
        </li>
      ))}
    </ul>
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
