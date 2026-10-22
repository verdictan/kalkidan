import type { Session } from './conversation';
import type { SettingsTab } from './settings-route';
/** 'board' is the project overview page (the old name is kept for saved routes). */
export type ProjectPage = 'board' | 'tasks' | 'chats' | 'knowledge';
/** The pages of the Knowledge tab. */
export type KnowledgeSection = 'pages' | 'memory' | 'insights';
/** The older project pages. Links and saved routes with them open Knowledge at a section. */
export type LegacyProjectPage = 'docs' | 'memory' | 'insights';
const legacySections: Record<LegacyProjectPage, KnowledgeSection> = {
  docs: 'pages',
  memory: 'memory',
  insights: 'insights',
};
/** The page and the Knowledge section of a page name, also of an older name. Else null. */
export function projectPageOf(
  value: unknown,
): { page: ProjectPage; section?: KnowledgeSection } | null {
  if (value === 'board' || value === 'tasks' || value === 'chats' || value === 'knowledge')
    return { page: value };
  if (value === 'docs' || value === 'memory' || value === 'insights')
    return { page: 'knowledge', section: legacySections[value] };
  return null;
}
export type WorkspacePage =
  | { kind: 'home' }
  | { kind: 'sessions' }
  | { kind: 'computers' }
  /** The one "Waiting for you" inbox: chats and assigned tasks. */
  | { kind: 'waiting' }
  | { kind: 'project'; groupId: string; page: ProjectPage; section?: KnowledgeSection }
  | { kind: 'repository'; repositoryId: string }
  | { kind: 'settings'; tab: SettingsTab };
export type WorkspaceRoute =
  | WorkspacePage
  | { kind: 'conversation'; session: Session; repositoryId?: string; parent: WorkspacePage };
export function routeKey(route: WorkspaceRoute): string {
  switch (route.kind) {
    case 'home':
    case 'sessions':
    case 'computers':
    case 'waiting':
      return route.kind;
    case 'project':
      return `project:${route.groupId}:${route.page}`;
    case 'repository':
      return `repository:${route.repositoryId}`;
    case 'settings':
      return `settings:${route.tab}`;
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

/** A route that the app saves between launches. A chat is saved by its agent and ID. */
export type SavedRoute =
  | WorkspacePage
  | { kind: 'conversation'; agent: string; id: string; hostId?: string; parent: WorkspacePage };
const pageKinds = new Set(['home', 'sessions', 'computers', 'waiting', 'project', 'repository']);
export function saveableRoute(route: WorkspaceRoute): SavedRoute | null {
  // Settings is not a place to return to after a launch.
  if (route.kind === 'settings') return null;
  if (route.kind !== 'conversation') return route;
  const parent: WorkspacePage = route.parent.kind === 'settings' ? { kind: 'home' } : route.parent;
  // A draft has no saved file. Reopen its parent page.
  if (route.session.id.startsWith('draft-')) return parent;
  return {
    kind: 'conversation',
    agent: route.session.agent,
    id: route.session.id,
    hostId: route.session.hostId,
    parent,
  };
}
function readPage(value: unknown): WorkspacePage | null {
  if (!value || typeof value !== 'object') return null;
  const page = value as Record<string, unknown>;
  if (!pageKinds.has(page.kind as string)) return null;
  if (page.kind === 'project') {
    // A route saved by an older version can name 'docs', 'memory' or 'insights'.
    const target = projectPageOf(page.page);
    if (typeof page.groupId !== 'string' || !target) return null;
    const section = target.section || projectPageOf(page.section)?.section;
    return {
      kind: 'project',
      groupId: page.groupId,
      page: target.page,
      ...(target.page === 'knowledge' && section ? { section } : {}),
    };
  }
  if (page.kind === 'repository')
    return typeof page.repositoryId === 'string'
      ? { kind: 'repository', repositoryId: page.repositoryId }
      : null;
  return { kind: page.kind as 'home' | 'sessions' | 'computers' | 'waiting' };
}
/**
 * The saved route when its project, code folder and chat still exist. Else the nearest page
 * that exists, or null.
 */
export function restoreRoute(
  value: unknown,
  groups: readonly { id: string }[],
  repositories: readonly { id: string }[],
  sessions: readonly Session[],
): WorkspaceRoute | null {
  if (!value || typeof value !== 'object') return null;
  const saved = value as Record<string, unknown>;
  if (saved.kind === 'conversation') {
    const parent = readPage(saved.parent) || { kind: 'home' };
    const session = sessions.find(
      (s) =>
        s.agent === saved.agent && s.id === saved.id && (s.hostId || '') === (saved.hostId || ''),
    );
    if (!session) return reconcileRoute(parent, groups, repositories);
    return reconcileRoute({ kind: 'conversation', session, parent }, groups, repositories);
  }
  const page = readPage(saved);
  return page ? reconcileRoute(page, groups, repositories) : null;
}
