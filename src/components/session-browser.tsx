import {
  ActivityDot,
  activityKey,
  useActivityState,
  useChatStatus,
  waitsForUser,
  type SessionActivityState,
} from './activity-dot';
import { useEffect, useState, type ReactNode } from 'react';
import { ArchiveRestore, GitBranch, MessagesSquare, Pin } from 'lucide-react';
import { agentCatalog, agentLabel } from '../config/agents';
import { fullTime, relativeTime } from '../lib/relative-time';
import { plural } from '../lib/platform';
import { Choice } from './choice';
import { ChatActionsDropdown, ChatContextMenu } from './chat-action-menu';
import { useChatListActions } from './chat-list-actions';
import { AgentIcon } from './ui/agent-icon';
import { Button } from './ui/button';
import { EmptyState } from './ui/empty-state';
import { EntityIcon } from './ui/entity-icon';
import { SearchInput } from './ui/search-input';
import { SegmentedControl } from './ui/segmented-control';
import type { API, Session, SessionOrganization, TrackerItem } from '../types';

interface Props {
  /** The API for rename and archive. A remote session uses the API of its host. */
  api?: API;
  /** Reads the sessions again after a rename, an archive or an undo. */
  onChanged?: () => void;
  sessions: Session[];
  query?: string;
  /**
   * With it, the filter row starts with a search field. Every chat list puts its search there,
   * first on the left.
   */
  onQueryChange?: (query: string) => void;
  /** Controls at the right end of the filter row, such as "New chat". */
  actions?: ReactNode;
  compact?: boolean;
  busy: boolean;
  onUpdate: (session: Session, changes: SessionOrganization) => Promise<boolean>;
  onResume: (session: Session) => void;
  /** Key that keeps the view and filters for one repository. */
  storageKey?: string;
  /** Background state of open sessions, by `activityKey`. */
  activity?: Record<string, SessionActivityState>;
  /** The branch copy of a session, shown as a badge on sessions of a branch copy. */
  branchOf?: (session: Session) => string | undefined;
  /** The project and code folder of each session. With it, the list shows a Project filter. */
  placeOf?: (session: Session) => { project?: string; folder?: string } | undefined;
  /**
   * The place that the place filter uses. 'folder' filters by code folder, for the chats of one
   * project. Rows then show the code folder only when there is more than one.
   */
  filterBy?: 'project' | 'folder';
  /** The board item that a chat works on. Rows show "#12" and the list a Task filter. */
  taskOf?: (session: Session) => TrackerItem | undefined;
  /** Opens the task that a chat works on. */
  onOpenTask?: (session: Session, task: TrackerItem) => void;
  /** Opens a chat, then runs a session command in it, such as "session-commit". */
  onSessionCommand?: (command: string, session: Session) => void;
  /** True for the chat that is open in this window. Its menu has no Open. */
  isOpen?: (session: Session) => boolean;
}
interface SavedView {
  agent: string;
  scope: string;
  project: string;
  task: string;
}
// Older versions saved a group filter. The list does not use it.
const defaultView: SavedView = {
  agent: 'all',
  scope: 'active',
  project: 'all',
  task: 'all',
};
/** Filters show only for longer lists, or when more than one agent made the sessions. */
const filterThreshold = 8;
function readView(key: string | undefined): SavedView {
  if (!key) return defaultView;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null') as Partial<SavedView> | null;
    return { ...defaultView, ...(saved && typeof saved === 'object' ? saved : {}) };
  } catch {
    return defaultView;
  }
}
/** The storage key of the saved view for one list. */
export const sessionViewKey = (key: string) => `kalkidan.sessionView.${key}`;
/** Shows the archived sessions of a list, for example from the "View archived" toast action. */
export function viewArchivedSessions(key: string) {
  try {
    localStorage.setItem(
      sessionViewKey(key),
      JSON.stringify({ ...readView(sessionViewKey(key)), scope: 'archived' }),
    );
  } catch {
    // Storage is not available. The event below still changes an open list.
  }
  window.dispatchEvent(new CustomEvent('kalkidan-view-archived', { detail: { key } }));
}
export function SessionBrowser({
  api,
  onChanged,
  sessions,
  query = '',
  onQueryChange,
  actions,
  compact = false,
  busy,
  onUpdate,
  onResume,
  storageKey,
  activity = {},
  branchOf,
  placeOf,
  filterBy = 'project',
  taskOf,
  onOpenTask,
  onSessionCommand,
  isOpen,
}: Props) {
  const placeName = (session: Session) => {
    const place = placeOf?.(session);
    return filterBy === 'folder' ? place?.folder : place?.project;
  };
  const { finished } = useActivityState();
  const chatStatus = useChatStatus();
  const statusOf = (session: Session) =>
    chatStatus(session, activity[activityKey(session.agent, session.id)]);
  /** True when the chat waits for an approval or an answer, or finished and is not seen. */
  const waiting = (session: Session) =>
    waitsForUser(activity[activityKey(session.agent, session.id)]) ||
    finished.some((item) => item.agent === session.agent && item.id === session.id);
  const listKey = storageKey ?? sessions[0]?.projectId;
  const repositoryKey = listKey ? sessionViewKey(listKey) : undefined;
  const [loadedKey, setLoadedKey] = useState(repositoryKey);
  const [view, setView] = useState(() => readView(repositoryKey));
  // Load the saved view again when the user goes to a different repository.
  if (loadedKey !== repositoryKey) {
    setLoadedKey(repositoryKey);
    setView(readView(repositoryKey));
  }
  const { agent, scope, project, task } = view;
  useEffect(() => {
    if (!loadedKey) return;
    try {
      localStorage.setItem(loadedKey, JSON.stringify(view));
    } catch {
      // Storage is not available. The view stays for this window only.
    }
  }, [loadedKey, view]);
  useEffect(() => {
    const onView = (event: Event) => {
      if ((event as CustomEvent<{ key?: string }>).detail?.key === listKey)
        setView((previous) => ({ ...previous, scope: 'archived' }));
    };
    window.addEventListener('kalkidan-view-archived', onView);
    return () => window.removeEventListener('kalkidan-view-archived', onView);
  }, [listKey]);
  const setAgent = (value: string) => setView((previous) => ({ ...previous, agent: value }));
  const setScope = (value: string) => setView((previous) => ({ ...previous, scope: value }));
  const setProject = (value: string) => setView((previous) => ({ ...previous, project: value }));
  const setTask = (value: string) => setView((previous) => ({ ...previous, task: value }));
  const linkedCount = taskOf ? sessions.filter((s) => !!taskOf(s)).length : 0;
  const waitingCount = sessions.filter((s) => !s.organization?.archived && waiting(s)).length;
  // Chats whose latest run failed or was refused. A running chat shows its live state instead.
  const outcomeCount = (kind: 'failed' | 'refused') =>
    sessions.filter((s) => !s.organization?.archived && statusOf(s)?.state === kind).length;
  const failedCount = outcomeCount('failed');
  const refusedCount = outcomeCount('refused');
  const { menuFor, dialogs } = useChatListActions({
    api,
    onResume,
    onSessionCommand,
    onChanged,
    // The list saves with its own update, so it shows its busy state and its errors.
    update: async (session, changes) => {
      if (!(await onUpdate(session, { ...session.organization, ...changes })))
        throw new Error('The chat did not change. Try again.');
    },
    onViewArchived: listKey ? () => viewArchivedSessions(listKey) : undefined,
    onOpenTask: onOpenTask
      ? (session) => {
          const linked = taskOf?.(session);
          if (linked) onOpenTask(session, linked);
          else onSessionCommand?.('open-linked-task', session);
        }
      : undefined,
    stateOf: (session) => ({
      open: !!isOpen?.(session),
      running: !!activity[activityKey(session.agent, session.id)],
      linkedTask: !!(taskOf?.(session) || session.organization?.taskId || session.task?.id),
      repository: placeOf ? !!placeOf(session)?.folder : undefined,
      project: placeOf ? !!placeOf(session)?.project : undefined,
    }),
  });
  const projects = placeOf
    ? [
        ...new Set(sessions.map((s) => placeName(s)).filter((name): name is string => !!name)),
      ].sort()
    : [];
  const agents = new Set(sessions.map((s) => s.agent));
  const archivedCount = sessions.filter((s) => s.organization?.archived).length;
  // A short list from one agent needs no filters. A saved filter keeps them visible.
  const showFilters =
    !compact &&
    (sessions.length >= filterThreshold ||
      agents.size > 1 ||
      projects.length > 1 ||
      linkedCount > 0 ||
      waitingCount > 0 ||
      failedCount > 0 ||
      refusedCount > 0 ||
      scope !== 'active' ||
      agent !== 'all' ||
      project !== 'all' ||
      task !== 'all');
  const list = sessions
    .filter((session) => {
      const org = session.organization || {};
      return (
        (compact
          ? !org.archived
          : (agent === 'all' || session.agent === agent) &&
            (scope === 'archived'
              ? org.archived
              : !org.archived &&
                (scope !== 'pinned' || org.pinned) &&
                (scope !== 'waiting' || waiting(session)) &&
                (scope !== 'failed' || statusOf(session)?.state === 'failed') &&
                (scope !== 'refused' || statusOf(session)?.state === 'refused')) &&
            (project === 'all' || placeName(session) === project) &&
            (task === 'all' || (task === 'linked') === !!taskOf?.(session))) &&
        `${org.title || session.title} ${session.title} ${session.cwd} ${session.agent} ${org.notes || ''} ${taskOf?.(session)?.number ? '#' + taskOf(session)!.number : ''} ${taskOf?.(session)?.title || ''}`
          .toLowerCase()
          .includes(query.toLowerCase())
      );
    })
    .sort(
      (a, b) =>
        Number(!!b.organization?.pinned) - Number(!!a.organization?.pinned) ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
  const shown = compact ? list.slice(0, 3) : list;
  return (
    <>
      {(showFilters || onQueryChange || actions) && !compact && (
        <div className="session-filters">
          {onQueryChange && (
            <SearchInput
              size="sm"
              className="repository-session-filter"
              aria-label="Filter chats"
              placeholder="Filter chats"
              value={query}
              onChange={(event) => onQueryChange(event.target.value)}
            />
          )}
          {showFilters && (
            <SegmentedControl
              size="sm"
              label="Chat view"
              value={scope}
              onChange={setScope}
              options={[
                { value: 'active', label: 'Active' },
                {
                  value: 'waiting',
                  label: waitingCount ? `Waiting for you (${waitingCount})` : 'Waiting for you',
                },
                // Failed and Refused show only when a chat has that outcome, or when selected.
                ...(failedCount || scope === 'failed'
                  ? [{ value: 'failed', label: failedCount ? `Failed (${failedCount})` : 'Failed' }]
                  : []),
                ...(refusedCount || scope === 'refused'
                  ? [
                      {
                        value: 'refused',
                        label: refusedCount ? `Refused (${refusedCount})` : 'Refused',
                      },
                    ]
                  : []),
                { value: 'pinned', label: 'Pinned' },
                { value: 'archived', label: 'Archived' },
              ]}
            />
          )}
          {showFilters && (agents.size > 1 || agent !== 'all') && (
            <Choice
              label="Filter by agent"
              size="sm"
              className="min-w-32"
              value={agent}
              onChange={setAgent}
              options={[
                { value: 'all', label: 'All agents' },
                ...agentCatalog.map((item) => ({ value: item.id, label: item.name })),
              ]}
            />
          )}
          {showFilters && (projects.length > 1 || project !== 'all') && (
            <Choice
              label={filterBy === 'folder' ? 'Filter by code folder' : 'Filter by project'}
              size="sm"
              className="min-w-32"
              value={project}
              onChange={setProject}
              options={[
                {
                  value: 'all',
                  label: filterBy === 'folder' ? 'All code folders' : 'All projects',
                },
                ...projects.map((name) => ({ value: name, label: name })),
              ]}
            />
          )}
          {showFilters && (linkedCount > 0 || task !== 'all') && (
            <Choice
              label="Filter by task"
              size="sm"
              className="min-w-32"
              value={task}
              onChange={setTask}
              options={[
                { value: 'all', label: 'All chats' },
                { value: 'linked', label: 'Linked to a task' },
                { value: 'unlinked', label: 'No task' },
              ]}
            />
          )}
          {actions && <div className="session-filters-end">{actions}</div>}
        </div>
      )}
      {shown.length ? (
        <div className="session-list">
          {shown.map((session) => {
            const org = session.organization || {};
            const title = org.title || session.title;
            const branch = branchOf?.(session);
            const linked = taskOf?.(session);
            const place = placeOf?.(session);
            const where =
              filterBy === 'folder'
                ? projects.length > 1
                  ? place?.folder || ''
                  : ''
                : place
                  ? [place.project, place.folder].filter(Boolean).join(' › ')
                  : '';
            const menu = menuFor(session);
            return (
              <ChatContextMenu
                key={session.agent + session.id}
                groups={menu.groups}
                onRun={menu.run}
              >
                <div className="list-row">
                  <EntityIcon>
                    <AgentIcon agent={session.agent} />
                  </EntityIcon>
                  <div className="min-w-0 flex-1">
                    <Button
                      variant="bare"
                      className="session-title max-w-full justify-start gap-1.5 text-left font-medium"
                      title={title}
                      disabled={busy}
                      aria-label={`Resume ${title}`}
                      onClick={() => onResume(session)}
                    >
                      {org.pinned && <Pin className="size-3" aria-hidden="true" />}
                      <span>{title}</span>
                      {linked?.number && (
                        <span className="session-task-number" title={`Task: ${linked.title}`}>
                          #{linked.number}
                        </span>
                      )}
                      <ActivityDot {...statusOf(session)} />
                    </Button>
                    <div className="session-meta">
                      {agentLabel(session.agent)} ·{' '}
                      <time dateTime={session.updatedAt} title={fullTime(session.updatedAt)}>
                        {relativeTime(session.updatedAt)}
                      </time>
                      {where && ` · ${where}`}
                      {branch && (
                        <span className="session-branch" title={`Branch copy: ${branch}`}>
                          {' · '}
                          <GitBranch className="size-3" aria-hidden="true" />
                          <span className="sr-only">Branch </span>
                          {branch}
                        </span>
                      )}
                    </div>
                    {org.notes && !compact && <p className="session-note">{org.notes}</p>}
                  </div>
                  <div className="session-actions">
                    {org.archived && !compact && (
                      <Button
                        variant="outline"
                        size="xs"
                        disabled={busy}
                        aria-label={`Restore ${title}`}
                        onClick={() => void onUpdate(session, { ...org, archived: false })}
                      >
                        <ArchiveRestore aria-hidden="true" />
                        Restore
                      </Button>
                    )}
                    <ChatActionsDropdown
                      size="xs"
                      disabled={busy}
                      label={`${title} actions`}
                      groups={menu.groups}
                      onRun={menu.run}
                    />
                  </div>
                </div>
              </ChatContextMenu>
            );
          })}
        </div>
      ) : (
        <EmptyState
          compact={compact}
          icon={<MessagesSquare />}
          title={
            scope === 'archived' && !compact
              ? 'No archived chats'
              : scope === 'pinned' && !compact
                ? 'No pinned chats'
                : scope === 'waiting' && !compact
                  ? 'Nothing waits for you'
                  : scope === 'failed' && !compact
                    ? 'No failed chats'
                    : scope === 'refused' && !compact
                      ? 'No refused chats'
                      : sessions.length
                        ? 'No chats found'
                        : 'No chats yet'
          }
        >
          {scope === 'waiting' && !compact
            ? 'Chats that ask for an approval or an answer, and finished runs, show here.'
            : (scope === 'failed' || scope === 'refused') && !compact
              ? 'Chats whose last run failed or did not start show here.'
              : sessions.length
                ? 'Try a different search or filter. Use ⋯ on a chat to pin it, add notes, or archive it.'
                : 'Select New chat to start one. The agent works in a code folder of the project.'}
        </EmptyState>
      )}
      {!showFilters && !compact && archivedCount > 0 && (
        <Button
          variant="link"
          size="sm"
          className="session-archived-link"
          onClick={() => setScope('archived')}
        >
          View archived ({plural(archivedCount, 'chat')})
        </Button>
      )}
      {dialogs}
    </>
  );
}
