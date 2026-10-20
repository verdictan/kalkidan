import type { Session } from './conversation';
export type ProjectPage = 'board' | 'docs' | 'tasks' | 'memory';
export type WorkspacePage =
  | { kind: 'home' }
  | { kind: 'sessions' }
  | { kind: 'project'; groupId: string; page: ProjectPage }
  | { kind: 'repository'; repositoryId: string };
export type WorkspaceRoute =
  | WorkspacePage
  | { kind: 'conversation'; session: Session; repositoryId?: string; parent: WorkspacePage };
export function routeKey(route: WorkspaceRoute): string {
  switch (route.kind) {
    case 'home':
    case 'sessions':
      return route.kind;
    case 'project':
      return `project:${route.groupId}:${route.page}`;
    case 'repository':
      return `repository:${route.repositoryId}`;
    case 'conversation':
      return JSON.stringify([
        'conversation',
        route.session.hostId || '',
        route.session.agent,
        route.session.id,
      ]);
  }
}
export function reconcileRoute(
  route: WorkspaceRoute,
  groups: readonly { id: string }[],
  repositories: readonly { id: string }[],
): WorkspaceRoute {
  const valid = (page: WorkspacePage) =>
    page.kind === 'project'
      ? groups.some((group) => group.id === page.groupId)
      : page.kind === 'repository'
        ? repositories.some((repo) => repo.id === page.repositoryId)
        : true;
  if (route.kind === 'conversation') {
    if (route.repositoryId && !repositories.some((repo) => repo.id === route.repositoryId))
      return { kind: 'home' };
    return valid(route.parent) ? route : { ...route, parent: { kind: 'home' } };
  }
  return valid(route) ? route : { kind: 'home' };
}
export function resolveRouteSession(
  route: WorkspaceRoute,
  before: Session,
  after: Session,
): WorkspaceRoute {
  return route.kind === 'conversation' &&
    route.session.agent === before.agent &&
    route.session.id === before.id &&
    route.session.hostId === before.hostId
    ? { ...route, session: after }
    : route;
}
