import { createPortal } from 'react-dom';
import { SessionMenu } from './session-menu';
import { sessionAPI } from '../lib/remote-api';
import { useEffect, useRef, useState } from 'react';
import { ChevronRight, X } from 'lucide-react';
import { pathBasename } from '../lib/platform';
import { sessionRepo } from '../lib/session-repository';
import { Conversation, type ConversationDraft } from './conversation';
import { Button } from './ui/button';
import type { SessionActivity, SessionActivityState } from './activity-dot';
import type { API, Session, Project, ProjectGroup } from '../types';
const keyOf = (session: Session) => session.agent + ':' + session.id;
// Only the most recently viewed sessions stay mounted. A session that works or waits for
// approval stays mounted until it finishes.
const mountedLimit = 5;
const titleOf = (session: Session) => session.organization?.title || session.title;
export function AgentWorkspace({
  api,
  sessions,
  projects = [],
  projectGroups = [],
  selected,
  visible,
  returnLabel = 'Repository details',
  onSelect,
  onClose,
  onOpenRepository,
  onActivity,
  onComplete,
  onCreated,
  onDraft,
}: {
  onDraft: (session: Session) => void;
  onCreated?: (draft: Session, id: string, title: string) => void;
  api: API;
  sessions: Session[];
  projects?: Project[];
  projectGroups?: ProjectGroup[];
  selected: Session;
  visible: boolean;
  returnLabel?: string;
  onSelect: (session: Session) => void;
  onClose: () => void;
  onOpenRepository?: (repository: Project) => void;
  /** Reports the open sessions that work or wait for approval. */
  onActivity?: (activity: SessionActivity[]) => void;
  onComplete: () => void;
}) {
  const [tabs, setTabs] = useState<Session[]>([selected]);
  const [sideKey, setSideKey] = useState<string | null>(null);
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
  const resolvedId = created[selectedKey]?.id;
  const saved = !!resolvedId || !selectedTab.projectId;
  const repository = sessionRepo(live, projects);
  const repositoryName = repository?.name || pathBasename(live.cwd) || returnLabel;
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
      title: fork ? 'Fork of ' + titleOf(live) : 'New side session',
      updatedAt: new Date().toISOString(),
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
    <section className="agent-workspace" aria-label="Sessions" hidden={!visible}>
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
            update={update}
            branch={branch}
            archive={() => {
              setTabs((previous) => previous.filter((t) => keyOf(t) !== selectedKey));
              onClose();
            }}
          />,
          document.getElementById('conversation-titlebar-actions')!,
        )}
      {visible &&
        document.getElementById('conversation-titlebar-heading') &&
        createPortal(
          <nav className="conversation-toolbar" aria-label="Breadcrumb">
            <button
              type="button"
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
            <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
            <span className="conversation-toolbar-title" title={titleOf(live)} aria-current="page">
              {titleOf(live)}
            </span>
          </nav>,
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
                  hidden={key !== selectedKey && key !== sideKey}
                >
                  {key === sideKey && (
                    <div className="tool-toolbar justify-between">
                      <span className="pl-1">Side session</span>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label="Close side session"
                        disabled={!!running[key]}
                        onClick={() => setSideKey(null)}
                      >
                        <X />
                      </Button>
                    </div>
                  )}
                  <Conversation
                    api={forSession(tab)}
                    projectGroup={projectGroups.find(
                      (g) => tabRepository && g.repoIds.includes(tabRepository.id),
                    )}
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
