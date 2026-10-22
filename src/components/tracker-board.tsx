import {
  StatusIcon,
  TaskCheckbox,
  isDoneStatus,
  taskMeta,
  TaskChip,
  TaskStartButton,
  chatsActivity,
  linkedChats,
  selectionClick,
  selectionKeys,
  taskKeyUp,
  taskKeys,
  trackerColumns,
  type TaskWorkProps,
} from './tracker-list';
import { PanelRight, Play, Plus, SquareCheck } from 'lucide-react';
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
import { Input } from './ui/input';
import { Count } from './ui/count';
import { MoreButton } from './ui/more-button';
import { menuShortcutClass } from './ui/menu-styles';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from './ui/dropdown-menu';

/** The title field that the column "+" adds: Enter creates the task, Escape cancels. */
function InlineTaskField({
  column,
  onCreate,
  onCancel,
}: {
  column: string;
  onCreate: (title: string) => Promise<boolean>;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Input
      autoFocus
      maxLength={256}
      // Card-shaped, so the new task takes the place of the card that it makes.
      className="tracker-inline-add h-auto min-h-11 rounded-lg p-3 font-medium"
      aria-label={`New task in ${column}`}
      placeholder="Task title"
      value={title}
      disabled={busy}
      onChange={(event) => setTitle(event.target.value)}
      onBlur={() => !title.trim() && !busy && onCancel()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Escape') {
          event.preventDefault();
          onCancel();
        } else if (event.key === 'Enter' && !event.nativeEvent.isComposing && title.trim()) {
          event.preventDefault();
          setBusy(true);
          void onCreate(title.trim()).then((ok) => {
            setBusy(false);
            if (ok) setTitle('');
          });
        }
      }}
    />
  );
}

/** The heading of a board column: status icon, name, task count and an optional action. */
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
      {icon ?? <StatusIcon name={name} />}
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
        'tracker-task gap-0 has-[.tracker-task-title:focus-visible]:shadow-[var(--focus-ring)] data-[selected]:bg-[var(--surface-selected)]',
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
 * starts a chat and Shift+F10 opens the card menu with "Move to".
 */
export function TrackerBoard({
  board,
  items,
  busy,
  sessions,
  onOpen,
  onCreate,
  onStatus,
  ...work
}: {
  board: TrackerBoard;
  items: TrackerItem[];
  busy: boolean;
  sessions: Session[];
  onOpen: (item: TrackerItem) => void;
  /** Creates a task with this title in a column. The column "+" shows a title field. */
  onCreate?: (status: string, title: string) => Promise<boolean>;
  onStatus: (item: TrackerItem, status: string) => void;
} & TaskWorkProps) {
  const [adding, setAdding] = useState<string | null>(null);
  const [dragged, setDragged] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const [activeId, setActiveId] = useState('');
  const [menuId, setMenuId] = useState('');
  const options = board.statusField?.options || [];
  const columns = trackerColumns(board);
  const scroller = useRef<HTMLDivElement>(null);
  const shadow = useScrollShadow(scroller, columns.length);
  const { selection } = work;
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
      // Up to four columns share the width. More columns keep 260 to 360px and scroll.
      data-many={columns.length > 4 || undefined}
      data-selecting={selection?.ids.size ? true : undefined}
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
            <BoardColumnHeading
              name={column.name}
              count={tasks.length}
              action={
                onCreate &&
                column.id && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="tracker-column-add"
                    aria-label={`New task in ${column.name}`}
                    tabIndex={-1}
                    disabled={busy}
                    onClick={() => setAdding(column.id)}
                  >
                    <Plus size={16} />
                  </Button>
                )
              }
            />
            <div
              className="tracker-column-items"
              role={tasks.length ? 'list' : undefined}
              aria-label={tasks.length ? `${column.name} tasks` : undefined}
            >
              {!tasks.length && adding !== column.id && (
                <p className="tracker-column-empty">
                  {columnIndex === 0 && !flat.length && onCreate
                    ? 'No tasks yet. Use + or New task.'
                    : 'No tasks'}
                </p>
              )}
              {onCreate && adding === column.id && (
                <InlineTaskField
                  column={column.name}
                  onCancel={() => setAdding(null)}
                  onCreate={async (title) => {
                    const ok = await onCreate(column.id, title);
                    if (ok) setAdding(null);
                    return ok;
                  }}
                />
              )}
              {tasks.map((item) => {
                const chats = linkedChats(sessions, item.id);
                const selected = !!selection?.ids.has(item.id);
                const move = (status: string, name: string) => {
                  setAnnouncement(`Moving ${item.title} to ${name}`);
                  onStatus(item, status);
                };
                const meta = taskMeta(item);
                const done = isDoneStatus(
                  options.find((option) => option.id === item.statusId)?.name || '',
                );
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
                      selection && (
                        <TaskCheckbox
                          item={item}
                          selection={selection}
                          tabIndex={-1}
                          className="absolute top-3 right-3"
                        />
                      )
                    }
                    titleProps={{
                      className: selection ? 'pr-6' : undefined,
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
                    <div className="tracker-task-footer">
                      {meta && <span className="tracker-task-meta truncate">{meta}</span>}
                      <TaskChip
                        chats={chats}
                        activity={work.activity}
                        onOpenChat={work.onOpenChat}
                        starting={work.startingId === item.id}
                        tabIndex={-1}
                      />
                      <span className="tracker-task-actions">
                        <DropdownMenu
                          open={menuId === item.id}
                          onOpenChange={(open) => setMenuId(open ? item.id : '')}
                        >
                          <DropdownMenuTrigger asChild>
                            <MoreButton
                              size="xs"
                              className="tracker-task-menu"
                              label={`Task menu: ${item.title}`}
                              tabIndex={-1}
                            />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent
                            align="end"
                            onCloseAutoFocus={(event) => {
                              // The focus goes back to the card, not to the hidden menu button.
                              event.preventDefault();
                              focusCard(item.id);
                            }}
                          >
                            <DropdownMenuItem onSelect={() => onOpen(item)}>
                              <PanelRight className="size-4" />
                              Open task
                            </DropdownMenuItem>
                            {work.onStart && (
                              <DropdownMenuItem onSelect={() => work.onStart?.(item)}>
                                <Play className="size-4" />
                                Start task
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
                                    disabled={
                                      busy || !!work.readOnly || option.id === item.statusId
                                    }
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
                        {work.onStart &&
                          !done &&
                          !chatsActivity(chats, work.activity) &&
                          work.startingId !== item.id && (
                            <TaskStartButton
                              item={item}
                              tabIndex={-1}
                              onStart={() => work.onStart?.(item)}
                            />
                          )}
                      </span>
                    </div>
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
