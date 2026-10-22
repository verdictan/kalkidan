import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  ArrowUp,
  ChevronDown,
  FileText,
  FolderGit2,
  FolderPlus,
  GitBranch,
  ListTodo,
} from 'lucide-react';
import { agentCatalog, agentLabel } from '../config/agents';
import { agentInstalled, agentMenuLabel, savePreferredAgent } from '../lib/agent-preference';
import { fullTime, relativeTime } from '../lib/relative-time';
import { useRecentItems } from '../lib/recent-items';
import { sessionRepo } from '../lib/session-repository';
import { isMac, shortcutLabel } from '../lib/platform';
import type { ProjectDocMetadata } from '../domain/docs';
import type { API, Agent, Project, ProjectGroup, Session, TrackerBoard } from '../types';
import { activityKey, useActivityState } from './activity-dot';
import { ChatRow } from './chat-row';
import { requestNewChat, usePreferredAgent } from './new-chat-button';
import { useNeedsYou } from './project-overview';
import { openProjectPage } from './project-tabs';
import { Hint } from './hint';
import { AgentIcon } from './ui/agent-icon';
import { Button } from './ui/button';
import { EntityIcon } from './ui/entity-icon';
import { SectionHeader } from './ui/page-header';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';

const recentLimit = 8;

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

/** One row of "Recent" that is not a chat: a task or a doc page. It looks like a chat row. */
function ItemRow({
  icon,
  title,
  meta,
  onOpen,
}: {
  icon: ReactNode;
  title: string;
  meta: ReactNode;
  onOpen: () => void;
}) {
  return (
    <div className="chat-row row-hover">
      <button type="button" className="chat-row-open" title={title} onClick={onOpen}>
        <EntityIcon>{icon}</EntityIcon>
        <span className="chat-row-text">
          <span className="chat-row-title">
            <span className="truncate">{title}</span>
          </span>
          <span className="chat-row-meta">{meta}</span>
        </span>
      </button>
    </div>
  );
}

/**
 * The compose box of the project home. Return starts a chat in the chosen code folder with the
 * text as the first message. The folder and agent chips start with the last-used values.
 */
