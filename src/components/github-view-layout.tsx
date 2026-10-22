import { useRef, type ReactNode } from 'react';
import { ListFilter } from 'lucide-react';
import type { TrackerBoard, TrackerItem } from '../types';
import type { SavedProjectView } from '../domain/github-resources';
import { projectFieldText, projectViewRows } from '../domain/project-view';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Card, CardContent } from './ui/card';
import { SectionHeader } from './ui/page-header';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Hint } from './hint';
import { BoardColumnHeading, useScrollShadow } from './tracker-board';

/**
 * The filter of a saved GitHub view as a chip next to the view picker. The tooltip tells that
 * GitHub applies the filter and that layout changes here are local.
 */
export function SavedViewFilterChip({ view }: { view: SavedProjectView }) {
  const help =
    'GitHub applies the filter of this view. A layout change here stays on this computer. ' +
    'To change the shared view, open Board settings › Views.';
  return (
    <Hint label={help}>
      <Badge
        variant="muted"
        size="md"
        className="tracker-view-filter max-w-64"
        tabIndex={0}
        aria-label={view.filter ? `Filter: ${view.filter}. ${help}` : `No filter. ${help}`}
      >
        <ListFilter aria-hidden="true" />
        <span className="truncate font-mono">{view.filter || 'No filter'}</span>
      </Badge>
    </Hint>
  );
}

function SavedViewBoard({
  names,
  items,
  matches,
  card,
}: {
  names: string[];
  items: TrackerItem[];
  matches: (item: TrackerItem, name: string) => boolean;
  card: (item: TrackerItem) => ReactNode;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const shadow = useScrollShadow(scroller, names.length);
  return (
    <div ref={scroller} className="tracker-board" {...shadow} role="region" aria-label="View board">
      {names.map((name) => {
        const tasks = items.filter((item) => matches(item, name));
        return (
          <section key={name} className="tracker-column" aria-label={`${name} column`}>
            <BoardColumnHeading name={name} count={tasks.length} />
            <div
              className="tracker-column-items"
              role={tasks.length ? 'list' : undefined}
              aria-label={tasks.length ? `${name} tasks` : undefined}
            >
              {tasks.map(card)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

export function GitHubViewLayout({
  board,
  items,
  view,
  mode,
  onOpen,
}: {
  board: TrackerBoard;
  items: TrackerItem[];
  view: SavedProjectView;
  mode: 'board' | 'list';
  onOpen: (item: TrackerItem) => void;
}) {
  const fields = (view.visibleFieldIds || []).flatMap(
    (id) => board.fields?.filter((field) => field.id === id && field.dataType !== 'TITLE') || [],
  );
  const column = board.fields?.find((field) => field.id === view.columnFieldIds?.[0]);
  const card = (item: TrackerItem) => (
    <Card
      key={item.id}
      role="listitem"
      className="tracker-task gap-0 has-[.tracker-task-title:focus-visible]:shadow-[var(--focus-ring)]"
      onClick={(event) => {
        if (!(event.target as HTMLElement).closest('button, a')) onOpen(item);
      }}
    >
      <CardContent className="flex flex-col items-start gap-1 p-0">
        <Button
          variant="bare"
          className="tracker-task-title max-w-full px-0 text-left text-sm leading-5 font-medium whitespace-normal break-words focus-visible:ring-0"
          data-task-focus={item.id}
          onClick={() => onOpen(item)}
        >
          {item.title}
        </Button>
        {fields.length > 0 && (
          <dl className="tracker-view-fields">
            {fields.map((field) => (
              <div key={field.id}>
                <dt>{field.name}</dt>
                <dd>{projectFieldText(item, field) || '—'}</dd>
              </div>
            ))}
          </dl>
        )}
      </CardContent>
    </Card>
  );
  const groups = projectViewRows(board, items, view);
  return (
    <section aria-label={`Saved GitHub view: ${view.name}`} className="tracker-saved-view">
      {groups.map((group) => {
        const names = column
          ? [
              ...new Set([
                ...(column.options || []).map((option) => option.name),
                ...group.items.map((item) => projectFieldText(item, column) || `No ${column.name}`),
              ]),
            ]
          : ['Items'];
        return (
          <section key={group.name} className="tracker-saved-view-group">
            {group.name && (
              <SectionHeader size="sm" title={group.name} count={group.items.length} />
            )}
            {mode === 'list' ? (
              <Table className="tracker-list table-fixed">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="first:pl-0">Title</TableHead>
                    {fields.map((field) => (
                      <TableHead key={field.id} className="w-[18%]">
                        {field.name}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.items.map((item) => (
                    <TableRow key={item.id} className="h-[var(--row-height-lg)]">
                      <TableCell className="whitespace-normal first:pl-0">
                        <Button
                          variant="bare"
                          className="min-w-0 px-0 text-left font-medium whitespace-normal break-words hover:underline"
                          data-task-focus={item.id}
                          onClick={() => onOpen(item)}
                        >
                          {item.title}
                        </Button>
                      </TableCell>
                      {fields.map((field) => {
                        const text = projectFieldText(item, field);
                        return (
                          <TableCell
                            key={field.id}
                            className="max-w-0 truncate text-muted-foreground"
                            title={text || undefined}
                          >
                            {text || '—'}
                          </TableCell>
                        );
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <SavedViewBoard
                names={names}
                items={group.items}
                card={card}
                matches={(item, name) =>
                  !column || (projectFieldText(item, column) || `No ${column.name}`) === name
                }
              />
            )}
          </section>
        );
      })}
    </section>
  );
}
