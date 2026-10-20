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
