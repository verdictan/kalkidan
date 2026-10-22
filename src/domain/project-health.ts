import type { TrackerBoard } from './tracker';
export function projectHealthReport(board: TrackerBoard, now: number): string {
  const counts = new Map<string, number>();
  for (const item of board.items)
    counts.set(item.status || 'No status', (counts.get(item.status || 'No status') || 0) + 1);
  const quote = (value: string) =>
    value.replace(/[\r\n]/g, ' ').replace(/[\\`*_{}[\]()<>#!|]/g, '\\$&');
  return [
    `# ${quote(board.project.title)} — project snapshot`,
    `Recorded: ${new Date(now).toISOString()}`,
    `Source: ${board.project.url}`,
    '',
    `${board.items.length} active items; ${board.archivedItems?.length || 0} archived items; ${board.restrictedItems || 0} restricted items.`,
    '',
    '## Status distribution',
    ...[...counts].map(([name, count]) => `- ${quote(name)}: ${count}`),
    '',
    '## Repository workload',
    ...[...new Set(board.items.map((item) => item.repository || 'Unassigned repository'))].map(
      (repo) =>
        `- ${quote(repo)}: ${board.items.filter((item) => (item.repository || 'Unassigned repository') === repo).length}`,
    ),
    '',
    'This is a current snapshot. It does not measure throughput or cycle time. Restricted item content is excluded.',
  ].join('\n');
}

/**
 * The status values of a GitHub project status update, with plain words and a StatusDot tone:
 * done and on track are green, at risk is amber, off track is red, the others are gray.
 */
export const healthStatuses = [
  { value: 'ON_TRACK', label: 'On track', tone: 'success' },
  { value: 'AT_RISK', label: 'At risk', tone: 'warning' },
  { value: 'OFF_TRACK', label: 'Off track', tone: 'danger' },
  { value: 'INACTIVE', label: 'Inactive', tone: 'neutral' },
  { value: 'COMPLETE', label: 'Complete', tone: 'success' },
] as const;
export type HealthStatus = (typeof healthStatuses)[number]['value'];

/** One count in the health summary. `filter` uses the values of the Tasks filter bar. */
export interface HealthCount {
  label: string;
  count: number;
  filter: { status?: string; repository?: string };
}

/** Task counts for each status, then the tasks with no status and no repository. */
export function projectHealthCounts(board: TrackerBoard): HealthCount[] {
  const options = board.statusField?.options || [];
  const rows: HealthCount[] = options.map((option) => ({
    label: option.name,
    count: board.items.filter((item) => item.statusId === option.id).length,
    filter: { status: option.id },
  }));
  const known = new Set(options.map((option) => option.id));
  // Statuses that the status field does not list, for example on an old snapshot.
  for (const item of board.items)
    if (item.statusId && !known.has(item.statusId)) {
      known.add(item.statusId);
      rows.push({
        label: item.status || 'Other status',
        count: board.items.filter((value) => value.statusId === item.statusId).length,
        filter: { status: item.statusId },
      });
    }
  rows.push({
    label: 'No status',
    count: board.items.filter((item) => !item.statusId).length,
    filter: { status: 'none' },
  });
  rows.push({
    label: 'No repository',
    count: board.items.filter((item) => !item.repository).length,
    filter: { repository: 'draft' },
  });
  return rows;
}
