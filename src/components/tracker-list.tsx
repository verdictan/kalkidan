import { Circle, CircleDashed, CircleCheck, CircleDot, MessageSquare } from 'lucide-react';
import type { TrackerBoard, TrackerItem, Session } from '../types';
import { Button } from './ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Choice } from './choice';
import { pathBasename, plural } from '../lib/platform';

export function StatusIcon({ name }: { name: string }) {
  if (/done|complete|closed/i.test(name))
    return <CircleCheck size={14} className="shrink-0 text-success" aria-hidden="true" />;
  if (/progress|doing|review/i.test(name))
    return <CircleDot size={14} className="shrink-0 text-warning" aria-hidden="true" />;
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
  // The first column starts at the page edge, in line with the filter bar.
  const firstCell = 'first:pl-0';
  return (
    <Table className="tracker-list table-fixed">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className={firstCell}>Title</TableHead>
          <TableHead className="w-[22%]">Repository</TableHead>
          <TableHead className="w-44">Status</TableHead>
        </TableRow>
      </TableHeader>
      {trackerColumns(board).map((column) => {
        const tasks = items.filter(
          (i) =>
            (board.statusField?.options.some((o) => o.id === i.statusId) ? i.statusId : '') ===
            column.id,
        );
        if (!tasks.length) return null;
        return (
          <TableBody key={column.id}>
            <TableRow className="tracker-list-group hover:bg-transparent">
              <th scope="rowgroup" colSpan={3} className="h-8 pl-0 text-left font-normal">
                <span className="flex items-center gap-2">
                  <StatusIcon name={column.name} />
                  <span className="text-sm font-semibold">{column.name}</span>
                  <span className="text-xs text-muted-foreground">{tasks.length}</span>
                </span>
              </th>
            </TableRow>
            {tasks.map((item) => {
              const count = sessions.filter(
                (s) => !s.organization?.archived && s.organization?.taskId === item.id,
              ).length;
              const hasStatus = board.statusField?.options.some((o) => o.id === item.statusId);
              return (
                <TableRow key={item.id} className="h-[var(--row-height-lg)]">
                  <TableCell className={`${firstCell} whitespace-normal`}>
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <Button
                        variant="bare"
                        className="min-w-0 px-0 text-left font-medium whitespace-normal break-words hover:underline"
                        onClick={() => onOpen(item)}
                      >
                        {item.title}
                      </Button>
                      {item.number ? (
                        <span className="text-xs text-muted-foreground tabular-nums">
                          #{item.number}
                        </span>
                      ) : null}
                      {count > 0 && (
                        <span
                          className="inline-flex shrink-0 items-center gap-1 text-xs text-muted-foreground"
                          title={plural(count, 'linked session')}
                        >
                          <MessageSquare size={12} aria-hidden="true" />
                          {count}
                          <span className="sr-only">{plural(count, 'linked session')}</span>
                        </span>
                      )}
                    </div>
                  </TableCell>
                  <TableCell
                    className="max-w-0 truncate text-muted-foreground"
                    title={item.repository || undefined}
                  >
                    {item.repository ? pathBasename(item.repository) : 'Not linked'}
                  </TableCell>
                  <TableCell>
                    {board.statusField && (
                      <Choice
                        size="sm"
                        variant="ghost"
                        className="-ml-2.5"
                        label={`Status for ${item.title}`}
                        value={hasStatus ? item.statusId || '' : ''}
                        disabled={busy}
                        options={[
                          // "No status" is a value only when the task has no status.
                          ...(!hasStatus ? [{ value: '', label: 'No status' }] : []),
                          ...board.statusField.options.map((o) => ({
                            value: o.id,
                            label: o.name,
                          })),
                        ]}
                        onChange={(value) => value && onStatus(item, value)}
                      />
                    )}
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
