import {
  Circle,
  CircleDashed,
  CircleCheck,
  CircleDot,
  GitPullRequest,
  MessageSquare,
  PanelRight,
  Play,
} from 'lucide-react';
import type { MouseEvent, KeyboardEvent } from 'react';
import type { Agent, TrackerBoard, TrackerItem, Session } from '../types';
import { agentLabel } from '../config/agents';
import {
  ActivityDot,
  activityKey,
  strongestActivity,
  type SessionActivityState,
} from './activity-dot';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Checkbox } from './ui/checkbox';
import { Count } from './ui/count';
import { AgentIcon } from './ui/agent-icon';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { MoreButton } from './ui/more-button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Hint } from './hint';
import { pathBasename, plural } from '../lib/platform';

/** True for a status that means the work is complete, such as "Done" or "Closed". */
export function isDoneStatus(name: string) {
  return /done|complete|closed/i.test(name);
}

/** The icon of a status. Menus use size 16; rows and cards use 14. */
export function StatusIcon({ name, size = 14 }: { name: string; size?: 14 | 16 }) {
  const box = size === 16 ? 'size-4' : 'size-3.5';
  if (isDoneStatus(name))
    return <CircleCheck className={`${box} shrink-0 text-success`} aria-hidden="true" />;
  if (/progress|doing|review/i.test(name))
    return <CircleDot className={`${box} shrink-0 text-warning`} aria-hidden="true" />;
  if (/backlog|no status/i.test(name))
    return <CircleDashed className={`${box} shrink-0 text-muted-foreground`} aria-hidden="true" />;
  return <Circle className={`${box} shrink-0 text-muted-foreground`} aria-hidden="true" />;
}
/** The meta line of a task: "atlas-web #40", "Draft" for a draft, else nothing. */
export function taskMeta(item: TrackerItem) {
  if (item.repository)
    return `${pathBasename(item.repository)}${item.number ? ` #${item.number}` : ''}`;
  return item.kind === 'DraftIssue' ? 'Draft' : '';
}
export function trackerColumns(board: TrackerBoard) {
  const options = board.statusField?.options || [];
  return [
    ...options,
    ...(!options.length || board.items.some((i) => !options.some((o) => o.id === i.statusId))
      ? [{ id: '', name: 'No status' }]
      : []),
  ];
}

/** The tasks that the user selected on the board or in the list. */
export interface TaskSelection {
  ids: ReadonlySet<string>;
  /** Adds or removes one task. With `range`, selects all tasks from the last one clicked. */
  toggle: (item: TrackerItem, range: boolean) => void;
  /** Selects all visible tasks. */
  selectAll: () => void;
  clear: () => void;
}

/** Shared props of the board and the list for the chats of a task and the quick start. */
export interface TaskWorkProps {
  /** The background state of open chats, by activityKey(agent, id). */
  activity?: Record<string, SessionActivityState>;
  onOpenChat?: (session: Session) => void;
  /** Starts a chat on the task. The board shows "Start" on hover and the S key starts it. */
  onStart?: (item: TrackerItem) => void;
  /** The task that is starting now. Its card shows "Starting…". */
  startingId?: string;
  /** The reason that write controls are off, for example "Read only". */
  readOnly?: string;
  selection?: TaskSelection;
}

