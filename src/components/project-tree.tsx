import { projectColors } from '../domain/project-colors';
import { TreeContextMenu, type TreeAction } from './tree-context-menu';
import { sessionRepo } from '../lib/session-repository';
import { CreateProject } from './create-project';
import { AddRepository } from './add-repository';
import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Folder,
  GitBranch,
  MessageSquare,
  Plus,
  Pin,
  Settings2,
} from 'lucide-react';
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
  run,
}: {
  onOverview: () => void;
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
      { label: 'Open conversation', action: () => onResume(session) },
      { label: 'Rename…', disabled, action: () => renameItem(session, 'session') },
      {
        label: session.organization?.pinned ? 'Unpin' : 'Pin',
        disabled,
        action: () => {
          void run(() =>
            api.updateSession(session.agent, session.id, { pinned: !session.organization?.pinned }),
          );
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
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  function edit(group: ProjectGroup | 'new') {
    setEditing(group);
    setName(group === 'new' ? '' : group.name);
  }
  function repository(repo: Project) {
    const chats = sessions.filter(
      (s) => !s.organization?.archived && sessionRepo(s, allRepos)?.id === repo.id,
    );
    const open = expanded[repo.id] ?? repo.id === selected;
    return (
      <div className="repo-node" key={repo.id}>
        <TreeContextMenu
          actions={[
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
                    label: 'Reveal in Finder',
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
          ]}
        >
          <div
            className={
              'repo-row' +
              (!activeSession && !activeGroup && selected === repo.id ? ' selected' : '')
            }
          >
            <Button
              variant="ghost"
              className="tree-toggle"
              aria-label={`${open ? 'Collapse' : 'Expand'} ${repo.name} sessions`}
              aria-expanded={open}
              onClick={() => setExpanded((p) => ({ ...p, [repo.id]: !open }))}
            >
              {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            </Button>
            <Button
              variant="ghost"
              className="repo-select"
              aria-pressed={!activeGroup && selected === repo.id}
              onClick={() => onSelect(repo)}
              title={repo.path}
            >
              <GitBranch size={14} />
              <span>{repo.name}</span>
            </Button>
          </div>
        </TreeContextMenu>
        {open && (
          <div className="repo-sessions">
            {chats.map((session) => (
              <TreeContextMenu key={session.agent + session.id} actions={sessionActions(session)}>
                <Button
                  variant="ghost"
                  key={session.agent + session.id}
                  title={session.organization?.title || session.title}
                  aria-current={
                    activeSession?.id === session.id && activeSession.agent === session.agent
                      ? 'page'
                      : undefined
                  }
                  onClick={() => onResume(session)}
                >
                  <MessageSquare size={12} />
                  <span>{session.organization?.title || session.title}</span>
                </Button>
              </TreeContextMenu>
            ))}
            {!chats.length && <p>No sessions yet</p>}
          </div>
        )}
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
                <Button
                  key={session.agent + session.id}
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
              </TreeContextMenu>
            ))}
        </div>
      )}
      <div className="tree-heading">
        <Button
          variant="ghost"
          size="sm"
          className="px-0"
          aria-label="Project overview"
          onClick={onOverview}
        >
          Projects
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={busy}
          aria-label="New project group"
          onClick={() => edit('new')}
        >
          <Plus size={15} />
        </Button>
      </div>
      {groups.map((group) => (
        <Collapsible className="project-group" defaultOpen key={group.id}>
          <TreeContextMenu
            folderColor={{ value: group.color, disabled: busy, onChange: color => void run(() => api.setGroupColor(group.id, color)) }}
            actions={[
              { label: 'Open project board', action: () => onProject(group) },
              { label: 'Rename…', disabled: busy, action: () => edit(group) },
              {
                label: 'Remove empty project…',
                disabled:
                  busy || group.repoIds.some((id) => allRepos.some((repo) => repo.id === id)),
                destructive: true,
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
                aria-current={activeGroup === group.id ? 'page' : undefined}
                onClick={() => onProject(group)}
              >
                <Folder size={15} style={{ color: group.color ? projectColors[group.color] : undefined }} />
                <strong>
                  {group.name}
                  {group.hostId && (
                    <span className="ml-1 text-[10px] text-muted-foreground">SSH</span>
                  )}
                </strong>
              </Button>
              <div className="project-group-actions">
                <AddRepository
                  api={api}
                  groupId={group.id}
                  disabled={busy}
                  onRefresh={() => run(async () => {})}
                >
                  <Plus size={14} />
                  <span className="sr-only">Add repositories to {group.name}</span>
                </AddRepository>
                <Button
                  variant="ghost"
                  disabled={busy}
                  aria-label={`Manage project ${group.name}`}
                  title={`Manage project ${group.name}`}
                  onClick={() => edit(group)}
                >
                  <Settings2 size={13} />
                </Button>
              </div>
            </div>
          </TreeContextMenu>
          <CollapsibleContent className="project-group-children">
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
                <small>{hosts.find((h) => h.id === group.hostId)?.status || 'offline'}</small>
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
      <Dialog open={!!itemAction} onOpenChange={(open) => !open && !busy && setItemAction(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {itemAction?.mode === 'rename'
                ? 'Rename ' + itemAction.kind
                : itemAction?.mode === 'archive'
                  ? 'Archive session'
                  : 'Remove ' + itemAction?.kind}
            </DialogTitle>
            <DialogDescription>
              {itemAction?.mode === 'rename'
                ? 'Change the name shown in Kalkidan.'
                : itemAction?.mode === 'archive'
                  ? 'Hide this session from the sidebar. You can restore it from the repository’s archived sessions.'
                  : 'Remove this entry from Kalkidan. Files on disk and the original conversations will be kept.'}
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
          ) : (
            <p className="truncate text-sm font-medium">
              {itemAction?.kind === 'session'
                ? itemAction.item.organization?.title || itemAction.item.title
                : itemAction?.item.name}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setItemAction(null)}>
              Cancel
            </Button>
            <Button
              disabled={busy || (itemAction?.mode === 'rename' && !itemName.trim())}
              variant={itemAction?.mode === 'remove' ? 'destructive' : 'default'}
              onClick={() => {
                void run(async () => {
                  if (!itemAction) return;
                  if (itemAction.kind === 'repository') {
                    if (itemAction.mode === 'rename')
                      await api.update(itemAction.item.id, { name: itemName.trim() });
                    else await api.remove(itemAction.item.id);
                  } else if (itemAction.kind === 'project')
                    await api.removeGroup(itemAction.item.id);
                  else
                    await api.updateSession(
                      itemAction.item.agent,
                      itemAction.item.id,
                      itemAction.mode === 'rename'
                        ? { title: itemName.trim() }
                        : { archived: true },
                    );
                  setItemAction(null);
                });
              }}
            >
              {itemAction?.mode === 'rename'
                ? 'Save name'
                : itemAction?.mode === 'archive'
                  ? 'Archive session'
                  : 'Remove'}
            </Button>
          </DialogFooter>
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
        onOpenChange={(open) => !open && !busy && setEditing(null)}
      >
        <DialogContent className="max-h-[calc(100dvh-48px)] overflow-y-auto">
          <DialogHeader className="pr-6">
            <DialogTitle>{editing === 'new' ? 'Create project' : 'Manage project'}</DialogTitle>
            <DialogDescription>
              Group related repositories under one project. Files and conversations stay in their
              original folders.
            </DialogDescription>
          </DialogHeader>
          <label className="form-label">
            Project name
            <Input
              value={name}
              maxLength={150}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Customer platform"
            />
          </label>
          {editing && editing !== 'new' && (
            <Button
              variant="ghost"
              disabled={busy || editing.repoIds.some((id) => allRepos.some((r) => r.id === id))}
              title="Move repositories to another project before removing this project"
              onClick={() =>
                void run(async () => {
                  await api.removeGroup(editing.id);
                  setEditing(null);
                })
              }
            >
              Remove empty project
            </Button>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              disabled={busy || !name.trim()}
              onClick={() =>
                void run(async () => {
                  if (editing && editing !== 'new') await api.updateGroup(editing.id, name.trim());
                  setEditing(null);
                })
              }
            >
              {editing === 'new' ? 'Create project' : 'Save project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
