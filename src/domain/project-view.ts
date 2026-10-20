import type { TrackerBoard, TrackerItem, TrackerField } from './tracker';
import type { SavedProjectView } from './github-resources';
export function projectFieldText(item: TrackerItem, field: TrackerField): string {
  if (field.dataType === 'TITLE') return item.title;
  if (field.dataType === 'REPOSITORY') return item.repository || '';
  const value = item.fieldValues?.find(
    (value) => (value.field as { id?: string })?.id === field.id,
  );
  if (!value) return '';
  for (const key of ['labels', 'users', 'pullRequests', 'reviewers'])
    if (Array.isArray(value[key]))
      return value[key]
        .map((entry) => entry.name || entry.login || entry.title || entry.slug || 'Unavailable')
        .join(', ');
  for (const key of ['milestone', 'repository']) {
    const entry = value[key] as { title?: string; nameWithOwner?: string } | undefined;
    if (entry) return entry.title || entry.nameWithOwner || '';
  }
  for (const key of ['text', 'number', 'date', 'name', 'title'])
    if (typeof value[key] === 'string' || typeof value[key] === 'number') return String(value[key]);
  if (Array.isArray(value.options)) return value.options.map((option) => option.name).join(', ');
  return 'Open item for this field';
}
export function projectViewRows(board: TrackerBoard, items: TrackerItem[], view: SavedProjectView) {
  const field = (id: string) => board.fields?.find((field) => field.id === id);
  const compare = (a: TrackerItem, b: TrackerItem) => {
    for (const order of view.sortFields || []) {
      const definition = field(order.id);
      if (!definition) continue;
      const x = projectFieldText(a, definition),
        y = projectFieldText(b, definition);
      if (!x || !y) {
        if (x !== y) return x ? -1 : 1;
        continue;
      }
      const result =
        definition.dataType === 'NUMBER'
          ? Number(x) - Number(y)
          : x.localeCompare(y, undefined, { numeric: true });
      if (result) return order.direction === 'DESC' ? -result : result;
    }
    return view.itemIds.indexOf(a.id) - view.itemIds.indexOf(b.id);
  };
  const groups = new Map<string, TrackerItem[]>();
  for (const item of [...items].sort(compare)) {
    const name = (view.groupFieldIds || [])
      .map((id) => {
        const f = field(id);
        return f ? projectFieldText(item, f) || `No ${f.name}` : 'Unavailable group field';
      })
      .join(' · ');
    groups.set(name, [...(groups.get(name) || []), item]);
  }
  return [...groups].map(([name, items]) => ({ name, items }));
}
