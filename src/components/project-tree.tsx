import { projectColors, type ProjectColor } from '../domain/project-colors';
import {
  ActivityDot,
  activityKey,
  strongestActivity,
  useActivityState,
  type ChatStatus,
  type SessionActivityState,
} from './activity-dot';
import { TreeContextMenu, type TreeAction } from './tree-context-menu';
import { projectSessions, sessionRepo } from '../lib/session-repository';
import { errorMessage } from '../lib/errors';
import { CreateProject } from './create-project';
import { AddRepository } from './add-repository';
import { ActionMenu, type ActionMenuItem } from './action-menu';
import { ChatActionsDropdown, ChatContextMenu } from './chat-action-menu';
import { useChatListActions } from './chat-list-actions';
import { viewArchivedSessions } from './session-browser';
import { Hint } from './hint';
import { plural } from '../lib/platform';
import { interfaceConfig } from '../config/interface';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  ChevronDown,
  Eye,
  Folder,
  FolderPlus,
  GitBranch,
  LayoutGrid,
  Loader2,
  MessagesSquare,
  Pin,
  PinOff,
} from 'lucide-react';
import { trackerConnection } from '../domain/tracker';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from './ui/collapsible';
import { AgentIcon } from './ui/agent-icon';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { EmptyState } from './ui/empty-state';
import { EntityIcon } from './ui/entity-icon';
import { SectionHeader } from './ui/page-header';
import { Input } from './ui/input';
import { showToast } from './ui/toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from './ui/dialog';
import type { API, Project, ProjectGroup, Session, RemoteHost, TrackerItem } from '../types';

const collapsedKey = 'kalkidan-collapsed-projects';
/** Each project shows its most recent chats in the sidebar. */
const recentLimit = interfaceConfig.recentChats;
function savedCollapsed() {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(collapsedKey) || '[]');
    return new Set(Array.isArray(value) ? value.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set<string>();
  }
}
// The row paints hover, selection and the focus ring. Its main button only holds the content.
const rowButton =
  'tree-row-button min-w-0 flex-1 justify-start gap-2 px-0 font-normal hover:bg-transparent focus-visible:ring-0 has-[>svg]:px-0';
const titleOf = (session: Session) => session.organization?.title || session.title;
const sameSession = (a: Session | null | undefined, b: Session) =>
  !!a && a.agent === b.agent && a.id === b.id;
