import { useEffect, useState } from 'react';
import {
  ChevronDown,
  FileText,
  FolderGit2,
  FolderPlus,
  GitBranch,
  Plus,
  SquareKanban,
} from 'lucide-react';
import { agentCatalog, agentLabel } from '../config/agents';
import { sessionRepo } from '../lib/session-repository';
import { relativeTime } from './project-overview';
import { StatusIcon, trackerColumns } from './tracker-list';
import { Hint } from './hint';
import { AgentIcon } from './ui/agent-icon';
import { Button } from './ui/button';
import { EmptyState } from './ui/empty-state';
import { EntityIcon } from './ui/entity-icon';
import { SectionHeader } from './ui/page-header';
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
import type { ProjectDocMetadata } from '../domain/docs';
import type { API, Agent, Project, ProjectGroup, Session, TrackerBoard } from '../types';

const recentLimit = 5;
const docLimit = 3;

/** Sessions that a person can open: not archived and not an unsent draft. */
function openSessions(sessions: Session[], repos: Project[]) {
  return sessions
    .filter((s) => !s.organization?.archived && !s.id.startsWith('draft-'))
    .map((session) => ({ session, repo: sessionRepo(session, repos) }))
    .filter((item): item is { session: Session; repo: Project } => !!item.repo)
    .sort((a, b) => (b.session.updatedAt || '').localeCompare(a.session.updatedAt || ''));
}

/** The code folder of the most recent session, else the first code folder. */
export function lastUsedRepo(repos: Project[], sessions: Session[], preferredId?: string) {
  return (
    repos.find((r) => r.id === preferredId) ||
    openSessions(sessions, repos)[0]?.repo ||
    repos[0] ||
    null
  );
}

function GitHubMark() {
  return (
    <span
      className="tracker-provider-mark size-4"
      style={{ maskImage: 'url(./icons/github.svg)' }}
      aria-hidden="true"
    />
  );
}

