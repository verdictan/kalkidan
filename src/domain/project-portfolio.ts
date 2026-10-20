import type { TrackerBoard, TrackerItem } from './tracker';
export interface PortfolioProject {
  groupId: string;
  board?: TrackerBoard;
  error?: string;
}
export function portfolioItems(projects: PortfolioProject[], login: string) {
  const owner = login.trim().toLowerCase();
  return projects.flatMap((project) =>
    (project.board?.items || [])
      .filter(
        (item) =>
          !owner ||
          (item.fieldValues || []).some(
            (value) =>
              Array.isArray(value.users) &&
              value.users.some((user) => String(user.login).toLowerCase() === owner),
          ),
      )
      .map((item) => ({ groupId: project.groupId, project: project.board!.project, item })),
  );
}
export function portfolioRisks(item: TrackerItem, now: number) {
  const notes: string[] = [];
  if (!item.repository) notes.push('No repository');
  if (!item.statusId) notes.push('No mapped status');
  for (const value of item.fieldValues || [])
    if (
      typeof value.date === 'string' &&
      Number.isFinite(Date.parse(value.date)) &&
      Date.parse(value.date) + 86400000 < now
    )
      notes.push(`${(value.field as { name?: string })?.name || 'Date field'} is in the past`);
  return notes;
}
