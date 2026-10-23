import type { KnowledgeSection, LegacyProjectPage, ProjectPage } from '../domain/workspace-route';
import { shortcutLabel } from '../lib/platform';

/**
 * The views of a project, in the order of the view switch in the header. Mod+1 to Mod+3 open
 * them in this order. A project has no Chats view: its chats are in the tree and in search.
 */
export const projectTabs: { page: ProjectPage; label: string; shortcut: string }[] = [
  { page: 'board', label: 'Overview', shortcut: shortcutLabel(['mod'], '1') },
  { page: 'tasks', label: 'Tasks', shortcut: shortcutLabel(['mod'], '2') },
  { page: 'knowledge', label: 'Knowledge', shortcut: shortcutLabel(['mod'], '3') },
];

/**
 * Opens a view of a project. The shell listens for this event and changes the route. The older
 * names 'docs', 'memory' and 'insights' open Knowledge at that section; 'chats' opens Overview.
 */
export function openProjectPage(
  groupId: string,
  page: ProjectPage | LegacyProjectPage,
  extra?: {
    docId?: string;
    topic?: string;
    heading?: string;
    taskId?: string;
    section?: KnowledgeSection;
  },
) {
  window.dispatchEvent(
    new CustomEvent('kalkidan-open-project-page', { detail: { groupId, page, ...extra } }),
  );
}
