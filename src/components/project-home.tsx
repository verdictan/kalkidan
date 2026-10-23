import { useEffect, useState, type ReactNode } from 'react';
import { FileText, GitBranch, Inbox, ListTodo } from 'lucide-react';
import { agentCatalog, agentLabel } from '../config/agents';
import { agentInstalled } from '../lib/agent-preference';
import { onChatPreferencesChange, readEnterToSend } from '../lib/chat-preferences';
import { chosenModel } from '../domain/model-choice';
import { fullTime, relativeTime } from '../lib/relative-time';
import { useRecentItems } from '../lib/recent-items';
import { sessionRepo } from '../lib/session-repository';
import type { ProjectDocMetadata } from '../domain/docs';
import type { WorkingStatus } from '../api/contracts';
import type {
  API,
  Agent,
  ModelOption,
  Project,
  ProjectGroup,
  Session,
  TrackerBoard,
} from '../types';
import { activityKey, useActivityState } from './activity-dot';
import { ChatRow } from './chat-row';
import { requestNewChat, usePreferredAgent } from './new-chat-button';
import { useNeedsYou } from './project-overview';
import { openProjectPage } from './project-tabs';
import {
  AccessPill,
  Composer,
  FolderPill,
  defaultAccess,
  readAccess,
  saveAccess,
  setNextChatModel,
  type ChatAccess,
} from './composer';
import { ModelChip, useModelChoice } from './model-chip';
import { Button } from './ui/button';
import { EmptyState } from './ui/empty-state';
import { EntityIcon } from './ui/entity-icon';
import { SectionHeader } from './ui/page-header';

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

// The unsent text of each project Overview. It stays when the user opens another page.
const overviewDrafts = new Map<string, string>();

/**
 * The composer of the project home: the same Composer as a chat. Send starts a chat in the
 * chosen code folder with the text as the first message. The folder, access and agent·model
 * pills start with the last-used values.
 */
