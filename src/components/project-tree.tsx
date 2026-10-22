import { projectColors, type ProjectColor } from '../domain/project-colors';
import {
  ActivityDot,
  activityKey,
  strongestActivity,
  useActivityState,
  useChatStatus,
  type SessionActivityState,
} from './activity-dot';
import { TreeActionsMenu, TreeContextMenu, type TreeAction } from './tree-context-menu';
import { projectSessions, sessionRepo } from '../lib/session-repository';
import { errorMessage } from '../lib/errors';
import { CreateProject } from './create-project';
import { ProjectSettingsDialog, type ProjectSettingsTab } from './project-settings-dialog';
import type { ProjectDocMetadata } from '../domain/docs';
import { openProjectPage } from './project-tabs';
import { AddRepository } from './add-repository';
import { ChatActionsDropdown, ChatContextMenu } from './chat-action-menu';
import { useChatListActions } from './chat-list-actions';
import { viewArchivedSessions } from './session-browser';
import { Hint } from './hint';
import { plural, shortcutLabel } from '../lib/platform';
import { interfaceConfig } from '../config/interface';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  ChevronDown,
  Eye,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  LayoutGrid,
  Loader2,
  MessageSquarePlus,
  MessagesSquare,
  PenLine,
  Plus,
  Settings2,
  SquarePen,
  Unplug,
} from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from './ui/collapsible';
import { AgentIcon } from './ui/agent-icon';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { showToast } from './ui/toast';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import type { API, Project, ProjectGroup, Session, RemoteHost, TrackerItem } from '../types';

