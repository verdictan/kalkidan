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
export type PortfolioRiskCode = 'no-repository' | 'no-status' | 'past-date';
export interface PortfolioRisk {
  code: PortfolioRiskCode;
  label: string;
}
/** Words for each risk code, for the filter chips. */
export const portfolioRiskLabels: Record<PortfolioRiskCode, string> = {
  'no-repository': 'No repository',
  'no-status': 'No status',
  'past-date': 'Date in the past',
};
/** Review hints for a task. A past date is a hint, not a deadline. */
export function portfolioRisks(item: TrackerItem, now: number): PortfolioRisk[] {
  const notes: PortfolioRisk[] = [];
  if (!item.repository) notes.push({ code: 'no-repository', label: 'No repository' });
  if (!item.statusId) notes.push({ code: 'no-status', label: 'No status' });
  for (const value of item.fieldValues || [])
    if (
      typeof value.date === 'string' &&
      Number.isFinite(Date.parse(value.date)) &&
      Date.parse(value.date) + 86400000 < now
    )
      notes.push({
        code: 'past-date',
        label: `${(value.field as { name?: string })?.name || 'Date'} is in the past`,
      });
  return notes;
}