function fullDate(value?: string) {
  const time = value ? Date.parse(value) : NaN;
  return Number.isNaN(time)
    ? ''
    : new Date(time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

function TimeLabel({ value }: { value?: string }) {
  const text = relativeTime(value);
  if (!text) return null;
  return (
    <Hint label={fullDate(value)}>
      <time dateTime={value} className="project-home-time">
        {text}
      </time>
    </Hint>
  );
}

/**
 * "New {agent} session" with a menu to choose the code folder and the agent. The main
 * part starts in the last used code folder.
 */
export function NewSessionSplit({
  repos,
  sessions,
  agent,
  preferredRepoId,
  onAgent,
  onStart,
}: {
  repos: Project[];
  sessions: Session[];
  agent: Agent;
  preferredRepoId?: string;
  onAgent: (agent: Agent) => void;
  onStart: (repo: Project, agent: Agent) => void;
}) {
  const target = lastUsedRepo(repos, sessions, preferredRepoId);
  if (!target) return null;
  return (
    <div className="split-button" role="group" aria-label="Start a session">
      <Hint label={`Start in ${target.name}`}>
        <Button className="rounded-r-none" onClick={() => onStart(target, agent)}>
          <AgentIcon agent={agent} />
          New {agentLabel(agent)} session
        </Button>
      </Hint>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="icon"
            className="rounded-l-none border-l border-primary-foreground/20"
            aria-label="Choose a code folder and an agent"
          >
            <ChevronDown />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-56">
          <DropdownMenuLabel>Start in</DropdownMenuLabel>
          {repos.map((repo) => (
            <DropdownMenuItem key={repo.id} onSelect={() => onStart(repo, agent)}>
              <FolderGit2 />
              <span className="min-w-0 truncate">{repo.name}</span>
            </DropdownMenuItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuLabel>Agent</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={agent} onValueChange={(value) => onAgent(value as Agent)}>
            {agentCatalog.map(({ id }) => (
              <DropdownMenuRadioItem key={id} value={id} onSelect={(e) => e.preventDefault()}>
                <AgentIcon agent={id} />
                {agentLabel(id)}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/** The overview of one project: code folders, recent sessions, docs and tasks. */
export function ProjectHome({
  api,
  group,
  repos,
  sessions,
  agent,
  board,
  boardName,
  connected,
  canCreateTask,
  onRepo,
  onNewSession,
  onOpenSession,
  onAddFolder,
  onCloneFromGitHub,
  onOpenDocs,
  onAllSessions,
  onConnectBoard,
  onOpenTasks,
  onNewTask,
}: {
  api: API;
  group: ProjectGroup;
  repos: Project[];
  sessions: Session[];
  agent: Agent;
  board: TrackerBoard | null;
  /** "GitHub Projects board", or the board name of another tracker. */
  boardName: string;
  connected: boolean;
  canCreateTask: boolean;
  onRepo: (repo: Project) => void;
  onNewSession: (repo: Project, agent: Agent) => void;
  onOpenSession?: (session: Session) => void;
  onAddFolder: () => void;
  onCloneFromGitHub: () => void;
  onOpenDocs?: (pageId?: string) => void;
  onAllSessions?: () => void;
  onConnectBoard?: () => void;
  onOpenTasks: () => void;
  onNewTask: () => void;
}) {
  const [branches, setBranches] = useState<Record<string, string>>({});
  const repoKey = repos.map((r) => r.id).join(',');
  useEffect(() => {
    let live = true;
    for (const repo of repos)
      api
        .git(repo.id)
        .then((info) => {
          if (live && info?.branch) setBranches((b) => ({ ...b, [repo.id]: info.branch }));
        })
        .catch(() => {
          // The row then shows no branch. A remote host can be offline.
        });
    return () => {
      live = false;
    };
  }, [api, repoKey]);
  const [docs, setDocs] = useState<ProjectDocMetadata[] | null>(null);
  const [docBusy, setDocBusy] = useState(false);
  useEffect(() => {
    let live = true;
    if (!onOpenDocs || typeof api.docsMetadata !== 'function') return;
    api
      .docsMetadata(group.id)
      .then((value) => {
        if (live) setDocs(value);
      })
      .catch(() => {
        if (live) setDocs([]);
      });
    return () => {
      live = false;
    };
  }, [api, group.id, !!onOpenDocs]);
  async function newPage() {
    if (!onOpenDocs) return;
    setDocBusy(true);
    try {
      const page = await api.docsCreate(group.id, 'Untitled', null);
      onOpenDocs(page.id);
    } catch {
      // The docs page shows the error when it opens.
      onOpenDocs();
    } finally {
      setDocBusy(false);
    }
  }
  const recent = openSessions(sessions, repos);
  const lastSession = (repo: Project) => recent.find((item) => item.repo.id === repo.id)?.session;
  // The metadata has no change time. The first pages in wiki order come first.
  const topDocs = (docs || [])
    .filter((doc) => !doc.parentId)
    .sort(
      (a, b) =>
        (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) ||
        a.title.localeCompare(b.title),
    )
    .slice(0, docLimit);
  const columns = board ? trackerColumns(board) : [];
  const options = board?.statusField?.options || [];
  const count = (id: string) =>
    board?.items.filter(
      (item) => (options.some((o) => o.id === item.statusId) ? item.statusId : '') === id,
    ).length || 0;
  return (
    <div className="project-home">
      <div className="project-home-main">
        {repos.length ? (
          <section className="project-home-section" aria-label="Code folders">
            <SectionHeader
              title="Code folders"
              count={repos.length}
              actions={
                <Button variant="ghost" size="sm" onClick={onCloneFromGitHub}>
                  <GitHubMark />
                  Clone from GitHub
                </Button>
              }
            />
            <ul className="project-home-list">
              {repos.map((repo) => {
                const last = lastSession(repo);
                return (
                  <li key={repo.id} className="project-home-row row-hover row-focus">
                    <button
                      type="button"
                      className="project-home-open"
                      title={repo.path}
                      onClick={() => onRepo(repo)}
                    >
                      <EntityIcon>
                        <FolderGit2 />
                      </EntityIcon>
                      <span className="project-home-text">
                        <span className="project-home-title">{repo.name}</span>
                        <span className="project-home-meta">
                          {branches[repo.id] && (
                            <span className="inline-flex min-w-0 items-center gap-1">
                              <GitBranch size={12} aria-hidden="true" />
                              <span className="truncate">{branches[repo.id]}</span>
                            </span>
                          )}
                          {branches[repo.id] && <span aria-hidden="true">·</span>}
                          <span className="truncate">
                            {last
                              ? `Last session ${relativeTime(last.updatedAt)}`
                              : 'No sessions yet'}
                          </span>
                        </span>
                      </span>
                    </button>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`New ${agentLabel(agent)} session in ${repo.name}`}
                      onClick={() => onNewSession(repo, agent)}
                    >
                      <AgentIcon agent={agent} />
                      New {agentLabel(agent)} session
                    </Button>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : (
          <EmptyState
            icon={<FolderPlus />}
            title="Add your first code folder"
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button size="lg" onClick={onAddFolder}>
                  <FolderPlus />
                  Add a code folder
                </Button>
                <Button size="lg" variant="outline" onClick={onCloneFromGitHub}>
                  <GitHubMark />
                  Clone from GitHub
                </Button>
              </div>
            }
          >
            A code folder is a Git repository on this computer. Agents read and change the files in
            it. Add a folder that you have, or clone one from GitHub.
          </EmptyState>
        )}
        {!!recent.length && onOpenSession && (
          <section className="project-home-section" aria-label="Recent sessions">
            <SectionHeader
              title="Recent sessions"
              actions={
                onAllSessions && (
                  <Button variant="ghost" size="sm" onClick={onAllSessions}>
                    See all sessions
                  </Button>
                )
              }
            />
            <ul className="project-home-list">
              {recent.slice(0, recentLimit).map(({ session, repo }) => {
                const title = session.organization?.title || session.title;
                return (
                  <li key={session.agent + ':' + session.id} className="project-home-row row-hover">
                    <button
                      type="button"
                      className="project-home-open"
                      title={title}
                      onClick={() => onOpenSession(session)}
                    >
                      <EntityIcon>
                        <AgentIcon agent={session.agent} />
                      </EntityIcon>
                      <span className="project-home-text">
                        <span className="project-home-title">{title}</span>
                        <span className="project-home-meta">
                          <span className="truncate">
                            {agentLabel(session.agent)} · {repo.name}
                          </span>
                        </span>
                      </span>
                      <TimeLabel value={session.updatedAt} />
                    </button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
      <aside className="project-home-side" aria-label="Project details">
        {connected ? (
          <section className="project-home-card" aria-label="Tasks">
            <SectionHeader
              size="sm"
              title="Tasks"
              count={board?.items.length}
              actions={
                canCreateTask && (
                  <Hint label="New task">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="New task"
                      onClick={onNewTask}
                    >
                      <Plus />
                    </Button>
                  </Hint>
                )
              }
            />
            {board ? (
              <ul className="project-home-status-list">
                {columns.map((column) => (
                  <li key={column.id}>
                    <StatusIcon name={column.name} />
                    <span className="min-w-0 flex-1 truncate">{column.name}</span>
                    <span className="text-subtle tabular-nums">{count(column.id)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="project-home-card-text">Loading tasks…</p>
            )}
            <Button variant="outline" size="sm" className="self-start" onClick={onOpenTasks}>
              <SquareKanban />
              Open tasks
            </Button>
          </section>
        ) : (
          onConnectBoard && (
            <section className="project-home-card" aria-label={`Connect a ${boardName}`}>
              <SectionHeader size="sm" title="Tasks" />
              <p className="project-home-card-text">
                Optional. Connect a {boardName} to see its tasks here and start sessions from them.
              </p>
              <Button variant="secondary" size="sm" className="self-start" onClick={onConnectBoard}>
                <SquareKanban />
                Connect a {boardName}
              </Button>
            </section>
          )
        )}
        {onOpenDocs && (
          <section className="project-home-card" aria-label="Docs">
            <SectionHeader
              size="sm"
              title="Docs"
              actions={
                <Button variant="ghost" size="sm" onClick={() => onOpenDocs()}>
                  Open docs
                </Button>
              }
            />
            {docs === null ? (
              <p className="project-home-card-text">Loading pages…</p>
            ) : topDocs.length ? (
              <ul className="project-home-doc-list">
                {topDocs.map((doc) => (
                  <li key={doc.id}>
                    <button
                      type="button"
                      className="project-home-doc row-hover"
                      onClick={() => onOpenDocs(doc.id)}
                    >
                      <FileText aria-hidden="true" />
                      <span className="truncate">{doc.title || 'Untitled'}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="project-home-card-text">
                No pages yet. Write notes, plans and decisions for this project.
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              disabled={docBusy}
              onClick={() => void newPage()}
            >
              <Plus />
              New page
            </Button>
          </section>
        )}
      </aside>
    </div>
  );
}
