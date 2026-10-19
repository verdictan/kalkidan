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
import { ChevronDown, Folder, BookOpen, GitBranch, Plus, Pin, Ellipsis } from 'lucide-react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from './ui/collapsible';
import { Button } from './ui/button';
import { Input } from './ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import type { API, Project, ProjectGroup, Session, RemoteHost } from '../types';

const collapsedKey = 'kalkidan-collapsed-projects';
function savedCollapsed() {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(collapsedKey) || '[]');
    return new Set(Array.isArray(value) ? value.filter((id) => typeof id === 'string') : []);
  } catch {
    return new Set<string>();
  }
}
/** The ellipsis menu shows the same actions as the context menu. */
function menuItems(actions: TreeAction[]) {
  return actions.map((item) => ({
    label: item.disabled && item.reason ? `${item.label} (${item.reason})` : item.label,
    action: item.action,
    disabled: item.disabled,
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
  projectPage,
  run,
  onNotice,
  activity = {},
}: {
  /** Background session state for each repository ID. */
  activity?: Record<string, SessionActivityState>;
  onNotice?: (message: string, error?: boolean) => void;
  onOverview: () => void;
  onDocs: (group: ProjectGroup) => void;
  projectPage: 'board' | 'docs';
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
    | { kind: 'repository'; item: Project; mode: 'rename' | 'remove' }
    | { kind: 'session'; item: Session; mode: 'rename' | 'archive' }
    | { kind: 'project'; item: ProjectGroup; mode: 'remove' }
    | null
  >(null);
  const [itemName, setItemName] = useState('');
  function renameItem(target: Project | Session, kind: 'repository' | 'session') {
    if (kind === 'repository') {
      setItemAction({ kind, item: target as Project, mode: 'rename' });
      setItemName((target as Project).name);
    } else {
      const session = target as Session;
      setItemAction({ kind, item: session, mode: 'rename' });
      setItemName(session.organization?.title || session.title);
    }
  }
  function sessionActions(session: Session): TreeAction[] {
    const disabled = busy || session.id.startsWith('draft-');
    return [
      { label: 'Open session', action: () => onResume(session) },
      { label: 'Rename…', disabled, action: () => renameItem(session, 'session') },
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
      { label: 'Rename…', disabled: busy, action: () => renameItem(repo, 'repository') },
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
  function repository(repo: Project) {
    // An open session keeps its repository row marked as the current location.
    const current = selected === repo.id && (!!activeSession || !activeGroup);
    const actions = repositoryActions(repo);
    return (
      <div className="repo-node" key={repo.id}>
        <TreeContextMenu actions={actions}>
          <div className={'repo-row' + (current ? ' selected' : '')}>
            <Button
              variant="ghost"
              className="repo-select"
              aria-current={current ? (activeSession ? 'location' : 'page') : undefined}
              onClick={() => onSelect(repo)}
              title={repo.path}
            >
              <GitBranch size={14} />
              <span>{repo.name}</span>
              <ActivityDot state={activity[repo.id]} />
            </Button>
            <ActionMenu
              className="tree-row-menu"
              label={`${repo.name} actions`}
              items={menuItems(actions)}
            />
          </div>
        </TreeContextMenu>
      </div>
    );
  }
  return (
    <section className="project-list project-tree" aria-label="Projects and repositories">
      {sessions.some(
        (s) =>
          s.organization?.pinned &&
          !s.organization.archived &&
          repos.some((r) => sessionRepo(s, allRepos)?.id === r.id),
      ) && (
        <div className="pinned-sessions">
          <div className="tree-heading">
            <span>Pinned</span>
            <Pin size={12} />
          </div>
          {sessions
            .filter(
              (s) =>
                s.organization?.pinned &&
                !s.organization.archived &&
                repos.some((r) => sessionRepo(s, allRepos)?.id === r.id),
            )
            .map((session) => (
              <TreeContextMenu key={session.agent + session.id} actions={sessionActions(session)}>
                <div
                  className={
                    'pinned-session-row' +
                    (activeSession?.id === session.id && activeSession.agent === session.agent
                      ? ' selected'
                      : '')
                  }
                >
                  <Button
                    variant="ghost"
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
        <Button variant="ghost" size="sm" className="px-0" onClick={onOverview}>
          Projects
        </Button>
        <Hint label="Add project">
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={busy}
            aria-label="Add project"
            onClick={() => edit('new')}
          >
            <Plus size={15} />
          </Button>
        </Hint>
      </div>
      {groups.map((group) => (
        <Collapsible
          className="project-group"
          open={!collapsed.has(group.id)}
          onOpenChange={(open) => toggleGroup(group.id, open)}
          key={group.id}
        >
          <TreeContextMenu
            folderColor={{
              value: group.color,
              disabled: busy,
              onChange: (color) => void run(() => api.setGroupColor(group.id, color)),
            }}
            actions={[
              { label: 'Open project board', action: () => onProject(group) },
              { label: 'Rename…', disabled: busy, action: () => edit(group) },
              {
                label: 'Remove empty project…',
                disabled:
                  busy || group.repoIds.some((id) => allRepos.some((repo) => repo.id === id)),
                destructive: true,
                reason: 'Remove its repositories first',
                action: () => setItemAction({ kind: 'project', item: group, mode: 'remove' }),
              },
            ]}
          >
            <div className="project-group-heading">
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Toggle ${group.name} repositories`}
                >
                  <ChevronDown size={13} />
                </Button>
              </CollapsibleTrigger>
              <Button
                variant="ghost"
                className="project-select"
                title={group.name}
                aria-current={activeGroup === group.id && !activeSession ? 'page' : undefined}
                onClick={() => onProject(group)}
              >
                <Folder
                  size={15}
                  style={{ color: group.color ? projectColors[group.color] : undefined }}
                />
                <strong>
                  {group.name}
                  {group.hostId && (
                    <span className="ml-1 text-[11px] text-muted-foreground">SSH</span>
                  )}
                </strong>
              </Button>
              <div className="project-group-actions">
                <AddRepository
                  api={api}
                  groupId={group.id}
                  disabled={busy}
                  onRefresh={() => run(async () => {})}
                  onNotice={onNotice}
                >
                  <Plus size={14} />
                  <span className="sr-only">Add repositories to {group.name}</span>
                </AddRepository>
                <Hint label={`Manage project ${group.name}`}>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    aria-label={`Manage project ${group.name}`}
                    onClick={() => edit(group)}
                  >
                    <Ellipsis size={13} />
                  </Button>
                </Hint>
              </div>
            </div>
          </TreeContextMenu>
          <CollapsibleContent className="project-group-children">
            <Button
              variant="ghost"
              className="project-subpage"
              aria-current={
                activeGroup === group.id && projectPage === 'docs' && !activeSession
                  ? 'page'
                  : undefined
              }
              onClick={() => onDocs(group)}
            >
              <BookOpen size={14} /> Docs
            </Button>
            {group.hostId && (
              <p className="tree-host">
                <span
                  className={
                    hosts.find((h) => h.id === group.hostId)?.status === 'connected'
                      ? 'host-connected'
                      : 'host-offline'
                  }
                />
                {hosts.find((h) => h.id === group.hostId)?.name || 'Remote host'}
                <small>{hosts.find((h) => h.id === group.hostId)?.status || 'disconnected'}</small>
              </p>
            )}
            {repos.filter((r) => group.repoIds.includes(r.id)).map(repository)}
            {!group.repoIds.some((id) => allRepos.some((r) => r.id === id)) && (
              <p className="tree-empty">Add repository folders to this project.</p>
            )}
          </CollapsibleContent>
        </Collapsible>
      ))}
      {!groups.length ? (
        <p className="tree-empty">Create a project, then add repositories.</p>
      ) : (
        !repos.some((repo) => groups.some((group) => group.repoIds.includes(repo.id))) && (
          <p className="tree-empty">No matching projects or repositories.</p>
        )
      )}
      <Dialog open={!!itemAction} onOpenChange={(open) => !open && setItemAction(null)}>
        <DialogContent>
          <form
            className="contents"
            onSubmit={(event) => {
              event.preventDefault();
              if (busy || (itemAction?.mode === 'rename' && !itemName.trim())) return;
              void run(async () => {
                if (!itemAction) return;
                let message: string;
                if (itemAction.kind === 'repository') {
                  if (itemAction.mode === 'rename') {
                    await api.update(itemAction.item.id, { name: itemName.trim() });
                    message = 'Repository renamed.';
                  } else {
                    await api.remove(itemAction.item.id);
                    message = 'Removed from Kalkidan. The files stay on disk.';
                  }
                } else if (itemAction.kind === 'project') {
                  await api.removeGroup(itemAction.item.id);
                  message = 'Project removed.';
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
                  ? 'Rename ' + itemAction.kind
                  : itemAction?.mode === 'archive'
                    ? 'Archive session'
                    : itemAction?.kind === 'project'
                      ? `Remove ${itemAction.item.name}?`
                      : itemAction?.kind === 'repository'
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
              <Input
                autoFocus
                aria-label="Name"
                value={itemName}
                maxLength={150}
                onChange={(event) => setItemName(event.target.value)}
              />
            ) : itemAction?.mode === 'remove' ? null : (
              <p className="truncate text-sm font-medium">
                {itemAction?.kind === 'session'
                  ? itemAction.item.organization?.title || itemAction.item.title
                  : itemAction?.item.name}
              </p>
            )}
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
                    : itemAction?.kind === 'project'
                      ? 'Remove project'
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
          await run(async () => {});
          onProject(group);
        }}
      />
      <Dialog
        open={!!editing && editing !== 'new'}
        onOpenChange={(open) => !open && setEditing(null)}
      >
        <DialogContent className="project-settings-dialog max-h-[calc(100dvh-48px)] overflow-y-auto sm:max-w-[560px]">
          <DialogHeader className="pr-6">
            <div className="project-settings-heading">
              <span
                className="project-settings-icon"
                style={{ color: color ? projectColors[color] : undefined }}
              >
                <Folder size={24} />
              </span>
              <div>
                <DialogTitle>Manage project</DialogTitle>
                <DialogDescription className="mt-1">
                  Customize your project and review its repositories.
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
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
              Contains docs/, repos/, and worktrees/. Existing external repositories stay linked.
            </span>
          </label>
          <fieldset className="project-settings-colors" disabled={busy}>
            <legend>Folder color</legend>
            <div className="flex flex-wrap gap-2">
              {([null, ...Object.keys(projectColors)] as (ProjectColor | null)[]).map((value) => (
                <Button
                  key={value || 'default'}
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={
                    value ? value[0].toUpperCase() + value.slice(1) + ' folder' : 'Default folder'
                  }
                  aria-pressed={color === value}
                  title={value || 'Default'}
                  onClick={() => setColor(value)}
                  style={{ color: value ? projectColors[value] : 'var(--muted-foreground)' }}
                >
                  <Folder size={19} />
                </Button>
              ))}
            </div>
          </fieldset>
          <section className="project-settings-repositories" aria-label="Project repositories">
            <h3>
              Repositories <span>{managedRepos.length}</span>
            </h3>
            {managedRepos.length ? (
              <ul>
                {managedRepos.map((repo) => (
                  <li key={repo.id}>
                    <GitBranch size={16} />
                    <div>
                      <strong>{repo.name}</strong>
                      <span title={repo.path}>{repo.path}</span>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No repositories added yet.</p>
            )}
          </section>
          {editing && editing !== 'new' && (
            <div className="project-settings-remove">
              <div>
                <strong>Remove project</strong>
                <p>
                  {managedRepos.length
                    ? 'Move or remove its repositories first.'
                    : 'Remove this empty project from your sidebar.'}
                </p>
              </div>
              <Hint
                label={managedRepos.length ? 'Remove its repositories first' : 'Remove project'}
              >
                <Button
                  variant="outline"
                  className="text-destructive"
                  disabled={busy || managedRepos.length > 0}
                  onClick={() => {
                    setItemAction({ kind: 'project', item: editing, mode: 'remove' });
                    setEditing(null);
                  }}
                >
                  Remove
                </Button>
              </Hint>
            </div>
          )}
          <DialogFooter className="project-settings-footer">
            <Button variant="outline" onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              disabled={
                busy ||
                !name.trim() ||
                (editing !== 'new' &&
                  editing?.name === name.trim() &&
                  (editing?.color || null) === color)
              }
              onClick={() =>
                void run(async () => {
                  if (editing && editing !== 'new') {
                    if (editing.name !== name.trim())
                      await api.updateGroup(editing.id, name.trim());
                    if ((editing.color || null) !== color)
                      await api.setGroupColor(editing.id, color);
                  }
                  setEditing(null);
                })
              }
            >
              {busy ? 'Saving…' : 'Save project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
