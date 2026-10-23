import {
  activityKey,
  answerApproval,
  itemStatusOf,
  useActivityState,
  useChatStatus,
  type SessionActivityState,
} from './activity-dot';
import {
  projectMenuActions,
  TreeActionsMenu,
  TreeContextMenu,
  type TreeAction,
} from './tree-context-menu';
import { sessionRepo } from '../lib/session-repository';
import { errorMessage } from '../lib/errors';
import { CreateProject } from './create-project';
import { openProjectSettings } from './settings-dialog';
import { trackerConnection } from '../domain/tracker';
import { AddRepository } from './add-repository';
import { ChatActionsDropdown, ChatContextMenu } from './chat-action-menu';
import { useChatListActions } from './chat-list-actions';
import { Hint } from './hint';
import { plural, shortcutLabel } from '../lib/platform';
import { interfaceConfig } from '../config/interface';
import {
  getIdentityOverride,
  setIdentityOverride,
  strongestStatus,
  type IdentityColor,
  type IdentityKind,
  type ItemStatus,
} from '../domain/identity';
import {
  subagentsOf,
  type Subagent,
  type WorkspaceIdentity,
} from '../hooks/use-workspace-identity';
import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type HTMLAttributes,
  type KeyboardEvent,
  type ReactNode,
  type Ref,
} from 'react';
import { AppWindow, ChevronDown, ChevronRight, Loader2, Plus, SquarePen } from 'lucide-react';
import { Button } from './ui/button';
import { IdentityMark } from './ui/identity-mark';
import { StatusGlyph } from './ui/status-glyph';
import { NavRow } from './ui/nav-row';
import { showToast } from './ui/toast';
import { RenameDialog } from './session-actions';
import { ProjectUsageContextMenuItem } from './project-usage';
import type { ChatMenuGroup, ChatMenuItem } from '../domain/chat-actions';
import type { API, Project, ProjectGroup, Session, RemoteHost, TrackerItem } from '../types';

/** The rows that the user opened or closed. The others use their default. */
const openKey = 'kalkidan-tree-open';
/** Each code folder shows its latest chats. "Show more" shows the others. */
const recentLimit = interfaceConfig.recentChats;
function savedOpen(): Record<string, boolean> {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(openKey) || '{}');
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, boolean>)
      : {};
  } catch {
    return {};
  }
}
const titleOf = (session: Session) => session.organization?.title || session.title;
const sameSession = (a: Session | null | undefined, b: Session) =>
  !!a && a.agent === b.agent && a.id === b.id;
/** The status glyph of a child run, from the words of the snapshot. */
function subagentStatus(child: Subagent): ItemStatus | null {
  const value = (child.status || '').toLowerCase();
  if (/run|work|progress|active/.test(value)) return 'working';
  if (/wait|approv|question|input/.test(value)) return 'needs-you';
  if (/fail|error|refus/.test(value)) return 'failed';
  return null;
}
/** The main buttons of the visible tree rows, in order. */
const rowSelector = '.tree-row-button, .nav-row-main, .tree-root-button';
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

/**
 * One row of the tree: a chevron column, the identity mark, the name, an optional muted meta
 * (the branch of a code folder), the status glyph and the ⋯ menu. The depth sets the indent:
 * 16px for each level.
 */
