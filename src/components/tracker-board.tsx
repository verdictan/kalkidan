import {
  StatusIcon,
  TaskChats,
  TaskCheckbox,
  TaskStartButton,
  linkedChats,
  selectionClick,
  selectionKeys,
  taskKeys,
  trackerColumns,
  type TaskWorkProps,
} from './tracker-list';
import { ChevronDown, Plus } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { pathBasename, plural } from '../lib/platform';
import type { TrackerBoard, TrackerItem, Session } from '../types';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { EmptyState } from './ui/empty-state';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
} from './ui/dropdown-menu';

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
      <span>
        <span aria-hidden="true">{count}</span>
        <span className="sr-only">{plural(count, 'task')}</span>
      </span>
      {action}
    </div>
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
  onCreate?: (status: string) => void;
  onStatus: (item: TrackerItem, status: string) => void;
} & TaskWorkProps) {
  const [dragged, setDragged] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const options = board.statusField?.options || [];
  const columns = trackerColumns(board);
  const scroller = useRef<HTMLDivElement>(null);
  const shadow = useScrollShadow(scroller, columns.length);
  const { selection } = work;
  return (
    <div
      ref={scroller}
      className="tracker-board"
      {...shadow}
      data-selecting={selection?.ids.size ? true : undefined}
      role="region"
      aria-label="Tracker board"
      aria-busy={busy}
      tabIndex={0}
      onKeyDown={selectionKeys(selection)}
    >
      <span className="sr-only" role="status">
        {announcement}
      </span>
      {columns.map((column) => {
        const tasks = items.filter(
          (item) =>
            (options.some((option) => option.id === item.statusId) ? item.statusId : '') ===
            column.id,
        );
        return (
          <section
            key={column.id}
            onDragOver={(event) => {
              if (!busy && dragged && column.id) {
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
              if (!busy && item && column.id && item.statusId !== column.id) {
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
                onCreate && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    className="tracker-column-add"
                    aria-label={`New task in ${column.name}`}
                    disabled={busy}
                    onClick={() => onCreate(column.id)}
                  >
                    <Plus size={14} />
                  </Button>
                )
              }
            />
            <div
              className="tracker-column-items"
              role={tasks.length ? 'list' : undefined}
              aria-label={tasks.length ? `${column.name} tasks` : undefined}
            >
              {tasks.map((item) => {
                const chats = linkedChats(sessions, item.id);
                const statusName =
                  options.find((option) => option.id === item.statusId)?.name || 'No status';
                const selected = !!selection?.ids.has(item.id);
                return (
                  // The title button is the only focus stop that opens the task. A
                  // pointer click on the card body also opens it. The status pill moves
                  // the task without drag and drop. Shift or ⌘ with a click selects.
                  <Card
                    key={item.id}
                    role="listitem"
                    data-selected={selected || undefined}
                    onKeyDown={taskKeys(item, work)}
                    onClick={(event) => {
                      if (
                        (event.target as HTMLElement).closest('button, a, input, [role="menuitem"]')
                      )
                        return;
                      if (!selectionClick(event, item, selection)) onOpen(item);
                    }}
                    draggable={!busy && !!board.statusField}
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
                    className="tracker-task gap-0 has-[.tracker-task-title:focus-visible]:shadow-[var(--focus-ring)]"
                  >
                    <CardContent className="flex flex-col items-start gap-1 p-0">
                      {selection && <TaskCheckbox item={item} selection={selection} />}
                      <Button
                        variant="bare"
                        className="tracker-task-title max-w-full px-0 text-left text-sm leading-5 font-medium whitespace-normal break-words focus-visible:ring-0"
                        data-task-focus={item.id}
                        aria-keyshortcuts={work.onStart ? 'S' : undefined}
                        onClick={(event) => {
                          if (!selectionClick(event, item, selection)) onOpen(item);
                        }}
                      >
                        {item.title}
                      </Button>
                      <p className="tracker-task-meta">
                        {item.repository
                          ? pathBasename(item.repository)
                          : 'Not linked to a GitHub repository'}
                        {item.number ? ` #${item.number}` : ''}
                      </p>
                      {(board.statusField || chats.length > 0 || work.onStart) && (
                        <div className="tracker-task-footer">
                          {board.statusField && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="outline"
                                  size="xs"
                                  className="tracker-task-status"
                                  aria-label={`Move task: ${item.title}. Status: ${statusName}`}
                                  disabled={busy}
                                >
                                  <StatusIcon name={statusName} />
                                  <span className="truncate">{statusName}</span>
                                  <ChevronDown aria-hidden="true" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="start">
                                <DropdownMenuLabel>Move to</DropdownMenuLabel>
                                {options.map((option) => (
                                  <DropdownMenuItem
                                    key={option.id}
                                    disabled={option.id === item.statusId}
                                    onSelect={() => onStatus(item, option.id)}
                                  >
                                    <StatusIcon name={option.name} />
                                    {option.name}
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                          <TaskChats
                            chats={chats}
                            activity={work.activity}
                            onOpenChat={work.onOpenChat}
                          />
                          {work.onStart && (
                            <TaskStartButton item={item} onStart={() => work.onStart?.(item)} />
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
              {!tasks.length && (
                <EmptyState compact className="tracker-column-empty">
                  No tasks
                </EmptyState>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
