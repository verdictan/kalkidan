import { createPortal } from 'react-dom';
import { SessionMenu, sendSessionCommand } from './session-menu';
import { viewArchivedSessions } from './session-browser';
import { sessionAPI } from '../lib/remote-api';
import { useEffect, useRef, useState } from 'react';
import { ChevronRight, GitFork, NotebookPen, X } from 'lucide-react';
import { pathBasename } from '../lib/platform';
import { sessionRepo } from '../lib/session-repository';
import { trackerConnection } from '../domain/tracker';
import type { ChatLink } from '../domain/chat-fork';
import { Conversation, type ConversationDraft } from './conversation';
import type { MentionChat } from '../lib/mention-sections';
import { Button } from './ui/button';
import { AgentIcon } from './ui/agent-icon';
import { Hint } from './hint';
import { showToast } from './ui/toast';
import { agentLabel, isAgent } from '../config/agents';
import type { SessionActivity, SessionActivityState } from './activity-dot';
import type { API, Session, Project, ProjectGroup, RemoteHost } from '../types';
const keyOf = (session: Session) => session.agent + ':' + session.id;
const timestamp = () => new Date().toISOString();
// Only the most recently viewed sessions stay mounted. A session that works or waits for
// approval stays mounted until it finishes.
const mountedLimit = 5;
const titleOf = (session: Session) => session.organization?.title || session.title;
/** Opens a linked chat. The app shell finds it in the open chats and the chat list. */
const openLink = (link: ChatLink) =>
  window.dispatchEvent(
    new CustomEvent('kalkidan-open-session', { detail: { agent: link.agent, id: link.id } }),
  );
