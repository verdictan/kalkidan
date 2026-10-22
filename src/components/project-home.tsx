import { useEffect, useState } from 'react';
import {
  Brain,
  ChevronRight,
  FileText,
  FolderGit2,
  FolderPlus,
  GitBranch,
  ListPlus,
  MessageSquarePlus,
  Plus,
  SquareKanban,
} from 'lucide-react';
import { agentLabel } from '../config/agents';
import { sessionRepo } from '../lib/session-repository';
import { NeedsYouList, relativeTime, useNeedsYou } from './project-overview';
import { ActivityDot, ChatStatusDot, activityKey, useActivityState } from './activity-dot';
import { NewChatButton } from './new-chat-button';
import { useInProjectFrame } from './project-header';
import { progressStatus } from '../hooks/use-project-boards';
import { StatusIcon, trackerColumns } from './tracker-list';
import { Hint } from './hint';
import { AgentIcon } from './ui/agent-icon';
import { Button } from './ui/button';
import { EmptyState } from './ui/empty-state';
import { EntityIcon } from './ui/entity-icon';
import { SectionHeader } from './ui/page-header';
import type { ProjectDocMetadata } from '../domain/docs';
import type { API, Agent, Project, ProjectGroup, Session, TrackerBoard } from '../types';

/** Opens a page of the project. The shell changes the route. */
function openPage(groupId: string, page: 'tasks' | 'memory', status?: string) {
  window.dispatchEvent(
    new CustomEvent('kalkidan-open-project-page', { detail: { groupId, page } }),
  );
  // The board applies the status filter after the Tasks page opens.
  if (status !== undefined)
    setTimeout(
      () =>
        window.dispatchEvent(
          new CustomEvent('kalkidan-board-filter', { detail: { groupId, status } }),
        ),
      60,
    );
}

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
 * The "New chat" split button for pages outside a project frame. Inside a frame, the project
 * header has the one "New chat" button, so this renders nothing.
 */
export function NewSessionSplit({
  repos,
  sessions,
  preferredRepoId,
}: {
  repos: Project[];
  sessions: Session[];
  /** The agent and the callbacks of older callers. The button reads the preference itself. */
  agent?: Agent;
  preferredRepoId?: string;
  onAgent?: (agent: Agent) => void;
  onStart?: (repo: Project, agent: Agent) => void;
}) {
  const inFrame = useInProjectFrame();
  if (inFrame || !repos.length) return null;
  return <NewChatButton repos={repos} sessions={sessions} preferredRepoId={preferredRepoId} />;
}

