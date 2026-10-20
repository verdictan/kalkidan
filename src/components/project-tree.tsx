import { projectColors, type ProjectColor } from '../domain/project-colors';
import { ActivityDot, type SessionActivityState } from './activity-dot';
import { TreeContextMenu, type TreeAction } from './tree-context-menu';
import { sessionRepo } from '../lib/session-repository';
import { CreateProject } from './create-project';
import { AddRepository } from './add-repository';
import { ActionMenu } from './action-menu';
import { Hint } from './hint';
import { revealLabel } from '../lib/platform';
import { useState } from 'react';
import {
  ChevronDown,
  Folder,
  FolderGit2,
  FolderPlus,
  BookOpen,
  Brain,
  GitBranch,
  Plus,
  Pin,
} from 'lucide-react';
import { trackerConnection } from '../domain/tracker';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from './ui/collapsible';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { EmptyState } from './ui/empty-state';
import { EntityIcon } from './ui/entity-icon';
import { MoreButton } from './ui/more-button';
import { Input } from './ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogBody,
  DialogFooter,
} from './ui/dialog';
import type { API, Project, ProjectGroup, Session, RemoteHost } from '../types';

/**
 * A worktree that Kalkidan created lives in `<project folder>/worktrees/<repository>-<branch>-<id>`.
 * Returns the repository that the worktree belongs to, if the project has it.
 */
function worktreeParent(repo: Project, siblings: Project[]) {
  const slash = repo.path.lastIndexOf('/');
  if (slash < 0 || !repo.path.slice(0, slash).endsWith('/worktrees')) return undefined;
  const folder = repo.path.slice(slash + 1);
  let parent: Project | undefined;
  let best = 0;
  for (const candidate of siblings) {
    if (candidate.id === repo.id || candidate.hostId !== repo.hostId) continue;
    if (candidate.path.slice(0, candidate.path.lastIndexOf('/')).endsWith('/worktrees')) continue;
    const name = candidate.path.slice(candidate.path.lastIndexOf('/') + 1);
    if (folder.startsWith(name + '-') && name.length > best) {
      parent = candidate;
      best = name.length;
    }
  }
  return parent;
}
const collapsedKey = 'kalkidan-collapsed-projects';
function savedCollapsed() {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(collapsedKey) || '[]');
    return new Set(Array.isArray(value) ? value.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set<string>();
  }
}
// The row paints hover and selection. Its main button only holds the content.
const rowButton =
  'h-8 min-w-0 flex-1 justify-start gap-1.5 px-0 font-normal hover:bg-transparent has-[>svg]:px-0';
