import { StatusIcon, trackerColumns } from './tracker-list';
import { ChevronDown, MessageSquare, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { pathBasename, plural } from '../lib/platform';
import type { TrackerBoard, TrackerItem, Session } from '../types';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuItem,
} from './ui/dropdown-menu';

export function TrackerBoard({
  board,
  items,
  busy,
  sessions,
  onOpen,
  onCreate,
  onStatus,
}: {
  board: TrackerBoard;
  items: TrackerItem[];
  busy: boolean;
  sessions: Session[];
  onOpen: (item: TrackerItem) => void;
  onCreate?: (status: string) => void;
  onStatus: (item: TrackerItem, status: string) => void;
}) {
  const [dragged, setDragged] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const options = board.statusField?.options || [];
  const columns = trackerColumns(board);
  // Columns that do not fit scroll sideways. A faded edge shows that more columns are there.
  const scroller = useRef<HTMLDivElement>(null);
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
  }, [columns.length]);
  return (
    <div
      ref={scroller}
      className="tracker-board"
      data-overflow-start={overflow.start || undefined}
      data-overflow-end={overflow.end || undefined}
      role="region"
      aria-label="Tracker board"
      aria-busy={busy}
      tabIndex={0}
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
            <div className="tracker-column-heading">
              <StatusIcon name={column.name} />
              <h4>{column.name}</h4>
              <span>
                <span aria-hidden="true">{tasks.length}</span>
                <span className="sr-only">{plural(tasks.length, 'task')}</span>
              </span>
              {onCreate && (
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
              )}
            </div>
            <div
              className="tracker-column-items"
              role={tasks.length ? 'list' : undefined}
              aria-label={tasks.length ? `${column.name} tasks` : undefined}
            >
              {tasks.map((item) => {
                const count = sessions.filter(
                  (session) =>
                    !session.organization?.archived && session.organization?.taskId === item.id,
                ).length;
                const statusName =
                  options.find((option) => option.id === item.statusId)?.name || 'No status';
                return (
                  // The title button is the only focus stop that opens the task. A
                  // pointer click on the card body also opens it. The status pill moves
                  // the task without drag and drop.
                  <Card
                    key={item.id}
                    role="listitem"
                    onClick={(event) => {
                      if (!(event.target as HTMLElement).closest('button, a, [role="menuitem"]'))
                        onOpen(item);
                    }}
                    draggable={!busy && !!board.statusField}
                    onDragStart={(event) => {
                      if ((event.target as HTMLElement).closest('button, [role="combobox"]')) {
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
                      <Button
                        variant="bare"
                        className="tracker-task-title max-w-full px-0 text-left text-sm leading-5 font-medium whitespace-normal break-words focus-visible:ring-0"
                        onClick={() => onOpen(item)}
                      >
                        {item.title}
                      </Button>
                      <p className="tracker-task-meta">
                        {item.repository
                          ? pathBasename(item.repository)
                          : 'Not linked to a repository'}
                        {item.number ? ` #${item.number}` : ''}
                      </p>
                      {(board.statusField || count > 0) && (
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
                          {count > 0 && (
                            <Badge variant="outline" size="sm">
                              <MessageSquare size={12} />
                              {plural(count, 'linked session')}
                            </Badge>
                          )}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
              {!tasks.length && <p className="tracker-column-empty">No tasks</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}
