import { useEffect, useState, type ReactNode } from 'react';
import { FileText, FolderGit2, FolderPlus, ListTodo } from 'lucide-react';
import { agentCatalog, agentLabel } from '../config/agents';
import { agentInstalled } from '../lib/agent-preference';
import { onChatPreferencesChange, readEnterToSend } from '../lib/chat-preferences';
import { chosenModel } from '../domain/model-choice';
import { fullTime, relativeTime } from '../lib/relative-time';
import { useRecentItems } from '../lib/recent-items';
import { sessionRepo } from '../lib/session-repository';
import type { ProjectDocMetadata } from '../domain/docs';
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
import { ListRow } from './ui/list-row';
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
  // Access: the last choice in the code folder, else the choice of Settings › General.
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
      sendLabel="Start the chat"
      value={text}
      onValueChange={setText}
      onSend={start}
      canSend={!!text.trim()}
      enterToSend={enterToSend}
      controls={
        <>
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
          count={repos.length || undefined}
          actions={
            <Button variant="ghost" size="sm" onClick={onAddFolder}>
              <FolderPlus aria-hidden="true" />
              Add code folder…
            </Button>
          }
        />
        {repos.length ? (
          <ul className="folder-list">
            {repos.map((repo) => (
              <ListRow
                key={repo.id}
                as="li"
                icon={
                  <EntityIcon>
                    <FolderGit2 />
                  </EntityIcon>
                }
                title={repo.name}
                meta={repo.path}
                onClick={() => onRepo(repo)}
              />
            ))}
          </ul>
        ) : (
          <EmptyState compact className="project-home-empty-state">
            No code folders yet.
          </EmptyState>
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
