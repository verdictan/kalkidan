import { Onboarding, onboardingDismissed, dismissOnboarding } from './components/onboarding';
import { ProjectDocsPanel } from './components/project-docs';
import { WorkspaceSearch } from './components/workspace-search';
import { useSidebarWidth } from './hooks/use-sidebar-width';
import { SidebarResizer } from './components/sidebar-resizer';
import { useNavigationHistory } from './hooks/use-navigation-history';
import { agentCatalog, agentLabel } from './config/agents';
import { trackerConnection } from './domain/tracker';
import { useTracker } from './hooks/use-tracker';
import { SettingsDialog } from './components/settings-dialog';
import { ProjectOverview } from './components/project-overview';
import { ActionMenu } from './components/action-menu';
import { Hint } from './components/hint';

import { AddRepository } from './components/add-repository';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  PanelLeft,
  Layers2,
  Folder,
  FolderPlus,
  Search,
  ArrowUpRight,
  GitBranch,
  Plus,
  RefreshCw,
  X,
  Settings2,
  ArrowRight,
  ArrowLeft,
  Check,
  Trash2,
} from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Badge } from './components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './components/ui/dialog';
import { Textarea } from './components/ui/textarea';
import { SessionBrowser } from './components/session-browser';
import { ProjectTrackerPanel } from './components/project-tracker';
import { Choice } from './components/choice';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from './components/ui/collapsible';
import { ProjectTree } from './components/project-tree';
import { worktreeSessions } from './lib/worktree-sessions';
import { sessionRepo } from './lib/session-repository';
import { AgentWorkspace } from './components/agent-workspace';
import type { API, Snapshot, GitInfo, Agent, Project, Session, TrackerItem } from './types';
export function App({ api, preview = false }: { api: API; preview?: boolean }) {
  const [data, setData] = useState<Snapshot>({
    projects: [],
    sessions: [],
    warnings: [],
    platform: '',
  });
  const [home, setHome] = useState(true);
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const onboardingChecked = useRef(false);
  const sidebar = useSidebarWidth();
  const [navigationOpen, setNavigationOpen] = useState(true);
  const [trackerTarget, setTrackerTarget] = useState('');
  const [connectRequest, setConnectRequest] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [projectPage, setProjectPage] = useState<'board' | 'docs'>('board');
  const [boardGroup, setBoardGroup] = useState<string | null>(null);
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [git, setGit] = useState<GitInfo | null>(null);
  const [gitError, setGitError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [modal, setModal] = useState<'worktree' | 'edit' | 'remove' | null>(null);
  const [branch, setBranch] = useState('');
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [repoGroup, setRepoGroup] = useState('');
  const [revision, setRevision] = useState(0);
  const [drafts, setDrafts] = useState<Session[]>([]);
  const [chatSession, setChatSession] = useState<Session | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const navigation = useNavigationHistory(
    { home, boardGroup, projectPage, selected, chatOpen, chatSession },
    (route) =>
      route.home
        ? 'home'
        : route.chatOpen && route.chatSession
          ? `chat:${route.chatSession.hostId || ''}:${route.chatSession.agent}:${route.chatSession.id}`
          : route.boardGroup
            ? `${route.projectPage}:${route.boardGroup}`
            : `repo:${route.selected}`,
    (route) => {
      const valid =
        route.home ||
        (route.boardGroup
          ? data.groups?.some((group) => group.id === route.boardGroup)
          : data.projects.some((project) => project.id === route.selected));
      setHome(!valid || route.home);
      setBoardGroup(valid ? route.boardGroup : null);
      setProjectPage(route.projectPage);
      setSelected(route.selected);
      setChatOpen(!!valid && route.chatOpen);
      if (route.chatOpen && route.chatSession) setChatSession(route.chatSession);
    },
  );
  const searchRef = useRef<HTMLInputElement>(null);
  const [gitLoading, setGitLoading] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setNavigationOpen(true);
        requestAnimationFrame(() => searchRef.current?.focus());
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  async function refresh() {
    const value = await api.snapshot();
    setData(value);
    if (!onboardingChecked.current) {
      onboardingChecked.current = true;
      if (
        !preview &&
        !value.projects.length &&
        !value.groups?.length &&
        !value.sessions.length &&
        !onboardingDismissed()
      )
        setOnboardingOpen(true);
    }
    setSelected((id) =>
      value.projects.some((p) => p.id === id) ? id : value.projects[0]?.id || '',
    );
    setRevision((r) => r + 1);
  }
  async function run(action: () => Promise<unknown>, message?: string) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
      await refresh();
      if (message) setNotice(message);
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
          : String(e),
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    void run(async () => {});
  }, []);
  const routed = useRef(false);
  useEffect(() => {
    if (routed.current || !data.sessions.length || !location.hash.startsWith('#session=')) return;
    routed.current = true;
    try {
      const target = JSON.parse(decodeURIComponent(location.hash.slice(9)));
      const session = data.sessions.find((s) => s.id === target.id && s.agent === target.agent);
      if (session) openConversation(session);
      else setError('This conversation is no longer available.');
    } catch {
      setError('Invalid conversation link.');
    }
  }, [data.sessions]);
  const repositoryCache = useRef(new Map<string, import('./domain/project').RepositorySnapshot>());
  const [repositoryView, setRepositoryView] = useState<{
    id: string;
    value: import('./domain/project').RepositorySnapshot;
  } | null>(null);
  const [repositoryRevision, setRepositoryRevision] = useState(0);
  useEffect(() => {
    if (home || chatOpen || boardGroup || !selected) return;
    let live = true;
    let pending = false;
    const cached = repositoryCache.current.get(selected);
    setGit(cached?.git || null);
    setRepositoryView(cached ? { id: selected, value: cached } : null);
    setGitError('');
    setGitLoading(!cached);
    const update = async () => {
      if (pending || document.visibilityState === 'hidden') return;
      pending = true;
      try {
        const value = await api.repositorySnapshot(selected);
        if (!live) return;
        repositoryCache.current.set(selected, value);
        setGit(value.git);
        setRepositoryView({ id: selected, value });
        setGitError(value.warnings.join(' '));
      } catch (error) {
        if (live) setGitError(error instanceof Error ? error.message : String(error));
      } finally {
        pending = false;
        if (live) setGitLoading(false);
      }
    };
    void update();
    const timer = window.setInterval(update, 15000);
    window.addEventListener('focus', update);
    return () => {
      live = false;
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
    };
  }, [home, chatOpen, boardGroup, selected, revision, repositoryRevision]);
  const visibleSessions =
    repositoryView?.id === selected ? repositoryView.value.sessions : data.sessions;
  const project = data.projects.find((p) => p.id === selected);
  const connectionGroup =
    (!home &&
      (data.groups?.find((g) => g.id === boardGroup) ||
        data.groups?.find((g) => g.repoIds.includes(selected)))) ||
    data.groups?.find((g) => g.id === trackerTarget) ||
    (data.groups?.length === 1 ? data.groups[0] : undefined);
  const connection = trackerConnection(connectionGroup);
  const { name: trackerName, client: connectionClient } = useTracker(api, connection?.provider);
  const [verifiedConnection, setVerifiedConnection] = useState('');
  const connectionKey = connection
    ? `${connectionGroup?.id}:${connection.provider}:${connection.project.id}`
    : '';
  useEffect(() => {
    let live = true;
    let request = 0;
    setVerifiedConnection('');
    if (!connectionKey) return;
    const check = async () => {
      const current = ++request;
      try {
        const state = await connectionClient.authStatus();
        if (live && current === request)
          setVerifiedConnection(state.status === 'ready' ? connectionKey : '');
      } catch {
        if (live && current === request) setVerifiedConnection('');
      }
    };
    void check();
    window.addEventListener('focus', check);
    return () => {
      live = false;
      window.removeEventListener('focus', check);
    };
  }, [connectionClient, connectionKey, revision]);
  const showConnectionButton = !connectionKey || verifiedConnection !== connectionKey;
  const projects = data.projects
    .filter((p) =>
      `${p.name} ${p.path} ${(data.groups || []).find((g) => g.repoIds.includes(p.id))?.name || ''}`
        .toLowerCase()
        .includes(query.toLowerCase()),
    )
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.name.localeCompare(b.name));
  const sessions =
    repositoryView?.id === selected
      ? visibleSessions
      : data.sessions.filter((s) => sessionRepo(s, data.projects)?.id === project?.id);
  function openProject(p: Project) {
    setHome(false);
    setChatOpen(false);
    setBoardGroup(null);
    setSelected(p.id);
  }
  function openConversation(session: Session) {
    setHome(false);
    const repo = sessionRepo(session, data.projects);
    if (repo) setSelected(repo.id);
    setBoardGroup((current) =>
      data.groups?.find((g) => g.id === current)?.repoIds.includes(repo?.id || '') ? current : null,
    );
    setChatSession(session);
    setChatOpen(true);
  }
  const launchTerminal = () =>
    project && run(() => api.launch(project.id, 'terminal'), 'Opened in Terminal.');
  function newSession(agent: Agent, repo = project, task?: TrackerItem, initialPrompt?: string) {
    if (!repo) return;
    setHome(false);
    setSelected(repo.id);
    const draft: Session = {
      id: 'draft-' + crypto.randomUUID(),
      projectId: repo.id,
      hostId: repo.hostId,
      agent,
      cwd: repo.path,
      task,
      initialPrompt:
        initialPrompt ||
        (task
          ? `Work on this task: ${task.title}. Review the repository and propose an implementation plan first.`
          : undefined),
      title: `New ${agentLabel(agent)} session`,
      updatedAt: new Date().toISOString(),
    };
    setDrafts((previous) => [...previous, draft]);
    setChatSession(draft);
    setChatOpen(true);
  }
  function sessionList() {
    return (
      <SessionBrowser
        sessions={sessions}
        query=""
        busy={busy}
        onResume={openConversation}
        onUpdate={async (session, changes) => {
          setBusy(true);
          setError('');
          try {
            await api.updateSession(session.agent, session.id, changes);
            await refresh();
            return true;
          } catch (e) {
            setError(e instanceof Error ? e.message : String(e));
            return false;
          } finally {
            setBusy(false);
          }
        }}
      />
    );
  }
  const navigationToggle = (
    <Hint label={navigationOpen ? 'Hide project navigation' : 'Show project navigation'}>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label="Toggle project navigation"
        aria-expanded={navigationOpen}
        onClick={() => setNavigationOpen(!navigationOpen)}
      >
        <PanelLeft size={16} />
      </Button>
    </Hint>
  );
  return (
    <div
      className={
        'app-shell' +
        (!preview ? ' desktop-app' : '') +
        (!navigationOpen ? ' navigation-collapsed' : '') +
        (chatOpen ? ' conversation-open' : '')
      }
      style={
        { '--navigation-width': navigationOpen ? sidebar.width + 'px' : '0px' } as CSSProperties
      }
    >
      <main>
        <header className={'topbar' + (!preview ? ' desktop-titlebar' : '')}>
          <div className="topbar-brand">
            {navigationToggle}
            <div className="navigation-history" role="group" aria-label="Navigation history">
              <Hint label="Go back">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Go back"
                  disabled={!navigation.canBack}
                  onClick={navigation.back}
                >
                  <ArrowLeft size={16} />
                </Button>
              </Hint>
              <Hint label="Go forward">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Go forward"
                  disabled={!navigation.canForward}
                  onClick={navigation.forward}
                >
                  <ArrowRight size={16} />
                </Button>
              </Hint>
            </div>
          </div>
          <div className="topbar-content">
            <div id="conversation-titlebar-heading" />
            <div id="conversation-titlebar-tabs" />
            <div className="topbar-actions">
              <div id="conversation-titlebar-actions" />
            </div>
          </div>
        </header>
        <div className="page-content">
          {(error || notice) && (
            <div role={error ? 'alert' : 'status'} className={'notice ' + (error ? 'error' : '')}>
              {error || notice}
              <Button
                variant="ghost"
                aria-label="Dismiss notification"
                onClick={() => {
                  setError('');
                  setNotice('');
                }}
              >
                <X size={15} />
              </Button>
            </div>
          )}
          {data.warnings.length > 0 && (
            <Collapsible className="warnings">
              <CollapsibleTrigger asChild>
                <Button variant="ghost">History scan notes ({data.warnings.length})</Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                {data.warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
              </CollapsibleContent>
            </Collapsible>
          )}
          <div className="workspace-grid">
            <div className="library-panel" hidden={!navigationOpen}>
              <div className="search">
                <Search size={16} />
                <Input
                  ref={searchRef}
                  aria-label="Search projects or sessions"
                  placeholder="Search projects, chats…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <kbd>⌘ K</kbd>
              </div>
              {query.trim() ? (
                <WorkspaceSearch
                  api={api}
                  query={query}
                  projects={data.projects}
                  groups={data.groups || []}
                  sessions={data.sessions}
                  onProject={(group) => {
                    setHome(false);
                    setChatOpen(false);
                    setBoardGroup(group.id);
                    setProjectPage('board');
                  }}
                  onRepository={openProject}
                  onSession={openConversation}
                />
              ) : (
                <ProjectTree
                  projectPage={projectPage}
                  onDocs={(group) => {
                    setHome(false);
                    setChatOpen(false);
                    setBoardGroup(group.id);
                    setProjectPage('docs');
                  }}
                  onOverview={() => {
                    setHome(true);
                    setChatOpen(false);
                    setBoardGroup(null);
                  }}
                  hosts={data.hosts}
                  api={api}
                  repos={projects}
                  allRepos={data.projects}
                  groups={data.groups || []}
                  sessions={[
                    ...drafts.filter(
                      (d) => !data.sessions.some((s) => s.agent === d.agent && s.id === d.id),
                    ),
                    ...data.sessions,
                  ]}
                  selected={home ? '' : selected}
                  activeGroup={home ? null : boardGroup}
                  activeSession={chatOpen ? chatSession : null}
                  busy={busy}
                  onSelect={openProject}
                  onProject={(group) => {
                    setHome(false);
                    setChatOpen(false);
                    setBoardGroup(group.id);
                    setProjectPage('board');
                  }}
                  onResume={openConversation}
                  run={run}
                />
              )}
              <div className="sidebar-github">
                {home && (data.groups?.length || 0) > 1 && (
                  <Choice
                    label="Tracker connection project"
                    className="w-full"
                    value={trackerTarget}
                    onChange={setTrackerTarget}
                    options={[
                      { value: '', label: 'Choose a project' },
                      ...(data.groups || []).map((g) => ({ value: g.id, label: g.name })),
                    ]}
                  />
                )}
                {showConnectionButton && (
                  <Button
                    className="sidebar-github-connect w-full justify-start"
                    disabled={!connectionGroup}
                    onClick={() => {
                      if (!connectionGroup) return;
                      setHome(false);
                      setChatOpen(false);
                      setBoardGroup(connectionGroup.id);
                      setProjectPage('board');
                      setConnectRequest(connectionGroup.id);
                    }}
                  >
                    {!connection || connection.provider === 'github' ? (
                      <img
                        src="./icons/github.svg"
                        width="16"
                        height="16"
                        alt=""
                        aria-hidden="true"
                      />
                    ) : (
                      <Layers2 size={16} />
                    )}
                    {connection ? `${trackerName} project` : `Connect ${trackerName}`}
                  </Button>
                )}
                <Button
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => setOnboardingOpen(true)}
                >
                  <ArrowRight size={16} /> Get started
                </Button>
                <Button
                  variant="ghost"
                  className="w-full justify-start"
                  onClick={() => setSettingsOpen(true)}
                >
                  <Settings2 size={16} />
                  Settings
                </Button>
              </div>
            </div>
            {navigationOpen && <SidebarResizer {...sidebar} />}
            <div className="project-content">
              <div className="management-pane" hidden={chatOpen}>
                {home ? (
                  <ProjectOverview
                    api={api}
                    groups={data.groups || []}
                    repos={data.projects}
                    sessions={data.sessions}
                    query=""
                    onRefresh={refresh}
                    onSelect={(group) => {
                      setHome(false);
                      setBoardGroup(group.id);
                      setProjectPage('board');
                    }}
                  />
                ) : boardGroup && data.groups?.find((g) => g.id === boardGroup) ? (
                  projectPage === 'docs' ? (
                    <ProjectDocsPanel
                      key={boardGroup}
                      api={api}
                      group={data.groups.find((g) => g.id === boardGroup)!}
                    />
                  ) : (
                    <ProjectTrackerPanel
                      connectRequested={connectRequest === boardGroup}
                      onConnectHandled={() => setConnectRequest(null)}
                      key={boardGroup}
                      revision={revision}
                      api={api}
                      sessions={data.sessions}
                      onResume={openConversation}
                      group={data.groups.find((g) => g.id === boardGroup)!}
                      repos={data.projects.filter((p) =>
                        data.groups!.find((g) => g.id === boardGroup)!.repoIds.includes(p.id),
                      )}
                      onRefresh={refresh}
                      onRepo={openProject}
                      onTask={(repo, agent, task) => newSession(agent, repo, task)}
                    />
                  )
                ) : project ? (
                  <section className="detail">
                    <div className="detail-heading">
                      <div className="detail-icon">
                        <Folder size={27} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <h2>{project.name}</h2>
                        {project.hostId && (
                          <span className="text-xs text-muted-foreground">
                            SSH ·{' '}
                            {data.hosts?.find((h) => h.id === project.hostId)?.name ||
                              'Remote host'}{' '}
                            ·{' '}
                            {data.hosts?.find((h) => h.id === project.hostId)?.status ||
                              'disconnected'}
                          </span>
                        )}
                        <Button
                          variant="ghost"
                          className="path-button"
                          disabled={!!project.hostId}
                          title={
                            project.hostId ? 'Remote filesystem path' : 'Open folder in Finder'
                          }
                          onClick={() => run(() => api.reveal(project.id))}
                        >
                          {project.path}
                          <ArrowUpRight size={12} />
                        </Button>
                      </div>
                      <ActionMenu
                        label="Repository actions"
                        disabled={busy}
                        items={[
                          ...(!project.hostId
                            ? [
                                {
                                  label: 'Open folder in Finder',
                                  action: () => void run(() => api.reveal(project.id)),
                                },
                                { label: 'Open Terminal', action: () => void launchTerminal() },
                              ]
                            : []),
                          {
                            label: project.favorite ? 'Remove favorite' : 'Mark as favorite',
                            action: () =>
                              void run(() =>
                                api.update(project.id, { favorite: !project.favorite }),
                              ),
                          },
                        ]}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label="Edit repository"
                        onClick={() => {
                          setName(project.name);
                          setNotes(project.notes);
                          setRepoGroup(
                            (data.groups || []).find((g) => g.repoIds.includes(project.id))?.id ||
                              '',
                          );
                          setModal('edit');
                        }}
                      >
                        <Settings2 size={18} />
                      </Button>
                    </div>
                    <div className="repository-overview">
                      <div className="repository-start">
                        <span>New conversation</span>
                        {agentCatalog.map(({ id: agent }) => (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busy}
                            key={agent}
                            aria-label={`${agentLabel(agent)} New session`}
                            onClick={() => newSession(agent)}
                          >
                            <Plus size={14} />
                            {agentLabel(agent)}
                          </Button>
                        ))}
                      </div>
                      <section
                        className="repository-overview-section"
                        aria-label="Repository sessions"
                      >
                        <div className="section-header">
                          <h3>
                            Sessions{' '}
                            <span className="text-muted-foreground">{sessions.length}</span>
                          </h3>
                        </div>
                        {sessionList()}
                      </section>
                      <section
                        className="repository-overview-section"
                        aria-label="Repository worktrees"
                      >
                        <div className="section-header">
                          <h3>
                            Worktrees{' '}
                            {git && (
                              <span className="text-muted-foreground">{git.worktrees.length}</span>
                            )}
                          </h3>
                          <div className="flex items-center gap-2">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label="Refresh worktrees"
                              disabled={busy || gitLoading}
                              onClick={() => setRepositoryRevision((value) => value + 1)}
                            >
                              <RefreshCw size={15} />
                            </Button>
                            <Button
                              size="sm"
                              disabled={!git || busy}
                              onClick={() => {
                                setBranch('');
                                setModal('worktree');
                              }}
                            >
                              <Plus size={14} /> New worktree
                            </Button>
                          </div>
                        </div>
                        {gitError && (
                          <p role="alert" className="text-destructive">
                            {gitError}
                          </p>
                        )}
                        {git ? (
                          git.worktrees.map((tree) => (
                            <div className="worktree" key={tree.path}>
                              <GitBranch size={20} />
                              <div>
                                <strong>{tree.branch}</strong>
                                <code>{tree.path}</code>
                                <div className="worktree-sessions">
                                  {worktreeSessions(
                                    tree.path,
                                    git.worktrees,
                                    visibleSessions,
                                    project.hostId,
                                  ).map((session) => (
                                    <Button
                                      key={session.agent + ':' + session.id}
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => openConversation(session)}
                                    >
                                      <span>{agentLabel(session.agent)}</span>
                                      <span className="truncate">{session.title}</span>
                                    </Button>
                                  ))}
                                </div>
                              </div>
                              {tree.path === project.path && (
                                <Badge variant="secondary">Current</Badge>
                              )}
                            </div>
                          ))
                        ) : gitLoading ? (
                          <p className="help-text" role="status">
                            Checking worktrees…
                          </p>
                        ) : (
                          <div className="empty-small">
                            <GitBranch size={28} />
                            <h3>No Git worktrees available</h3>
                            <p>
                              Choose an existing Git repository with an initial commit to create a
                              worktree.
                            </p>
                          </div>
                        )}
                      </section>
                    </div>
                  </section>
                ) : (
                  <section className="detail welcome">
                    <Layers2 size={44} />
                    <h2>Organize your repositories</h2>
                    <p>
                      Create a project to group related repositories, or add a repository folder to
                      get started.
                    </p>
                    <AddRepository
                      api={api}
                      variant="default"
                      onRefresh={() => run(async () => {})}
                    >
                      <FolderPlus size={16} /> Add your first repository
                    </AddRepository>
                  </section>
                )}
              </div>
              {chatSession && (
                <AgentWorkspace
                  onDraft={(draft) => {
                    setDrafts((previous) => [...previous.filter((s) => s.id !== draft.id), draft]);
                    setChatSession((current) => (current?.id === draft.id ? draft : current));
                  }}
                  onCreated={(draft, id, title) => {
                    navigation.replace((route) =>
                      route.chatSession?.id === draft.id && route.chatSession.agent === draft.agent
                        ? { ...route, chatSession: { ...route.chatSession, id, title } }
                        : route,
                    );

                    setDrafts((previous) =>
                      previous.map((s) =>
                        s.id === draft.id && s.agent === draft.agent ? { ...s, id, title } : s,
                      ),
                    );
                    setChatSession((current) =>
                      current?.id === draft.id && current.agent === draft.agent
                        ? { ...current, id, title }
                        : current,
                    );
                  }}
                  api={api}
                  projects={data.projects}
                  projectGroups={data.groups}
                  sessions={data.sessions}
                  selected={chatSession}
                  returnLabel={
                    boardGroup
                      ? `Back to ${data.groups?.find((g) => g.id === boardGroup)?.name || 'project'} board`
                      : 'Repository details'
                  }
                  visible={chatOpen}
                  onSelect={openConversation}
                  onClose={() => {
                    setChatOpen(false);
                  }}
                  onComplete={() => {
                    void refresh().catch((e) => setError(String(e)));
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </main>

      {onboardingOpen && (
        <Onboarding
          api={api}
          data={data}
          preview={preview}
          open={onboardingOpen}
          onOpenChange={(open) => {
            setOnboardingOpen(open);
            if (!open) dismissOnboarding();
          }}
          onRefresh={refresh}
          onSettings={() => {
            setOnboardingOpen(false);
            dismissOnboarding();
            setSettingsOpen(true);
          }}
          onStart={(agent, repo, prompt) => {
            setBoardGroup(null);
            newSession(agent, repo, undefined, prompt);
          }}
        />
      )}
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        api={api}
        onRefresh={refresh}
      />
      <Dialog open={modal !== null} onOpenChange={(open) => !open && !busy && setModal(null)}>
        <DialogContent className="max-h-[calc(100dvh-48px)] overflow-y-auto">
          <DialogHeader className="pr-6">
            <DialogTitle>
              {modal === 'worktree'
                ? 'Create a Git worktree'
                : modal === 'edit'
                  ? 'Repository settings'
                  : modal === 'remove'
                    ? 'Remove from library?'
                    : 'Settings'}
            </DialogTitle>
            <DialogDescription>
              {modal === 'worktree'
                ? 'Create a new branch in a separate folder. The folder is automatically added to your library.'
                : modal === 'edit'
                  ? 'Name this repository and assign it to a project.'
                  : modal === 'remove'
                    ? 'The repository folder, files, and agent sessions will remain on disk.'
                    : 'Your agents, projects, and repositories.'}
            </DialogDescription>
          </DialogHeader>
          {modal === 'worktree' && (
            <label className="form-label">
              New branch name
              <Input
                autoFocus
                placeholder="feature/my-next-idea"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
              />
            </label>
          )}
          {modal === 'edit' && (
            <>
              <label className="form-label">
                Repository name
                <Input value={name} onChange={(e) => setName(e.target.value)} />
              </label>
              <label className="form-label">
                Project
                <Choice
                  label="Project"
                  value={repoGroup}
                  onChange={setRepoGroup}
                  options={[
                    { value: '', label: 'Choose a project' },
                    ...(data.groups || [])
                      .filter((g) => g.hostId === project?.hostId)
                      .map((g) => ({ value: g.id, label: g.name })),
                  ]}
                />
              </label>
              <label className="form-label">
                Notes
                <Textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} />
              </label>
              <Button
                variant="ghost"
                className="text-destructive justify-start"
                onClick={() => setModal('remove')}
              >
                <Trash2 size={14} /> Remove from library
              </Button>
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setModal(null)}>
              Cancel
            </Button>
            {modal === 'edit' && (
              <Button
                disabled={busy || !name.trim() || !repoGroup}
                onClick={() =>
                  run(async () => {
                    await api.update(selected, { name, notes });
                    if (api.moveRepo) await api.moveRepo(selected, repoGroup || null);
                    setModal(null);
                  }, 'Project updated.')
                }
              >
                <Check size={15} /> Save changes
              </Button>
            )}
            {modal === 'remove' && (
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await api.remove(selected);
                    setModal(null);
                  }, 'Removed from library. Files were kept.')
                }
              >
                Remove project
              </Button>
            )}
            {modal === 'worktree' && (
              <Button
                disabled={busy || !branch.trim()}
                onClick={() =>
                  run(async () => {
                    if (await api.worktree(selected, branch.trim())) {
                      setModal(null);
                      setNotice('Worktree created and added to your library.');
                    }
                  })
                }
              >
                {busy ? 'Creating…' : 'Choose folder & create'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
