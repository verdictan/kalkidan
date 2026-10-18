import { StatusIcon, trackerColumns } from './tracker-list';
import { MessageSquare, Plus } from 'lucide-react';
import { useState } from 'react';
import type { TrackerBoard, TrackerItem, Session } from '../types';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { MoreHorizontal } from 'lucide-react';
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
  return (
    <div
      className="tracker-board"
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
              <span aria-label={`${tasks.length} tasks`}>{tasks.length}</span>
              {onCreate && (
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="tracker-column-add"
                  aria-label={`New item in ${column.name}`}
                  disabled={busy}
                  onClick={() => onCreate(column.id)}
                >
                  <Plus size={14} />
                </Button>
              )}
            </div>
            <div className="tracker-column-items">
              {tasks.map((item) => {
                const count = sessions.filter(
                  (session) =>
                    !session.organization?.archived && session.organization?.taskId === item.id,
                ).length;
                return (
                  <Card
                    key={item.id}
                    aria-label={`Task: ${item.title}`}
                    tabIndex={0}
                    onClick={(event) => {
                      if (!(event.target as HTMLElement).closest('button, a, [role="menuitem"]'))
                        onOpen(item);
                    }}
                    onKeyDown={(event) => {
                      if (
                        event.target === event.currentTarget &&
                        ['Enter', ' '].includes(event.key)
                      ) {
                        event.preventDefault();
                        onOpen(item);
                      }
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
                    className="tracker-task gap-2 rounded-lg py-3 shadow-none"
                  >
                    <CardContent className="space-y-2 px-3 pr-10">
                      <Button
                        variant="ghost"
                        className="h-auto max-w-full justify-start p-0 text-left text-[13px] font-medium whitespace-normal break-words leading-snug"
                        onClick={() => onOpen(item)}
                      >
                        {item.title}
                      </Button>
                      <p className="break-words text-xs text-muted-foreground">
                        {item.repository?.split('/').at(-1) || 'Draft item'}
                        {item.number ? ` #${item.number}` : ''}
                      </p>
                      {count > 0 && (
                        <Badge variant="outline">
                          <MessageSquare size={11} />
                          {count} linked {count === 1 ? 'session' : 'sessions'}
                        </Badge>
                      )}
                      {board.statusField && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              className="tracker-task-menu"
                              aria-label={`Move task: ${item.title}`}
                              disabled={busy}
                            >
                              <MoreHorizontal size={14} />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
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
                    </CardContent>
                  </Card>
                );
              })}
              {!tasks.length && (
                <p className="py-6 text-center text-xs text-muted-foreground">No tasks</p>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}