function HomeComposer({
  api,
  group,
  repos,
  sessions,
  onAddFolder,
}: {
  api: API;
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
  const [text, setText] = useState(() => overviewDrafts.get(group.id) || '');
  useEffect(() => {
    if (text) overviewDrafts.set(group.id, text);
    else overviewDrafts.delete(group.id);
  }, [group.id, text]);
  const [enterToSend, setEnterToSend] = useState(readEnterToSend);
  useEffect(() => onChatPreferencesChange(() => setEnterToSend(readEnterToSend())), []);
  // Access: the last choice in the code folder, else the choice of Settings › General, else
  // Read only. The Overview starts chats in the main checkout, never in a branch copy.
  const [access, setAccess] = useState<ChatAccess | null>(null);
  const shownAccess = access || readAccess(repo?.id) || defaultAccess() || 'read';
  // Agent and model, as in the chat composer.
  const [models, setModels] = useState<ModelOption[]>([]);
  const [model, setModel] = useState('');
  useEffect(() => {
    let live = true;
    setModels([]);
    setModel('');
    Promise.resolve(api.models?.(agent))
      .then((value) => live && setModels(value || []))
      .catch(() => {
        /* The chip offers the default model. */
      });
    return () => {
      live = false;
    };
  }, [api, agent]);
  const choice = useModelChoice(api, agent, models, agentLabel(agent));
  function start() {
    const prompt = text.trim();
    if (!prompt) return;
    if (!repo) return onAddFolder();
    if (access) saveAccess(repo.id, access);
    setNextChatModel(agent, chosenModel(choice, model));
    requestNewChat({ groupId: group.id, repoId: repo.id, agent, prompt, send: true });
    setText('');
  }
  return (
    <Composer
      label="New chat"
      inputLabel="Message for a new chat"
      placeholder={`Ask anything about ${group.name}`}
      sendLabel="Start the chat"
      value={text}
      onValueChange={setText}
      onSend={start}
      canSend={!!text.trim()}
      enterToSend={enterToSend}
      controls={
        <>
          {/* folder · access · agent, in the order of a chat. Type @ to add a file. */}
          <FolderPill
            label={repo?.name}
            folders={repos}
            current={repo?.id}
            onPick={(id) => {
              setRepoId(id);
              setAccess(null);
            }}
            onAdd={onAddFolder}
          />
          <AccessPill value={shownAccess} onChange={setAccess} />
          <ModelChip
            choice={choice}
            value={model}
            onChange={setModel}
            agent={agent}
            agentName={agentLabel(agent)}
            onAgentChange={(value) => {
              const next = agentCatalog.find((item) => item.id === value)?.id;
              if (next && agentInstalled(next)) setAgent(next);
            }}
          />
        </>
      }
    />
  );
}

/**
 * The project home (the Overview tab): one compose box that starts a chat, then what needs the
 * user, then recent chats, tasks and pages, then the code folders as one row of chips.
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
  // The branch of each code folder, for its chip and for the access default of the composer.
  const [working, setWorking] = useState<Record<string, WorkingStatus>>({});
  const repoKey = repos.map((repo) => repo.id).join(',');
  useEffect(() => {
    let live = true;
    if (typeof api.workingStatus !== 'function') return;
    for (const repo of repos)
      Promise.resolve()
        .then(() => api.workingStatus(repo.id))
        .then((status) => live && setWorking((current) => ({ ...current, [repo.id]: status })))
        .catch(() => {
          /* The chip then shows the name only. */
        });
    return () => {
      live = false;
    };
  }, [api, repoKey]);
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
      <HomeComposer
        api={api}
        group={group}
        repos={repos}
        sessions={sessions}
        onAddFolder={onAddFolder}
      />
      {!!needsYou.length && (
        <section className="project-home-section" aria-label="Needs you">
          <SectionHeader title="Needs you" count={needsYou.length} />
          <div className="chat-list">
            {needsYou.map(({ session, repo, reason, state, at }) => {
              const title = session.organization?.title || session.title;
              return (
                <ChatRow
                  key={activityKey(session.agent, session.id)}
                  className="needs-you-row"
                  time={false}
                  session={session}
                  activity={state}
                  onOpen={onOpenSession}
                  icon={
                    <EntityIcon className="needs-you-icon">
                      <Inbox />
                    </EntityIcon>
                  }
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
                  // The approval and the answer are in the chat. Review opens it there.
                  trailing={
                    <Button
                      variant="outline"
                      size="sm"
                      aria-label={`Review ${title}`}
                      onClick={() => onOpenSession(session)}
                    >
                      Review
                    </Button>
                  }
                />
              );
            })}
          </div>
        </section>
      )}
      {!!recent.length && (
        <section className="project-home-section" aria-label="Recent">
          <SectionHeader
            title="Recent"
            actions={
              <Button
                variant="bare"
                className="section-link"
                onClick={() => openProjectPage(group.id, 'chats')}
              >
                All chats
              </Button>
            }
          />
          <div className="chat-list">{recent.map((item) => item.node)}</div>
        </section>
      )}
      <section className="project-home-section" aria-label="Code folders">
        <SectionHeader
          title="Code folders"
          count={repos.length || undefined}
          actions={
            <Button
              variant="bare"
              className="section-link"
              aria-label="Add code folder…"
              onClick={onAddFolder}
            >
              Add…
            </Button>
          }
        />
        {repos.length ? (
          <ul className="folder-chips">
            {repos.map((repo) => {
              const branch = working[repo.id]?.branch;
              return (
                <li key={repo.id}>
                  <button
                    type="button"
                    className="folder-chip"
                    title={repo.path}
                    aria-label={branch ? `${repo.name}, branch ${branch}` : repo.name}
                    onClick={() => onRepo(repo)}
                  >
                    <GitBranch aria-hidden="true" />
                    <span className="folder-chip-name">{repo.name}</span>
                    {branch && <span className="folder-chip-branch">{branch}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <EmptyState compact title="No code folders yet." />
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
}: {
  api: API;
  group: ProjectGroup;
  repos: Project[];
  sessions: Session[];
  board?: TrackerBoard | null;
  onRepo: (repo: Project) => void;
  onOpenSession?: (session: Session) => void;
  onAddFolder: () => void;
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
    />
  );
}