/** The ellipsis menu shows the same actions as the context menu. */
function menuItems(actions: TreeAction[]): ActionMenuItem[] {
  return actions.map((item) => ({
    label: item.label,
    action: item.action,
    disabled: item.disabled,
    reason: item.reason,
    danger: item.destructive,
    separator: item.separator,
  }));
}
/** A saved GitHub view that the user pinned to the sidebar. */
export interface PinnedView {
  id: string;
  name: string;
}
/** The main buttons of the visible tree rows, in order. */
function treeRows(tree: HTMLElement) {
  return [...tree.querySelectorAll<HTMLElement>('.tree-row-button')].filter(
    (row) => !row.closest('[hidden]') && row.offsetParent !== null,
  );
}
export interface OpenChat {
  session: Session;
  state?: SessionActivityState;
}
export interface CloneProgress {
  id: string;
  name: string;
  groupId?: string;
}
export function ProjectTree({
  api,
  repos,
  allRepos,
  groups,
  sessions,
  selected,
  activeGroup,
  activeSession,
  busy,
  hosts = [],
  onSelect,
  onResume,
  onProject,
  onProjectChats,
  onOverview,
  onAllSessions,
  overviewCurrent = false,
  allSessionsCurrent = false,
  onDocs,
  onMemory,
  onInsights,
  onNewTask,
  onProjectSettings,
  taskOf,
  onOpenTask,
  onSessionCommand,
  pinnedViews = {},
  onOpenView,
  onUnpinView,
  run,
  onNotice,
  onRefresh,
  onConnect,
  connectLabel = 'Connect a GitHub Projects board…',
  activity = {},
  sessionActivity = {},
  openChats = [],
  cloning = [],
  addFolderRequest,
  query = '',
}: {
  /** Reloads the snapshot without a busy state. */
  onRefresh: () => Promise<unknown>;
  /** Connects a GitHub Projects board to a project without a board. */
  onConnect?: (group: ProjectGroup) => void;
  connectLabel?: string;
  /** Background session state for each repository ID. */
  activity?: Record<string, SessionActivityState>;
  /** Background state of open sessions, by `activityKey`. */
  sessionActivity?: Record<string, SessionActivityState>;
  /** Chats that are open in this window, also in the background. */
  openChats?: OpenChat[];
  /** Clones that run after their dialog closed. */
  cloning?: CloneProgress[];
  /** Each new request opens the Add code folders dialog for that project. */
  addFolderRequest?: { groupId: string; at: number };
  /** The sidebar search text. The empty search message shows only with a query. */
  query?: string;
  onNotice?: (message: string, error?: boolean) => void;
  onOverview: () => void;
  onAllSessions?: () => void;
  overviewCurrent?: boolean;
  allSessionsCurrent?: boolean;
  onDocs: (group: ProjectGroup) => void;
  onMemory: (group: ProjectGroup) => void;
  /** Opens the Insights page of a project. */
  onInsights?: (group: ProjectGroup) => void;
  /** Opens the tasks of a project with the New task form. */
  onNewTask?: (group: ProjectGroup) => void;
  /** Opens the Project settings dialog. */
  onProjectSettings?: (group: ProjectGroup) => void;
  /** Opens the list of all chats of a project. Without it, "Show all chats" opens the project. */
  onProjectChats?: (group: ProjectGroup) => void;
  /** The board item that a chat works on. Rows show its number, such as "#12". */
  taskOf?: (session: Session) => TrackerItem | undefined;
  onOpenTask?: (groupId: string, itemId: string) => void;
  /** Runs a session command, such as "session-commit", in a chat. Opens the chat first. */
  onSessionCommand?: (command: string, session: Session) => void;
  /** Saved GitHub views pinned to the sidebar, by project ID. */
  pinnedViews?: Record<string, PinnedView[]>;
  onOpenView?: (group: ProjectGroup, view: PinnedView) => void;
  onUnpinView?: (group: ProjectGroup, view: PinnedView) => void;
  hosts?: RemoteHost[];
  api: API;
  repos: Project[];
  allRepos: Project[];
  groups: ProjectGroup[];
  sessions: Session[];
  selected: string;
  activeGroup?: string | null;
  activeSession?: Session | null;
  busy: boolean;
  onProject: (group: ProjectGroup) => void;
  onSelect: (repo: Project) => void;
  onResume: (session: Session) => void;
  run: (action: () => Promise<unknown>) => Promise<void>;
}) {
  const [removing, setRemoving] = useState<
    { kind: 'repository'; item: Project } | { kind: 'project'; item: ProjectGroup } | null
  >(null);
  const [reconnecting, setReconnecting] = useState('');
  // The one Add code folders dialog. The project row menu and the app open it.
  const [addFolder, setAddFolder] = useState<{ groupId: string; at: number }>();
  useEffect(() => {
    if (addFolderRequest) setAddFolder(addFolderRequest);
  }, [addFolderRequest]);
  const { finished } = useActivityState();
  async function togglePin(session: Session) {
    const pinned = !session.organization?.pinned;
    await run(async () => {
      await api.updateSession(session.agent, session.id, { pinned });
      onNotice?.(pinned ? 'Chat pinned. It shows at the top of the sidebar.' : 'Chat unpinned.');
    });
  }
  const running = (session: Session) =>
    openChats.find((chat) => sameSession(chat.session, session))?.state ||
    sessionActivity[activityKey(session.agent, session.id)];
  /** Work in progress or a wait for the user, else a finished run that the user did not see. */
  const statusOf = (session: Session): ChatStatus | undefined =>
    running(session) ||
    (finished.some((item) => item.agent === session.agent && item.id === session.id)
      ? 'done'
      : undefined);
  const chatMenus = useChatListActions({
    api,
    onResume,
    onSessionCommand,
    onChanged: () => void onRefresh(),
    onViewArchived: (session) => {
      const repo = sessionRepo(session, allRepos);
      if (!repo) return;
      viewArchivedSessions(repo.id);
      onSelect(repo);
    },
    onOpenTask: onOpenTask
      ? (session) => {
          const task = taskOf?.(session);
          const group = groups.find((g) =>
            g.repoIds.includes(sessionRepo(session, allRepos)?.id || ''),
          );
          if (task && group) onOpenTask(group.id, task.id);
          else onSessionCommand?.('open-linked-task', session);
        }
      : undefined,
    stateOf: (session) => {
      const repo = sessionRepo(session, allRepos);
      return {
        open: sameSession(activeSession, session),
        running: !!running(session),
        linkedTask: !!(taskOf?.(session) || session.organization?.taskId || session.task?.id),
        repository: !!repo,
        project: !!repo && groups.some((g) => g.repoIds.includes(repo.id)),
      };
    },
  });
  const [editing, setEditing] = useState<ProjectGroup | 'new' | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState<ProjectColor | null>(null);
  const managedRepos =
    editing && editing !== 'new'
      ? allRepos.filter((repo) => editing.repoIds.includes(repo.id))
      : [];
  const canSave =
    !busy &&
    !!name.trim() &&
    !(editing !== 'new' && editing?.name === name.trim() && (editing?.color || null) === color);
  function saveProject() {
    void run(async () => {
      if (editing && editing !== 'new') {
        if (editing.name !== name.trim()) await api.updateGroup(editing.id, name.trim());
        if ((editing.color || null) !== color) await api.setGroupColor(editing.id, color);
      }
      setEditing(null);
    });
  }
  function edit(group: ProjectGroup | 'new') {
    setEditing(group);
    setName(group === 'new' ? '' : group.name);
    setColor(group === 'new' ? null : group.color || null);
  }
  const [collapsed, setCollapsed] = useState(savedCollapsed);
  function toggleGroup(id: string, open: boolean) {
    setCollapsed((current) => {
      const next = new Set(current);
      if (open) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(collapsedKey, JSON.stringify([...next]));
      } catch {
        /* Optional preference. */
      }
      return next;
    });
  }
  /** One chat row: in Pinned, or under its project. */
  function sessionRow(session: Session, kind: 'pinned' | 'recent', folder?: string) {
    const title = titleOf(session);
    const current = sameSession(activeSession, session);
    const draft = session.id.startsWith('draft-');
    const pinned = !!session.organization?.pinned;
    const task = taskOf?.(session);
    const menu = chatMenus.menuFor(session);
    return (
      <ChatContextMenu
        key={kind + session.agent + session.id}
        groups={menu.groups}
        onRun={menu.run}
      >
        <div
          className={
            'tree-row session-row row-hover row-focus' +
            (kind === 'recent' ? ' tree-session-row' : ' tree-top-row pinned-session-row') +
            (current ? ' selected row-selected' : '')
          }
        >
          <Button
            variant="ghost"
            className={rowButton}
            title={folder ? `${title} · ${folder}` : title}
            aria-label={kind === 'pinned' ? `Resume pinned ${title}` : `Chat: ${title}`}
            aria-current={current ? 'page' : undefined}
            onClick={() => onResume(session)}
          >
            <span className="tree-icon">
              <AgentIcon agent={session.agent} className="size-3.5" />
            </span>
            <span className="tree-label">{title}</span>
            {folder && <span className="tree-secondary">{folder}</span>}
            {task?.number && (
              <span className="tree-task-number" title={`Task #${task.number}: ${task.title}`}>
                #{task.number}
              </span>
            )}
            <ActivityDot state={statusOf(session)} />
          </Button>
          {!draft && (
            <Hint label={pinned ? 'Unpin' : 'Pin to keep this chat at the top'}>
              <Button
                variant="ghost"
                size="icon-xs"
                className="tree-row-menu"
                disabled={busy}
                aria-label={pinned ? `Unpin ${title}` : `Pin ${title}`}
                onClick={() => void togglePin(session)}
              >
                {pinned ? <PinOff /> : <Pin />}
              </Button>
            </Hint>
          )}
          <ChatActionsDropdown
            size="xs"
            className="tree-row-menu"
            label={`${title} actions`}
            groups={menu.groups}
            onRun={menu.run}
          />
        </div>
      </ChatContextMenu>
    );
  }
  /** The recent chats of a project, newest first. Pinned chats show once, in Pinned. */
  function projectChats(group: ProjectGroup) {
    const members = allRepos.filter((repo) => group.repoIds.includes(repo.id));
    const all = projectSessions(sessions, group, allRepos);
    const recent = all.filter((s) => !s.organization?.pinned).slice(0, recentLimit);
    // The code folder shows only when the project has more than one.
    const folderOf = (session: Session) =>
      members.length > 1 ? sessionRepo(session, allRepos)?.name : undefined;
    return [
      ...recent.map((session) => sessionRow(session, 'recent', folderOf(session))),
      ...(all.length > recent.length
        ? [
            <div
              key={group.id + ':more'}
              className="tree-row tree-session-row tree-more-row row-hover row-focus"
            >
              <Button
                variant="ghost"
                className={rowButton}
                title={`See all chats of ${group.name}`}
                onClick={() => (onProjectChats || onProject)(group)}
              >
                <span className="tree-icon" aria-hidden="true" />
                <span className="tree-label">Show all {plural(all.length, 'chat')}</span>
              </Button>
            </div>,
          ]
        : []),
    ];
  }
  const pinned = sessions.filter(
    (s) =>
      s.organization?.pinned &&
      !s.organization.archived &&
      repos.some((r) => sessionRepo(s, allRepos)?.id === r.id),
  );
  const views = groups.flatMap((group) =>
    (pinnedViews[group.id] || []).map((view) => ({ group, view })),
  );
  const hasRepositories = (group: ProjectGroup) =>
    group.repoIds.some((id) => allRepos.some((repo) => repo.id === id));
  const showAddFolder = (group: ProjectGroup) =>
    setAddFolder((current) => ({ groupId: group.id, at: (current?.at || 0) + 1 }));
  function projectActions(group: ProjectGroup, host?: RemoteHost): TreeAction[] {
    return [
      { label: 'Open project', action: () => onProject(group) },
      ...(onNewTask && trackerConnection(group)
        ? [{ label: 'New task', action: () => onNewTask(group) }]
        : []),
      { label: 'Open docs', action: () => onDocs(group) },
      { label: 'Open memory', action: () => onMemory(group) },
      ...(onInsights ? [{ label: 'Insights', action: () => onInsights(group) }] : []),
      ...(onProjectSettings
        ? [{ label: 'Project settings…', action: () => onProjectSettings(group) }]
        : []),
      ...(host && host.status !== 'connected'
        ? [
            {
              label: `Reconnect to ${host.name}`,
              disabled: reconnecting === host.id || host.status === 'connecting',
              action: () => void reconnect(host),
            },
          ]
        : []),
      {
        label: 'Add a code folder…',
        separator: true,
        disabled: busy,
        action: () => showAddFolder(group),
      },
      ...(onConnect && !trackerConnection(group)
        ? [{ label: connectLabel, action: () => onConnect(group) }]
        : []),
      { label: 'Rename…', separator: true, disabled: busy, action: () => edit(group) },
      {
        label: 'Remove project from Kalkidan…',
        disabled: busy,
        destructive: true,
        separator: true,
        action: () => setRemoving({ kind: 'project', item: group }),
      },
    ];
  }
  async function reconnect(host: RemoteHost) {
    setReconnecting(host.id);
    try {
      await api.remoteConnect(host.id);
      await onRefresh();
    } catch (e) {
      showToast({
        message: `Could not connect to ${host.name}: ${errorMessage(e)}`,
        tone: 'error',
      });
    } finally {
      setReconnecting('');
    }
  }
  const searching = !!query.trim();
  const removingProjectRepos =
    removing?.kind === 'project'
      ? allRepos.filter((repo) => removing.item.repoIds.includes(repo.id)).length
      : 0;
  const treeRef = useRef<HTMLDivElement>(null);
  // The row that has the one tab stop of the tree. The arrow keys move it.
  const activeRow = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const tree = treeRef.current;
    if (!tree) return;
    // Row actions (pin, menu, add) are reachable with the context menu key.
    for (const control of tree.querySelectorAll<HTMLElement>(
      '.tree-row-menu, .tree-row-action, .tree-toggle, .tree-row button:not(.tree-row-button)',
    ))
      control.tabIndex = -1;
    const rows = treeRows(tree);
    const active =
      (activeRow.current && rows.includes(activeRow.current) && activeRow.current) ||
      rows.find((row) => row.getAttribute('aria-current') === 'page') ||
      rows.find((row) => row.getAttribute('aria-current')) ||
      rows[0];
    for (const row of rows) row.tabIndex = row === active ? 0 : -1;
  });
  function moveFocus(row: HTMLElement | undefined) {
    if (!row) return;
    activeRow.current = row;
    for (const item of treeRows(treeRef.current!)) item.tabIndex = item === row ? 0 : -1;
    row.focus();
  }
  function onTreeKey(event: KeyboardEvent<HTMLDivElement>) {
    const target = event.target as HTMLElement;
    if (!target.classList.contains('tree-row-button') || event.altKey || event.metaKey) return;
    const rows = treeRows(treeRef.current!);
    const index = rows.indexOf(target);
    const groupElement = target.closest<HTMLElement>('.project-group');
    const groupId = groupElement?.dataset.group;
    const projectRow = target.classList.contains('project-select');
    const expanded = groupId ? !collapsed.has(groupId) : false;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(rows[index + (event.key === 'ArrowDown' ? 1 : -1)]);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      moveFocus(event.key === 'Home' ? rows[0] : rows[rows.length - 1]);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (projectRow && groupId && !expanded) toggleGroup(groupId, true);
      else if (projectRow) moveFocus(rows[index + 1]);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      if (projectRow && groupId && expanded) toggleGroup(groupId, false);
      else if (!projectRow && groupElement)
        moveFocus(groupElement.querySelector<HTMLElement>('.project-select') || undefined);
    }
  }
  return (
    <div
      ref={treeRef}
      className="project-list project-tree"
      onKeyDown={onTreeKey}
      onFocus={(event) => {
        if ((event.target as HTMLElement).classList.contains('tree-row-button'))
          activeRow.current = event.target as HTMLElement;
      }}
    >
      <div
        className={
          'tree-row tree-top-row tree-nav-row row-hover row-focus' +
          (overviewCurrent ? ' selected row-selected' : '')
        }
      >
        <Button
          variant="ghost"
          className={rowButton}
          aria-current={overviewCurrent ? 'page' : undefined}
          onClick={onOverview}
        >
          <span className="tree-icon">
            <LayoutGrid className="size-3.5" />
          </span>
          <span className="tree-label">Projects</span>
        </Button>
        <Hint label="New project">
          <Button
            variant="ghost"
            size="icon-xs"
            className="tree-row-action"
            disabled={busy}
            aria-label="New project"
            onClick={() => edit('new')}
          >
            <FolderPlus />
          </Button>
        </Hint>
      </div>
      {onAllSessions && (
        <div
          className={
            'tree-row tree-top-row tree-nav-row row-hover row-focus' +
            (allSessionsCurrent ? ' selected row-selected' : '')
          }
        >
          <Button
            variant="ghost"
            className={rowButton}
            aria-current={allSessionsCurrent ? 'page' : undefined}
            onClick={onAllSessions}
          >
            <span className="tree-icon">
              <MessagesSquare className="size-3.5" />
            </span>
            <span className="tree-label">All chats</span>
          </Button>
        </div>
      )}
      {(pinned.length > 0 || views.length > 0) && (
        <section className="tree-section pinned-sessions" aria-labelledby="tree-pinned">
          <h2 id="tree-pinned" className="sidebar-label tree-heading">
            Pinned
          </h2>
          {pinned.map((session) => sessionRow(session, 'pinned'))}
          {views.map(({ group, view }) => (
            <TreeContextMenu
              key={'view:' + group.id + view.id}
              label="View actions"
              actions={[
                { label: 'Open view', action: () => onOpenView?.(group, view) },
                {
                  label: 'Unpin view',
                  separator: true,
                  action: () => onUnpinView?.(group, view),
                },
              ]}
            >
              <div className="tree-row tree-top-row tree-view-row row-hover row-focus">
                <Button
                  variant="ghost"
                  className={rowButton}
                  title={`Saved GitHub view: ${view.name} · ${group.name}`}
                  onClick={() => onOpenView?.(group, view)}
                >
                  <span className="tree-icon">
                    <Eye className="size-3.5" />
                  </span>
                  <span className="tree-label">{view.name}</span>
                  <span className="tree-secondary">{group.name}</span>
                </Button>
              </div>
            </TreeContextMenu>
          ))}
        </section>
      )}
      {/* The heading always shows, so the tree does not move when a chat opens. */}
      {groups.length > 0 && (
        <h2 className="sidebar-label tree-heading tree-projects-heading">Your projects</h2>
      )}
      {groups.map((group) => {
        const members = allRepos.filter((repo) => group.repoIds.includes(repo.id));
        const projectCurrent = activeGroup === group.id && !activeSession;
        const activeRepo = activeSession ? sessionRepo(activeSession, allRepos) : undefined;
        // The project row shows that the current page is inside it, without a background.
        const containsCurrent =
          !projectCurrent &&
          (activeRepo
            ? group.repoIds.includes(activeRepo.id)
            : !activeGroup && members.some((repo) => selected === repo.id));
        const host = hosts.find((h) => h.id === group.hostId);
        const open = !collapsed.has(group.id);
        const groupState = strongestActivity(members.map((repo) => activity[repo.id]));
        const actions = projectActions(group, host);
        const folderColor = {
          value: group.color,
          disabled: busy,
          onChange: (color: ProjectColor | null) =>
            void run(() => api.setGroupColor(group.id, color)),
        };
        const clones = cloning.filter((clone) => clone.groupId === group.id);
        const chats = projectChats(group);
        const hostStatus = host?.status || 'disconnected';
        const hostLabel = group.hostId
          ? `SSH: ${host?.target || host?.name || 'remote host'} · ${hostStatus}` +
            (host?.error ? ` · ${host.error}` : '')
          : '';
        return (
          <Collapsible
            className="project-group"
            data-group={group.id}
            open={open}
            onOpenChange={(open) => toggleGroup(group.id, open)}
            key={group.id}
          >
            <TreeContextMenu label="Project actions" folderColor={folderColor} actions={actions}>
              <div
                className={
                  'tree-row tree-top-row project-group-heading row-hover row-focus' +
                  (projectCurrent ? ' selected row-selected' : '') +
                  (containsCurrent ? ' contains-current' : '')
                }
              >
                <CollapsibleTrigger asChild>
                  <Button
                    variant="bare"
                    className="tree-toggle tree-icon focus-visible:ring-0"
                    aria-label={`${open ? 'Collapse' : 'Expand'} ${group.name}`}
                  >
                    <Folder
                      className="project-folder-icon size-3.5"
                      style={{ color: group.color ? projectColors[group.color] : undefined }}
                    />
                    <ChevronDown className="tree-chevron size-3.5" />
                  </Button>
                </CollapsibleTrigger>
                <Button
                  variant="ghost"
                  className={'project-select ' + rowButton}
                  title={hostLabel ? `${group.name} · ${hostLabel}` : group.name}
                  aria-label={group.name}
                  aria-current={projectCurrent ? 'page' : undefined}
                  onClick={() => onProject(group)}
                >
                  <span className="tree-label">{group.name}</span>
                  {group.hostId && (
                    <Badge
                      variant="outline"
                      size="sm"
                      className="project-host-badge"
                      title={hostLabel}
                      data-status={hostStatus}
                    >
                      <span
                        className={
                          'tree-host-dot' +
                          (hostStatus === 'connected'
                            ? ' host-connected'
                            : hostStatus === 'error'
                              ? ' host-error'
                              : '')
                        }
                        aria-hidden="true"
                      />
                      SSH
                    </Badge>
                  )}
                  {!open && <ActivityDot state={groupState} />}
                </Button>
                <ActionMenu
                  size="xs"
                  className="tree-row-menu"
                  disabled={busy}
                  label={`Manage project ${group.name}`}
                  folderColor={folderColor}
                  items={menuItems(actions)}
                />
              </div>
            </TreeContextMenu>
            <CollapsibleContent className="project-group-children">
              {chats}
              {clones.map((clone) => (
                <div key={clone.id} className="tree-row tree-cloning" role="status">
                  <span className="tree-icon">
                    <Loader2 className="size-3.5 animate-spin" />
                  </span>
                  <span className="tree-label">Cloning {clone.name}…</span>
                </div>
              ))}
              {!hasRepositories(group) && !clones.length ? (
                <div className="tree-row tree-empty">
                  <span className="tree-icon" aria-hidden="true" />
                  <Button
                    variant="link"
                    size="xs"
                    className="tree-empty-action tree-row-button"
                    disabled={busy}
                    onClick={() => showAddFolder(group)}
                  >
                    Add a code folder
                  </Button>
                </div>
              ) : (
                !chats.length &&
                !clones.length && (
                  <div className="tree-row tree-empty">
                    <span className="tree-icon" aria-hidden="true" />
                    <span className="tree-label">No chats yet</span>
                  </div>
                )
              )}
            </CollapsibleContent>
          </Collapsible>
        );
      })}
      {!groups.length ? (
        <EmptyState compact icon={<Folder />} title="No projects yet">
          A project holds your code folders, agent chats and notes. Select New project next to
          Projects to create one.
        </EmptyState>
      ) : (
        searching &&
        !repos.some((repo) => groups.some((group) => group.repoIds.includes(repo.id))) && (
          <EmptyState compact>No matching projects or code folders.</EmptyState>
        )
      )}
      {addFolder && (
        <AddRepository
          key={addFolder.groupId}
          api={api}
          groupId={addFolder.groupId}
          trigger={false}
          openRequest={addFolder.at}
          onRefresh={onRefresh}
          onNotice={onNotice}
        />
      )}
      {chatMenus.dialogs}
      <Dialog open={!!removing} onOpenChange={(open) => !open && setRemoving(null)}>
        <DialogContent size="sm">
          <DialogHeader>
            <DialogTitle>
              {removing?.kind === 'project'
                ? `Remove ${removing.item.name} from Kalkidan?`
                : removing
                  ? `Remove ${removing.item.name} from Kalkidan?`
                  : ''}
            </DialogTitle>
            <DialogDescription>
              {removing?.kind === 'project'
                ? removingProjectRepos
                  ? `Kalkidan stops showing this project and its ${removingProjectRepos === 1 ? 'code folder' : `${removingProjectRepos} code folders`}. All files stay on disk.`
                  : 'Kalkidan stops showing this project. All files stay on disk.'
                : 'Kalkidan stops showing this code folder. The folder, its files, and its sessions stay on disk.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            {/* A remove action starts on Cancel, so a second Enter does not remove. */}
            <Button type="button" variant="outline" autoFocus onClick={() => setRemoving(null)}>
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  if (!removing) return;
                  if (removing.kind === 'repository') await api.remove(removing.item.id);
                  else await api.removeGroup(removing.item.id, true);
                  const message = `${removing.item.name} removed from Kalkidan.`;
                  setRemoving(null);
                  onNotice?.(message);
                })
              }
            >
              {removing?.kind === 'project' ? 'Remove project' : 'Remove from Kalkidan'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <CreateProject
        api={api}
        open={editing === 'new'}
        onOpenChange={(open) => !open && setEditing(null)}
        onCreated={async (group) => {
          await onRefresh();
          onProject(group);
        }}
      />
      <Dialog
        open={!!editing && editing !== 'new'}
        onOpenChange={(open) => !open && setEditing(null)}
      >
        <DialogContent size="md" layout="scroll">
          <DialogHeader>
            <div className="project-settings-heading">
              <EntityIcon size="lg" color={color ? projectColors[color] : undefined}>
                <Folder />
              </EntityIcon>
              <div>
                <DialogTitle>Manage project</DialogTitle>
                <DialogDescription className="mt-1">
                  Change the name and color, and see the code folders of this project.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <DialogBody>
            <form
              id="project-settings-form"
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (canSave) saveProject();
              }}
            >
              <label className="form-label">
                Project name
                <Input
                  value={name}
                  maxLength={150}
                  disabled={busy}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="e.g. Customer platform"
                />
              </label>
              <label className="form-label">
                Project folder
                <Input
                  readOnly
                  aria-label="Project folder"
                  value={
                    editing && editing !== 'new'
                      ? editing.rootPath || 'Set when this project opens on its host'
                      : ''
                  }
                />
                <span className="form-help">
                  Contains docs/, repos/, and worktrees/. Code folders in other places stay linked.
                </span>
              </label>
              <fieldset className="project-settings-colors" disabled={busy}>
                <legend className="form-label">Folder color</legend>
                <div className="flex flex-wrap gap-2">
                  {([null, ...Object.keys(projectColors)] as (ProjectColor | null)[]).map(
                    (value) => (
                      <Button
                        key={value || 'default'}
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={
                          value
                            ? value[0].toUpperCase() + value.slice(1) + ' folder'
                            : 'Default folder'
                        }
                        aria-pressed={color === value}
                        title={value || 'Default'}
                        onClick={() => setColor(value)}
                        style={{ color: value ? projectColors[value] : 'var(--muted-foreground)' }}
                      >
                        <Folder />
                      </Button>
                    ),
                  )}
                </div>
              </fieldset>
              <section className="project-settings-repositories" aria-label="Project code folders">
                <SectionHeader size="sm" title="Code folders" count={managedRepos.length} />
                {managedRepos.length ? (
                  <ul className="list-box">
                    {managedRepos.map((repo) => (
                      <li key={repo.id} className="list-box-row">
                        <GitBranch size={14} />
                        <div>
                          <strong>{repo.name}</strong>
                          <span title={repo.path}>{repo.path}</span>
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <EmptyState compact>No code folders in this project yet.</EmptyState>
                )}
              </section>
              {editing && editing !== 'new' && (
                <div className="danger-zone">
                  <div>
                    <strong>Remove project</strong>
                    <p>Kalkidan stops showing it. All files stay on disk.</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    disabled={busy}
                    onClick={() => {
                      setRemoving({ kind: 'project', item: editing });
                      setEditing(null);
                    }}
                  >
                    Remove project…
                  </Button>
                </div>
              )}
            </form>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button type="submit" form="project-settings-form" disabled={!canSave}>
              {busy ? 'Saving…' : 'Save project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