const collapsedKey = 'kalkidan-collapsed-projects';
const docsOpenKey = 'kalkidan-sidebar-docs-open';
/** The sidebar shows this many doc pages under each project. "All pages" opens the rest. */
const docLimit = 8;
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
const titleOf = (session: Session) => session.organization?.title || session.title;
const sameSession = (a: Session | null | undefined, b: Session) =>
  !!a && a.agent === b.agent && a.id === b.id;
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
  activePage,
  activeDoc,
  query = '',
}: {
  /** The page of the open project, such as 'docs'. */
  activePage?: string;
  /** The doc page that shows, for the selected Docs row. */
  activeDoc?: string;
  /** Starts a new chat where the user works now. The top row of the sidebar runs it. */
  onNewChat?: () => void;
  /** Starts a new chat in a project. The project row shows it on hover. */
  onNewChatIn?: (group: ProjectGroup) => void;
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
  const [removing, setRemoving] = useState<
    { kind: 'repository'; item: Project } | { kind: 'project'; item: ProjectGroup } | null
  >(null);
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
  const { drafts: draftOutcomes } = useActivityState();
  const running = (session: Session) =>
    openChats.find((chat) => sameSession(chat.session, session))?.state ||
    sessionActivity[activityKey(session.agent, session.id)];
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
      return {
        open: sameSession(activeSession, session),
        running: !!running(session),
        linkedTask: !!(taskOf?.(session) || session.organization?.taskId || session.task?.id),
        repository: !!repo,
        project: !!repo && groups.some((g) => g.repoIds.includes(repo.id)),
      };
    },
  });
  const [creating, setCreating] = useState(false);
  // The Project settings dialog. The row menu, the project header and other pages open it.
  const [settings, setSettings] = useState<{
    groupId: string;
    tab?: ProjectSettingsTab;
    section?: 'general' | 'folders' | 'board';
    rename?: boolean;
  } | null>(null);
  const settingsGroup = settings && groups.find((group) => group.id === settings.groupId);
  const openSettings = (group: ProjectGroup, tab?: ProjectSettingsTab, rename = false) =>
    setSettings({ groupId: group.id, tab, rename });
  const latest = useRef({ groups, activeGroup });
  latest.current = { groups, activeGroup };
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (
        event as CustomEvent<{ groupId?: string; tab?: string; section?: string } | undefined>
      ).detail;
      // An event without a project is for the project that shows.
      const id = detail?.groupId || latest.current.activeGroup;
      if (!id || !latest.current.groups.some((group) => group.id === id)) return;
      const section = (['general', 'folders', 'board'] as const).find(
        (value) => value === detail?.section,
      );
      setSettings({ groupId: id, tab: detail?.tab as ProjectSettingsTab | undefined, section });
    };
    window.addEventListener('kalkidan-open-project-settings', onOpen);
    return () => window.removeEventListener('kalkidan-open-project-settings', onOpen);
  }, []);
  /** Tells the project page to load its board again. */
  const boardChanged = (groupId: string) =>
    window.dispatchEvent(new CustomEvent('kalkidan-github-writes', { detail: { groupId } }));
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
  // The Docs row under each project. It starts closed. Its pages load when it opens.
  const [docsOpen, setDocsOpen] = useState(() => savedCollapsed(docsOpenKey));
  const [docPages, setDocPages] = useState<Record<string, ProjectDocMetadata[] | undefined>>({});
  function loadDocs(groupId: string) {
    if (typeof api.docsMetadata !== 'function') return;
    Promise.resolve()
      .then(() => api.docsMetadata(groupId))
      .then((pages) => setDocPages((current) => ({ ...current, [groupId]: pages })))
      .catch(() => setDocPages((current) => ({ ...current, [groupId]: [] })));
  }
  useEffect(() => {
    for (const id of docsOpen) if (groups.some((group) => group.id === id)) loadDocs(id);
  }, [groups.map((group) => group.id).join(','), activeDoc]);
  function toggleDocs(groupId: string, open: boolean) {
    if (open) loadDocs(groupId);
    setDocsOpen((current) => {
      const next = new Set(current);
      if (open) next.add(groupId);
      else next.delete(groupId);
      try {
        localStorage.setItem(docsOpenKey, JSON.stringify([...next]));
      } catch {
        /* Optional preference. */
      }
      return next;
    });
  }
  /** The Docs row of a project and, when it is open, its top pages. */
  function docsRows(group: ProjectGroup) {
    const open = docsOpen.has(group.id);
    const pages = (docPages[group.id] || [])
      .filter((page) => !page.parentId)
      .sort(
        (a, b) =>
          (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
          a.title.localeCompare(b.title),
      );
    const docsCurrent = activeGroup === group.id && activePage === 'docs' && !activeSession;
    const pageRow = (
      key: string,
      label: string,
      open: () => void,
      current = false,
      more = false,
    ) => (
      <div
        key={key}
        className={
          'tree-row tree-session-row tree-doc-row row-hover row-focus' +
          (more ? ' tree-more-row' : '') +
          (current ? ' selected row-selected' : '')
        }
      >
        <Button
          variant="ghost"
          className={rowButton}
          title={label}
          aria-current={current ? 'page' : undefined}
          onClick={open}
        >
          <span className="tree-label">{label}</span>
        </Button>
      </div>
    );
    return (
      <Collapsible
        key={group.id + ':docs'}
        open={open}
        onOpenChange={(value) => toggleDocs(group.id, value)}
      >
        <div
          className={
            'tree-row tree-session-row tree-docs-row row-hover row-focus' +
            (docsCurrent && !activeDoc ? ' selected row-selected' : '')
          }
        >
          <CollapsibleTrigger asChild>
            <Button variant="ghost" className={rowButton} aria-label={`Docs of ${group.name}`}>
              <span className="tree-icon">
                <FileText className="size-3.5" />
              </span>
              <span className="tree-label">Docs</span>
              <ChevronDown
                className={'tree-docs-chevron size-3.5' + (open ? '' : ' -rotate-90')}
                aria-hidden="true"
              />
            </Button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          {docPages[group.id] === undefined ? (
            <div className="tree-row tree-empty tree-doc-row" role="status">
              <span className="tree-label">Loading pages…</span>
            </div>
          ) : pages.length ? (
            [
              ...pages
                .slice(0, docLimit)
                .map((page) =>
                  pageRow(
                    page.id,
                    page.title || 'Untitled',
                    () => openProjectPage(group.id, 'docs', { docId: page.id }),
                    docsCurrent && activeDoc === page.id,
                  ),
                ),
              ...(pages.length > docLimit
                ? [
                    pageRow(
                      'all',
                      `All ${plural(pages.length, 'page')}`,
                      () => openProjectPage(group.id, 'docs'),
                      false,
                      true,
                    ),
                  ]
                : []),
            ]
          ) : (
            pageRow('none', 'No pages yet', () => openProjectPage(group.id, 'docs'), false, true)
          )}
        </CollapsibleContent>
      </Collapsible>
    );
  }
  /** One chat row: in Pinned, or under its project. */
  function sessionRow(session: Session, kind: 'pinned' | 'recent', folder?: string) {
    const title = titleOf(session);
    const current = sameSession(activeSession, session);
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
            // The title gets the full row. The code folder shows in the tooltip only: the
            // project row above gives the context.
            title={folder ? `${title} · ${folder}` : title}
            aria-label={kind === 'pinned' ? `Resume pinned ${title}` : `Chat: ${title}`}
            aria-current={current ? 'page' : undefined}
            onClick={() => onResume(session)}
          >
            <span className="tree-icon">
              <AgentIcon agent={session.agent} className="size-3.5" />
            </span>
            <span className="tree-label">{title}</span>
            {task?.number && (
              <span className="tree-task-number" title={`Task #${task.number}: ${task.title}`}>
                #{task.number}
              </span>
            )}
            <ActivityDot {...statusOf(session)} />
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
    // A draft whose launch was refused or failed is not saved. It shows first, with its dot,
    // while the app runs. It does not count as a chat of the project.
    const unsaved = sessions.filter((s) => {
      const outcome = draftOutcomes[activityKey(s.agent, s.id)]?.outcome;
      return (
        s.id.startsWith('draft-') &&
        (outcome === 'refused' || outcome === 'failed') &&
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
  const icon = (Icon: typeof Folder) => <Icon className="size-4" />;
  // Navigation to the project pages is in the project tabs. The menu has no copies of it.
  function projectActions(group: ProjectGroup, host?: RemoteHost): TreeAction[] {
    return [
      ...(onNewChatIn
        ? [
            {
              label: 'New chat',
              icon: icon(MessageSquarePlus),
              action: () => onNewChatIn(group),
            },
          ]
        : []),
      { label: 'Open project', icon: icon(FolderOpen), action: () => onProject(group) },
      ...(host && host.status !== 'connected'
        ? [
            {
              label: `Reconnect to ${host.name}`,
              icon: icon(Unplug),
              disabled: reconnecting === host.id || host.status === 'connecting',
              action: () => void reconnect(host),
            },
          ]
        : []),
      {
        label: 'Add a code folder…',
        icon: icon(FolderPlus),
        separator: true,
        disabled: busy,
        action: () => showAddFolder(group),
      },
      {
        label: 'Rename…',
        icon: icon(PenLine),
        disabled: busy,
        action: () => openSettings(group, 'general', true),
      },
      {
        label: 'Project settings…',
        icon: icon(Settings2),
        action: () => openSettings(group),
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
      {onNewChat && (
        <div className="tree-row tree-top-row tree-nav-row tree-new-chat row-hover row-focus">
          <Button variant="ghost" className={rowButton} onClick={onNewChat}>
            <span className="tree-icon">
              <SquarePen className="size-3.5" />
            </span>
            <span className="tree-label">New chat</span>
            <kbd className="kbd tree-kbd" aria-hidden="true">
              {shortcutLabel(['mod'], 'N')}
            </kbd>
          </Button>
        </div>
      )}
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
            onClick={() => setCreating(true)}
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
                {onNewChatIn && (
                  <Hint label={`New chat in ${group.name}`}>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="tree-row-menu"
                      aria-label={`New chat in ${group.name}`}
                      onClick={() => onNewChatIn(group)}
                    >
                      <Plus />
                    </Button>
                  </Hint>
                )}
                <TreeActionsMenu
                  className="tree-row-menu"
                  disabled={busy}
                  label={`Manage project ${group.name}`}
                  folderColor={folderColor}
                  actions={actions}
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
              {docsRows(group)}
            </CollapsibleContent>
          </Collapsible>
        );
      })}
      {/* The page shows the empty state. The sidebar has only one labeled button. */}
      {!groups.length ? (
        <Button
          variant="outline"
          size="sm"
          className="tree-new-project"
          disabled={busy}
          onClick={() => setCreating(true)}
        >
          <FolderPlus />
          New project
        </Button>
      ) : (
        searching &&
        !repos.some((repo) => groups.some((group) => group.repoIds.includes(repo.id))) && (
          <p className="tree-no-match">No matching projects or code folders.</p>
        )
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
        open={creating}
        onOpenChange={setCreating}
        onCreated={async (group) => {
          await onRefresh();
          onProject(group);
        }}
      />
      {settingsGroup && (
        <ProjectSettingsDialog
          api={api}
          group={settingsGroup}
          repos={allRepos}
          host={hosts.find((h) => h.id === settingsGroup.hostId)}
          open={!!settings}
          tab={settings?.tab}
          section={settings?.section}
          focusName={!!settings?.rename}
          onOpenChange={(open) => {
            if (open) return;
            setSettings(null);
            boardChanged(settingsGroup.id);
            void onRefresh();
          }}
          onSaved={() => void onRefresh()}
          onChanged={() => boardChanged(settingsGroup.id)}
          onConnected={async () => {
            await onRefresh();
            // A connected board shows its tasks on the project page that shows.
            if (latest.current.activeGroup === settingsGroup.id)
              openProjectPage(settingsGroup.id, 'tasks');
          }}
          onDisconnected={async () => {
            await onRefresh();
            if (latest.current.activeGroup === settingsGroup.id)
              openProjectPage(settingsGroup.id, 'board');
          }}
          onAddFolder={() => showAddFolder(settingsGroup)}
          onRemoveFolder={(repo) => setRemoving({ kind: 'repository', item: repo })}
          onRemoveProject={() => setRemoving({ kind: 'project', item: settingsGroup })}
        />
      )}
    </div>
  );
}