/** The overview of one project: what needs you, code folders, recent chats, tasks, docs and memory. */
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
  // Memory card: the number of entries and the latest change.
  const [memory, setMemory] = useState<{ count: number; updatedAt?: string } | null>(null);
  useEffect(() => {
    let live = true;
    Promise.resolve()
      .then(async () => {
        if (typeof api.memoryEntries === 'function') {
          const entries = await api.memoryEntries(group.id);
          return {
            count: entries.length,
            updatedAt: entries
              .map((entry) => entry.updatedAt)
              .sort()
              .at(-1),
          };
        }
        const value = await api.memoryList(group.id);
        return {
          count: value.pages.length,
          updatedAt: value.pages
            .map((page) => page.updatedAt)
            .sort()
            .at(-1),
        };
      })
      .then((value) => live && setMemory(value))
      .catch(() => live && setMemory({ count: 0 }));
    return () => {
      live = false;
    };
  }, [api, group.id]);
  const needsYou = useNeedsYou(sessions, repos);
  const { activity } = useActivityState();
  const stateOf = (session: Session) =>
    activity.find(
      (item) => activityKey(item.agent, item.id) === activityKey(session.agent, session.id),
    )?.state;
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
  // Tasks in progress, each with the chats that work on it.
  const progressIds = new Set(options.filter((o) => progressStatus(o.name)).map((o) => o.id));
  const inProgress = (board?.items || [])
    .filter((item) => item.statusId && progressIds.has(item.statusId))
    .map((item) => ({
      item,
      chats: recent
        .filter(({ session }) => (session.organization?.taskId || session.task?.id) === item.id)
        .map(({ session }) => session),
    }))
    .slice(0, 5);
  return (
    <div className="project-home">
      <div className="project-home-main">
        {!!needsYou.length && onOpenSession && (
          <section className="project-home-section" aria-label="Needs you">
            <SectionHeader title="Needs you" count={needsYou.length} />
            <NeedsYouList
              items={needsYou}
              groups={[group]}
              showProject={false}
              onOpen={onOpenSession}
            />
          </section>
        )}
        {repos.length ? (
          <section className="project-home-section" aria-label="Code folders">
            <SectionHeader
              title="Code folders"
              count={repos.length}
              actions={
                <>
                  <Button variant="ghost" size="sm" onClick={onAddFolder}>
                    <FolderPlus />
                    Add a code folder
                  </Button>
                  <Button variant="ghost" size="sm" onClick={onCloneFromGitHub}>
                    <GitHubMark />
                    Clone from GitHub
                  </Button>
                </>
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
                            {last ? `Last chat ${relativeTime(last.updatedAt)}` : 'No chats yet'}
                          </span>
                        </span>
                      </span>
                    </button>
                    <Hint label={`New chat in ${repo.name}`}>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="project-home-row-action"
                        aria-label={`New chat in ${repo.name}`}
                        onClick={() => onNewSession(repo, agent)}
                      >
                        <MessageSquarePlus />
                      </Button>
                    </Hint>
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
          <section className="project-home-section" aria-label="Recent chats">
            <SectionHeader
              title="Recent chats"
              actions={
                onAllSessions && (
                  <Button variant="ghost" size="sm" onClick={onAllSessions}>
                    See all chats
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
                      <ChatStatusDot session={session} live={stateOf(session)} />
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
                <Button variant="ghost" size="sm" onClick={onOpenTasks}>
                  Open tasks
                </Button>
              }
            />
            {board ? (
              <>
                <ul className="project-home-status-list">
                  {columns.map((column) => (
                    <li key={column.id}>
                      <button
                        type="button"
                        className="project-home-status row-hover"
                        aria-label={`${column.name}: ${count(column.id)} tasks. Show them.`}
                        onClick={() => openPage(group.id, 'tasks', column.id)}
                      >
                        <StatusIcon name={column.name} />
                        <span className="min-w-0 flex-1 truncate">{column.name}</span>
                        <span className="text-subtle tabular-nums">{count(column.id)}</span>
                        <ChevronRight className="project-home-status-chevron" aria-hidden="true" />
                      </button>
                    </li>
                  ))}
                </ul>
                {!!inProgress.length && (
                  <div className="project-home-progress" aria-label="In progress">
                    <SectionHeader size="sm" title="In progress" />
                    <ul className="project-home-doc-list">
                      {inProgress.map(({ item, chats }) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            className="project-home-doc row-hover"
                            title={item.title}
                            onClick={() =>
                              chats[0] && onOpenSession
                                ? onOpenSession(chats[0])
                                : window.dispatchEvent(
                                    new CustomEvent('kalkidan-open-task', {
                                      detail: { groupId: group.id, itemId: item.id },
                                    }),
                                  )
                            }
                          >
                            {chats[0] ? (
                              <AgentIcon agent={chats[0].agent} className="size-3.5" />
                            ) : (
                              <StatusIcon name="In progress" />
                            )}
                            <span className="truncate">
                              {item.number ? `#${item.number} ` : ''}
                              {item.title}
                            </span>
                            {chats[0] ? (
                              <ActivityDot state={stateOf(chats[0])} />
                            ) : (
                              <span className="text-subtle ml-auto shrink-0">No chat</span>
                            )}
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            ) : (
              <p className="project-home-card-text">Loading tasks…</p>
            )}
            {canCreateTask && (
              <Button variant="outline" size="sm" className="self-start" onClick={onNewTask}>
                <ListPlus />
                New task
              </Button>
            )}
          </section>
        ) : (
          onConnectBoard && (
            <section className="project-home-card" aria-label={`Connect a ${boardName}`}>
              <SectionHeader size="sm" title="Tasks" />
              <p className="project-home-card-text">
                Optional. Connect a {boardName} to see its tasks here and start chats from them.
              </p>
              <Button variant="outline" size="sm" className="self-start" onClick={onConnectBoard}>
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
        <section className="project-home-card" aria-label="Memory">
          <SectionHeader
            size="sm"
            title="Memory"
            count={memory?.count || undefined}
            actions={
              <Button variant="ghost" size="sm" onClick={() => openPage(group.id, 'memory')}>
                Open memory
              </Button>
            }
          />
          <p className="project-home-card-text">
            {memory === null ? (
              'Loading memory…'
            ) : memory.count ? (
              <>
                <Brain className="project-home-inline-icon" aria-hidden="true" />
                {memory.count === 1 ? '1 entry' : `${memory.count} entries`}
                {memory.updatedAt && ` · Last change ${relativeTime(memory.updatedAt)}`}
              </>
            ) : (
              'No entries yet. Agents save facts about this project here as they work.'
            )}
          </p>
        </section>
      </aside>
    </div>
  );
}