function TreeRow({
  depth,
  kind,
  color,
  label,
  title,
  meta,
  status,
  statusLabel,
  open,
  expandable,
  selected,
  current,
  rowKey,
  parentKey,
  name,
  toggleLabel,
  onToggle,
  onClick,
  onDoubleClick,
  onKeyDown,
  trailing,
  menu,
  className,
  ...rest
}: Omit<HTMLAttributes<HTMLDivElement>, 'onClick' | 'onDoubleClick' | 'onKeyDown' | 'title'> & {
  ref?: Ref<HTMLDivElement>;
  depth: number;
  kind: IdentityKind;
  color: IdentityColor;
  label: ReactNode;
  title?: string;
  meta?: ReactNode;
  status?: ItemStatus | null;
  /** The accessible name of the status glyph, such as the reason of a failed run. */
  statusLabel?: string;
  open?: boolean;
  expandable?: boolean;
  selected?: boolean;
  /** aria-current of the main button. */
  current?: boolean;
  rowKey: string;
  parentKey?: string;
  /** The accessible name of the main button. */
  name: string;
  toggleLabel?: string;
  onToggle?: () => void;
  onClick: () => void;
  onDoubleClick?: () => void;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
  /** Icons after the name, such as the window mark. */
  trailing?: ReactNode;
  menu?: ReactNode;
  className?: string;
}) {
  return (
    <div
      {...rest}
      className={
        'tree-row' +
        (selected ? ' selected id-tint-sidebar' : '') +
        (className ? ' ' + className : '')
      }
      data-kind={kind}
      data-depth={depth}
      style={{ '--depth': depth, '--id': `var(--id-${color})` } as CSSProperties}
    >
      <span className="tree-chevron">
        {expandable && (
          <button
            type="button"
            className="tree-toggle"
            tabIndex={-1}
            aria-label={toggleLabel}
            aria-expanded={!!open}
            onClick={onToggle}
          >
            {open ? <ChevronDown aria-hidden="true" /> : <ChevronRight aria-hidden="true" />}
          </button>
        )}
      </span>
      <button
        type="button"
        className="tree-row-button"
        data-key={rowKey}
        data-parent={parentKey}
        data-expandable={expandable ? '' : undefined}
        aria-expanded={expandable ? !!open : undefined}
        aria-label={name}
        aria-current={current ? 'page' : undefined}
        title={title}
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onKeyDown={onKeyDown}
      >
        <IdentityMark kind={kind} color={color} />
        <span className="tree-label">{label}</span>
        {meta && <span className="tree-meta">{meta}</span>}
      </button>
      {trailing}
      <StatusGlyph status={status} label={statusLabel} className="tree-status" />
      {menu}
    </div>
  );
}

