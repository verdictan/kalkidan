import type { TrackerBoard, TrackerItem } from '../types';
import type { SavedProjectView } from '../domain/github-resources';
import { projectFieldText, projectViewRows } from '../domain/project-view';
import { Button } from './ui/button';
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
    <article key={item.id} className="grid gap-2 rounded border bg-muted/30 p-3">
      <Button
        variant="bare"
        className="justify-start whitespace-normal text-left"
        onClick={() => onOpen(item)}
      >
        {item.title}
      </Button>
      {fields.map((field) => (
        <p className="text-xs text-muted-foreground" key={field.id}>
          <span>{field.name}: </span>
          {projectFieldText(item, field) || '—'}
        </p>
      ))}
    </article>
  );
  return (
    <section aria-label="Saved GitHub view" className="grid gap-5">
      <p className="help-text">
        {view.name}
        {view.filter ? ` · ${view.filter}` : ''}. Layout switches here are local. Edit the shared
        view in Board actions.
      </p>
      {projectViewRows(board, items, view).map((group) => {
        const names = column
          ? [
              ...new Set([
                ...(column.options || []).map((option) => option.name),
                ...group.items.map((item) => projectFieldText(item, column) || `No ${column.name}`),
              ]),
            ]
          : ['Items'];
        return (
          <section key={group.name} className="grid gap-2">
            {group.name && (
              <h3>
                {group.name} · {group.items.length}
              </h3>
            )}
            {mode === 'list' ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr>
                      <th className="p-2">Title</th>
                      {fields.map((field) => (
                        <th key={field.id} className="p-2">
                          {field.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {group.items.map((item) => (
                      <tr key={item.id} className="border-t">
                        <td className="p-2">
                          <Button variant="bare" onClick={() => onOpen(item)}>
                            {item.title}
                          </Button>
                        </td>
                        {fields.map((field) => (
                          <td key={field.id} className="p-2">
                            {projectFieldText(item, field) || '—'}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex gap-3 overflow-x-auto pb-3">
                {names.map((name) => (
                  <section key={name} className="grid w-64 shrink-0 content-start gap-2">
                    <h4>{name}</h4>
                    {group.items
                      .filter(
                        (item) =>
                          !column ||
                          (projectFieldText(item, column) || `No ${column.name}`) === name,
                      )
                      .map(card)}
                  </section>
                ))}
              </div>
            )}
          </section>
        );
      })}
    </section>
  );
}
