import {
  StatusIcon,
  TaskCheckbox,
  TaskLiveLine,
  TaskPullRequest,
  TaskRepo,
  isDoneStatus,
  TaskStartButton,
  chatsActivity,
  linkedChats,
  selectionClick,
  selectionKeys,
  taskFolderName,
  taskKeyUp,
  taskKeys,
  trackerColumns,
  type TaskIdentity,
  type TaskWorkProps,
} from './tracker-list';
import { Check, ChevronDown, PanelRight, Play, SquareCheck } from 'lucide-react';
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
  type RefObject,
} from 'react';
import { plural } from '../lib/platform';
import type { TrackerBoard, TrackerItem, Session } from '../types';
import { cn } from '../lib/utils';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Count } from './ui/count';
import { IdentityMark } from './ui/identity-mark';
import { menuShortcutClass } from './ui/menu-styles';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from './ui/dropdown-menu';

/** True for the URL of a GitHub issue or pull request. Such a title adds that item. */
export function itemUrl(text: string) {
  return /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/(issues|pull)\/\d+\/?$/i.test(text.trim());
}

/** A code folder that a new task can use. */
export interface TaskFolder {
  id: string;
  name: string;
}

/**
 * New task: a card-shaped title field at the top of the first column, with a repo chip under
 * it. The chip starts on the repo used last. Enter adds the task, ⌘Enter adds it and starts a
 * chat, Escape cancels. A pasted issue or pull request URL adds that item to the board.
 */
