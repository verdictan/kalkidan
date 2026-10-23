import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import { agentCatalog, agentLabel } from '../config/agents';
import { onChatPreferencesChange, readEnterToSend } from '../lib/chat-preferences';
import { sessionRepo } from '../lib/session-repository';
import { relativeTime } from '../lib/relative-time';
import type { WorkingStatus } from '../api/contracts';
import type { API, Agent, Project, ProjectGroup, Session } from '../types';
import type { WorkspaceIdentity } from '../hooks/use-workspace-identity';
import { activityKey, answerApproval, useActivityState } from './activity-dot';
import { requestNewChat, usePreferredAgent } from './new-chat-button';
import { useNeedsYou } from './project-overview';
import { Composer, NewChatAccessPill, RepoPill } from './composer';
import { AgentPicker } from './model-chip';
import { Button } from './ui/button';
import { Hint } from './hint';
import { IdentityMark } from './ui/identity-mark';
import { Row } from './ui/row';
import { SectionHeader } from './ui/page-header';

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

// The unsent text of each project Overview. It stays when the user opens another page.
const overviewDrafts = new Map<string, string>();

/**
 * The composer of the project Overview: the same Composer as a chat. Send starts a chat in the
 * chosen code folder with the text as the first message. The repo and the agent start with the
 * last-used values. The agent picker lists only the agents that Kalkidan found.
 */
function HomeComposer({
  api,
  group,
  repos,
  sessions,
  identity,
  onAddFolder,
}: {
  api: API;
  group: ProjectGroup;
  repos: Project[];
  sessions: Session[];
  identity: WorkspaceIdentity;
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
  function start() {
    const prompt = text.trim();
    if (!prompt) return;
    if (!repo) return onAddFolder();
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
          <RepoPill
            label={repo?.name}
            color={repo ? identity.repo(repo) : undefined}
            folders={repos.map((item) => ({
              id: item.id,
              name: item.name,
              color: identity.repo(item),
            }))}
            current={repo?.id}
            onPick={(id) => setRepoId(id)}
            onAdd={onAddFolder}
          />
          <NewChatAccessPill repoId={repo?.id} />
          <AgentPicker
            api={api}
            agent={agent}
            hostId={repo?.hostId}
            onAgentChange={(value) => {
              const next = agentCatalog.find((item) => item.id === value)?.id;
              if (next) setAgent(next);
            }}
          />
        </>
      }
    />
  );
}

/**
 * The project Overview: one composer that starts a chat, then the chats that need the user
 * (Allow and Deny in place), the chats that work now, and the repos as one row of chips. Other
 * chats are in the tree and in search.
 */
export function ProjectHomePage({
  api,
  group,
  repos,
  sessions,
  identity,
  onOpenSession,
  onRepo,
  onAddFolder,
}: {
  api: API;
  group: ProjectGroup;
  /** The code folders of this project. */
  repos: Project[];
  sessions: Session[];
  identity: WorkspaceIdentity;
  onOpenSession: (session: Session) => void;
  /** Shows a code folder in the tree. */
  onRepo: (repo: Project) => void;
  onAddFolder: () => void;
}) {
  const needsYou = useNeedsYou(sessions, repos);
  const { activity } = useActivityState();
  // The branch of each code folder, for its chip.
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
  const waitingKeys = new Set(
    needsYou.map(({ session }) => activityKey(session.agent, session.id)),
  );
  const workingNow = openSessions(sessions, repos).filter(
    ({ session }) =>
      !waitingKeys.has(activityKey(session.agent, session.id)) &&
      activity.some(
        (item) =>
          item.state === 'running' && item.agent === session.agent && item.id === session.id,
      ),
  );
  const titleOf = (session: Session) => session.organization?.title || session.title;
  const approvalOf = (session: Session) =>
    activity.find((item) => item.agent === session.agent && item.id === session.id)?.approval;
  return (
    <div className="project-home">
      <HomeComposer
        api={api}
        group={group}
        repos={repos}
        sessions={sessions}
        identity={identity}
        onAddFolder={onAddFolder}
      />
      {!!needsYou.length && (
        <section className="project-home-section" aria-label="Needs you">
          <SectionHeader title="Needs you" as="h2" />
          <div className="row-list">
            {needsYou.map(({ session, repo, reason, state }) => {
              const title = titleOf(session);
              const approval = state === 'approval' ? approvalOf(session) : undefined;
              // SH-A1: "Wants to run `npm test -- auth` · atlas-web · 2m".
              const when = relativeTime(session.updatedAt);
              const detail = (
                <>
                  {approval ? (
                    <>
                      {approval.title}
                      {approval.detail && (
                        <>
                          {' '}
                          <code className="needs-you-command">{approval.detail}</code>
                        </>
                      )}
                    </>
                  ) : (
                    reason
                  )}
                  {' · '}
                  {repo.name}
                  {when && ` · ${when}`}
                </>
              );
              return (
                <Row
                  key={activityKey(session.agent, session.id)}
                  size="list"
                  className="needs-you-row"
                  leading={<IdentityMark kind="session" color={identity.session(session)} />}
                  title={title}
                  detail={detail}
                  onClick={() => onOpenSession(session)}
                  aria-label={`${title}: ${reason}`}
                  actionsVisible
                  actions={
                    state === 'approval' ? (
                      <>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="needs-you-deny"
                          aria-label={`Deny ${title}`}
                          onClick={() => answerApproval(session, false)}
                        >
                          Deny
                        </Button>
                        <Button
                          size="sm"
                          aria-label={`Allow ${title}`}
                          onClick={() => answerApproval(session, true)}
                        >
                          Allow
                        </Button>
                      </>
                    ) : state === 'question' ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={`Answer ${title}`}
                        onClick={() => onOpenSession(session)}
                      >
                        Answer
                      </Button>
                    ) : undefined
                  }
                />
              );
            })}
          </div>
        </section>
      )}
      {!!workingNow.length && (
        <section className="project-home-section" aria-label="Working">
          <SectionHeader title="Working" as="h2" />
          <div className="row-list">
            {workingNow.map(({ session, repo }) => (
              <Row
                key={activityKey(session.agent, session.id)}
                size="list"
                leading={<IdentityMark kind="session" color={identity.session(session)} />}
                title={titleOf(session)}
                detail={`${repo.name} · ${agentLabel(session.agent)}`}
                status="working"
                onClick={() => onOpenSession(session)}
              />
            ))}
          </div>
        </section>
      )}
      <section className="project-home-section" aria-label="Repos">
        <SectionHeader title="Repos" as="h2" />
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
                  <IdentityMark kind="repo" color={identity.repo(repo)} slot={false} />
                  <span className="folder-chip-name">{repo.name}</span>
                  {branch && <span className="folder-chip-branch">{branch}</span>}
                </button>
              </li>
            );
          })}
          <li>
            <Hint label="Add repo">
              <button
                type="button"
                className="folder-chip folder-chip-add"
                aria-label="Add repo…"
                onClick={onAddFolder}
              >
                <Plus aria-hidden="true" />
              </button>
            </Hint>
          </li>
        </ul>
      </section>
    </div>
  );
}
