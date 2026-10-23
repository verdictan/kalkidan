import type { Session } from './conversation';
import type { SettingsTab } from './settings-route';
/**
 * The views of a project, in the order of the view switch: Overview ('board', the old name is
 * kept for saved routes), Tasks and Knowledge. A project has no Chats view: its chats are in
 * the sidebar tree and in search.
 */
export type ProjectPage = 'board' | 'tasks' | 'knowledge';
/** The pages of the Knowledge tab. */
export type KnowledgeSection = 'pages' | 'memory' | 'insights';
/**
 * The older project pages. Links and saved routes with them open Knowledge at a section, or
 * Overview for the removed Chats tab.
 */
export type LegacyProjectPage = 'docs' | 'memory' | 'insights' | 'chats';
const legacySections: Record<'docs' | 'memory' | 'insights', KnowledgeSection> = {
  docs: 'pages',
  memory: 'memory',
  insights: 'insights',
};
/** The page and the Knowledge section of a page name, also of an older name. Else null. */
export function projectPageOf(
  value: unknown,
): { page: ProjectPage; section?: KnowledgeSection } | null {
  if (value === 'board' || value === 'tasks' || value === 'knowledge') return { page: value };
  // The Chats tab is gone. Its links open the Overview of the project.
  if (value === 'chats') return { page: 'board' };
  if (value === 'docs' || value === 'memory' || value === 'insights')
    return { page: 'knowledge', section: legacySections[value] };
  return null;
}
export type WorkspacePage =
  /** The Projects page: the root of the tree. */
  | { kind: 'home' }
  | { kind: 'project'; groupId: string; page: ProjectPage; section?: KnowledgeSection }
  /** The one Settings page (Mod+,). */
  | { kind: 'settings'; tab: SettingsTab };
export type WorkspaceRoute =
  | WorkspacePage
  | { kind: 'conversation'; session: Session; repositoryId?: string; parent: WorkspacePage };
export function routeKey(route: WorkspaceRoute): string {
  switch (route.kind) {
    case 'home':
      return route.kind;
    case 'project':
      return `project:${route.groupId}:${route.page}`;
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
    page.kind === 'project' ? groups.some((group) => group.id === page.groupId) : true;
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
/** Page kinds of this and older versions. The older ones open their nearest page. */
const pageKinds = new Set(['home', 'sessions', 'computers', 'waiting', 'project', 'repository']);
/**
 * The project page of a page name and a Knowledge section. Knowledge has no Insights any more:
 * its board health and GitHub checks are on Tasks, so an Insights route opens Tasks.
 */
export function projectTarget(
  page: unknown,
  section?: unknown,
): { page: ProjectPage; section?: KnowledgeSection } | null {
  const target = projectPageOf(page);
  if (!target) return null;
  const knowledge = target.section || projectPageOf(section)?.section;
  if (target.page !== 'knowledge') return { page: target.page };
  if (knowledge === 'insights') return { page: 'tasks' };
  return knowledge ? { page: 'knowledge', section: knowledge } : { page: 'knowledge' };
}
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
type GroupRef = { id: string; repoIds?: readonly string[] };
function readPage(value: unknown, groups: readonly GroupRef[]): WorkspacePage | null {
  if (!value || typeof value !== 'object') return null;
  const page = value as Record<string, unknown>;
  if (!pageKinds.has(page.kind as string)) return null;
  if (page.kind === 'project') {
    // A route saved by an older version can name 'docs', 'memory', 'insights' or 'chats'.
    const target = projectTarget(page.page, page.section);
    if (typeof page.groupId !== 'string' || !target) return null;
    return { kind: 'project', groupId: page.groupId, ...target };
  }
  // The code folder page is gone: the code folder is a row of the tree. Open its project.
  if (page.kind === 'repository') {
    if (typeof page.repositoryId !== 'string') return null;
    const group = groups.find((item) => item.repoIds?.includes(page.repositoryId as string));
    return group ? { kind: 'project', groupId: group.id, page: 'board' } : { kind: 'home' };
  }
  // Computers, Chats and Waiting for you are not pages any more. Open Projects.
  return { kind: 'home' };
}
/**
 * The saved route when its project, code folder and chat still exist. Else the nearest page
 * that exists, or null.
 */
export function restoreRoute(
  value: unknown,
  groups: readonly GroupRef[],
  repositories: readonly { id: string }[],
  sessions: readonly Session[],
): WorkspaceRoute | null {
  if (!value || typeof value !== 'object') return null;
  const saved = value as Record<string, unknown>;
  if (saved.kind === 'conversation') {
    const parent = readPage(saved.parent, groups) || { kind: 'home' };
    const session = sessions.find(
      (s) =>
        s.agent === saved.agent && s.id === saved.id && (s.hostId || '') === (saved.hostId || ''),
    );
    if (!session) return reconcileRoute(parent, groups, repositories);
    return reconcileRoute({ kind: 'conversation', session, parent }, groups, repositories);
  }
  const page = readPage(saved, groups);
  return page ? reconcileRoute(page, groups, repositories) : null;
}