/** The chats that work on a task, the most recent first. Archived chats do not count. */
export function linkedChats(sessions: Session[], itemId: string) {
  return sessions
    .filter((s) => !s.organization?.archived && s.organization?.taskId === itemId)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

const activityWords: Record<SessionActivityState, string> = {
  approval: 'Needs approval',
  question: 'Needs your answer',
  running: 'Agent working',
};
/** The state of the chats of a task that needs the user most. */
export function chatsActivity(
  chats: Session[],
  activity: Record<string, SessionActivityState> = {},
) {
  return strongestActivity(chats.map((s) => activity[activityKey(s.agent, s.id)]));
}
/** "Codex working", "Needs your answer" or "Needs approval". */
export function activityText(state: SessionActivityState, agent?: Agent) {
  return state === 'running' && agent ? `${agentLabel(agent)} working` : activityWords[state];
}
/** The chat of a task that has the given state. */
function chatWithState(
  chats: Session[],
  state: SessionActivityState | undefined,
  activity: Record<string, SessionActivityState> = {},
) {
  return state ? chats.find((s) => activity[activityKey(s.agent, s.id)] === state) : undefined;
}

const pullRequestWords = { open: 'Open', merged: 'Merged', closed: 'Closed' } as const;

/**
 * The chats of a task: a button with the live state ("Agent working", "Needs your answer")
 * that opens the chat, or a menu when there are several. A pull request from one of the
 * chats shows as a badge that opens it on GitHub.
 */
export function TaskChats({
  chats,
  activity,
  onOpenChat,
  showAgent = false,
  tabIndex,
}: {
  chats: Session[];
  activity?: Record<string, SessionActivityState>;
  onOpenChat?: (session: Session) => void;
  /** Shows the agent of the latest chat, for the Chat column of the list. */
  showAgent?: boolean;
  /** -1 on the board, where the card is the only tab stop. */
  tabIndex?: number;
}) {
  if (!chats.length) return null;
  const state = chatsActivity(chats, activity);
  const label = state
    ? activityText(state, chatWithState(chats, state, activity)?.agent)
    : showAgent && chats.length === 1
      ? agentLabel(chats[0].agent)
      : plural(chats.length, 'chat');
  const icon = state ? (
    <ActivityDot state={state} />
  ) : showAgent ? (
    <AgentIcon agent={chats[0].agent} />
  ) : (
    <MessageSquare size={12} aria-hidden="true" />
  );
  const title = (s: Session) => s.organization?.title || s.title;
  return (
    <>
      {!onOpenChat ? (
        <Badge variant="outline" size="sm" className="tracker-task-chats">
          {icon}
          {label}
        </Badge>
      ) : chats.length === 1 ? (
        <Hint label={`Open chat: ${title(chats[0])}`}>
          <Button
            variant="ghost"
            size="xs"
            className="tracker-task-chats"
            data-state={state}
            tabIndex={tabIndex}
            aria-label={`${label}. Open chat: ${title(chats[0])}`}
            onClick={() => onOpenChat(chats[0])}
          >
            {icon}
            {label}
          </Button>
        </Hint>
      ) : (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="xs"
              className="tracker-task-chats"
              data-state={state}
              tabIndex={tabIndex}
              aria-label={`${label}. ${plural(chats.length, 'chat')}. Choose a chat to open`}
            >
              {icon}
              {state ? `${label} · ${chats.length}` : label}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-w-80">
            <DropdownMenuLabel>Open a chat</DropdownMenuLabel>
            {chats.map((s) => {
              const own = activity?.[activityKey(s.agent, s.id)];
              return (
                <DropdownMenuItem key={s.agent + s.id} onSelect={() => onOpenChat(s)}>
                  <AgentIcon agent={s.agent} />
                  <span className="min-w-0 flex-1 truncate">{title(s)}</span>
                  {own && <ActivityDot state={own} />}
                  <span className="sr-only">{agentLabel(s.agent)}</span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <TaskPullRequest chats={chats} tabIndex={tabIndex} />
    </>
  );
}

/** The pull request of the chats of a task: the one of the latest chat that has one. */
export function taskPullRequest(chats: Session[]) {
  return chats.find((s) => s.organization?.pullRequest?.url)?.organization?.pullRequest;
}
export function pullRequestStateWord(state?: 'open' | 'merged' | 'closed') {
  return state ? pullRequestWords[state] : '';
}

/** The pull request that a chat of the task opened, as a small link that opens it on GitHub. */
export function TaskPullRequest({
  chats,
  tabIndex,
  short = false,
}: {
  chats: Session[];
  tabIndex?: number;
  /** Shows only "#41", for a card. */
  short?: boolean;
}) {
  const pullRequest = taskPullRequest(chats);
  if (!pullRequest) return null;
  return (
    <Button asChild variant="ghost" size="xs" className="tracker-task-pr">
      <a
        href={pullRequest.url}
        target="_blank"
        rel="noreferrer"
        tabIndex={tabIndex}
        aria-label={
          `Pull request${pullRequest.number ? ` #${pullRequest.number}` : ''}` +
          `${pullRequest.state ? `, ${pullRequestWords[pullRequest.state].toLowerCase()}` : ''}` +
          '. Opens on GitHub'
        }
        data-state={pullRequest.state}
      >
        <GitPullRequest aria-hidden="true" />
        {pullRequest.number ? `#${pullRequest.number}` : 'PR'}
        {!short && pullRequest.state ? ` · ${pullRequestWords[pullRequest.state]}` : ''}
      </a>
    </Button>
  );
}

/**
 * The "Start" button of a card or a row. It shows on hover and on focus, for tasks that are not
 * done. The S key does the same.
 */
export function TaskStartButton({
  item,
  onStart,
  tabIndex,
}: {
  item: TrackerItem;
  onStart: () => void;
  tabIndex?: number;
}) {
  return (
    <Hint label="Start a chat on this task" shortcut="S">
      <Button
        variant="outline"
        size="xs"
        className="tracker-task-start"
        aria-label={`Start task: ${item.title}`}
        aria-keyshortcuts="S"
        tabIndex={tabIndex}
        onClick={onStart}
      >
        <Play aria-hidden="true" />
        Start
      </Button>
    </Hint>
  );
}

/**
 * The one chip of a card: "Starting…", the live state of its chat ("Codex working", "Needs
 * your answer"), else its pull request ("#41"). It opens the chat or the pull request.
 * Returns null when the task has none of these.
 */
export function TaskChip({
  chats,
  activity,
  onOpenChat,
  starting,
  tabIndex,
}: {
  chats: Session[];
  activity?: Record<string, SessionActivityState>;
  onOpenChat?: (session: Session) => void;
  starting?: boolean;
  tabIndex?: number;
}) {
  if (starting)
    return (
      <span className="tracker-task-chip" data-state="running" role="status">
        <ActivityDot state="running" />
        Starting…
      </span>
    );
  const state = chatsActivity(chats, activity);
  const chat = chatWithState(chats, state, activity);
  if (state && chat) {
    const label = activityText(state, chat.agent);
    const name = chat.organization?.title || chat.title;
    return onOpenChat ? (
      <Hint label={`Open chat: ${name}`}>
        <button
          type="button"
          className="tracker-task-chip"
          data-state={state}
          tabIndex={tabIndex}
          aria-label={`${label}. Open chat: ${name}`}
          onClick={() => onOpenChat(chat)}
        >
          <ActivityDot state={state} />
          {label}
        </button>
      </Hint>
    ) : (
      <span className="tracker-task-chip" data-state={state}>
        <ActivityDot state={state} />
        {label}
      </span>
    );
  }
  return <TaskPullRequest chats={chats} tabIndex={tabIndex} short />;
}

/** True when a key event comes from a text field or a menu, where keys have other uses. */
function typing(event: KeyboardEvent) {
  return !!(event.target as HTMLElement).closest(
    'input:not([type="checkbox"]):not([type="radio"]), textarea, select, ' +
      '[contenteditable="true"], [role="menu"], [role="listbox"]',
  );
}

/** True when the event comes from the title button of a task, the focus stop of the task. */
function onTaskTitle(event: KeyboardEvent) {
  return !!(event.target as HTMLElement).closest('[data-task-focus]');
}

/**
 * Keys on a task: S starts a chat and Space selects the task. On the board or the list: ⌘A or
 * Ctrl+A selects all visible tasks and Escape clears the selection.
 */
export function taskKeys(item: TrackerItem, work: TaskWorkProps) {
  return (event: KeyboardEvent) => {
    if (typing(event) || event.altKey || event.metaKey || event.ctrlKey) return;
    if ((event.key === 's' || event.key === 'S') && work.onStart) {
      event.preventDefault();
      event.stopPropagation();
      work.onStart(item);
    } else if (event.key === ' ' && work.selection && onTaskTitle(event)) {
      // Space on the title selects. Without this, the button opens the task.
      event.preventDefault();
      event.stopPropagation();
      work.selection.toggle(item, event.shiftKey);
    }
  };
}
/** Stops the click that Space makes on a title button when Space selects the task. */
export function taskKeyUp(work: TaskWorkProps) {
  return (event: KeyboardEvent) => {
    if (event.key === ' ' && work.selection && onTaskTitle(event)) event.preventDefault();
  };
}
export function selectionKeys(selection?: TaskSelection) {
  return (event: KeyboardEvent) => {
    if (!selection || typing(event)) return;
    if (event.key === 'a' && (event.metaKey || event.ctrlKey) && !event.altKey) {
      event.preventDefault();
      selection.selectAll();
    } else if (event.key === 'Escape' && selection.ids.size) {
      event.preventDefault();
      selection.clear();
    }
  };
}
/**
 * A click on the body of a task with Shift selects a range, and with ⌘ or Ctrl adds the task
 * to the selection. Returns true when the click changed the selection.
 */
export function selectionClick(event: MouseEvent, item: TrackerItem, selection?: TaskSelection) {
  if (!selection || !(event.shiftKey || event.metaKey || event.ctrlKey)) return false;
  event.preventDefault();
  selection.toggle(item, event.shiftKey);
  return true;
}

/**
 * The check box that selects a task. It shows on hover and focus, and on every task while the
 * user selects.
 */
export function TaskCheckbox({
  item,
  selection,
  className,
  tabIndex,
}: {
  item: TrackerItem;
  selection: TaskSelection;
  className?: string;
  tabIndex?: number;
}) {
  return (
    <Hint label="Select" shortcut="Space">
      <Checkbox
        className={className ? `tracker-task-select ${className}` : 'tracker-task-select'}
        aria-label={`Select ${item.title}`}
        tabIndex={tabIndex}
        checked={selection.ids.has(item.id)}
        onClick={(event) => {
          // The change event has no Shift key, so the click changes the selection. React then
          // sets the box from the selection.
          event.stopPropagation();
          selection.toggle(item, event.shiftKey);
        }}
        onChange={() => {}}
      />
    </Hint>
  );
}

/**
 * The list view: one group per status, so the rows show no status column. The row menu moves a
 * task. Columns that are empty on every row do not show.
 */
export function TrackerList({
  board,
  items,
  sessions,
  busy,
  onOpen,
  onStatus,
  ...work
}: {
  board: TrackerBoard;
  items: TrackerItem[];
  sessions: Session[];
  busy: boolean;
  onOpen: (item: TrackerItem) => void;
  onStatus: (item: TrackerItem, status: string) => void;
} & TaskWorkProps) {
  const { selection } = work;
  const selecting = !!selection?.ids.size;
  const allSelected =
    !!selection && items.length > 0 && items.every((i) => selection.ids.has(i.id));
  const chatsOf = new Map(items.map((item) => [item.id, linkedChats(sessions, item.id)]));
  const showRepository = items.some((item) => taskMeta(item));
  const showChats = items.some((item) => chatsOf.get(item.id)?.length) || !!work.startingId;
  const options = board.statusField?.options || [];
  const columnCount = 2 + (showRepository ? 1 : 0) + (showChats ? 1 : 0);
  return (
    <Table
      className="tracker-list table-fixed"
      data-selecting={selecting || undefined}
      onKeyDown={selectionKeys(selection)}
    >
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          {/* The select boxes sit in the gutter left of the titles, so titles line up. */}
          <TableHead className="tracker-list-title first:pl-0">
            {selection && (
              <Checkbox
                className="tracker-task-select absolute top-1/2 -left-5 -translate-y-1/2"
                aria-label="Select all tasks"
                checked={allSelected}
                ref={(element) => {
                  if (element) element.indeterminate = selecting && !allSelected;
                }}
                onChange={() => (allSelected ? selection.clear() : selection.selectAll())}
              />
            )}
            Title
          </TableHead>
          {showRepository && <TableHead className="w-[22%]">Repository</TableHead>}
          {showChats && <TableHead className="w-44">Chat</TableHead>}
          <TableHead className="tracker-list-start">
            <span className="sr-only">Actions</span>
          </TableHead>
        </TableRow>
      </TableHeader>
      {trackerColumns(board).map((column) => {
        const tasks = items.filter(
          (i) => (options.some((o) => o.id === i.statusId) ? i.statusId : '') === column.id,
        );
        if (!tasks.length) return null;
        return (
          <TableBody key={column.id}>
            <TableRow className="tracker-list-group border-b-0 hover:bg-transparent">
              <th scope="rowgroup" colSpan={columnCount} className="h-8 pl-0 text-left font-normal">
                <span className="flex items-center gap-2">
                  <StatusIcon name={column.name} />
                  <span className="text-sm font-semibold">{column.name}</span>
                  <Count>{tasks.length}</Count>
                </span>
              </th>
            </TableRow>
            {tasks.map((item) => {
              const chats = chatsOf.get(item.id) || [];
              const selected = !!selection?.ids.has(item.id);
              const active = !!chatsActivity(chats, work.activity);
              return (
                <TableRow
                  key={item.id}
                  className="tracker-list-row h-10 border-b-0"
                  data-state={selected ? 'selected' : undefined}
                  onKeyDown={taskKeys(item, work)}
                  onKeyUp={taskKeyUp(work)}
                  onClick={(event) => {
                    if (
                      (event.target as HTMLElement).closest('button, a, input, [role="menuitem"]')
                    )
                      return;
                    selectionClick(event, item, selection);
                  }}
                >
                  <TableCell className="tracker-list-title whitespace-normal first:pl-0">
                    {selection && (
                      <TaskCheckbox
                        item={item}
                        selection={selection}
                        className="absolute top-1/2 -left-5 -translate-y-1/2"
                      />
                    )}
                    <Button
                      variant="bare"
                      className="min-w-0 px-0 text-left font-medium whitespace-normal break-words hover:underline"
                      data-task-focus={item.id}
                      aria-keyshortcuts={work.onStart ? 'S' : undefined}
                      onClick={(event) => {
                        if (!selectionClick(event, item, selection)) onOpen(item);
                      }}
                    >
                      {item.title}
                    </Button>
                  </TableCell>
                  {showRepository && (
                    <TableCell className="max-w-0 truncate text-xs text-muted-foreground tabular-nums">
                      {taskMeta(item)}
                    </TableCell>
                  )}
                  {showChats && (
                    <TableCell className="max-w-0">
                      <div className="tracker-list-chat">
                        {work.startingId === item.id ? (
                          <TaskChip chats={chats} starting />
                        ) : (
                          <TaskChats
                            chats={chats}
                            activity={work.activity}
                            onOpenChat={work.onOpenChat}
                            showAgent
                          />
                        )}
                      </div>
                    </TableCell>
                  )}
                  <TableCell className="tracker-list-start">
                    <span className="tracker-task-actions">
                      {work.onStart &&
                        !active &&
                        !isDoneStatus(column.name) &&
                        work.startingId !== item.id && (
                          <TaskStartButton item={item} onStart={() => work.onStart?.(item)} />
                        )}
                      <TaskRowMenu
                        board={board}
                        item={item}
                        busy={busy}
                        readOnly={work.readOnly}
                        onOpen={onOpen}
                        onStatus={onStatus}
                      />
                    </span>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        );
      })}
    </Table>
  );
}

/** The ⋯ menu of a list row: open the task and move it to a status. */
function TaskRowMenu({
  board,
  item,
  busy,
  readOnly,
  onOpen,
  onStatus,
}: {
  board: TrackerBoard;
  item: TrackerItem;
  busy: boolean;
  readOnly?: string;
  onOpen: (item: TrackerItem) => void;
  onStatus: (item: TrackerItem, status: string) => void;
}) {
  const options = board.statusField?.options || [];
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <MoreButton size="xs" className="tracker-task-menu" label={`Task menu: ${item.title}`} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => onOpen(item)}>
          <PanelRight className="size-4" />
          Open task
        </DropdownMenuItem>
        {!!options.length && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>{readOnly ? `Move to · ${readOnly}` : 'Move to'}</DropdownMenuLabel>
            {options.map((option) => (
              <DropdownMenuItem
                key={option.id}
                disabled={busy || option.id === item.statusId}
                onSelect={() => onStatus(item, option.id)}
              >
                <StatusIcon name={option.name} size={16} />
                {option.name}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
