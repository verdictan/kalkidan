import { Circle, CircleDashed, CircleCheck, CircleDot, MessageSquare } from 'lucide-react';
import { Fragment } from 'react';
import type { TrackerBoard, TrackerItem, Session } from '../types';
import { Button } from './ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Choice } from './choice';
import { plural } from '../lib/platform';

export function StatusIcon({ name }: { name: string }) {
  if (/done|complete|closed/i.test(name))
    return <CircleCheck size={14} className="shrink-0 text-[var(--success)]" aria-hidden="true" />;
  if (/progress|doing|review/i.test(name))
    return <CircleDot size={14} className="shrink-0 text-[var(--warning)]" aria-hidden="true" />;
  if (/backlog|no status/i.test(name))
    return <CircleDashed size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />;
  return <Circle size={14} className="shrink-0 text-muted-foreground" aria-hidden="true" />;
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
export function TrackerList({
  board,
  items,
  sessions,
  busy,
  onOpen,
  onStatus,
}: {
  board: TrackerBoard;
  items: TrackerItem[];
  sessions: Session[];
  busy: boolean;
  onOpen: (item: TrackerItem) => void;
  onStatus: (item: TrackerItem, status: string) => void;
}) {
  return (
    <Table className="tracker-list">
      <TableHeader className="sr-only">
        <TableRow>
          <TableHead>Task</TableHead>
          <TableHead>Repository</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Action</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {trackerColumns(board).map((column) => {
          const tasks = items.filter(
            (i) =>
              (board.statusField?.options.some((o) => o.id === i.statusId) ? i.statusId : '') ===
              column.id,
          );
          if (!tasks.length) return null;
          return (
            <Fragment key={column.id}>
              <TableRow className="tracker-list-group">
                <TableCell colSpan={4}>
                  <span className="flex items-center gap-2">
                    <StatusIcon name={column.name} />
                    <strong className="text-xs font-medium">{column.name}</strong>
                    <span className="text-xs text-muted-foreground">{tasks.length}</span>
                  </span>
                </TableCell>
              </TableRow>
              {tasks.map((item) => {
                const count = sessions.filter(
                  (s) => !s.organization?.archived && s.organization?.taskId === item.id,
                ).length;
                return (
                  <TableRow key={item.id}>
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <span className="w-12 shrink-0 text-xs text-muted-foreground">
                          {item.number ? `#${item.number}` : 'Draft task'}
                        </span>
                        <Button
                          variant="ghost"
                          className="h-auto justify-start whitespace-normal px-0 py-1.5 text-left text-[13px] font-normal"
                          onClick={() => onOpen(item)}
                        >
                          {item.title}
                        </Button>
                        {count > 0 && (
                          <span
                            className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
                            title={plural(count, 'linked session')}
                          >
                            <MessageSquare size={12} />
                            {count}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {item.repository || '—'}
                    </TableCell>
                    <TableCell>
                      {board.statusField && (
                        <Choice
                          className="h-7 border-transparent bg-transparent text-xs shadow-none"
                          label={`Status for ${item.title}`}
                          value={item.statusId || ''}
                          disabled={busy}
                          options={[
                            { value: '', label: 'No status' },
                            ...board.statusField.options.map((o) => ({
                              value: o.id,
                              label: o.name,
                            })),
                          ]}
                          onChange={(value) => value && onStatus(item, value)}
                        />
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-label={`Work on this task: ${item.title}`}
                        onClick={() => onOpen(item)}
                      >
                        Work on this task
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}