function InlineTaskField({
  folders,
  folderId,
  onFolderChange,
  identity,
  startLabel,
  onCreate,
  onCancel,
}: {
  folders: TaskFolder[];
  /** The code folder of the new task. */
  folderId?: string;
  onFolderChange?: (id: string) => void;
  identity?: TaskIdentity;
  /** "start with Codex" for the key hint, or undefined when a chat cannot start. */
  startLabel?: string;
  onCreate: (title: string, start: boolean) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const folder = folders.find((item) => item.id === folderId);
  function submit(start: boolean) {
    const value = title.trim();
    if (!value || busy) return;
    setBusy(true);
    void onCreate(value, start && !itemUrl(value)).then((ok) => {
      setBusy(false);
      if (ok) {
        setTitle('');
        field.current?.focus();
      }
    });
  }
  const color = folder && identity?.repoColor(folder.name);
  return (
    <div
      className="tracker-quick-add"
      data-busy={busy || undefined}
      onBlur={(event) => {
        // The field closes when the focus leaves the card with no title. The repo menu keeps it.
        if (event.currentTarget.contains(event.relatedTarget as Node) || menuOpen) return;
        if (!title.trim() && !busy) onCancel();
      }}
    >
      <textarea
        ref={field}
        autoFocus
        rows={1}
        maxLength={256}
        className="tracker-quick-title"
        aria-label="New task title"
        aria-keyshortcuts="Enter Meta+Enter Escape"
        placeholder="Task title"
        value={title}
        readOnly={busy}
        onChange={(event) => setTitle(event.target.value.replace(/\n/g, ' '))}
        onKeyDown={(event) => {
          event.stopPropagation();
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
            event.preventDefault();
            submit(event.metaKey || event.ctrlKey);
          }
        }}
      />
      <div className="tracker-quick-meta">
        {folders.length > 0 && (
          <DropdownMenu
            open={menuOpen}
            onOpenChange={(open) => {
              setMenuOpen(open);
              if (!open) window.setTimeout(() => field.current?.focus(), 0);
            }}
          >
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="tracker-quick-folder"
                aria-label={`Repo: ${folder?.name || 'Choose a repo'}`}
                disabled={busy}
              >
                {color && <IdentityMark kind="repo" color={color} slot={false} />}
                <span className="truncate">{folder?.name || 'Choose a repo'}</span>
                <ChevronDown aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              {folders.map((item) => {
                const itemColor = identity?.repoColor(item.name);
                return (
                  <DropdownMenuItem key={item.id} onSelect={() => onFolderChange?.(item.id)}>
                    {itemColor ? (
                      <IdentityMark kind="repo" color={itemColor} />
                    ) : (
                      <span className="size-4" />
                    )}
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    {item.id === folderId && <Check className="size-4" aria-label="Chosen" />}
                  </DropdownMenuItem>
                );
              })}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <kbd className="tracker-quick-keys">
          {busy ? 'Adding…' : startLabel ? `⏎ add · ⌘⏎ ${startLabel}` : '⏎ add'}
        </kbd>
      </div>
    </div>
  );
}

/** The heading of a board column: name, task count and an optional action. */
export function BoardColumnHeading({
  name,
  count,
  icon,
  action,
}: {
  name: string;
  count: number;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="tracker-column-heading">
      {icon}
      <h4 className="truncate" title={name}>
        {name}
      </h4>
      <Count>
        <span aria-hidden="true">{count}</span>
        <span className="sr-only">{plural(count, 'task')}</span>
      </Count>
      {action}
    </div>
  );
}

/**
 * One task card: the title button (the one focus stop of the card), then the content of the
 * board or the saved view. `top` is for the select box. The board and saved views use it.
 */
export function TaskCard({
  item,
  titleProps,
  top,
  children,
  className,
  ...props
}: ComponentProps<typeof Card> & {
  item: TrackerItem;
  titleProps?: ComponentProps<typeof Button>;
  top?: ReactNode;
}) {
  return (
    <Card
      role="listitem"
      {...props}
      className={cn(
        // Borderless: the grey fill marks the card, and hover makes it darker. A selected card
        // is white with a brown ring. The focus ring is inset, so the column does not clip it.
        'tracker-task gap-0 border border-transparent bg-[var(--fill)] p-3 hover:bg-[var(--fill-strong)]',
        'data-[selected]:border-primary data-[selected]:bg-background data-[selected]:shadow-[0_0_0_3px_color-mix(in_oklch,var(--primary)_12%,transparent)]',
        'has-[.tracker-task-title:focus-visible]:shadow-[var(--focus-ring-inset)]',
        className,
      )}
    >
      <CardContent className="flex flex-col items-stretch gap-1 p-0">
        {top}
        <Button
          variant="bare"
          data-task-focus={item.id}
          {...titleProps}
          className={cn(
            // The card ring is the one focus mark. The title draws no ring of its own.
            'tracker-task-title max-w-full self-start px-0 text-left text-sm leading-5 font-medium whitespace-normal break-words focus-visible:ring-0 focus-visible:ring-offset-0 focus-visible:outline-none',
            titleProps?.className,
          )}
        >
          {item.title}
        </Button>
        {children}
      </CardContent>
    </Card>
  );
}

/**
 * Columns that do not fit scroll sideways. A faded edge shows that more columns are there.
 * Returns the data attributes for the scrolling element.
 */
export function useScrollShadow(scroller: RefObject<HTMLElement | null>, key: unknown) {
  const [overflow, setOverflow] = useState({ start: false, end: false });
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const measure = () => {
      const start = element.scrollLeft > 1;
      const end = element.scrollLeft + element.clientWidth < element.scrollWidth - 1;
      setOverflow((current) =>
        current.start === start && current.end === end ? current : { start, end },
      );
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    element.addEventListener('scroll', measure, { passive: true });
    return () => {
      observer.disconnect();
      element.removeEventListener('scroll', measure);
    };
  }, [scroller, key]);
  return {
    'data-overflow-start': overflow.start || undefined,
    'data-overflow-end': overflow.end || undefined,
  };
}

/**
 * The board columns. The board is one tab stop: the arrow keys move between the cards (up and
 * down in a column, left and right between columns), Enter opens a task, Space selects it, S
 * starts a chat and Shift+F10 opens the card menu with "Move to". A right click opens the same
 * menu. ⌘-click or Shift-click selects.
 */
export function TrackerBoard({
  board,
  items,
  busy,
  sessions,
  onOpen,
  onCreate,
  onStatus,
  adding,
  onAddingChange,
  folders = [],
  addFolderId,
  onAddFolderChange,
  startLabel,
  folderOf = taskFolderName,
  dimmed = false,
  ...work
}: {
  board: TrackerBoard;
  items: TrackerItem[];
  busy: boolean;
  sessions: Session[];
  onOpen: (item: TrackerItem) => void;
  /**
   * Creates a task with this title in a column. With `start`, a chat starts on it. Returns false
   * when it fails, so the title stays.
   */
  onCreate?: (status: string, title: string, start: boolean) => Promise<boolean>;
  onStatus: (item: TrackerItem, status: string) => void;
  /** The column that shows the New task field, or null. */
  adding?: string | null;
  onAddingChange?: (column: string | null) => void;
  /** The code folders of the project, for the repo chip of the New task field. */
  folders?: TaskFolder[];
  /** The code folder of a new task: the repo used last. */
  addFolderId?: string;
  onAddFolderChange?: (id: string) => void;
  /** "start with Codex": the ⌘⏎ hint of the New task field. */
  startLabel?: string;
  /** The code folder name of a card. Drafts keep the repo that the user chose when adding. */
  folderOf?: (item: TrackerItem) => string;
  /** No task matches the search: the columns stay, dimmed. */
  dimmed?: boolean;
} & TaskWorkProps) {
  const [dragged, setDragged] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [activeId, setActiveId] = useState('');
  const [menuId, setMenuId] = useState('');
  // Where a right click opened the card menu, from the top left of the card. Shift+F10 uses the
  // top right corner.
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null);
  const options = board.statusField?.options || [];
  const columns = trackerColumns(board);
  const scroller = useRef<HTMLDivElement>(null);
  const shadow = useScrollShadow(scroller, columns.length);
  const { selection } = work;
  const selecting = !!selection?.ids.size;
  const grid = columns.map((column) =>
    items.filter(
      (item) =>
        (options.some((option) => option.id === item.statusId) ? item.statusId : '') === column.id,
    ),
  );
  const flat = grid.flat();
  // The card that has the tab stop: the last focused card, else the first card.
  const current = flat.some((item) => item.id === activeId) ? activeId : flat[0]?.id;
  function focusCard(id: string) {
    setActiveId(id);
    const card = scroller.current?.querySelector<HTMLElement>(
      `[data-task-focus="${CSS.escape(id)}"]`,
    );
    card?.focus();
    card?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function moveFocus(event: KeyboardEvent) {
    selectionKeys(selection)(event);
    if (event.defaultPrevented || event.altKey || event.metaKey || event.ctrlKey) return;
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-task-focus]');
    const id = target?.dataset.taskFocus;
    if (!id) return;
    const column = grid.findIndex((tasks) => tasks.some((item) => item.id === id));
    if (column < 0) return;
    const row = grid[column].findIndex((item) => item.id === id);
    let next: TrackerItem | undefined;
    if (event.key === 'ArrowUp') next = grid[column][row - 1];
    else if (event.key === 'ArrowDown') next = grid[column][row + 1];
    else if (event.key === 'Home') next = grid[column][0];
    else if (event.key === 'End') next = grid[column].at(-1);
    else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      const step = event.key === 'ArrowLeft' ? -1 : 1;
      // Skip empty columns. Keep the row when the next column has enough cards.
      for (let index = column + step; index >= 0 && index < grid.length; index += step)
        if (grid[index].length) {
          next = grid[index][Math.min(row, grid[index].length - 1)];
          break;
        }
    } else if (event.key === 'F10' && event.shiftKey) {
      event.preventDefault();
      setMenuAt(null);
      setMenuId(id);
      return;
    } else return;
    event.preventDefault();
    if (next) focusCard(next.id);
  }
  return (
    <div
      ref={scroller}
      className="tracker-board"
      {...shadow}
      // Up to four columns share the width. More columns keep 224 to 360px and scroll.
      data-many={columns.length > 4 || undefined}
      data-selecting={selecting || undefined}
      data-dimmed={dimmed || undefined}
      role="region"
      aria-label="Tracker board"
      aria-busy={busy}
      aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight"
      onKeyDown={moveFocus}
    >
      <span className="sr-only" role="status">
        {announcement}
      </span>
      {columns.map((column, columnIndex) => {
        const tasks = grid[columnIndex];
        const addingHere = !!onCreate && adding === column.id;
        return (
          <section
            key={column.id}
            onDragOver={(event) => {
              if (!busy && !work.readOnly && dragged && column.id) {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
                setOver(column.id);
              }
            }}
            onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget as Node)) setOver(null);
            }}
            onDrop={(event) => {
              event.preventDefault();
              const item = items.find((i) => i.id === dragged);
              setDragged(null);
              setOver(null);
              if (!busy && !work.readOnly && item && column.id && item.statusId !== column.id) {
                setAnnouncement(`Moving ${item.title} to ${column.name}`);
                onStatus(item, column.id);
              }
            }}
            data-drop-target={over === column.id || undefined}
            role="region"
            aria-label={`${column.name} column`}
            className="tracker-column"
          >
            <BoardColumnHeading name={column.name} count={tasks.length} />
            <div
              className="tracker-column-items"
              role={tasks.length ? 'list' : undefined}
              aria-label={tasks.length ? `${column.name} tasks` : undefined}
            >
              {addingHere && (
                <InlineTaskField
                  folders={folders}
                  folderId={addFolderId}
                  onFolderChange={onAddFolderChange}
                  identity={work.identity}
                  startLabel={work.onStart ? startLabel : undefined}
                  onCancel={() => onAddingChange?.(null)}
                  onCreate={(title, start) => onCreate(column.id, title, start)}
                />
              )}
              {tasks.map((item) => {
                const chats = linkedChats(sessions, item.id);
                const selected = !!selection?.ids.has(item.id);
                const move = (status: string, name: string) => {
                  setAnnouncement(`Moving ${item.title} to ${name}`);
                  onStatus(item, status);
                };
                const folder = folderOf(item);
                const done = isDoneStatus(
                  options.find((option) => option.id === item.statusId)?.name || '',
                );
                const working = !!chatsActivity(chats, work.activity);
                return (
                  // The title button is the one focus stop of the card. A pointer click on the
                  // card body also opens the task. Shift or ⌘ with a click selects.
                  <TaskCard
                    key={item.id}
                    item={item}
                    data-selected={selected || undefined}
                    onKeyDown={taskKeys(item, work)}
                    onKeyUp={taskKeyUp(work)}
                    onClick={(event) => {
                      if (
                        (event.target as HTMLElement).closest('button, a, input, [role="menuitem"]')
                      )
                        return;
                      if (!selectionClick(event, item, selection)) onOpen(item);
                    }}
                    onContextMenu={(event) => {
                      if ((event.target as HTMLElement).closest('a, input')) return;
                      event.preventDefault();
                      // The menu opens under the pointer, so the release of the button does not
                      // choose an item.
                      const box = event.currentTarget.getBoundingClientRect();
                      setMenuAt({ x: event.clientX - box.left, y: event.clientY - box.top });
                      setMenuId(item.id);
                    }}
                    draggable={!busy && !work.readOnly && !!board.statusField}
                    onDragStart={(event) => {
                      if ((event.target as HTMLElement).closest('button, a, input')) {
                        event.preventDefault();
                        return;
                      }
                      setDragged(item.id);
                      event.dataTransfer.effectAllowed = 'move';
                      event.dataTransfer.setData('text/plain', item.id);
                    }}
                    onDragEnd={() => {
                      setDragged(null);
                      setOver(null);
                    }}
                    data-dragging={dragged === item.id || undefined}
                    top={
                      // The select box shows only while the user selects (⌘-click or Space).
                      selection &&
                      selecting && (
                        <TaskCheckbox
                          item={item}
                          selection={selection}
                          tabIndex={-1}
                          className="absolute top-3 right-3"
                        />
                      )
                    }
                    titleProps={{
                      className: selected ? 'pr-6' : undefined,
                      tabIndex: item.id === current ? 0 : -1,
                      'aria-keyshortcuts':
                        [work.onStart && !done && 'S', selection && 'Space', 'Shift+F10']
                          .filter(Boolean)
                          .join(' ') || undefined,
                      onFocus: () => setActiveId(item.id),
                      onClick: (event) => {
                        if (!selectionClick(event, item, selection)) onOpen(item);
                      },
                    }}
                  >
                    {/* The meta line always shows, so cards of one kind have one height. */}
                    <span className="tracker-task-meta">
                      {folder && <TaskRepo name={folder} identity={work.identity} />}
                      {/* The pull request shows also after its chat is archived. */}
                      <TaskPullRequest
                        chats={sessions.filter((s) => s.organization?.taskId === item.id)}
                        tabIndex={-1}
                        short
                        separator={!!folder}
                      />
                    </span>
                    {/* The card menu opens on a right click or Shift+F10. It has no button. */}
                    <DropdownMenu
                      open={menuId === item.id}
                      onOpenChange={(open) => setMenuId(open ? item.id : '')}
                    >
                      <DropdownMenuTrigger asChild>
                        <span
                          className="tracker-task-menu-anchor"
                          aria-hidden="true"
                          style={
                            menuId === item.id && menuAt
                              ? { top: menuAt.y, left: menuAt.x, right: 'auto' }
                              : undefined
                          }
                        />
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align={menuAt ? 'start' : 'end'}
                        onCloseAutoFocus={(event) => {
                          // The focus goes back to the card.
                          event.preventDefault();
                          focusCard(item.id);
                        }}
                      >
                        <DropdownMenuItem onSelect={() => onOpen(item)}>
                          <PanelRight className="size-4" />
                          Open task
                        </DropdownMenuItem>
                        {work.onStart && !done && (
                          <DropdownMenuItem onSelect={() => work.onStart?.(item)}>
                            <Play className="size-4" />
                            Start task
                            <span className={menuShortcutClass}>S</span>
                          </DropdownMenuItem>
                        )}
                        {selection && (
                          <DropdownMenuItem onSelect={() => selection.toggle(item, false)}>
                            <SquareCheck className="size-4" />
                            {selected ? 'Clear selection' : 'Select'}
                            <span className={menuShortcutClass}>Space</span>
                          </DropdownMenuItem>
                        )}
                        {board.statusField && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuLabel>
                              {work.readOnly ? `Move to · ${work.readOnly}` : 'Move to'}
                            </DropdownMenuLabel>
                            {options.map((option) => (
                              <DropdownMenuItem
                                key={option.id}
                                disabled={busy || !!work.readOnly || option.id === item.statusId}
                                onSelect={() => move(option.id, option.name)}
                              >
                                <StatusIcon name={option.name} size={16} />
                                {option.name}
                              </DropdownMenuItem>
                            ))}
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                    {/* Start floats at the bottom right on hover, so the card keeps its height. */}
                    {work.onStart && !done && !working && work.startingId !== item.id && (
                      <span className="tracker-task-actions">
                        <TaskStartButton
                          item={item}
                          tabIndex={-1}
                          onStart={() => work.onStart?.(item)}
                        />
                      </span>
                    )}
                    <TaskLiveLine
                      chats={chats}
                      activity={work.activity}
                      live={work.live}
                      identity={work.identity}
                      onOpenChat={work.onOpenChat}
                      onAllow={work.onAllow}
                      starting={work.startingId === item.id}
                      tabIndex={-1}
                    />
                  </TaskCard>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
