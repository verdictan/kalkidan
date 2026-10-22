import { projectColors } from '../domain/project-colors';
import {
  StatusMark,
  activityKey,
  strongestActivity,
  useActivityState,
  useChatStatus,
  type SessionActivityState,
} from './activity-dot';
import { projectMenuActions, TreeActionsMenu, TreeContextMenu } from './tree-context-menu';
import { projectSessions, sessionRepo } from '../lib/session-repository';
import { errorMessage } from '../lib/errors';
import { CreateProject } from './create-project';
import { openProjectPage } from './project-tabs';
import { trackerConnection } from '../domain/tracker';
import { useNeedsYou } from './project-overview';
import { AddRepository } from './add-repository';
import { ChatActionsDropdown, ChatContextMenu } from './chat-action-menu';
import { useChatListActions } from './chat-list-actions';
import { viewArchivedSessions } from './session-browser';
import { Hint } from './hint';
import { plural, shortcutLabel } from '../lib/platform';
import { interfaceConfig } from '../config/interface';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  Eye,
  Folder,
  FolderOpen,
  Inbox,
  LayoutGrid,
  Loader2,
  MessagesSquare,
  Plus,
  SquarePen,
} from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from './ui/collapsible';
import { agentLabel } from '../config/agents';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { NavRow } from './ui/nav-row';
import { showToast } from './ui/toast';
import { RenameDialog } from './session-actions';
import type { API, Project, ProjectGroup, Session, RemoteHost, TrackerItem } from '../types';

const collapsedKey = 'kalkidan-collapsed-projects';
/** Each project shows its most recent chats in the sidebar. */
const recentLimit = interfaceConfig.recentChats;
function savedCollapsed(key = collapsedKey) {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || '[]');
    return new Set(Array.isArray(value) ? value.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set<string>();
  }
}
// The row paints hover, selection and the focus ring. Its main button only holds the content.
const rowButton =
  'tree-row-button min-w-0 flex-1 justify-start gap-2 px-0 font-normal hover:bg-transparent focus-visible:ring-0 has-[>svg]:px-0';
// A chat row is 32px high, like every sidebar row. Its button has the same height.
const childButton = rowButton + ' h-8';
const titleOf = (session: Session) => session.organization?.title || session.title;
const sameSession = (a: Session | null | undefined, b: Session) =>
  !!a && a.agent === b.agent && a.id === b.id;