/** The ellipsis menu shows the same actions as the context menu. */
function menuItems(actions: TreeAction[]) {
  return actions.map((item) => ({
    label: item.label,
    action: item.action,
    disabled: item.disabled,
    reason: item.reason,
    danger: item.destructive,
  }));
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
  onOverview,
  onDocs,
  onMemory,
  projectPage,
  run,
  onNotice,
  onRefresh,
  onEditRepository,
  onConnect,
  connectLabel = 'Connect GitHub project…',
  activity = {},
}: {
  /** Reloads the snapshot without a busy state. */
  onRefresh: () => Promise<unknown>;
  onEditRepository: (repo: Project) => void;
  /** Starts the tracker connection for a project without a tracker. */
  onConnect?: (group: ProjectGroup) => void;
  connectLabel?: string;
  /** Background session state for each repository ID. */
  activity?: Record<string, SessionActivityState>;
  onNotice?: (message: string, error?: boolean) => void;
  onOverview: () => void;
  onDocs: (group: ProjectGroup) => void;
  onMemory: (group: ProjectGroup) => void;
  projectPage: 'board' | 'docs' | 'memory';
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
  const [itemAction, setItemAction] = useState<
    | { kind: 'repository'; item: Project; mode: 'remove' }
    | { kind: 'session'; item: Session; mode: 'rename' | 'archive' }
    | { kind: 'project'; item: ProjectGroup; mode: 'remove' }
    | null
  >(null);
  const [itemName, setItemName] = useState('');
  function renameSession(session: Session) {
    setItemAction({ kind: 'session', item: session, mode: 'rename' });
    setItemName(session.organization?.title || session.title);
  }
  function sessionActions(session: Session): TreeAction[] {
    const disabled = busy || session.id.startsWith('draft-');
    return [
      { label: 'Open session', action: () => onResume(session) },
      { label: 'Rename…', disabled, action: () => renameSession(session) },
      {
        label: session.organization?.pinned ? 'Unpin' : 'Pin',
        disabled,
        action: () => {
          void run(async () => {
            const pinned = !session.organization?.pinned;
            await api.updateSession(session.agent, session.id, { pinned });
            onNotice?.(pinned ? 'Session pinned.' : 'Session unpinned.');
          });
        },
      },
      {
        label: 'Archive…',
        disabled,
        action: () => setItemAction({ kind: 'session', item: session, mode: 'archive' }),
      },
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
  function repositoryActions(repo: Project): TreeAction[] {
    return [
      { label: 'Open repository', action: () => onSelect(repo) },
      { label: 'Edit repository…', disabled: busy, action: () => onEditRepository(repo) },
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
      {
        label: 'Remove from Kalkidan…',
        disabled: busy,
        destructive: true,
        action: () => setItemAction({ kind: 'repository', item: repo, mode: 'remove' }),
      },
    ];
  }
  // An open session keeps its repository row marked as the current location.
  const isCurrent = (repo: Project) => selected === repo.id && (!!activeSession || !activeGroup);
  // Rows stay siblings (no wrapper), so focus can move to the next row after a removal.
  function repository(repo: Project, worktree = false) {
    const current = isCurrent(repo);
    const actions = repositoryActions(repo);
    return (
      <TreeContextMenu key={repo.id} label="Repository actions" actions={actions}>
        <div
          className={
            'tree-row repo-row row-hover' +
            (worktree ? ' worktree-row' : '') +
            (current ? ' selected row-selected' : '')
          }
        >
          <Button
            variant="ghost"
            className={'repo-select ' + rowButton}
            aria-current={current ? (activeSession ? 'location' : 'page') : undefined}
            onClick={() => onSelect(repo)}
            title={repo.path}
          >
            {worktree ? <FolderGit2 size={14} /> : <GitBranch size={14} />}
            <span>{repo.name}</span>
            <ActivityDot state={activity[repo.id]} />
          </Button>
          <ActionMenu
            size="xs"
            className="tree-row-menu"
            label={`${repo.name} actions`}
            items={menuItems(actions)}
          />
        </div>
      </TreeContextMenu>
    );
  }
  /** Repositories of a project. Worktrees show under the repository they belong to. */
  function repositories(group: ProjectGroup) {
    const members = repos.filter((r) => group.repoIds.includes(r.id));
    const parents = new Map(members.map((repo) => [repo.id, worktreeParent(repo, members)]));
    return members
      .filter((repo) => !parents.get(repo.id))
      .flatMap((repo) => [
        repository(repo),
        ...members
          .filter((child) => parents.get(child.id)?.id === repo.id)
          .map((child) => repository(child, true)),
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
  return (
    <div className="project-list project-tree">
      {pinned.length > 0 && (
        <div className="pinned-sessions">
          <div className="tree-heading">
            <h2 className="sidebar-label gap-1.5">
              Pinned
              <Pin size={12} aria-hidden="true" />
            </h2>
          </div>
          {pinned.map((session) => (
            <TreeContextMenu
              key={session.agent + session.id}
              label="Session actions"
              actions={sessionActions(session)}
            >
              <div
                className={
                  'tree-row pinned-session-row row-hover' +
                  (activeSession?.id === session.id && activeSession.agent === session.agent
                    ? ' selected row-selected'
                    : '')
                }
              >
                <Button
                  variant="ghost"
                  className={rowButton}
                  title={session.organization?.title || session.title}
                  aria-label={`Resume pinned ${session.organization?.title || session.title}`}
                  aria-current={
                    activeSession?.id === session.id && activeSession.agent === session.agent
                      ? 'page'
                      : undefined
                  }
                  onClick={() => onResume(session)}
                >
                  <span>{session.organization?.title || session.title}</span>
                </Button>
                <ActionMenu
                  size="xs"
                  className="tree-row-menu"
                  label={`${session.organization?.title || session.title} actions`}
                  items={menuItems(sessionActions(session))}
                />
              </div>
            </TreeContextMenu>
          ))}
        </div>
      )}
      <div className="tree-heading">
        <h2 className="sidebar-label">
          <button type="button" className="tree-heading-link" onClick={onOverview}>
            Projects
          </button>
        </h2>
        <Hint label="New project">
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-muted-foreground"
            disabled={busy}
            aria-label="New project"
            onClick={() => edit('new')}
          >
            <Plus />
          </Button>
        </Hint>
      </div>
      {groups.map((group) => {
        const boardCurrent = activeGroup === group.id && projectPage === 'board' && !activeSession;
        const docsCurrent = activeGroup === group.id && projectPage === 'docs' && !activeSession;
        // The project row shows that the current page is inside it, without a background.
        const containsCurrent =
          !boardCurrent &&
          (docsCurrent ||
            (activeGroup === group.id && projectPage === 'memory') ||
            allRepos.some((repo) => group.repoIds.includes(repo.id) && isCurrent(repo)));
        const host = hosts.find((h) => h.id === group.hostId);
        return (
          <Collapsible
            className="project-group"
            open={!collapsed.has(group.id)}
            onOpenChange={(open) => toggleGroup(group.id, open)}
            key={group.id}
          >
            <TreeContextMenu
              label="Project actions"
              folderColor={{
                value: group.color,
                disabled: busy,
                onChange: (color) => void run(() => api.setGroupColor(group.id, color)),
              }}
              actions={[
                { label: 'Open project board', action: () => onProject(group) },
                ...(onConnect && !trackerConnection(group)
                  ? [{ label: connectLabel, action: () => onConnect(group) }]
                  : []),
                { label: 'Rename…', disabled: busy, action: () => edit(group) },
                {
                  label: 'Remove empty project…',
                  disabled: busy || hasRepositories(group),
                  destructive: true,
                  reason: hasRepositories(group) ? 'Remove its repositories first' : undefined,
                  action: () => setItemAction({ kind: 'project', item: group, mode: 'remove' }),
                },
              ]}
            >
              <div
                className={
                  'tree-row project-group-heading row-hover' +
                  (boardCurrent ? ' selected row-selected' : '') +
                  (containsCurrent ? ' contains-current' : '')
                }
              >
                <CollapsibleTrigger asChild>
                  <Button
                    variant="bare"
                    className="tree-toggle h-6 w-4 p-0 text-muted-foreground has-[>svg]:p-0"
                    aria-label={`Toggle ${group.name} repositories`}
                  >
                    <ChevronDown size={12} />
                  </Button>
                </CollapsibleTrigger>
                <Button
                  variant="ghost"
                  className={'project-select ' + rowButton}
                  title={group.name}
                  aria-current={boardCurrent ? 'page' : undefined}
                  onClick={() => onProject(group)}
                >
                  <Folder
                    size={14}
                    style={{ color: group.color ? projectColors[group.color] : undefined }}
                  />
                  <strong>{group.name}</strong>
                  {group.hostId && (
                    <Badge variant="outline" size="sm">
                      SSH
                    </Badge>
                  )}
                </Button>
                <div className="project-group-actions">
                  <AddRepository
                    api={api}
                    groupId={group.id}
                    disabled={busy}
                    size="icon-xs"
                    className="text-muted-foreground"
                    onRefresh={onRefresh}
                    onNotice={onNotice}
                  >
                    <Plus size={14} />
                    <span className="sr-only">Add repositories to {group.name}</span>
                  </AddRepository>
                  <Hint label={`Manage project ${group.name}`}>
                    <MoreButton
                      size="xs"
                      className="text-muted-foreground"
                      disabled={busy}
                      label={`Manage project ${group.name}`}
                      onClick={() => edit(group)}
                    />
                  </Hint>
                </div>
              </div>
            </TreeContextMenu>
            <CollapsibleContent className="project-group-children">
              <div
                className={
                  'tree-row project-subpage-row row-hover' +
                  (docsCurrent ? ' selected row-selected' : '')
                }
              >
                <Button
                  variant="ghost"
                  className={'project-subpage ' + rowButton}
                  aria-current={docsCurrent ? 'page' : undefined}
                  onClick={() => onDocs(group)}
                >
                  <BookOpen size={14} />
                  <span>Docs</span>
                </Button>
              </div>
              <div
                className={
                  'tree-row project-subpage-row row-hover' +
                  (activeGroup === group.id && projectPage === 'memory'
                    ? ' selected row-selected'
                    : '')
                }
              >
                <Button
                  variant="ghost"
                  className={'project-subpage ' + rowButton}
                  aria-current={
                    activeGroup === group.id && projectPage === 'memory' ? 'page' : undefined
                  }
                  onClick={() => onMemory(group)}
                >
                  <Brain size={14} />
                  <span>Memory</span>
                </Button>
              </div>
              {group.hostId && (
                <p className="tree-host">
                  <span
                    className={host?.status === 'connected' ? 'host-connected' : undefined}
                    aria-hidden="true"
                  />
                  {host?.name || 'Remote host'}
                  <small>{host?.status || 'disconnected'}</small>
                </p>
              )}
              {repositories(group)}
              {!hasRepositories(group) && (
                <p className="tree-empty">Add repository folders to this project.</p>
              )}
            </CollapsibleContent>
          </Collapsible>
        );
      })}
      {!groups.length ? (
        <EmptyState compact icon={<FolderPlus />}>
          Create a project, then add repositories.
        </EmptyState>
      ) : (
        !repos.some((repo) => groups.some((group) => group.repoIds.includes(repo.id))) && (
          <EmptyState compact>No matching projects or repositories.</EmptyState>
        )
      )}
      <Dialog open={!!itemAction} onOpenChange={(open) => !open && setItemAction(null)}>
        <DialogContent size={itemAction?.mode === 'rename' ? 'md' : 'sm'}>
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault();
              if (busy || (itemAction?.mode === 'rename' && !itemName.trim())) return;
              void run(async () => {
                if (!itemAction) return;
                let message: string;
                if (itemAction.kind === 'repository') {
                  await api.remove(itemAction.item.id);
                  message = `${itemAction.item.name} removed from Kalkidan.`;
                } else if (itemAction.kind === 'project') {
                  await api.removeGroup(itemAction.item.id);
                  message = `${itemAction.item.name} removed from Kalkidan.`;
                } else {
                  await api.updateSession(
                    itemAction.item.agent,
                    itemAction.item.id,
                    itemAction.mode === 'rename' ? { title: itemName.trim() } : { archived: true },
                  );
                  message = itemAction.mode === 'rename' ? 'Session renamed.' : 'Session archived.';
                }
                setItemAction(null);
                onNotice?.(message);
              });
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {itemAction?.mode === 'rename'
                  ? 'Rename session'
                  : itemAction?.mode === 'archive'
                    ? 'Archive session'
                    : itemAction && itemAction.kind !== 'session'
                      ? `Remove ${itemAction.item.name} from Kalkidan?`
                      : ''}
              </DialogTitle>
              <DialogDescription>
                {itemAction?.mode === 'rename'
                  ? 'Change the name shown in Kalkidan.'
                  : itemAction?.mode === 'archive'
                    ? 'Hide this session from the sidebar. You can restore it from the repository’s archived sessions.'
                    : itemAction?.kind === 'project'
                      ? 'Remove this empty project from the sidebar. Files on disk stay.'
                      : 'Kalkidan stops showing this repository. The folder, its files, and its sessions stay on disk.'}
              </DialogDescription>
            </DialogHeader>
            {itemAction?.mode === 'rename' ? (
              <label className="form-label">
                Name
                <Input
                  autoFocus
                  value={itemName}
                  maxLength={150}
                  onChange={(event) => setItemName(event.target.value)}
                />
              </label>
            ) : itemAction?.mode === 'archive' ? (
              <p className="truncate text-sm font-medium">
                {itemAction.item.organization?.title || itemAction.item.title}
              </p>
            ) : null}
            <DialogFooter>
              {/* A remove action starts on Cancel, so a second Enter does not remove. */}
              <Button
                type="button"
                variant="outline"
                autoFocus={itemAction?.mode === 'remove'}
                onClick={() => setItemAction(null)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                autoFocus={itemAction?.mode === 'archive'}
                disabled={busy || (itemAction?.mode === 'rename' && !itemName.trim())}
                variant={itemAction?.mode === 'remove' ? 'destructive' : 'default'}
              >
                {itemAction?.mode === 'rename'
                  ? 'Save name'
                  : itemAction?.mode === 'archive'
                    ? 'Archive session'
                    : 'Remove from Kalkidan'}
              </Button>
            </DialogFooter>
          </form>
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
                  Customize your project and review its repositories.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <DialogBody>
            <form
              id="project-settings-form"
              className="grid gap-6"
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
                      ? editing.rootPath || 'Assigned when this project is opened on its host'
                      : ''
                  }
                />
                <span className="text-xs text-muted-foreground">
                  Contains docs/, repos/, and worktrees/. Existing external repositories stay
                  linked.
                </span>
              </label>
              <fieldset className="project-settings-colors" disabled={busy}>
                <legend>Folder color</legend>
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
              <section className="project-settings-repositories" aria-label="Project repositories">
                <h3>
                  Repositories <span>{managedRepos.length}</span>
                </h3>
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
                  <EmptyState compact>No repositories in this project yet.</EmptyState>
                )}
              </section>
              {editing && editing !== 'new' && (
                <div className="danger-zone">
                  <div>
                    <strong>Remove project</strong>
                    <p>
                      {managedRepos.length
                        ? 'Move or remove its repositories first.'
                        : 'Remove this empty project from your sidebar.'}
                    </p>
                  </div>
                  {managedRepos.length ? (
                    // The reason shows only when repositories block the removal.
                    <Hint label="Remove its repositories first">
                      <Button
                        type="button"
                        variant="outline"
                        className="text-destructive hover:text-destructive"
                        disabled
                      >
                        Remove project…
                      </Button>
                    </Hint>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      className="text-destructive hover:text-destructive"
                      disabled={busy}
                      onClick={() => {
                        setItemAction({ kind: 'project', item: editing, mode: 'remove' });
                        setEditing(null);
                      }}
                    >
                      Remove project…
                    </Button>
                  )}
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