/** The time now, as the `updatedAt` text of a new draft. */
const nowText = () => new Date().toISOString();
// The picker offers the most recent chats only.
const mentionChatLimit = 200;
/** The other saved chats in the code folders of a project, newest first, for "@" mentions. */
function projectChats(
  group: ProjectGroup | undefined,
  current: Session,
  sessions: Session[],
  projects: Project[],
): MentionChat[] {
  if (!group) return [];
  return sessions
    .filter((session) => {
      if (session.agent === current.agent && session.id === current.id) return false;
      if (session.id.startsWith('draft-') || session.organization?.archived) return false;
      const repository = sessionRepo(session, projects);
      return !!repository && group.repoIds.includes(repository.id);
    })
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, mentionChatLimit)
    .map((session) => ({
      id: session.id,
      agent: session.agent,
      title: titleOf(session),
      updatedAt: session.updatedAt,
    }));
}
export function AgentWorkspace({
  api,
  sessions,
  projects = [],
  projectGroups = [],
  hosts = [],
  initialTabs = [],
  selected,
  visible,
  returnLabel = 'Repository details',
  onSelect,
  onClose,
  onOpenRepository,
  onOpenOverview,
  onOpenProject,
  onOpenChats,
  onActivity,
  onComplete,
  onCreated,
  onDraft,
}: {
  onDraft: (session: Session) => void;
  onCreated?: (draft: Session, id: string, title: string) => void;
  api: API;
  sessions: Session[];
  /** Chats that were open at the end of the last run. They show in "Open chats" again. */
  initialTabs?: Session[];
  projects?: Project[];
  projectGroups?: ProjectGroup[];
  /** The SSH hosts. A refusal message names the host of the chat. */
  hosts?: RemoteHost[];
  selected: Session;
  visible: boolean;
  returnLabel?: string;
  onSelect: (session: Session) => void;
  onClose: () => void;
  onOpenRepository?: (repository: Project) => void;
  /** Opens the Projects overview from the breadcrumb. */
  onOpenOverview?: () => void;
  /** Opens the project home from the breadcrumb. */
  onOpenProject?: (group: ProjectGroup) => void;
  /** Reports the open chats, for the "Open chats" list in the sidebar. */
  onOpenChats?: (chats: { session: Session; state?: SessionActivityState }[]) => void;
  /** Reports the open sessions that work or wait for approval. */
  onActivity?: (activity: SessionActivity[]) => void;
  onComplete: () => void;
}) {
  const [tabs, setTabs] = useState<Session[]>(() => [
    selected,
    ...initialTabs.filter((tab) => keyOf(tab) !== keyOf(selected)),
  ]);
  // The restored chats can arrive after the first render.
  useEffect(() => {
    if (!initialTabs.length) return;
    setTabs((previous) => [
      ...previous,
      ...initialTabs.filter((tab) => !previous.some((item) => keyOf(item) === keyOf(tab))),
    ]);
  }, [initialTabs]);
  const [sideKey, setSideKey] = useState<string | null>(null);
  // A new side chat takes the focus, after the menu that opened it gives the focus back.
  useEffect(() => {
    if (!sideKey) return;
    const timer = window.setTimeout(() =>
      document.querySelector<HTMLTextAreaElement>('.agent-pane[data-side] textarea')?.focus(),
    );
    return () => window.clearTimeout(timer);
  }, [sideKey]);
  const [running, setRunning] = useState<Record<string, SessionActivityState | null>>({});
  const [created, setCreated] = useState<Record<string, { id: string; title: string }>>({});
  // Keys in the order the user viewed them, most recent first.
  const [recent, setRecent] = useState<string[]>([]);
  // Unsent text and attachments of sessions that are not mounted.
  const drafts = useRef(new Map<string, ConversationDraft>());
  // Sessions that were unmounted after the agent created them. They resume by their new id.
  const evicted = useRef(new Set<string>());
  function liveSession(tab: Session) {
    const resolved = created[keyOf(tab)];
    const stored = sessions.find((s) => s.agent === tab.agent && s.id === (resolved?.id || tab.id));
    return {
      ...tab,
      ...stored,
      id: tab.id,
      projectId: tab.projectId,
      title: stored?.title || resolved?.title || tab.title,
    };
  }
  const hostAPIs = useRef(new Map<string, API>());
  function forSession(session: Session) {
    const key = keyOf(session);
    if (!hostAPIs.current.has(key)) hostAPIs.current.set(key, sessionAPI(api, session));
    return hostAPIs.current.get(key)!;
  }
  const callbacks = useRef(new Map<string, (activity: SessionActivityState | null) => void>());
  const selectedTab =
    tabs.find((tab) => keyOf(tab) === keyOf(selected)) ||
    tabs.find((tab) => tab.agent === selected.agent && created[keyOf(tab)]?.id === selected.id) ||
    selected;
  const selectedKey = keyOf(selectedTab);
  useEffect(() => {
    setRecent((previous) =>
      previous[0] === selectedKey
        ? previous
        : [selectedKey, ...previous.filter((key) => key !== selectedKey)],
    );
  }, [selectedKey]);
  const mounted = new Set(
    tabs
      .map(keyOf)
      .filter(
        (key) =>
          key === selectedKey ||
          key === sideKey ||
          !!running[key] ||
          recent.slice(0, mountedLimit).includes(key),
      ),
  );
  for (const tab of tabs) {
    const key = keyOf(tab);
    if (!mounted.has(key) && created[key]) evicted.current.add(key);
  }
  useEffect(() => {
    setTabs((previous) =>
      previous.some((s) => keyOf(s) === selectedKey) ? previous : [...previous, selected],
    );
    // Archive removes the tab but keeps the selection. Opening the session again adds it back.
  }, [selectedKey, visible]);
  // The sidebar and the title bar close a chat with this event. A chat that works keeps
  // running in the background and stays in the list.
  const closeRef = useRef<(key: string) => void>(() => {});
  closeRef.current = (key: string) => {
    if (!running[key]) {
      setTabs((previous) => previous.filter((t) => keyOf(t) !== key));
      if (sideKey === key) setSideKey(null);
    }
    if (key === selectedKey && visible) onClose();
  };
  useEffect(() => {
    const onCloseChat = (event: Event) => {
      const detail = (event as CustomEvent<{ agent: string; id: string }>).detail;
      if (!detail) return;
      const tab = tabs.find(
        (t) =>
          t.agent === detail.agent && (t.id === detail.id || created[keyOf(t)]?.id === detail.id),
      );
      if (tab) closeRef.current(keyOf(tab));
    };
    window.addEventListener('kalkidan-close-chat', onCloseChat);
    return () => window.removeEventListener('kalkidan-close-chat', onCloseChat);
  }, [tabs, created]);
  const reportChats = useRef(onOpenChats);
  reportChats.current = onOpenChats;
  useEffect(() => {
    reportChats.current?.(
      tabs.map((tab) => {
        const session = liveSession(tab);
        return {
          session: { ...session, id: created[keyOf(tab)]?.id || session.id },
          state: running[keyOf(tab)] || undefined,
        };
      }),
    );
  }, [tabs, running, created, sessions]);
  const reportActivity = useRef(onActivity);
  reportActivity.current = onActivity;
  useEffect(() => {
    const activity: SessionActivity[] = [];
    for (const tab of tabs) {
      const state = running[keyOf(tab)];
      if (!state) continue;
      const session = liveSession(tab);
      activity.push({
        agent: session.agent,
        id: created[keyOf(tab)]?.id || session.id,
        projectId: session.projectId,
        cwd: session.cwd,
        hostId: session.hostId,
        state,
      });
    }
    reportActivity.current?.(activity);
  }, [running, tabs, created]);
  const live = liveSession(selectedTab);
  const forkedFrom = live.organization?.forkedFrom || live.forkOf;
  const forks = live.organization?.forks || [];
  const resolvedId = created[selectedKey]?.id;
  const saved = !!resolvedId || !selectedTab.projectId;
  const repository = sessionRepo(live, projects);
  const repositoryName = repository?.name || pathBasename(live.cwd) || returnLabel;
  const group = repository
    ? projectGroups.find((g) => g.repoIds.includes(repository.id))
    : undefined;
  async function update(changes: import('../types').SessionOrganization) {
    if (saved) await api.updateSession(live.agent, resolvedId || live.id, changes);
    else onDraft({ ...live, organization: { ...live.organization, ...changes } });
    setTabs((previous) =>
      previous.map((t) =>
        keyOf(t) === selectedKey ? { ...t, organization: { ...t.organization, ...changes } } : t,
      ),
    );
    onComplete();
  }
  /**
   * Changes the agent of a new chat before its first message. The draft keeps its ID, text and
   * task, so the sidebar shows one chat.
   */
  function switchAgent(tab: Session, agent: string, taskId?: string) {
    const key = keyOf(tab);
    if (created[key] || !tab.id.startsWith('draft-') || !isAgent(agent)) return;
    const session = liveSession(tab);
    const generic = /^New( .*)? (session|chat)$/.test(session.title);
    const next: Session = {
      ...session,
      agent,
      title: generic ? `New ${agentLabel(agent)} chat` : session.title,
      organization: taskId ? { ...session.organization, taskId } : session.organization,
    };
    const draft = drafts.current.get(key);
    drafts.current.delete(key);
    if (draft) drafts.current.set(keyOf(next), draft);
    setTabs((previous) => previous.map((t) => (keyOf(t) === key ? next : t)));
    if (sideKey === key) setSideKey(keyOf(next));
    onDraft(next);
    if (key === selectedKey) onSelect(next);
  }
  /**
   * Opens a new, empty chat in the code folder of a read-only chat of another account. The new
   * chat gets its own authorized binding under the active account when it starts. Nothing of the
   * read-only chat moves.
   */
  function startNew(tab: Session) {
    const source = liveSession(tab);
    const repo = sessionRepo(source, projects);
    if (!repo) {
      showToast({ message: 'Add this repository to a project first.', tone: 'error' });
      return;
    }
    const draft: Session = {
      id: 'draft-' + crypto.randomUUID(),
      projectId: repo.id,
      cwd: repo.path,
      hostId: repo.hostId,
      agent: source.agent,
      title: `New ${agentLabel(source.agent)} chat`,
      updatedAt: nowText(),
    };
    setTabs((previous) => [...previous, draft]);
    onDraft(draft);
    setSideKey(null);
    onSelect(draft);
  }
  async function branch(fork: boolean, worktree?: string) {
    let repo = sessionRepo(live, projects);
    if (!repo) throw new Error('Add this repository to a project first.');
    if (worktree) {
      const result = await api.taskWorktree(repo.id, worktree);
      if (!result) return;
      repo = result;
    }
    const draft: Session = {
      id: 'draft-' + crypto.randomUUID(),
      projectId: repo.id,
      cwd: repo.path,
      hostId: repo.hostId,
      agent: live.agent,
      title: fork ? 'Fork of ' + titleOf(live) : 'New side chat',
      updatedAt: timestamp(),
      forkFrom: fork ? resolvedId || live.id : undefined,
    };
    setTabs((previous) => [...previous, draft]);
    onDraft(draft);
    onComplete();
    if (fork) {
      setSideKey(null);
      onSelect(draft);
    } else setSideKey(keyOf(draft));
  }
  return (
    <section className="agent-workspace" aria-label="Chats" hidden={!visible}>
      {visible &&
        document.getElementById('conversation-titlebar-actions') &&
        createPortal(
          <SessionMenu
            key={selectedKey}
            api={api}
            session={{ ...live, id: resolvedId || live.id }}
            saved={saved}
            running={!!running[selectedKey]}
            repositoryId={repository?.id}
            inProject={repository ? !!group : undefined}
            board={group ? !!trackerConnection(group) : undefined}
            update={update}
            branch={branch}
            archive={() => {
              setTabs((previous) => previous.filter((t) => keyOf(t) !== selectedKey));
              onClose();
            }}
            onViewArchived={
              repository
                ? () => {
                    viewArchivedSessions(repository.id);
                    onOpenRepository?.(repository);
                  }
                : undefined
            }
          />,
          document.getElementById('conversation-titlebar-actions')!,
        )}
      {visible &&
        document.getElementById('conversation-titlebar-heading') &&
        createPortal(
          <div className="conversation-heading">
            <nav className="conversation-toolbar conversation-trail" aria-label="Breadcrumb">
              {onOpenOverview && (
                <>
                  <button
                    type="button"
                    className="topbar-crumb"
                    data-optional
                    aria-label="Projects overview"
                    title="Projects"
                    onClick={onOpenOverview}
                  >
                    Projects
                  </button>
                  <ChevronRight
                    aria-hidden="true"
                    data-optional
                    className="size-3 shrink-0 text-muted-foreground"
                  />
                </>
              )}
              {group && onOpenProject && (
                <>
                  <button
                    type="button"
                    className="topbar-crumb"
                    data-middle
                    aria-label={`${group.name} project`}
                    title={group.name}
                    onClick={() => onOpenProject(group)}
                  >
                    {group.name}
                  </button>
                  <ChevronRight
                    aria-hidden="true"
                    className="size-3 shrink-0 text-muted-foreground"
                  />
                </>
              )}
              {/* The composer of a new chat shows the code folder. In a project, the trail
                  shows the project, not the folder. */}
              {!(group && onOpenProject) && (
                <>
                  <button
                    type="button"
                    data-middle
                    className="conversation-breadcrumb-repo"
                    aria-label={`Back to ${repositoryName}`}
                    title={`Back to ${repositoryName}`}
                    onClick={() => {
                      if (repository && onOpenRepository) onOpenRepository(repository);
                      else onClose();
                    }}
                  >
                    {repositoryName}
                  </button>
                  <ChevronRight
                    aria-hidden="true"
                    className="size-3 shrink-0 text-muted-foreground"
                  />
                </>
              )}
              <span
                className="conversation-toolbar-title"
                title={titleOf(live)}
                aria-current="page"
              >
                {titleOf(live)}
              </span>
              {live.organization?.notes && (
                <button
                  type="button"
                  className="conversation-note"
                  title={live.organization.notes}
                  aria-label={`Notes: ${live.organization.notes}`}
                  onClick={() => sendSessionCommand('session-notes')}
                >
                  <NotebookPen aria-hidden="true" className="size-3 shrink-0" />
                  <span className="truncate">{live.organization.notes.split('\n')[0]}</span>
                </button>
              )}
              {forkedFrom && (
                <button
                  type="button"
                  className="conversation-note"
                  title={`Forked from ${forkedFrom.title}`}
                  onClick={() => openLink(forkedFrom)}
                >
                  <GitFork aria-hidden="true" className="size-3 shrink-0" />
                  <span className="truncate">Forked from {forkedFrom.title}</span>
                </button>
              )}
              {forks.length ? (
                <button
                  type="button"
                  className="conversation-note"
                  title={forks.map((fork) => fork.title).join('\n')}
                  onClick={() => openLink(forks.at(-1)!)}
                >
                  <GitFork aria-hidden="true" className="size-3 shrink-0" />
                  <span className="truncate">
                    Forked to {forks.at(-1)!.title}
                    {forks.length > 1 && ` and ${forks.length - 1} more`}
                  </span>
                </button>
              ) : null}
            </nav>
          </div>,
          document.getElementById('conversation-titlebar-heading')!,
        )}
      <div className="agent-stage">
        <div className="agent-stage-body">
          <div
            className={'agent-panes' + (sideKey && sideKey !== selectedKey ? ' has-side-chat' : '')}
          >
            {tabs.map((tab) => {
              const key = keyOf(tab);
              if (!mounted.has(key)) return null;
              const tabRepository = sessionRepo(tab, projects);
              const tabGroup = projectGroups.find(
                (g) => tabRepository && g.repoIds.includes(tabRepository.id),
              );
              // A session that the agent created before it was unmounted resumes by its id.
              const resumed = evicted.current.has(key) && created[key];
              const session = liveSession(tab);
              if (!callbacks.current.has(key))
                callbacks.current.set(key, (activity) =>
                  setRunning((previous) =>
                    previous[key] === activity ? previous : { ...previous, [key]: activity },
                  ),
                );
              return (
                <div
                  className="agent-pane"
                  key={key}
                  data-side={key === sideKey || undefined}
                  hidden={key !== selectedKey && key !== sideKey}
                >
                  {key === sideKey && (
                    <div className="tool-toolbar" role="group" aria-label="Side chat">
                      <AgentIcon agent={session.agent} className="size-4 shrink-0" />
                      <span className="side-chat-title">
                        {/^New( .*)? (session|chat)$/.test(titleOf(session))
                          ? 'New chat'
                          : titleOf(session)}
                      </span>
                      <span className="side-chat-agent">{agentLabel(session.agent)}</span>
                      <Hint
                        label={running[key] ? 'Wait for the response' : 'Close side chat'}
                        disabled={!!running[key]}
                      >
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          aria-label="Close side chat"
                          disabled={!!running[key]}
                          onClick={() => setSideKey(null)}
                        >
                          <X />
                        </Button>
                      </Hint>
                    </div>
                  )}
                  <Conversation
                    api={forSession(tab)}
                    hostName={hosts.find((host) => host.id === session.hostId)?.name}
                    projectGroup={tabGroup}
                    mentionChats={projectChats(tabGroup, tab, sessions, projects)}
                    folders={
                      tabGroup
                        ? projects
                            .filter((project) => tabGroup.repoIds.includes(project.id))
                            .map((project) => ({ id: project.id, name: project.name }))
                        : []
                    }
                    repositoryId={tabRepository?.id}
                    session={
                      resumed
                        ? { ...session, id: resumed.id, projectId: undefined, forkFrom: undefined }
                        : session
                    }
                    draft={drafts.current.get(key)}
                    onDraftChange={(draft) => {
                      if (draft) drafts.current.set(key, draft);
                      else drafts.current.delete(key);
                    }}
                    onTitleChange={(title) => {
                      // A draft takes the first line of its first message as its title, so a
                      // failed first send does not leave "New … chat".
                      if (!title || created[key] || !tab.id.startsWith('draft-')) return;
                      setTabs((previous) =>
                        previous.map((t) => (keyOf(t) === key ? { ...t, title } : t)),
                      );
                      onDraft({ ...liveSession(tab), title });
                    }}
                    onAgentChange={
                      tab.id.startsWith('draft-') && !created[key]
                        ? (agent, taskId) => switchAgent(tab, agent, taskId)
                        : undefined
                    }
                    onStartNew={() => startNew(tab)}
                    onSessionCreated={(id, title) => {
                      setCreated((previous) => ({ ...previous, [key]: { id, title } }));
                      onCreated?.(tab, id, title);
                    }}
                    titlebarVisible={key === selectedKey}
                    open={visible && (key === selectedKey || key === sideKey)}
                    onComplete={onComplete}
                    onActivityChange={callbacks.current.get(key)!}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </section>
  );
}