/** A saved GitHub view that the user pinned to the sidebar. */
export interface PinnedView {
  id: string;
  name: string;
}
/** The main buttons of the visible nav rows and tree rows, in order. */
const rowSelector = '.tree-row-button, .nav-row-main';
const isRow = (element: HTMLElement) => element.matches(rowSelector);
function treeRows(tree: HTMLElement) {
  return [...tree.querySelectorAll<HTMLElement>(rowSelector)].filter(
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
  taskOf,
  onOpenTask,
  onSessionCommand,
  pinnedViews = {},
  onOpenView,
  onUnpinView,
  run,
  onNotice,
  onRefresh,
  activity = {},
  sessionActivity = {},
  openChats = [],
  cloning = [],
  addFolderRequest,
  onNewChat,
  onNewChatIn,
  onNewTaskIn,
  onNewPageIn,
  onWaiting,
  waitingCurrent = false,
  onUsage,
  query = '',
}: {
  /** Starts a new chat where the user works now. The top row of the sidebar runs it. */
  onNewChat?: () => void;
  /** Starts a new chat in a project, from the project menu. */
  onNewChatIn?: (group: ProjectGroup) => void;
  /** Opens New task in a project, from the project menu. */
  onNewTaskIn?: (group: ProjectGroup) => void;
  /** Makes a new doc page in a project, from the project menu. */
  onNewPageIn?: (group: ProjectGroup) => void;
  /**
   * Opens the one "Waiting for you" page. The row is the last nav row. Its count shows how many
   * chats wait for the user.
   */
  onWaiting?: () => void;
  waitingCurrent?: boolean;
  /** Opens the Usage sheet of a project, from the project menu. */
  onUsage?: (group: ProjectGroup) => void;
  /** Reloads the snapshot without a busy state. */
  onRefresh: () => Promise<unknown>;
  /** Background session state for each repository ID. */
  activity?: Record<string, SessionActivityState>;
  /** Background state of open sessions, by `activityKey`. */
  sessionActivity?: Record<string, SessionActivityState>;
  /** Chats that are open in this window, also in the background. */
  openChats?: OpenChat[];
  /** Clones that run after their dialog closed. */
  cloning?: CloneProgress[];
  /** Each new request opens the Add code folders dialog for that project, at its source. */
  addFolderRequest?: { groupId: string; at: number; source?: 'github' | 'local' };
  /** The sidebar search text. The empty search message shows only with a query. */
  query?: string;
  onNotice?: (message: string, error?: boolean) => void;
  onOverview: () => void;
  onAllSessions?: () => void;
  overviewCurrent?: boolean;
  allSessionsCurrent?: boolean;
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
  const [renaming, setRenaming] = useState<ProjectGroup | null>(null);
  const [reconnecting, setReconnecting] = useState('');
  // The one Add code folders dialog. The project row menu and the app open it.
  const [addFolder, setAddFolder] = useState<{
    groupId: string;
    at: number;
    source?: 'github' | 'local';
  }>();
  useEffect(() => {
    if (addFolderRequest) setAddFolder(addFolderRequest);
  }, [addFolderRequest]);
  const chatStatus = useChatStatus();
  const { drafts: draftOutcomes, activity: published } = useActivityState();
  // The live state of a chat: from the open chats, else from the store that the shell fills.
  const running = (session: Session) =>
    openChats.find((chat) => sameSession(chat.session, session))?.state ||
    sessionActivity[activityKey(session.agent, session.id)] ||
    published.find((item) => item.agent === session.agent && item.id === session.id)?.state;
  /**
   * Work in progress or a wait for the user, then a failed or refused latest run, then a
   * finished run that the user did not see.
   */
  const statusOf = (session: Session) => chatStatus(session, running(session));
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
      const group = repo && groups.find((g) => g.repoIds.includes(repo.id));
      return {
        board: !!group && !!trackerConnection(group),
        open: sameSession(activeSession, session),
        running: !!running(session),
        linkedTask: !!(taskOf?.(session) || session.organization?.taskId || session.task?.id),
        repository: !!repo,
        project: !!repo && groups.some((g) => g.repoIds.includes(repo.id)),
      };
    },
  });
  const [creating, setCreating] = useState(false);
  // The project section of the one Settings window. The shell opens it.
  const openSettings = (group: ProjectGroup) =>
    window.dispatchEvent(
      new CustomEvent('kalkidan-open-project-settings', { detail: { groupId: group.id } }),
    );
  const latest = useRef({ groups });
  latest.current = { groups };
  useEffect(() => {
    // "Rename…" in the project header opens the same rename dialog as the sidebar row.
    const onRename = (event: Event) => {
      const id = (event as CustomEvent<{ groupId?: string } | undefined>).detail?.groupId;
      const group = latest.current.groups.find((item) => item.id === id);
      if (group) setRenaming(group);
    };
    window.addEventListener('kalkidan-rename-project', onRename);
    return () => window.removeEventListener('kalkidan-rename-project', onRename);
  }, []);
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
    // A new chat that has no first message yet. It stays open while the user is on other pages.
    const draft = session.id.startsWith('draft-');
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
            className={kind === 'recent' ? childButton : rowButton}
            // The title gets the full row. The agent and the code folder show in the tooltip
            // only: the project row above gives the context.
            title={[title, agentLabel(session.agent), folder].filter(Boolean).join(' · ')}
            aria-label={kind === 'pinned' ? `Resume pinned ${title}` : `Chat: ${title}`}
            aria-current={current ? 'page' : undefined}
            onClick={() => onResume(session)}
          >
            {/* The status mark replaces the agent icon. It is before the title, so the ⋯
                button at the end never hides it. */}
            <StatusMark {...statusOf(session)} draft={draft} />
            <span className="tree-label">{title}</span>
            {task?.number && (
              <span className="tree-task-number" title={`Task #${task.number}: ${task.title}`}>
                #{task.number}
              </span>
            )}
          </Button>
          {/* Only … shows on hover, over the end of the title. Pin is in its menu. */}
          <ChatActionsDropdown
            size="xs"
            className="tree-row-menu tree-row-overlay"
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
    // A draft is not saved until its first message. It shows first while it is open, so the
    // user can go back to its unsent text, and when its launch was refused or failed. It does
    // not count as a chat of the project.
    const unsaved = sessions.filter((s) => {
      const outcome = draftOutcomes[activityKey(s.agent, s.id)]?.outcome;
      return (
        s.id.startsWith('draft-') &&
        (outcome === 'refused' ||
          outcome === 'failed' ||
          openChats.some((chat) => sameSession(chat.session, s))) &&
        group.repoIds.includes(sessionRepo(s, allRepos)?.id || '')
      );
    });
    // The code folder shows only when the project has more than one.
    const folderOf = (session: Session) =>
      members.length > 1 ? sessionRepo(session, allRepos)?.name : undefined;
    return [
      ...unsaved.map((session) => sessionRow(session, 'recent', folderOf(session))),
      ...recent.map((session) => sessionRow(session, 'recent', folderOf(session))),
      ...(all.length > recent.length
        ? [
            <div
              key={group.id + ':more'}
              className="tree-row tree-session-row tree-more-row row-hover row-focus"
            >
              <Button
                variant="ghost"
                className={childButton}
                title={`See all chats of ${group.name}`}
                onClick={() => (onProjectChats || onProject)(group)}
              >
                <span className="status-mark" aria-hidden="true" />
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
  const waiting = useNeedsYou(sessions, allRepos).length;
  const showAddFolder = (group: ProjectGroup) =>
    setAddFolder((current) => ({ groupId: group.id, at: (current?.at || 0) + 1 }));
  // The one project menu. The project header has the same items in the same order.
  function projectActions(group: ProjectGroup, host?: RemoteHost) {
    return projectMenuActions({
      busy,
      onNewChat: () => (onNewChatIn ? onNewChatIn(group) : onProject(group)),
      onNewTask: () => (onNewTaskIn ? onNewTaskIn(group) : openProjectPage(group.id, 'tasks')),
      onNewPage: () => (onNewPageIn ? onNewPageIn(group) : openProjectPage(group.id, 'knowledge')),
      onAddFolder: () => showAddFolder(group),
      onRename: () => setRenaming(group),
      onUsage: onUsage ? () => onUsage(group) : undefined,
      onSettings: () => openSettings(group),
      reconnect:
        host && host.status !== 'connected'
          ? {
              host: host.name,
              disabled: reconnecting === host.id || host.status === 'connecting',
              run: () => void reconnect(host),
            }
          : undefined,
    });
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
    if (!isRow(target) || event.altKey || event.metaKey) return;
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
        if (isRow(event.target as HTMLElement)) activeRow.current = event.target as HTMLElement;
      }}
    >
      {/* The nav rows. Their order never changes: "Waiting for you" is always the last. */}
      {onNewChat && (
        <NavRow
          className="tree-new-chat"
          icon={<SquarePen />}
          label="New chat"
          onClick={onNewChat}
          actions={
            <kbd className="kbd tree-kbd" aria-hidden="true">
              {shortcutLabel(['mod'], 'N')}
            </kbd>
          }
        />
      )}
      <NavRow
        icon={<LayoutGrid />}
        label="Projects"
        current={overviewCurrent}
        onClick={onOverview}
      />
      {/* Before the first project, the lists are empty. Only Projects shows. */}
      {onAllSessions && groups.length > 0 && (
        <NavRow
          icon={<MessagesSquare />}
          label="All chats"
          current={allSessionsCurrent}
          onClick={onAllSessions}
        />
      )}
      {onWaiting && groups.length > 0 && (
        <NavRow
          className="tree-waiting"
          icon={<Inbox />}
          label="Waiting for you"
          count={waiting || undefined}
          current={waitingCurrent}
          onClick={onWaiting}
        />
      )}
      {(pinned.length > 0 || views.length > 0) && (
        <section className="pinned-sessions" aria-labelledby="tree-pinned">
          <h2 id="tree-pinned" className="group-label tree-heading">
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
                  <span className="tree-label has-secondary">{view.name}</span>
                  <span className="tree-secondary">{group.name}</span>
                </Button>
              </div>
            </TreeContextMenu>
          ))}
        </section>
      )}
      {/* The heading always shows, so the tree does not move when a chat opens. */}
      {groups.length > 0 && (
        <div className="tree-heading tree-projects-heading">
          <h2 className="group-label">Your projects</h2>
          <Hint label="New project" shortcut={shortcutLabel(['mod', 'shift'], 'N')}>
            <Button
              variant="ghost"
              size="icon-xs"
              className="tree-row-action"
              disabled={busy}
              aria-label="New project"
              onClick={() => setCreating(true)}
            >
              <Plus />
            </Button>
          </Hint>
        </div>
      )}
      {groups.map((group) => {
        const members = allRepos.filter((repo) => group.repoIds.includes(repo.id));
        const projectCurrent = activeGroup === group.id && !activeSession;
        const activeRepo = activeSession ? sessionRepo(activeSession, allRepos) : undefined;
        const host = hosts.find((h) => h.id === group.hostId);
        const open = !collapsed.has(group.id);
        const chatShows =
          open &&
          !!activeSession &&
          projectSessions(sessions, group, allRepos)
            .filter((s) => !s.organization?.pinned)
            .slice(0, recentLimit)
            .some((s) => sameSession(activeSession, s));
        // The tree has one strong highlight. A project page, a code folder page, or a chat that
        // does not show under the project selects the project row. A chat that shows under it
        // selects the chat row, and the project row only gets its label in the foreground.
        const containsCurrent = activeRepo
          ? group.repoIds.includes(activeRepo.id)
          : !activeGroup && members.some((repo) => selected === repo.id);
        const rowSelected = projectCurrent || (containsCurrent && !chatShows);
        const groupState = strongestActivity([
          ...members.map((repo) => activity[repo.id]),
          ...published
            .filter((item) => group.repoIds.includes(sessionRepo(item, allRepos)?.id || ''))
            .map((item) => item.state),
        ]);
        const actions = projectActions(group, host);
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
            <TreeContextMenu label="Project actions" actions={actions}>
              <div
                className={
                  'tree-row tree-top-row project-group-heading row-hover row-focus' +
                  (rowSelected
                    ? ' selected row-selected'
                    : containsCurrent
                      ? ' contains-current'
                      : '')
                }
              >
                <CollapsibleTrigger asChild>
                  <Button
                    variant="bare"
                    className="tree-toggle tree-icon"
                    aria-label={`${open ? 'Collapse' : 'Expand'} ${group.name}`}
                  >
                    {open ? (
                      <FolderOpen
                        className="size-4"
                        style={{ color: group.color ? projectColors[group.color] : undefined }}
                      />
                    ) : (
                      <Folder
                        className="size-4"
                        style={{ color: group.color ? projectColors[group.color] : undefined }}
                      />
                    )}
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
                  {!open && groupState && (
                    <span className="tree-group-mark">
                      <StatusMark state={groupState} />
                    </span>
                  )}
                </Button>
                <TreeActionsMenu
                  className="tree-row-menu"
                  disabled={busy}
                  label={`Manage project ${group.name}`}
                  actions={actions}
                />
              </div>
            </TreeContextMenu>
            <CollapsibleContent className="project-group-children">
              {chats}
              {clones.map((clone) => (
                <div key={clone.id} className="tree-row tree-cloning" role="status">
                  <span className="status-mark">
                    <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                  </span>
                  <span className="tree-label">Cloning {clone.name}…</span>
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        );
      })}
      {/* Without projects, the page shows the only "New project" action. */}
      {searching &&
        !repos.some((repo) => groups.some((group) => group.repoIds.includes(repo.id))) && (
          <p className="tree-no-match">No matching projects or code folders.</p>
        )}
      {/* The dialog stays mounted, as it did when each project row had its own button. */}
      <AddRepository
        key={addFolder?.groupId}
        api={api}
        groupId={addFolder?.groupId}
        trigger={false}
        openRequest={addFolder?.at}
        initialSource={addFolder?.source}
        onRefresh={onRefresh}
        onNotice={onNotice}
      />
      {chatMenus.dialogs}
      <RenameDialog
        open={!!renaming}
        title="Rename project"
        label="Project name"
        value={renaming?.name || ''}
        onOpenChange={(open) => !open && setRenaming(null)}
        save={async (name) => {
          if (!renaming) return;
          await api.updateGroup(renaming.id, name);
          await onRefresh();
        }}
      />
      <CreateProject
        api={api}
        open={creating}
        onOpenChange={setCreating}
        onCreated={async (group) => {
          await onRefresh();
          onProject(group);
        }}
      />
    </div>
  );
}