function Composer({
  group,
  repos,
  sessions,
  onAddFolder,
}: {
  group: ProjectGroup;
  repos: Project[];
  sessions: Session[];
  onAddFolder: () => void;
}) {
  const preferred = usePreferredAgent();
  const [agent, setAgent] = useState<Agent>(preferred);
  useEffect(() => setAgent(preferred), [preferred]);
  const [repoId, setRepoId] = useState('');
  const repo = lastUsedRepo(repos, sessions, repoId);
  const [text, setText] = useState('');
  const input = useRef<HTMLTextAreaElement>(null);
  // The box grows with the text, up to 8 lines.
  useEffect(() => {
    const element = input.current;
    if (!element) return;
    element.style.height = 'auto';
    element.style.height = `${Math.min(element.scrollHeight, 176)}px`;
  }, [text]);
  function start() {
    const prompt = text.trim();
    if (!prompt) return;
    if (!repo) return onAddFolder();
    requestNewChat({ groupId: group.id, repoId: repo.id, agent, prompt, send: true });
    setText('');
  }
  function onKey(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    start();
  }
  const keys = shortcutLabel([], '↵');
  return (
    <form
      className="home-composer"
      aria-label="New chat"
      onSubmit={(event) => {
        event.preventDefault();
        start();
      }}
    >
      <textarea
        ref={input}
        className="home-composer-input"
        rows={2}
        aria-label="Message for a new chat"
        aria-keyshortcuts={`Enter ${isMac ? 'Meta' : 'Control'}+Enter`}
        placeholder={`What should an agent do in ${group.name}?`}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={onKey}
      />
      <div className="home-composer-bar">
        {repos.length ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="chip" aria-label={`Code folder: ${repo?.name}`}>
                <GitBranch />
                <span className="truncate">{repo?.name}</span>
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-56">
              <DropdownMenuRadioGroup value={repo?.id || ''} onValueChange={setRepoId}>
                {repos.map((item) => (
                  <DropdownMenuRadioItem key={item.id} value={item.id}>
                    <FolderGit2 className="size-4" />
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <Button variant="chip" onClick={onAddFolder}>
            <FolderPlus />
            Add code folder
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="chip" aria-label={`Agent: ${agentLabel(agent)}`}>
              <AgentIcon agent={agent} />
              {agentLabel(agent)}
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-56">
            <DropdownMenuRadioGroup
              value={agent}
              onValueChange={(value) => {
                const next = agentCatalog.find((item) => item.id === value)?.id;
                if (!next || !agentInstalled(next)) return;
                setAgent(next);
                // The last-used agent is the default of the next chat too.
                savePreferredAgent(next);
              }}
            >
              {agentCatalog.map(({ id }) => (
                <DropdownMenuRadioItem key={id} value={id} disabled={!agentInstalled(id)}>
                  <AgentIcon agent={id} className="size-4" />
                  {agentMenuLabel(id, agentLabel(id))}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <Hint label={`Start the chat (${keys})`}>
          <Button
            type="submit"
            size="icon-sm"
            className="home-composer-send"
            aria-label="Start the chat"
            disabled={!text.trim()}
          >
            <ArrowUp />
          </Button>
        </Hint>
      </div>
    </form>
  );
}

/**
 * The project home (the Overview tab): one compose box that starts a chat, then what waits for
 * the user, then recent chats, tasks and pages, then the code folders.
 */
export function ProjectHomePage({
  api,
  group,
  repos,
  sessions,
  board,
  onOpenSession,
  onRepo,
  onAddFolder,
  onCloneFromGitHub,
}: {
  api: API;
  group: ProjectGroup;
  /** The code folders of this project. */
  repos: Project[];
  sessions: Session[];
  /** The board of the project, when one is connected. */
  board?: TrackerBoard;
  onOpenSession: (session: Session) => void;
  onRepo: (repo: Project) => void;
  onAddFolder: () => void;
  onCloneFromGitHub: () => void;
}) {
  const needsYou = useNeedsYou(sessions, repos);
  const { activity } = useActivityState();
  const stateOf = (session: Session) =>
    activity.find(
      (item) => activityKey(item.agent, item.id) === activityKey(session.agent, session.id),
    )?.state;
  const [docs, setDocs] = useState<ProjectDocMetadata[]>([]);
  useEffect(() => {
    let live = true;
    if (typeof api.docsMetadata !== 'function') return;
    Promise.resolve()
      .then(() => api.docsMetadata(group.id))
      .then((value) => live && setDocs(value))
      .catch(() => {
        /* Recent then shows the pages that the list has. */
      });
    return () => {
      live = false;
    };
  }, [api, group.id]);
  const opened = useRecentItems();
  const waitingKeys = new Set(
    needsYou.map(({ session }) => activityKey(session.agent, session.id)),
  );
  // Recent work of every kind, newest first: chats by their last change, tasks and pages by
  // the time the user opened them.
  const chats = openSessions(sessions, repos)
    .filter(({ session }) => !waitingKeys.has(activityKey(session.agent, session.id)))
    .map(({ session, repo }) => ({
      key: 'chat:' + activityKey(session.agent, session.id),
      at: Date.parse(session.updatedAt || '') || 0,
      node: (
        <ChatRow
          key={'chat:' + activityKey(session.agent, session.id)}
          session={session}
          activity={stateOf(session)}
          folder={repos.length > 1 ? repo.name : undefined}
          onOpen={onOpenSession}
        />
      ),
    }));
  const items = opened
    .filter((item) => item.groupId === group.id && item.kind !== 'chat')
    .flatMap((item) => {
      const when = relativeTime(new Date(item.at).toISOString());
      if (item.kind === 'doc') {
        const doc = docs.find((page) => page.id === item.id);
        if (docs.length && !doc) return [];
        const title = doc?.title || item.title || 'Untitled';
        return [
          {
            key: 'doc:' + item.id,
            at: item.at,
            node: (
              <ItemRow
                key={'doc:' + item.id}
                icon={<FileText />}
                title={title}
                meta={`Page · ${when}`}
                onOpen={() =>
                  openProjectPage(group.id, 'knowledge', { section: 'pages', docId: item.id })
                }
              />
            ),
          },
        ];
      }
      const task = board?.items.find((entry) => entry.id === item.id);
      const status = board?.statusField?.options.find((o) => o.id === task?.statusId)?.name;
      const title = task
        ? `${task.number ? `#${task.number} ` : ''}${task.title}`
        : item.title || 'Task';
      return [
        {
          key: 'task:' + item.id,
          at: item.at,
          node: (
            <ItemRow
              key={'task:' + item.id}
              icon={<ListTodo />}
              title={title}
              meta={['Task', status || when].join(' · ')}
              onOpen={() =>
                window.dispatchEvent(
                  new CustomEvent('kalkidan-open-task', {
                    detail: { groupId: group.id, itemId: item.id },
                  }),
                )
              }
            />
          ),
        },
      ];
    });
  const recent = [...chats, ...items].sort((a, b) => b.at - a.at).slice(0, recentLimit);
  return (
    <div className="project-home">
      <Composer group={group} repos={repos} sessions={sessions} onAddFolder={onAddFolder} />
      <div className="project-home-lists">
        {!!needsYou.length && (
          <section className="project-home-section" aria-label="Waiting for you">
            <SectionHeader title="Waiting for you" count={needsYou.length} />
            <div className="chat-list">
              {needsYou.map(({ session, repo, reason, state, at }) => (
                <ChatRow
                  key={activityKey(session.agent, session.id)}
                  session={session}
                  activity={state}
                  onOpen={onOpenSession}
                  meta={
                    <>
                      {[reason, repos.length > 1 ? repo.name : undefined]
                        .filter(Boolean)
                        .join(' · ')}
                      {at && (
                        <>
                          {' · '}
                          <time dateTime={at} title={fullTime(at)}>
                            {relativeTime(at)}
                          </time>
                        </>
                      )}
                    </>
                  }
                />
              ))}
            </div>
          </section>
        )}
        {!!recent.length && (
          <section className="project-home-section" aria-label="Recent">
            <SectionHeader title="Recent" />
            <div className="chat-list">{recent.map((item) => item.node)}</div>
          </section>
        )}
      </div>
      <section className="project-home-section" aria-label="Code folders">
        <SectionHeader
          title="Code folders"
          actions={
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm">
                  Add
                  <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52">
                <DropdownMenuItem onSelect={onAddFolder}>
                  <FolderPlus className="size-4" />
                  Choose a folder…
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={onCloneFromGitHub}>
                  <GitHubMark />
                  Clone from GitHub…
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          }
        />
        {repos.length ? (
          <ul className="folder-list">
            {repos.map((repo) => (
              <li key={repo.id}>
                <button
                  type="button"
                  className="folder-row row-hover"
                  title={repo.path}
                  onClick={() => onRepo(repo)}
                >
                  <FolderGit2 aria-hidden="true" />
                  <span className="truncate">{repo.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="project-home-empty">No code folders yet.</p>
        )}
      </section>
    </div>
  );
}

/**
 * The older entry point of the project home. The Tasks page used it for its Overview. It now
 * shows the same home as the Overview tab.
 */
export function ProjectHome({
  api,
  group,
  repos,
  sessions,
  board,
  onRepo,
  onOpenSession,
  onAddFolder,
  onCloneFromGitHub,
}: {
  api: API;
  group: ProjectGroup;
  repos: Project[];
  sessions: Session[];
  board?: TrackerBoard | null;
  onRepo: (repo: Project) => void;
  onOpenSession?: (session: Session) => void;
  onAddFolder: () => void;
  onCloneFromGitHub: () => void;
  [legacy: string]: unknown;
}) {
  return (
    <ProjectHomePage
      api={api}
      group={group}
      repos={repos}
      sessions={sessions}
      board={board || undefined}
      onRepo={onRepo}
      onOpenSession={
        onOpenSession ||
        ((session) =>
          window.dispatchEvent(
            new CustomEvent('kalkidan-open-session', {
              detail: { agent: session.agent, id: session.id },
            }),
          ))
      }
      onAddFolder={onAddFolder}
      onCloneFromGitHub={onCloneFromGitHub}
    />
  );
}
