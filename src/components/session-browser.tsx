import {
  activityKey,
  useActivityState,
  useChatStatus,
  waitsForUser,
  type SessionActivityState,
} from './activity-dot';
import { useEffect, useState, type ReactNode } from 'react';
import {
  ArchiveRestore,
  ChevronDown,
  GitBranch,
  ListFilter,
  MessagesSquare,
  Pin,
} from 'lucide-react';
import { agentCatalog, agentLabel } from '../config/agents';
import { fullTime, relativeTime } from '../lib/relative-time';
import { ChatRow } from './chat-row';
import { ChatActionsDropdown, ChatContextMenu } from './chat-action-menu';
import { useChatListActions } from './chat-list-actions';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { EmptyState } from './ui/empty-state';
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
  /** True when the project of the chat has a task board. False hides "Link task". */
  hasBoard?: (session: Session) => boolean;
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
/** Shows one view of a list, such as 'waiting' or 'archived', also before the list opens. */
export function showSessionScope(key: string, scope: string) {
  try {
    localStorage.setItem(
      sessionViewKey(key),
      JSON.stringify({ ...readView(sessionViewKey(key)), scope }),
    );
  } catch {
    // Storage is not available. The event below still changes an open list.
  }
  window.dispatchEvent(new CustomEvent('kalkidan-session-scope', { detail: { key, scope } }));
}
/** Shows the archived sessions of a list, for example from the "View archived" toast action. */
export function viewArchivedSessions(key: string) {
  showSessionScope(key, 'archived');
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
  hasBoard,
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
      const detail = (event as CustomEvent<{ key?: string; scope?: string }>).detail;
      if (detail?.key === listKey && detail.scope)
        setView((previous) => ({ ...previous, scope: detail.scope! }));
    };
    window.addEventListener('kalkidan-session-scope', onView);
    return () => window.removeEventListener('kalkidan-session-scope', onView);
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
      board: hasBoard?.(session),
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
      archivedCount > 0 ||
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
  // The agent, place and task filters, and the Archived, Failed and Refused views, are in one
  // filter menu. The segments hold the views that people use most.
  const placeLabel = filterBy === 'folder' ? 'Code folder' : 'Project';
  const filterCount =
    Number(agent !== 'all') +
    Number(project !== 'all') +
    Number(task !== 'all') +
    Number(scope === 'archived' || scope === 'failed' || scope === 'refused');
  const otherViews = [
    ...(failedCount || scope === 'failed'
      ? [{ value: 'failed', label: failedCount ? `Failed (${failedCount})` : 'Failed' }]
      : []),
    ...(refusedCount || scope === 'refused'
      ? [{ value: 'refused', label: refusedCount ? `Refused (${refusedCount})` : 'Refused' }]
      : []),
    {
      value: 'archived',
      label: archivedCount ? `Archived (${archivedCount})` : 'Archived',
    },
  ];
  const filterMenu = (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" aria-label="Filter chats">
          <ListFilter />
          {filterCount ? `Filters (${filterCount})` : 'Filter'}
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56">
        {(agents.size > 1 || agent !== 'all') && (
          <>
            <DropdownMenuLabel>Agent</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={agent} onValueChange={setAgent}>
              <DropdownMenuRadioItem value="all">All agents</DropdownMenuRadioItem>
              {agentCatalog.map((item) => (
                <DropdownMenuRadioItem key={item.id} value={item.id}>
                  {item.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        )}
        {(projects.length > 1 || project !== 'all') && (
          <>
            <DropdownMenuLabel>{placeLabel}</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={project} onValueChange={setProject}>
              <DropdownMenuRadioItem value="all">
                {filterBy === 'folder' ? 'All code folders' : 'All projects'}
              </DropdownMenuRadioItem>
              {projects.map((name) => (
                <DropdownMenuRadioItem key={name} value={name}>
                  {name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        )}
        {(linkedCount > 0 || task !== 'all') && (
          <>
            <DropdownMenuLabel>Task</DropdownMenuLabel>
            <DropdownMenuRadioGroup value={task} onValueChange={setTask}>
              <DropdownMenuRadioItem value="all">All chats</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="linked">Linked to a task</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value="unlinked">No task</DropdownMenuRadioItem>
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuLabel>Show</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={scope} onValueChange={setScope}>
          {otherViews.map((option) => (
            <DropdownMenuRadioItem key={option.value} value={option.value}>
              {option.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {filterCount > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setView(defaultView)}>Clear filters</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  return (
    <>
      {(showFilters || onQueryChange || actions) && !compact && (
        <div className="session-filters">
          {onQueryChange && (
            <SearchInput
              size="sm"
              className="repository-session-filter"
              aria-label="Filter chats"
              placeholder="Search chats"
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
                { value: 'pinned', label: 'Pinned' },
              ]}
            />
          )}
          {showFilters && filterMenu}
          {actions && <div className="session-filters-end">{actions}</div>}
        </div>
      )}
      {shown.length ? (
        <div className="session-list chat-list">
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
                  ? [place.project, place.folder].filter(Boolean).join(' · ')
                  : '';
            const when = relativeTime(session.updatedAt);
            const menu = menuFor(session);
            return (
              <ChatContextMenu
                key={session.agent + session.id}
                groups={menu.groups}
                onRun={menu.run}
              >
                <ChatRow
                  session={session}
                  activity={activity[activityKey(session.agent, session.id)]}
                  label={`Resume ${title}`}
                  onOpen={(item) => !busy && onResume(item)}
                  meta={
                    <>
                      {org.pinned && <Pin className="chat-row-pin" aria-label="Pinned" />}
                      {[agentLabel(session.agent), where].filter(Boolean).join(' · ')}
                      {linked?.number && (
                        <span title={`Task: ${linked.title}`}>{` · #${linked.number}`}</span>
                      )}
                      {branch && (
                        <span className="session-branch" title={`Branch copy: ${branch}`}>
                          {' · '}
                          <GitBranch className="size-3" aria-hidden="true" />
                          <span className="sr-only">Branch </span>
                          {branch}
                        </span>
                      )}
                      {when && (
                        <>
                          {' · '}
                          <time dateTime={session.updatedAt} title={fullTime(session.updatedAt)}>
                            {when}
                          </time>
                        </>
                      )}
                      {org.notes && !compact && (
                        <span className="chat-row-note" title={org.notes}>
                          {' · '}
                          {org.notes}
                        </span>
                      )}
                    </>
                  }
                  trailing={
                    org.archived &&
                    !compact && (
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
                    )
                  }
                  menu={
                    <ChatActionsDropdown
                      size="xs"
                      disabled={busy}
                      label={`${title} actions`}
                      groups={menu.groups}
                      onRun={menu.run}
                    />
                  }
                />
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
        />
      )}
      {dialogs}
    </>
  );
}