export function ProjectTree({
  api,
  allRepos,
  groups,
  sessions,
  identity,
  activeGroup,
  activeSession,
  busy,
  hosts = [],
  scope,
  windowed = [],
  projectsCurrent = false,
  onProjects,
  onProject,
  onOpenWindow,
  onFocusWindow,
  onResume,
  onOpenSubagent,
  taskOf,
  onOpenTask,
  onSessionCommand,
  onRefresh,
  onNotice,
  sessionActivity = {},
  openChats = [],
  cloning = [],
  addFolderRequest,
  onNewChat,
  onNewChatIn,
  repoActions,
  usage,
}: {
  api: API;
  allRepos: Project[];
  groups: ProjectGroup[];
  /** The chats, with the drafts that are not saved yet. */
  sessions: Session[];
  identity: WorkspaceIdentity;
  activeGroup?: string | null;
  activeSession?: Session | null;
  busy: boolean;
  hosts?: RemoteHost[];
  /** In a project window: the project. The tree then starts at its code folders. */
  scope?: string;
  /** Projects that show in their own window. Their rows stay closed here. */
  windowed?: string[];
  /** True when the Projects page shows. */
  projectsCurrent?: boolean;
  /** Opens the Projects page: the root of the tree. */
  onProjects?: () => void;
  onProject: (group: ProjectGroup) => void;
  /** Opens a project in its own window: double-click or "Open in new window". */
  onOpenWindow?: (group: ProjectGroup) => void;
  /** Moves the window of a project to the front. */
  onFocusWindow?: (group: ProjectGroup) => void;
  onResume: (session: Session) => void;
  /** Opens the chat of a subagent at that subagent. */
  onOpenSubagent?: (session: Session, subagent: Subagent) => void;
  /** The board item that a chat works on. */
  taskOf?: (session: Session) => TrackerItem | undefined;
  onOpenTask?: (groupId: string, itemId: string) => void;
  /** Runs a session command, such as "session-commit", in a chat. Opens the chat first. */
  onSessionCommand?: (command: string, session: Session) => void;
  /** Reloads the snapshot without a busy state. */
  onRefresh: () => Promise<unknown>;
  onNotice?: (message: string, error?: boolean) => void;
  /** Background state of open sessions, by `activityKey`. */
  sessionActivity?: Record<string, SessionActivityState>;
  /** Chats that are open in this window, also in the background. */
  openChats?: OpenChat[];
  /** Clones that run after their dialog closed. */
  cloning?: CloneProgress[];
  /** Each new request opens the Add code folders dialog for that project, at its source. */
  addFolderRequest?: { groupId: string; at: number; source?: 'github' | 'local' };
  /** Starts a new chat where the user works now. */
  onNewChat?: () => void;
  /** Starts a new chat in a project, or in one code folder. */
  onNewChatIn?: (group: ProjectGroup, repo?: Project) => void;
  /** The menu of a code folder row. */
  repoActions?: (repo: Project) => TreeAction[];
  /** The props of the Usage row of the project menu. */
  usage?: { sessions: Session[]; repos: Project[] };
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
  /** Working, needs you or failed, or no glyph. */
  const statusOf = (session: Session) => itemStatusOf(chatStatus(session, running(session))?.state);
  const chatMenus = useChatListActions({
    api,
    onResume,
    onSessionCommand,
    onChanged: () => void onRefresh(),
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
  /** The chat menu, with Allow and Deny first while the chat waits for an approval. */
  function chatMenu(session: Session) {
    const menu = chatMenus.menuFor(session);
    if (running(session) !== 'approval') return menu;
    const answer = (allow: boolean) => ({
      id: (allow ? 'allow' : 'deny') as ChatMenuItem['id'],
      label: allow ? 'Allow' : 'Deny',
      group: menu.groups[0]?.group as ChatMenuItem['group'],
      disabled: false,
      definition: {
        run: () => answerApproval(session, allow),
      } as unknown as ChatMenuItem['definition'],
    });
    const groups: ChatMenuGroup[] = [
      {
        group: menu.groups[0]?.group as ChatMenuGroup['group'],
        items: [answer(true), answer(false)],
      },
      ...menu.groups,
    ];
    return { groups, run: menu.run };
  }
  const [creating, setCreating] = useState(false);
  // The Settings page at the project. The shell opens it.
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
  // Rows that the user opened or closed. Other rows open by their default.
  const [opened, setOpened] = useState(savedOpen);
  function setRowOpen(key: string, open: boolean) {
    setOpened((current) => {
      const next = { ...current, [key]: open };
      try {
        localStorage.setItem(openKey, JSON.stringify(next));
      } catch {
        /* Optional preference. */
      }
      return next;
    });
  }
  // Code folders whose chats all show.
  const [showAll, setShowAll] = useState<Set<string>>(() => new Set());
  // The branch of each local code folder, for the muted text after its name.
  const [branches, setBranches] = useState<Record<string, string>>({});
  const asked = useRef(new Set<string>());
  useEffect(() => {
    if (typeof api.workingStatus !== 'function') return;
    for (const repo of allRepos) {
      if (repo.hostId || asked.current.has(repo.id)) continue;
      asked.current.add(repo.id);
      Promise.resolve()
        .then(() => api.workingStatus(repo.id))
        .then((status) => {
          if (status?.branch) setBranches((current) => ({ ...current, [repo.id]: status.branch }));
        })
        .catch(() => {
          // The row shows no branch. Ask again with the next snapshot.
          asked.current.delete(repo.id);
        });
    }
  }, [api, allRepos]);
  const showAddFolder = (group: ProjectGroup) =>
    setAddFolder((current) => ({ groupId: group.id, at: (current?.at || 0) + 1 }));
  // The one project menu. The project header has the same items in the same order.
  function projectActions(group: ProjectGroup, host?: RemoteHost) {
    return projectMenuActions({
      projectName: group.name,
      busy,
      onOpenWindow: onOpenWindow && !scope ? () => onOpenWindow(group) : undefined,
      onNewChat: () => (onNewChatIn ? onNewChatIn(group) : onProject(group)),
      onAddFolder: () => showAddFolder(group),
      onRename: () => setRenaming(group),
      onSettings: () => openSettings(group),
      onRemove: () => openProjectSettings(group.id, 'danger'),
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
  const treeRef = useRef<HTMLDivElement>(null);
  // The row that has the one tab stop of the tree. The arrow keys move it.
  const activeRow = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const tree = treeRef.current;
    if (!tree) return;
    // Row actions (menu, add, toggle) are reachable with the context menu key.
    for (const control of tree.querySelectorAll<HTMLElement>(
      '.tree-row-menu, .tree-row-action, .tree-toggle, .tree-window',
    ))
      control.tabIndex = -1;
    const rows = treeRows(tree);
    const active =
      (activeRow.current && rows.includes(activeRow.current) && activeRow.current) ||
      rows.find((row) => row.getAttribute('aria-current') === 'page') ||
      rows[0];
    for (const row of rows) row.tabIndex = row === active ? 0 : -1;
  });
  function moveFocus(row: HTMLElement | undefined | null) {
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
    const key = target.dataset.key;
    const expandable = target.dataset.expandable !== undefined;
    const expanded = target.getAttribute('aria-expanded') === 'true';
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      moveFocus(rows[index + (event.key === 'ArrowDown' ? 1 : -1)]);
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      moveFocus(event.key === 'Home' ? rows[0] : rows[rows.length - 1]);
    } else if (event.key === 'ArrowRight' && key) {
      event.preventDefault();
      if (expandable && !expanded) setRowOpen(key, true);
      else if (expandable) moveFocus(rows[index + 1]);
    } else if (event.key === 'ArrowLeft' && key) {
      event.preventDefault();
      if (expandable && expanded) setRowOpen(key, false);
      else if (target.dataset.parent)
        moveFocus(
          treeRef.current!.querySelector<HTMLElement>(
            `.tree-row-button[data-key="${CSS.escape(target.dataset.parent)}"]`,
          ),
        );
    }
  }
  const activeRepo = activeSession ? sessionRepo(activeSession, allRepos) : undefined;
  /** The chats of a code folder that the tree shows: open drafts first, then newest first. */
  function repoSessions(repo: Project) {
    const own = (s: Session) => sessionRepo(s, allRepos)?.id === repo.id;
    const drafts = sessions.filter((s) => {
      const outcome = draftOutcomes[activityKey(s.agent, s.id)]?.outcome;
      return (
        s.id.startsWith('draft-') &&
        own(s) &&
        (outcome === 'refused' ||
          outcome === 'failed' ||
          openChats.some((chat) => sameSession(chat.session, s)))
      );
    });
    const saved = sessions
      .filter((s) => !s.id.startsWith('draft-') && !s.organization?.archived && own(s))
      .sort(
        (a, b) =>
          Number(!!b.organization?.pinned) - Number(!!a.organization?.pinned) ||
          (b.updatedAt || '').localeCompare(a.updatedAt || ''),
      );
    return { drafts, saved };
  }
  function sessionRows(session: Session, depth: number, parentKey: string, repo: Project) {
    const key = 'session:' + activityKey(session.agent, session.id);
    const children = subagentsOf(session);
    const info = chatStatus(session, running(session));
    const own = itemStatusOf(info?.state);
    const childStatus = children.map(subagentStatus);
    const current = sameSession(activeSession, session);
    const open = opened[key] ?? (current || childStatus.includes('working'));
    const title = titleOf(session) || 'New chat';
    const task = taskOf?.(session);
    const menu = chatMenu(session);
    const color = identity.session(session);
    const row = (
      <ChatContextMenu key={key} groups={menu.groups} onRun={menu.run}>
        <TreeRow
          depth={depth}
          kind="session"
          color={color}
          rowKey={key}
          parentKey={parentKey}
          label={title}
          title={[title, task?.number ? `Task #${task.number}` : '', repo.name]
            .filter(Boolean)
            .join(' · ')}
          name={`Chat: ${title}`}
          status={open || !children.length ? own : strongestStatus([own, ...childStatus])}
          statusLabel={open || !children.length ? info?.label : undefined}
          expandable={children.length > 0}
          open={open}
          toggleLabel={`${open ? 'Hide' : 'Show'} the subagents of ${title}`}
          onToggle={() => setRowOpen(key, !open)}
          selected={current}
          current={current}
          className={session.id.startsWith('draft-') ? 'tree-row-draft' : undefined}
          onClick={() => onResume(session)}
          menu={
            <ChatActionsDropdown
              size="xs"
              className="tree-row-menu"
              label={`${title} actions`}
              groups={menu.groups}
              onRun={menu.run}
            />
          }
        />
      </ChatContextMenu>
    );
    if (!open || !children.length) return [row];
    return [
      row,
      ...children.map((child) => (
        <TreeRow
          key={key + ':' + child.id}
          depth={depth + 1}
          kind="subagent"
          color={identity.subagent(session, child.id)}
          rowKey={key + ':' + child.id}
          parentKey={key}
          label={child.title}
          meta={child.type}
          title={[child.type, child.title, child.status, `Subagent of ${title}`]
            .filter(Boolean)
            .join(' · ')}
          name={`Subagent: ${child.title}`}
          status={subagentStatus(child)}
          onClick={() => (onOpenSubagent ? onOpenSubagent(session, child) : onResume(session))}
        />
      )),
    ];
  }
  function repoRows(repo: Project, group: ProjectGroup, depth: number, parentKey: string) {
    const key = 'repo:' + repo.id;
    const { drafts, saved } = repoSessions(repo);
    const all = [...drafts, ...saved];
    const contains = !!activeRepo && activeRepo.id === repo.id;
    const busyChild = all.some((s) => statusOf(s));
    // The newest chat by time, in the order of the snapshot (as latestInProject). Pinned chats
    // sort first in `saved`, so saved[0] can be an older chat.
    const newest = sessions
      .filter((s) => saved.includes(s))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
    const latestInProject = sessions
      .filter((s) => group.repoIds.includes(sessionRepo(s, allRepos)?.id || ''))
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))[0];
    const open =
      opened[key] ?? (contains || busyChild || (!!newest && sameSession(latestInProject, newest)));
    const visible = showAll.has(repo.id) ? saved : saved.slice(0, recentLimit);
    const rollup = strongestStatus(
      all.flatMap((s) => [statusOf(s), ...subagentsOf(s).map(subagentStatus)]),
    );
    const actions = repoActions?.(repo) || [];
    const row = (
      <TreeContextMenu
        key={key}
        label={`${repo.name} actions`}
        actions={actions}
        disabled={!actions.length}
      >
        <TreeRow
          depth={depth}
          kind="repo"
          color={identity.repo(repo)}
          rowKey={key}
          parentKey={parentKey}
          label={repo.name}
          title={repo.path}
          meta={branches[repo.id]}
          name={repo.name}
          status={open ? null : rollup}
          expandable={all.length > 0}
          open={open && all.length > 0}
          toggleLabel={`${open ? 'Collapse' : 'Expand'} ${repo.name}`}
          onToggle={() => setRowOpen(key, !open)}
          onClick={() => (all.length ? setRowOpen(key, !open) : onNewChatIn?.(group, repo))}
          menu={
            actions.length > 0 && (
              <TreeActionsMenu
                className="tree-row-menu"
                label={`${repo.name} actions`}
                actions={actions}
              />
            )
          }
        />
      </TreeContextMenu>
    );
    if (!open || !all.length) return [row];
    return [
      row,
      ...drafts.flatMap((s) => sessionRows(s, depth + 1, key, repo)),
      ...visible.flatMap((s) => sessionRows(s, depth + 1, key, repo)),
      ...(saved.length > visible.length
        ? [
            <div
              key={key + ':more'}
              className="tree-row tree-more-row"
              style={{ '--depth': depth + 1 } as CSSProperties}
            >
              <span className="tree-chevron" />
              <button
                type="button"
                className="tree-row-button"
                data-key={key + ':more'}
                data-parent={key}
                onClick={() => setShowAll((current) => new Set(current).add(repo.id))}
              >
                <span className="identity-slot" aria-hidden="true" />
                <span className="tree-label">
                  Show {plural(saved.length - visible.length, 'more chat')}
                </span>
              </button>
            </div>,
          ]
        : []),
    ];
  }
  function projectRows(group: ProjectGroup) {
    const key = 'project:' + group.id;
    const members = allRepos.filter((repo) => group.repoIds.includes(repo.id));
    const host = hosts.find((h) => h.id === group.hostId);
    const elsewhere = windowed.includes(group.id);
    const contains = !!activeRepo && group.repoIds.includes(activeRepo.id);
    const open = !elsewhere && (opened[key] ?? (contains || activeGroup === group.id));
    const projectCurrent = activeGroup === group.id && !activeSession;
    const rollup = strongestStatus(
      members.flatMap((repo) => {
        const { drafts, saved } = repoSessions(repo);
        return [...drafts, ...saved].flatMap((s) => [
          statusOf(s),
          ...subagentsOf(s).map(subagentStatus),
        ]);
      }),
    );
    const hostStatus = host?.status || 'disconnected';
    const hostLabel = group.hostId
      ? `SSH: ${host?.target || host?.name || 'remote host'} · ${hostStatus}` +
        (host?.error ? ` · ${host.error}` : '')
      : '';
    const actions = projectActions(group, host);
    const color = identity.project(group);
    const usageRow = usage ? (
      <ProjectUsageContextMenuItem
        api={api}
        group={group}
        sessions={usage.sessions}
        repos={usage.repos}
      />
    ) : undefined;
    const clones = cloning.filter((clone) => clone.groupId === group.id);
    const row = (
      <TreeContextMenu
        key={key}
        label="Project actions"
        actions={actions}
        color={{
          value: color,
          chosen: !!getIdentityOverride('project', group.name),
          onChange: (next) => setIdentityOverride('project', group.name, next),
        }}
        extra={usageRow}
      >
        <TreeRow
          depth={0}
          kind="project"
          color={color}
          rowKey={key}
          label={group.name}
          title={hostLabel ? `${group.name} · ${hostLabel}` : group.name}
          meta={group.hostId ? 'SSH' : undefined}
          name={group.name}
          status={open ? null : rollup}
          expandable
          open={open}
          toggleLabel={`${open ? 'Collapse' : 'Expand'} ${group.name}`}
          onToggle={() =>
            elsewhere && onFocusWindow ? onFocusWindow(group) : setRowOpen(key, !open)
          }
          selected={projectCurrent}
          current={projectCurrent}
          onClick={() => (elsewhere && onFocusWindow ? onFocusWindow(group) : onProject(group))}
          onDoubleClick={onOpenWindow ? () => onOpenWindow(group) : undefined}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && event.shiftKey && onOpenWindow) {
              event.preventDefault();
              onOpenWindow(group);
            }
          }}
          trailing={
            elsewhere && (
              <Hint label={`${group.name} is open in its own window`}>
                <button
                  type="button"
                  className="tree-window"
                  aria-label={`Show the ${group.name} window`}
                  onClick={() => onFocusWindow?.(group)}
                >
                  <AppWindow aria-hidden="true" />
                </button>
              </Hint>
            )
          }
          menu={
            <TreeActionsMenu
              className="tree-row-menu"
              disabled={busy}
              label={`Manage project ${group.name}`}
              actions={actions}
            />
          }
        />
      </TreeContextMenu>
    );
    if (!open) return [row];
    return [
      row,
      ...members.flatMap((repo) => repoRows(repo, group, 1, key)),
      ...clones.map((clone) => (
        <div
          key={clone.id}
          className="tree-row tree-cloning"
          role="status"
          style={{ '--depth': 1 } as CSSProperties}
        >
          <span className="tree-chevron" />
          <span className="identity-slot">
            <Loader2 className="size-3 animate-spin" aria-hidden="true" />
          </span>
          <span className="tree-label">Cloning {clone.name}…</span>
        </div>
      )),
    ];
  }
  const scoped = scope ? groups.find((group) => group.id === scope) : undefined;
  return (
    <div
      ref={treeRef}
      className="project-list project-tree"
      onKeyDown={onTreeKey}
      onFocus={(event) => {
        if (isRow(event.target as HTMLElement)) activeRow.current = event.target as HTMLElement;
      }}
    >
      {onNewChat && !scope && (
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
      {scoped ? (
        <div className="tree-scope" role="group" aria-label={`${scoped.name} code folders`}>
          {allRepos
            .filter((repo) => scoped.repoIds.includes(repo.id))
            .flatMap((repo) => repoRows(repo, scoped, 0, ''))}
          {cloning
            .filter((clone) => clone.groupId === scoped.id)
            .map((clone) => (
              <div key={clone.id} className="tree-row tree-cloning" role="status">
                <span className="tree-chevron" />
                <span className="identity-slot">
                  <Loader2 className="size-3 animate-spin" aria-hidden="true" />
                </span>
                <span className="tree-label">Cloning {clone.name}…</span>
              </div>
            ))}
        </div>
      ) : (
        <>
          {/* The root of the tree. It opens the Projects page. */}
          <div className={'tree-root' + (projectsCurrent ? ' selected' : '')}>
            <button
              type="button"
              className="tree-root-button"
              aria-current={projectsCurrent ? 'page' : undefined}
              onClick={onProjects}
            >
              Projects
            </button>
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
          <div className="tree-projects" role="group" aria-label="Projects">
            {groups.flatMap((group) => projectRows(group))}
          </div>
        </>
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
