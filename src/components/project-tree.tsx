import { projectColors, type ProjectColor } from '../domain/project-colors';
import { ActivityDot, activityKey, type SessionActivityState } from './activity-dot';
import { TreeContextMenu, type TreeAction } from './tree-context-menu';
import { sessionRepo } from '../lib/session-repository';
import { worktreeBranch, worktreeParent } from '../lib/worktree-sessions';
import { agentCatalog, agentLabel } from '../config/agents';
import { errorMessage } from '../lib/errors';
import { CreateProject } from './create-project';
import { AddRepository } from './add-repository';
import { ActionMenu, type ActionMenuItem } from './action-menu';
import { RenameSessionDialog, archiveSessionWithUndo } from './session-actions';
import { viewArchivedSessions } from './session-browser';
import { Hint } from './hint';
import { revealLabel } from '../lib/platform';
import { useState } from 'react';
import {
  BookOpen,
  ChevronDown,
  Folder,
  FolderGit2,
  GitBranch,
  LayoutGrid,
  ListTodo,
  Loader2,
  MessagesSquare,
  Pin,
  PinOff,
  Plus,
  X,
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
import type { Agent, API, Project, ProjectGroup, Session, RemoteHost } from '../types';

const collapsedKey = 'kalkidan-collapsed-projects';
/** Each code folder shows its most recent chats in the sidebar. */
const recentLimit = 3;
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
/** An approval request is stronger than work in progress. */
function strongest(states: (SessionActivityState | undefined)[]) {
  return states.includes('approval') ? 'approval' : states.find(Boolean);
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
  onTasks,
  onOverview,
  onAllSessions,
  overviewCurrent = false,
  allSessionsCurrent = false,
  onDocs,
  projectPage,
  run,
  onNotice,
  onRefresh,
  onEditRepository,
  onDeleteBranchCopy,
  onNewSession,
  onConnect,
  connectLabel = 'Connect a GitHub Projects board…',
  activity = {},
  sessionActivity = {},
  openChats = [],
  onCloseChat,
  cloning = [],
  query = '',
}: {
  /** Reloads the snapshot without a busy state. */
  onRefresh: () => Promise<unknown>;
  onEditRepository: (repo: Project) => void;
  /** Opens the one dialog that deletes a branch copy (a Git worktree). */
  onDeleteBranchCopy?: (repo: Project, branch: string) => void;
  /** Starts a new session in a code folder. */
  onNewSession?: (agent: Agent, repo: Project) => void;
  /** Connects a GitHub Projects board to a project without a board. */
  onConnect?: (group: ProjectGroup) => void;
  connectLabel?: string;
  /** Background session state for each repository ID. */
  activity?: Record<string, SessionActivityState>;
  /** Background state of open sessions, by `activityKey`. */
  sessionActivity?: Record<string, SessionActivityState>;
  /** Chats that are open in this window, also in the background. */
  openChats?: OpenChat[];
  onCloseChat?: (session: Session) => void;
  /** Clones that run after their dialog closed. */
  cloning?: CloneProgress[];
  /** The sidebar search text. The empty search message shows only with a query. */
  query?: string;
  onNotice?: (message: string, error?: boolean) => void;
  onOverview: () => void;
  onAllSessions?: () => void;
  overviewCurrent?: boolean;
  allSessionsCurrent?: boolean;
  onDocs: (group: ProjectGroup) => void;
  /** Opens the task board of a project. */
  onTasks?: (group: ProjectGroup) => void;
  projectPage: 'board' | 'docs' | 'tasks';
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
  const [renaming, setRenaming] = useState<Session | null>(null);
  const [reconnecting, setReconnecting] = useState('');
  async function togglePin(session: Session) {
    const pinned = !session.organization?.pinned;
    await run(async () => {
      await api.updateSession(session.agent, session.id, { pinned });
      onNotice?.(pinned ? 'Chat pinned. It shows at the top of the sidebar.' : 'Chat unpinned.');
    });
  }
  function archive(session: Session) {
    const repo = sessionRepo(session, allRepos);
    void archiveSessionWithUndo(session, {
      api,
      onChange: () => void onRefresh(),
      onViewArchived: repo
        ? () => {
            viewArchivedSessions(repo.id);
            onSelect(repo);
          }
        : undefined,
    }).catch((e) =>
      showToast({ message: 'Could not archive the chat: ' + errorMessage(e), tone: 'error' }),
    );
  }
  function sessionActions(session: Session): TreeAction[] {
    const disabled = busy || session.id.startsWith('draft-');
    return [
      { label: 'Open', action: () => onResume(session) },
      { label: 'Rename…', disabled, action: () => setRenaming(session) },
      {
        label: session.organization?.pinned ? 'Unpin' : 'Pin to top',
        disabled,
        action: () => void togglePin(session),
      },
      { label: 'Archive', disabled, separator: true, action: () => archive(session) },
    ];
  }
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
  function repositoryActions(repo: Project, branch?: string): TreeAction[] {
    return [
      { label: branch ? 'Open branch copy' : 'Open code folder', action: () => onSelect(repo) },
      ...(onNewSession
        ? agentCatalog.map(({ id: agent }) => ({
            label: `New ${agentLabel(agent)} session`,
            action: () => onNewSession(agent, repo),
          }))
        : []),
      {
        label: 'Edit code folder…',
        separator: true,
        disabled: busy,
        action: () => onEditRepository(repo),
      },
      {
        label: repo.favorite ? 'Remove from favorites' : 'Add to favorites',
        disabled: busy,
        action: () => {
          void run(() => api.update(repo.id, { favorite: !repo.favorite }));
        },
      },
      ...(!repo.hostId
        ? [
            {
              label: revealLabel(),
              action: () => {
                void run(() => api.reveal(repo.id));
              },
            },
          ]
        : []),
      branch && onDeleteBranchCopy
        ? {
            label: 'Delete this branch copy…',
            disabled: busy,
            destructive: true,
            separator: true,
            action: () => onDeleteBranchCopy(repo, branch),
          }
        : {
            label: 'Remove from Kalkidan…',
            disabled: busy,
            destructive: true,
            separator: true,
            action: () => setRemoving({ kind: 'repository', item: repo }),
          },
    ];
  }
  // An open session keeps its repository row marked as the current location.
  const isCurrent = (repo: Project) =>
    selected === repo.id && (!!activeSession || (!activeGroup && !allSessionsCurrent));
  /** One chat row: in Open chats, Pinned, or under its code folder. */
  function sessionRow(
    session: Session,
    kind: 'open' | 'pinned' | 'recent',
    state?: SessionActivityState,
    deep = false,
  ) {
    const title = titleOf(session);
    const current = sameSession(activeSession, session);
    const draft = session.id.startsWith('draft-');
    const pinned = !!session.organization?.pinned;
    return (
      <TreeContextMenu
        key={kind + session.agent + session.id}
        label="Session actions"
        actions={sessionActions(session)}
      >
        <div
          className={
            'tree-row session-row row-hover row-focus' +
            (kind === 'recent' ? ' tree-session-row' : ' tree-top-row') +
            (deep ? ' tree-session-deep' : '') +
            (kind === 'pinned' ? ' pinned-session-row' : '') +
            (kind === 'open' ? ' open-chat-row' : '') +
            (current ? ' selected row-selected' : '')
          }
        >
          <Button
            variant="ghost"
            className={rowButton}
            title={title}
            aria-label={
              kind === 'pinned'
                ? `Resume pinned ${title}`
                : kind === 'open'
                  ? `Open chat: ${title}`
                  : `Chat: ${title}`
            }
            aria-current={current ? 'page' : undefined}
            onClick={() => onResume(session)}
          >
            <span className="tree-icon">
              <AgentIcon agent={session.agent} className="size-3.5" />
            </span>
            <span className="tree-label">{title}</span>
            <ActivityDot state={state || sessionActivity[activityKey(session.agent, session.id)]} />
          </Button>
          {kind === 'open' && onCloseChat ? (
            <Hint label={state ? 'Close chat. The agent keeps working.' : 'Close chat'}>
              <Button
                variant="ghost"
                size="icon-xs"
                className="tree-row-menu"
                aria-label={`Close ${title}`}
                onClick={() => onCloseChat(session)}
              >
                <X />
              </Button>
            </Hint>
          ) : (
            <>
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
              <ActionMenu
                size="xs"
                className="tree-row-menu"
                label={`${title} actions`}
                items={menuItems(sessionActions(session))}
              />
            </>
          )}
        </div>
      </TreeContextMenu>
    );
  }
  /** The most recent chats of a code folder, without pinned chats and drafts. */
  function recentSessions(repo: Project) {
    return sessions
      .filter(
        (s) =>
          !s.organization?.archived &&
          !s.organization?.pinned &&
          !s.id.startsWith('draft-') &&
          sessionRepo(s, allRepos)?.id === repo.id,
      )
      .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
      .slice(0, recentLimit);
  }
  // Rows stay siblings (no wrapper), so focus can move to the next row after a removal.
  function repository(repo: Project, parent?: Project) {
    const current = isCurrent(repo);
    const branch = parent ? worktreeBranch(repo, parent) : undefined;
    const actions = repositoryActions(repo, branch);
    const label = branch ? `branch: ${branch}` : repo.name;
    return [
      <TreeContextMenu
        key={repo.id}
        label={branch ? 'Branch copy actions' : 'Code folder actions'}
        actions={actions}
      >
        <div
          className={
            'tree-row repo-row row-hover row-focus' +
            (branch ? ' worktree-row' : '') +
            (current ? ' selected row-selected' : '')
          }
        >
          <Button
            variant="ghost"
            className={'repo-select ' + rowButton}
            aria-label={label}
            aria-current={current ? (activeSession ? 'location' : 'page') : undefined}
            onClick={() => onSelect(repo)}
            title={branch ? `Branch copy of ${parent!.name}: ${repo.path}` : repo.path}
          >
            <span className="tree-icon">
              {branch ? <FolderGit2 className="size-3.5" /> : <GitBranch className="size-3.5" />}
            </span>
            <span className="tree-label">{label}</span>
            <ActivityDot state={activity[repo.id]} />
          </Button>
          <ActionMenu
            size="xs"
            className="tree-row-menu"
            label={`${repo.name} actions`}
            items={menuItems(actions)}
          />
        </div>
      </TreeContextMenu>,
      ...recentSessions(repo).map((session) => sessionRow(session, 'recent', undefined, !!branch)),
    ];
  }
  /** Code folders of a project. Branch copies show under the code folder they belong to. */
  function repositories(group: ProjectGroup) {
    const members = repos.filter((r) => group.repoIds.includes(r.id));
    const parents = new Map(members.map((repo) => [repo.id, worktreeParent(repo, members)]));
    return members
      .filter((repo) => !parents.get(repo.id))
      .flatMap((repo) => [
        ...repository(repo),
        ...members
          .filter((child) => parents.get(child.id)?.id === repo.id)
          .flatMap((child) => repository(child, repo)),
      ]);
  }
  const pinned = sessions.filter(
    (s) =>
      s.organization?.pinned &&
      !s.organization.archived &&
      repos.some((r) => sessionRepo(s, allRepos)?.id === r.id),
  );
  const hasRepositories = (group: ProjectGroup) =>
    group.repoIds.some((id) => allRepos.some((repo) => repo.id === id));
  function projectActions(group: ProjectGroup): TreeAction[] {
    return [
      { label: 'Open project', action: () => onProject(group) },
      {
        label: 'Add a code folder…',
        disabled: busy,
        action: () =>
          window.dispatchEvent(
            new CustomEvent('kalkidan-add-code-folder', { detail: { groupId: group.id } }),
          ),
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
  return (
    <div className="project-list project-tree">
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
            <Plus />
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
            <span className="tree-label">All sessions</span>
          </Button>
        </div>
      )}
      {openChats.length > 0 && (
        <section className="tree-section" aria-labelledby="tree-open-chats">
          <h2 id="tree-open-chats" className="sidebar-label tree-heading">
            Open chats
          </h2>
          {openChats.map(({ session, state }) => sessionRow(session, 'open', state))}
        </section>
      )}
      {pinned.length > 0 && (
        <section className="tree-section pinned-sessions" aria-labelledby="tree-pinned">
          <h2 id="tree-pinned" className="sidebar-label tree-heading">
            Pinned
          </h2>
          {pinned.map((session) => sessionRow(session, 'pinned'))}
        </section>
      )}
      {groups.length > 0 && (openChats.length > 0 || pinned.length > 0) && (
        <h2 className="sidebar-label tree-heading tree-projects-heading">Your projects</h2>
      )}
      {groups.map((group) => {
        const boardCurrent = activeGroup === group.id && projectPage === 'board' && !activeSession;
        const tasksCurrent = activeGroup === group.id && projectPage === 'tasks' && !activeSession;
        const docsCurrent = activeGroup === group.id && projectPage === 'docs' && !activeSession;
        const members = allRepos.filter((repo) => group.repoIds.includes(repo.id));
        // The project row shows that the current page is inside it, without a background.
        const containsCurrent =
          !boardCurrent && (docsCurrent || tasksCurrent || members.some((repo) => isCurrent(repo)));
        const host = hosts.find((h) => h.id === group.hostId);
        const open = !collapsed.has(group.id);
        const groupState = strongest(members.map((repo) => activity[repo.id]));
        const actions = projectActions(group);
        const folderColor = {
          value: group.color,
          disabled: busy,
          onChange: (color: ProjectColor | null) =>
            void run(() => api.setGroupColor(group.id, color)),
        };
        const clones = cloning.filter((clone) => clone.groupId === group.id);
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
                  (boardCurrent ? ' selected row-selected' : '') +
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
                  title={group.name}
                  aria-label={group.name}
                  aria-current={boardCurrent ? 'page' : undefined}
                  onClick={() => onProject(group)}
                >
                  <span className="tree-label">{group.name}</span>
                  {group.hostId && (
                    <Badge variant="outline" size="sm">
                      SSH
                    </Badge>
                  )}
                  {!open && <ActivityDot state={groupState} />}
                </Button>
                <div className="project-group-actions">
                  <AddRepository
                    api={api}
                    groupId={group.id}
                    disabled={busy}
                    size="icon-xs"
                    className="tree-row-action"
                    onRefresh={onRefresh}
                    onNotice={onNotice}
                  >
                    <Plus />
                    <span className="sr-only">Add code folders to {group.name}</span>
                  </AddRepository>
                  <ActionMenu
                    size="xs"
                    className="tree-row-menu"
                    disabled={busy}
                    label={`Manage project ${group.name}`}
                    folderColor={folderColor}
                    items={menuItems(actions)}
                  />
                </div>
              </div>
            </TreeContextMenu>
            <CollapsibleContent className="project-group-children">
              <div
                className={
                  'tree-row project-subpage-row row-hover row-focus' +
                  (tasksCurrent ? ' selected row-selected' : '')
                }
              >
                <Button
                  variant="ghost"
                  className={'project-subpage ' + rowButton}
                  aria-current={tasksCurrent ? 'page' : undefined}
                  title={
                    trackerConnection(group)
                      ? 'The GitHub Projects board of this project'
                      : 'Connect a GitHub Projects board to track tasks'
                  }
                  onClick={() => (onTasks || onProject)(group)}
                >
                  <span className="tree-icon">
                    <ListTodo className="size-3.5" />
                  </span>
                  <span className="tree-label">Tasks</span>
                </Button>
              </div>
              <div
                className={
                  'tree-row project-subpage-row row-hover row-focus' +
                  (docsCurrent ? ' selected row-selected' : '')
                }
              >
                <Button
                  variant="ghost"
                  className={'project-subpage ' + rowButton}
                  aria-current={docsCurrent ? 'page' : undefined}
                  onClick={() => onDocs(group)}
                >
                  <span className="tree-icon">
                    <BookOpen className="size-3.5" />
                  </span>
                  <span className="tree-label">Docs</span>
                </Button>
              </div>
              {group.hostId && (
                <div className="tree-row tree-host" title={host?.error || host?.target}>
                  <span className="tree-icon" aria-hidden="true">
                    <span
                      className={
                        'tree-host-dot' +
                        (host?.status === 'connected'
                          ? ' host-connected'
                          : host?.status === 'error'
                            ? ' host-error'
                            : '')
                      }
                    />
                  </span>
                  <span className="tree-label">{host?.name || 'Remote host'}</span>
                  {host && host.status !== 'connected' ? (
                    <Button
                      variant="ghost"
                      size="xs"
                      className="tree-host-action"
                      disabled={reconnecting === host.id || host.status === 'connecting'}
                      aria-label={`Reconnect to ${host.name}`}
                      onClick={() => void reconnect(host)}
                    >
                      {reconnecting === host.id || host.status === 'connecting' ? (
                        <Loader2 className="animate-spin" />
                      ) : null}
                      {host.status === 'error' ? 'Try again' : 'Reconnect'}
                    </Button>
                  ) : (
                    <small>{host?.status || 'disconnected'}</small>
                  )}
                </div>
              )}
              {repositories(group)}
              {clones.map((clone) => (
                <div key={clone.id} className="tree-row tree-cloning" role="status">
                  <span className="tree-icon">
                    <Loader2 className="size-3.5 animate-spin" />
                  </span>
                  <span className="tree-label">Cloning {clone.name}…</span>
                </div>
              ))}
              {!hasRepositories(group) && !clones.length && (
                <div className="tree-row tree-empty">
                  <span className="tree-icon" aria-hidden="true" />
                  <Button
                    variant="link"
                    size="xs"
                    className="tree-empty-action"
                    disabled={busy}
                    onClick={() =>
                      window.dispatchEvent(
                        new CustomEvent('kalkidan-add-code-folder', {
                          detail: { groupId: group.id },
                        }),
                      )
                    }
                  >
                    Add a code folder
                  </Button>
                </div>
              )}
            </CollapsibleContent>
          </Collapsible>
        );
      })}
      {!groups.length ? (
        <EmptyState compact icon={<Folder />} title="No projects yet">
          A project holds your code folders, agent chats and notes. Select + next to Projects to
          create one.
        </EmptyState>
      ) : (
        searching &&
        !repos.some((repo) => groups.some((group) => group.repoIds.includes(repo.id))) && (
          <EmptyState compact>No matching projects or code folders.</EmptyState>
        )
      )}
      <RenameSessionDialog
        api={api}
        session={renaming}
        open={!!renaming}
        onOpenChange={(open) => !open && setRenaming(null)}
        onRenamed={() => {
          void onRefresh();
          onNotice?.('Chat renamed.');
        }}
      />
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
