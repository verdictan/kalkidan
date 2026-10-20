import { Onboarding, onboardingDismissed, dismissOnboarding } from './components/onboarding';
import { ProjectMemoryPanel } from './components/project-memory';
import { ProjectDocsPanel } from './components/project-docs';
import { WorkspaceSearch } from './components/workspace-search';
import { useSidebarWidth } from './hooks/use-sidebar-width';
import { SidebarResizer } from './components/sidebar-resizer';
import { useNavigationHistory } from './hooks/use-navigation-history';
import { agentCatalog, agentLabel } from './config/agents';
import {
  onPreferredAgentChange,
  readPreferredAgent,
  savePreferredAgent,
} from './lib/agent-preference';
import { trackerConnection } from './domain/tracker';
import { useTracker } from './hooks/use-tracker';
import { SettingsDialog } from './components/settings-dialog';
import { ProjectOverview } from './components/project-overview';
import { ActionMenu } from './components/action-menu';
import { Hint } from './components/hint';
import { CreateProject } from './components/create-project';
import {
  hasPrimaryModifier,
  isMac,
  isTypingTarget,
  revealLabel,
  shortcutLabel,
} from './lib/platform';

import { AddRepository } from './components/add-repository';
import { Fragment, useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  PanelLeft,
  Layers2,
  FolderPlus,
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
  Menu,
  ChevronDown,
  ChevronRight,
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
  DialogBody,
  DialogFooter,
} from './components/ui/dialog';
import { AgentIcon } from './components/ui/agent-icon';
import { SearchInput } from './components/ui/search-input';
import { Textarea } from './components/ui/textarea';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './components/ui/dropdown-menu';
import { EmptyState } from './components/ui/empty-state';
import { EntityIcon } from './components/ui/entity-icon';
import { PageHeader, SectionHeader } from './components/ui/page-header';
import { SessionBrowser } from './components/session-browser';
import { ProjectTrackerPanel } from './components/project-tracker';
import { Choice } from './components/choice';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from './components/ui/collapsible';
import { ProjectTree } from './components/project-tree';
import { worktreeSessions } from './lib/worktree-sessions';
import { sessionRepo } from './lib/session-repository';
import {
  activityKey,
  type SessionActivity,
  type SessionActivityState,
} from './components/activity-dot';
import { AgentWorkspace } from './components/agent-workspace';
import type {
  API,
  Snapshot,
  GitInfo,
  Agent,
  Project,
  ProjectGroup,
  Session,
  TrackerItem,
} from './types';

// The footer buttons of the sidebar: full width and start aligned. Utilities, so they win
// over the Button padding.
const sidebarAction = 'sidebar-action w-full justify-start px-2 has-[>svg]:px-2';
type RepositoryModal = 'worktree' | 'edit' | 'remove' | 'remove-worktree';
/** Removes the Electron IPC prefix from an error message. */
function errorText(error: unknown) {
  return error instanceof Error
    ? error.message.replace(/^Error invoking remote method '[^']+': Error: /, '')
    : String(error);
}
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
  const [connectRequest, setConnectRequest] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [projectPage, setProjectPage] = useState<'board' | 'docs' | 'memory'>('board');
  const [boardGroup, setBoardGroup] = useState<string | null>(null);
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [git, setGit] = useState<GitInfo | null>(null);
  const [gitError, setGitError] = useState('');
  // True while a user action that changes data runs. A refresh does not set it.
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  // Page errors. Dialogs show their own errors.
  const [error, setError] = useState('');
  const [modal, setModal] = useState<RepositoryModal | null>(null);
  const [modalBusy, setModalBusy] = useState(false);
  const [modalError, setModalError] = useState('');
  // The repository that the open modal acts on. Navigation must not change it.
  const [modalRepo, setModalRepo] = useState('');
  // The worktree that "Remove worktree" acts on. `dirty` is true after the first attempt
  // stops because of uncommitted changes.
  const [worktreeTarget, setWorktreeTarget] = useState<{
    id: string;
    branch: string;
    dirty: boolean;
  } | null>(null);
  const [sessionFilter, setSessionFilter] = useState('');
  useEffect(() => setSessionFilter(''), [selected]);
  const [activity, setActivity] = useState<SessionActivity[]>([]);
  // Keep the last modal content while the dialog animates closed.
  const lastModal = useRef(modal);
  if (modal) lastModal.current = modal;
  const shownModal = modal ?? lastModal.current;
  function openModal(kind: RepositoryModal, repo = selected) {
    setModalRepo(repo);
    setModalError('');
    setModal(kind);
  }
  /** Runs a dialog action. Its error shows in the dialog, not in the page banner. */
  async function runModal(action: () => Promise<unknown>, message?: string) {
    setModalBusy(true);
    setModalError('');
    try {
      await action();
      await refresh();
      if (message) notify(message);
    } catch (e) {
      setModalError(errorText(e));
    } finally {
      setModalBusy(false);
    }
  }
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
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  const [gitLoading, setGitLoading] = useState(false);
  // Window listeners read the latest history through this ref.
  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;
  // Navigation must not change the selection under an open dialog.
  const dialogOpen = () => !!document.querySelector('[role="dialog"], [role="alertdialog"]');
  function focusSearch() {
    setNavigationOpen(true);
    requestAnimationFrame(() => searchRef.current?.focus());
  }
  // When the sidebar closes with the focus in it, move the focus to the sidebar button.
  function toggleSidebar() {
    setNavigationOpen((open) => {
      if (open && sidebarRef.current?.contains(document.activeElement))
        requestAnimationFrame(() => sidebarToggleRef.current?.focus());
      return !open;
    });
  }
  // Close the open tool tab, then the open session. With nothing open, close the window.
  function closeTab() {
    const event = new CustomEvent('kalkidan-close-tab', { cancelable: true });
    if (!window.dispatchEvent(event)) return;
    if (closeTabRef.current()) return;
    window.close();
  }
  // The handler reads the latest state through this ref.
  const closeTabRef = useRef<() => boolean>(() => false);
  closeTabRef.current = () => {
    if (!chatOpen) return false;
    closeConversation();
    return true;
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Windows and Linux also use Alt+Left and Alt+Right for history.
      if (
        !isMac &&
        event.altKey &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.shiftKey &&
        (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
      ) {
        if (isTypingTarget(event.target) || dialogOpen()) return;
        event.preventDefault();
        if (event.key === 'ArrowLeft') navigationRef.current.back();
        else navigationRef.current.forward();
        return;
      }
      if (!hasPrimaryModifier(event) || event.altKey || event.shiftKey) return;
      const key = event.key.toLowerCase();
      if (key === 'k') {
        // The document editor uses Mod+K for links.
        if (
          event.target instanceof Element &&
          event.target.closest('[data-shortcut-scope="editor"]')
        )
          return;
        event.preventDefault();
        if (!dialogOpen()) focusSearch();
      } else if (preview && (key === 'w' || key === 'b')) {
        // The browser preview has no native menu. The desktop menu sends these commands.
        event.preventDefault();
        if (dialogOpen()) return;
        if (key === 'w') closeTab();
        else toggleSidebar();
      } else if (event.key === '[' || event.key === ']') {
        // Prevent the default so the native Go menu does not run the command either.
        event.preventDefault();
        if (isTypingTarget(event.target) || dialogOpen()) return;
        if (event.key === '[') navigationRef.current.back();
        else navigationRef.current.forward();
      }
    };
    // Mouse buttons 3 and 4 are the back and forward side buttons.
    const onMouse = (event: MouseEvent) => {
      if (event.button !== 3 && event.button !== 4) return;
      event.preventDefault();
      if (dialogOpen()) return;
      if (event.button === 3) navigationRef.current.back();
      else navigationRef.current.forward();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mouseup', onMouse);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mouseup', onMouse);
    };
  }, []);
  useEffect(
    () =>
      api.onMenuCommand?.((command) => {
        if (dialogOpen()) return;
        if (command === 'back') navigationRef.current.back();
        else if (command === 'forward') navigationRef.current.forward();
        else if (command === 'new-project') setCreateOpen(true);
        else if (command === 'settings') setSettingsOpen(true);
        else if (command === 'search') focusSearch();
        else if (command === 'toggle-sidebar') toggleSidebar();
        else if ((command as string) === 'close-tab') closeTab();
      }),
    [api],
  );
  // Success notices clear themselves. Errors stay until the user dismisses them.
  useEffect(() => {
    if (!notice || error) return;
    const timer = window.setTimeout(() => setNotice(''), 4000);
    return () => window.clearTimeout(timer);
  }, [notice, error]);
  function notify(message: string, failed = false) {
    if (failed) setError(message);
    else {
      setError('');
      setNotice(message);
    }
  }
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
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  /** Reloads the snapshot. It does not disable controls. */
  function reload() {
    return refresh().catch((e) => setError(errorText(e)));
  }
  useEffect(() => {
    void reload();
  }, []);
  const routed = useRef(false);
  useEffect(() => {
    if (routed.current || !data.sessions.length || !location.hash.startsWith('#session=')) return;
    routed.current = true;
    try {
      const target = JSON.parse(decodeURIComponent(location.hash.slice(9)));
      const session = data.sessions.find((s) => s.id === target.id && s.agent === target.agent);
      if (session) openConversation(session);
      else setError('This session is no longer available.');
    } catch {
      setError('Invalid session link.');
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
  // Status dots for open sessions that work or wait for approval in the background.
  const sessionActivity: Record<string, SessionActivityState> = {};
  const repoActivity: Record<string, SessionActivityState> = {};
  for (const item of activity) {
    sessionActivity[activityKey(item.agent, item.id)] = item.state;
    const repo = sessionRepo(item, data.projects);
    if (repo && repoActivity[repo.id] !== 'approval') repoActivity[repo.id] = item.state;
  }
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
  // A docs page or task chosen in search. The panel opens it once after it loads.
  const [searchTarget, setSearchTarget] = useState<{ page?: string; task?: string }>({});
  function openGroup(group: ProjectGroup, page: 'board' | 'docs' | 'memory' = 'board') {
    setHome(false);
    setChatOpen(false);
    setBoardGroup(group.id);
    setProjectPage(page);
  }
  function connectTracker(group = connectionGroup) {
    if (!group) return;
    openGroup(group);
    setConnectRequest(group.id);
  }
  function openOverview() {
    setHome(true);
    setChatOpen(false);
    setBoardGroup(null);
  }
  // Closing a session returns to the view before it. Without history, show the repository.
  function closeConversation() {
    if (navigation.canBack) navigation.back();
    else setChatOpen(false);
  }
  const currentGroup = boardGroup ? data.groups?.find((g) => g.id === boardGroup) : undefined;
  const projectGroup = project
    ? data.groups?.find((g) => g.repoIds.includes(project.id))
    : undefined;
  // The title bar shows the trail to the page. The page header shows the page title, so the
  // title bar leaves it out. The overview is the top page and has no trail.
  const trailGroup = currentGroup || projectGroup;
  const viewTrail: { label: string; name: string; open: () => void }[] =
    home || (!currentGroup && !project)
      ? []
      : [
          { label: 'Projects', name: 'Projects overview', open: openOverview },
          ...(trailGroup && (projectPage !== 'board' || !currentGroup)
            ? [
                {
                  label: trailGroup.name,
                  name: `${trailGroup.name} project`,
                  open: () => openGroup(trailGroup),
                },
              ]
            : []),
        ];
  const connectLabel = `Connect ${trackerName}`;
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
  function newSession(
    agent: Agent,
    repo = project,
    task?: TrackerItem,
    initialPrompt?: string,
    cwd = repo?.path,
  ) {
    if (!repo) return;
    setHome(false);
    setSelected(repo.id);
    const draft: Session = {
      id: 'draft-' + crypto.randomUUID(),
      projectId: repo.id,
      hostId: repo.hostId,
      agent,
      cwd: cwd || repo.path,
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
  // The split button starts the preferred agent. Settings and every "New session" menu
  // change the preference.
  const [preferredAgent, setPreferredAgent] = useState<Agent>(readPreferredAgent);
  useEffect(() => onPreferredAgentChange(setPreferredAgent), []);
  function startSession(agent: Agent, repo = project, cwd?: string) {
    if (agent === 'codex' || agent === 'claude') savePreferredAgent(agent);
    newSession(agent, repo, undefined, undefined, cwd);
  }
  function editRepository(repo: Project) {
    setName(repo.name);
    setNotes(repo.notes);
    setRepoGroup((data.groups || []).find((g) => g.repoIds.includes(repo.id))?.id || '');
    openModal('edit', repo.id);
  }
  const modalProject = data.projects.find((p) => p.id === modalRepo);
  function saveRepository() {
    void runModal(async () => {
      await api.update(modalRepo, { name, notes });
      if (api.moveRepo) await api.moveRepo(modalRepo, repoGroup || null);
      setModal(null);
    }, 'Repository updated.');
  }
  function createWorktree() {
    void runModal(async () => {
      if (await api.worktree(modalRepo, branch.trim())) setModal(null);
    }, 'Worktree created and added to the project.');
  }
  function removeWorktree() {
    if (!worktreeTarget) return;
    const target = worktreeTarget;
    setModalBusy(true);
    setModalError('');
    api
      .worktreeRemove(target.id, target.dirty)
      .then(async () => {
        setModal(null);
        await refresh();
        setRepositoryRevision((value) => value + 1);
        notify(`Worktree ${target.branch} removed.`);
      })
      .catch((e) => {
        const message = errorText(e);
        // The first attempt stops on uncommitted changes. Ask before a forced removal.
        if (!target.dirty && /uncommitted changes/i.test(message))
          setWorktreeTarget({ ...target, dirty: true });
        else setModalError(message);
      })
      .finally(() => setModalBusy(false));
  }
  // Each session row keeps its own busy state. A refresh does not disable the rows.
  const [sessionBusy, setSessionBusy] = useState(false);
  function sessionList() {
    return (
      <SessionBrowser
        activity={sessionActivity}
        storageKey={selected}
        sessions={sessions}
        query={sessionFilter}
        busy={sessionBusy}
        onResume={openConversation}
        onUpdate={async (session, changes) => {
          setSessionBusy(true);
          setError('');
          try {
            await api.updateSession(session.agent, session.id, changes);
            await refresh();
            return true;
          } catch (e) {
            setError(errorText(e));
            return false;
          } finally {
            setSessionBusy(false);
          }
        }}
      />
    );
  }
  const navigationToggle = (
    <Hint label={navigationOpen ? 'Hide sidebar' : 'Show sidebar'}>
      <Button
        ref={sidebarToggleRef}
        variant="ghost"
        size="icon-sm"
        aria-label="Toggle sidebar"
        aria-expanded={navigationOpen}
        onClick={toggleSidebar}
      >
        <PanelLeft />
      </Button>
    </Hint>
  );
  // The main checkout is the first entry of `git worktree list`. It cannot be removed.
  const mainCheckout = git?.worktrees[0]?.path;
  function worktreeRepository(path: string) {
    return data.projects.find((p) => p.path === path && p.hostId === project?.hostId);
  }
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
      <header className={'topbar' + (!preview ? ' desktop-titlebar' : '')}>
        <div className="topbar-brand">
          {/* Windows and Linux hide the menu bar with the title bar. This button shows it. */}
          {!isMac && !preview && api.showAppMenu && (
            <Hint label="Menu">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Application menu"
                onClick={() => void api.showAppMenu?.()}
              >
                <Menu />
              </Button>
            </Hint>
          )}
          {navigationToggle}
          <div className="navigation-history" role="group" aria-label="Navigation history">
            <Hint
              label={`Go back (${isMac ? shortcutLabel(['mod'], '[') : shortcutLabel(['alt'], '←')})`}
            >
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Go back"
                disabled={!navigation.canBack}
                onClick={navigation.back}
              >
                <ArrowLeft />
              </Button>
            </Hint>
            <Hint
              label={`Go forward (${isMac ? shortcutLabel(['mod'], ']') : shortcutLabel(['alt'], '→')})`}
            >
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Go forward"
                disabled={!navigation.canForward}
                onClick={navigation.forward}
              >
                <ArrowRight />
              </Button>
            </Hint>
          </div>
        </div>
        <div className="topbar-content">
          {!chatOpen && viewTrail.length > 0 && (
            <nav className="topbar-title" aria-label="Breadcrumb">
              {viewTrail.map((part, index) => (
                <Fragment key={index}>
                  {index > 0 && <ChevronRight size={12} aria-hidden="true" />}
                  <button
                    type="button"
                    className="topbar-crumb"
                    aria-label={part.name}
                    onClick={part.open}
                  >
                    {part.label}
                  </button>
                </Fragment>
              ))}
            </nav>
          )}
          <div id="conversation-titlebar-heading" />
          <div id="conversation-titlebar-tabs" />
          <div className="topbar-actions">
            <div id="conversation-titlebar-actions" />
          </div>
        </div>
      </header>
      <nav
        ref={sidebarRef}
        className="library-panel"
        hidden={!navigationOpen}
        aria-label="Projects and repositories"
      >
        <WorkspaceSearch
          api={api}
          inputRef={searchRef}
          query={query}
          onQueryChange={setQuery}
          projects={data.projects}
          groups={data.groups || []}
          sessions={data.sessions}
          onProject={(group) => openGroup(group)}
          onDoc={(group, doc) => {
            setSearchTarget({ page: doc.id });
            openGroup(group, 'docs');
          }}
          onTask={(group, task) => {
            setSearchTarget({ task: task.id });
            openGroup(group);
          }}
          onRepository={openProject}
          onSession={openConversation}
        >
          <ProjectTree
            activity={repoActivity}
            projectPage={projectPage}
            onDocs={(group) => openGroup(group, 'docs')}
            onMemory={(group) => openGroup(group, 'memory')}
            onOverview={openOverview}
            onEditRepository={editRepository}
            onConnect={(group) => connectTracker(group)}
            connectLabel={`Connect ${trackerName} project…`}
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
            onProject={(group) => openGroup(group)}
            onResume={openConversation}
            onNotice={notify}
            onRefresh={reload}
            run={run}
          />
        </WorkspaceSearch>
        <div className="sidebar-github">
          {showConnectionButton && connectionGroup && (
            <Button
              variant="outline"
              className={sidebarAction + ' sidebar-github-connect'}
              onClick={() => connectTracker()}
            >
              {!connection || connection.provider === 'github' ? (
                <img src="./icons/github.svg" width="16" height="16" alt="" aria-hidden="true" />
              ) : (
                <Layers2 />
              )}
              {connectLabel}
            </Button>
          )}
          <Button
            variant="ghost"
            className={sidebarAction + ' font-normal'}
            onClick={() => setOnboardingOpen(true)}
          >
            <ArrowRight /> Get started
          </Button>
          <Button
            variant="ghost"
            className={sidebarAction + ' font-normal'}
            onClick={() => setSettingsOpen(true)}
          >
            <Settings2 />
            Settings
          </Button>
        </div>
      </nav>
      {navigationOpen && <SidebarResizer {...sidebar} />}
      <main>
        <div className="page-content">
          {/* This live region stays mounted, so screen readers announce each new notice. */}
          <div className="sr-only" aria-live="polite" aria-atomic="true">
            {error ? '' : notice}
          </div>
          {(error || notice) && (
            <div role={error ? 'alert' : undefined} className={'notice ' + (error ? 'error' : '')}>
              {error || notice}
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label="Dismiss notification"
                onClick={() => {
                  setError('');
                  setNotice('');
                }}
              >
                <X />
              </Button>
            </div>
          )}
          {data.warnings.length > 0 && (
            <Collapsible className="warnings">
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm">
                  Session import warnings ({data.warnings.length})
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                {data.warnings.map((w, i) => (
                  <p key={i}>{w}</p>
                ))}
              </CollapsibleContent>
            </Collapsible>
          )}
          <div className="workspace-grid">
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
                    onSelect={(group) => openGroup(group)}
                    onResume={openConversation}
                  />
                ) : boardGroup && data.groups?.find((g) => g.id === boardGroup) ? (
                  projectPage === 'memory' ? (
                    <ProjectMemoryPanel
                      key={boardGroup}
                      api={api}
                      group={data.groups.find((g) => g.id === boardGroup)!}
                    />
                  ) : projectPage === 'docs' ? (
                    <ProjectDocsPanel
                      key={boardGroup}
                      initialPageId={searchTarget.page}
                      api={api}
                      group={data.groups.find((g) => g.id === boardGroup)!}
                    />
                  ) : (
                    <ProjectTrackerPanel
                      initialTaskId={searchTarget.task}
                      connectRequested={connectRequest === boardGroup}
                      onConnectHandled={() => setConnectRequest(null)}
                      onConnectTracker={() => connectTracker()}
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
                  <section className="page">
                    <PageHeader
                      icon={
                        <EntityIcon size="lg">
                          <GitBranch />
                        </EntityIcon>
                      }
                      title={project.name}
                      subtitle={
                        <>
                          {project.hostId && (
                            <span className="shrink-0">
                              SSH ·{' '}
                              {data.hosts?.find((h) => h.id === project.hostId)?.name ||
                                'Remote host'}{' '}
                              ·{' '}
                              {data.hosts?.find((h) => h.id === project.hostId)?.status ||
                                'disconnected'}{' '}
                              ·
                            </span>
                          )}
                          <Hint
                            label={
                              project.hostId
                                ? `Remote path: ${project.path}`
                                : `${revealLabel()}: ${project.path}`
                            }
                          >
                            <Button
                              variant="bare"
                              className="path-button h-auto gap-1 p-0 text-xs font-normal text-muted-foreground hover:text-foreground has-[>svg]:px-0"
                              title={project.path}
                              disabled={!!project.hostId}
                              onClick={() => run(() => api.reveal(project.id))}
                            >
                              <span>{project.path}</span>
                              {!project.hostId && <ArrowUpRight size={12} />}
                            </Button>
                          </Hint>
                        </>
                      }
                      actions={
                        <>
                          <ActionMenu
                            label="Repository actions"
                            size="md"
                            disabled={busy}
                            items={[
                              {
                                label: 'Edit repository…',
                                action: () => editRepository(project),
                              },
                              ...(!project.hostId
                                ? [
                                    {
                                      label: revealLabel(),
                                      action: () => void run(() => api.reveal(project.id)),
                                    },
                                    {
                                      label: 'Open Terminal',
                                      action: () => void launchTerminal(),
                                    },
                                  ]
                                : []),
                              {
                                label: project.favorite
                                  ? 'Remove from favorites'
                                  : 'Add to favorites',
                                action: () =>
                                  void run(() =>
                                    api.update(project.id, { favorite: !project.favorite }),
                                  ),
                              },
                            ]}
                          />
                          <div className="split-button" role="group" aria-label="New session">
                            <Button
                              className="rounded-r-none"
                              aria-label={`New ${agentLabel(preferredAgent)} session`}
                              onClick={() => startSession(preferredAgent)}
                            >
                              <Plus />
                              New {agentLabel(preferredAgent)} session
                            </Button>
                            <DropdownMenu>
                              <Hint label="Choose an agent">
                                <DropdownMenuTrigger asChild>
                                  <Button
                                    size="icon"
                                    className="rounded-l-none border-l border-primary-foreground/20"
                                    aria-label="Choose an agent"
                                  >
                                    <ChevronDown />
                                  </Button>
                                </DropdownMenuTrigger>
                              </Hint>
                              <DropdownMenuContent align="end">
                                {agentCatalog.map(({ id: agent }) => (
                                  <DropdownMenuItem
                                    key={agent}
                                    onSelect={() => startSession(agent)}
                                  >
                                    <AgentIcon agent={agent} />
                                    New {agentLabel(agent)} session
                                  </DropdownMenuItem>
                                ))}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </>
                      }
                    />
                    <div className="repository-overview">
                      <section
                        className="repository-overview-section"
                        aria-label="Repository sessions"
                      >
                        <SectionHeader
                          title="Sessions"
                          count={sessions.length}
                          actions={
                            sessions.length > 0 && (
                              <SearchInput
                                size="sm"
                                className="repository-session-filter"
                                aria-label="Filter sessions"
                                placeholder="Filter sessions"
                                value={sessionFilter}
                                onChange={(event) => setSessionFilter(event.target.value)}
                              />
                            )
                          }
                        />
                        {sessionList()}
                      </section>
                      <section
                        className="repository-overview-section"
                        aria-label="Repository worktrees"
                      >
                        <SectionHeader
                          title="Worktrees"
                          count={git?.worktrees.length}
                          actions={
                            <>
                              <Hint label="Refresh worktrees">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  aria-label="Refresh worktrees"
                                  disabled={gitLoading}
                                  onClick={() => setRepositoryRevision((value) => value + 1)}
                                >
                                  <RefreshCw />
                                </Button>
                              </Hint>
                              <Button
                                variant="outline"
                                disabled={!git}
                                onClick={() => {
                                  setBranch('');
                                  openModal('worktree');
                                }}
                              >
                                <Plus /> New worktree
                              </Button>
                            </>
                          }
                        />
                        {gitError && (
                          <p role="alert" className="field-error">
                            {gitError}
                          </p>
                        )}
                        {git ? (
                          <div>
                            {git.worktrees.map((tree) => {
                              const treeRepo = worktreeRepository(tree.path);
                              const linked = tree.path !== mainCheckout;
                              return (
                                <div className="worktree list-row" key={tree.path}>
                                  <EntityIcon>
                                    <GitBranch />
                                  </EntityIcon>
                                  <div className="worktree-text">
                                    <strong title={tree.branch}>{tree.branch}</strong>
                                    {tree.path === project.path ? (
                                      <span className="worktree-path">Repository folder</span>
                                    ) : (
                                      <code className="worktree-path" title={tree.path}>
                                        {tree.path}
                                      </code>
                                    )}
                                    <div className="worktree-sessions">
                                      {worktreeSessions(
                                        tree.path,
                                        git.worktrees,
                                        visibleSessions,
                                        project.hostId,
                                      ).map((session) => {
                                        const title = session.organization?.title || session.title;
                                        return (
                                          <Button
                                            key={session.agent + ':' + session.id}
                                            variant="ghost"
                                            size="xs"
                                            title={`${agentLabel(session.agent)} · ${title}`}
                                            onClick={() => openConversation(session)}
                                          >
                                            <AgentIcon agent={session.agent} />
                                            <span className="sr-only">
                                              {agentLabel(session.agent)}:
                                            </span>
                                            <span className="truncate">{title}</span>
                                          </Button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                  {tree.path === project.path && (
                                    <Badge variant="secondary" size="sm">
                                      Current
                                    </Badge>
                                  )}
                                  <ActionMenu
                                    size="xs"
                                    label={`${tree.branch} worktree actions`}
                                    items={[
                                      ...agentCatalog.map(({ id: agent }) => ({
                                        label: `New ${agentLabel(agent)} session here`,
                                        action: () =>
                                          treeRepo
                                            ? startSession(agent, treeRepo)
                                            : startSession(agent, project, tree.path),
                                      })),
                                      ...(linked && treeRepo
                                        ? [
                                            {
                                              label: 'Remove worktree…',
                                              danger: true,
                                              action: () => {
                                                setWorktreeTarget({
                                                  id: treeRepo.id,
                                                  branch: tree.branch,
                                                  dirty: false,
                                                });
                                                openModal('remove-worktree');
                                              },
                                            },
                                          ]
                                        : []),
                                    ]}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        ) : gitLoading ? (
                          <p className="help-text" role="status">
                            Checking worktrees…
                          </p>
                        ) : (
                          <EmptyState
                            compact
                            icon={<GitBranch />}
                            title="No Git worktrees available"
                          >
                            Choose an existing Git repository with an initial commit to create a
                            worktree.
                          </EmptyState>
                        )}
                      </section>
                    </div>
                  </section>
                ) : (
                  <section className="page">
                    <EmptyState
                      icon={<Layers2 />}
                      title="Organize your repositories"
                      action={
                        <div className="flex flex-wrap justify-center gap-2">
                          <Button size="lg" onClick={() => setCreateOpen(true)}>
                            <Plus /> New project
                          </Button>
                          <AddRepository
                            api={api}
                            variant="outline"
                            size="lg"
                            onRefresh={reload}
                            onNotice={notify}
                          >
                            <FolderPlus /> Add a repository
                          </AddRepository>
                        </div>
                      }
                    >
                      Create a project to group related repositories, or add a repository folder to
                      get started.
                    </EmptyState>
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
                  onClose={closeConversation}
                  onOpenRepository={(repo) => openProject(repo)}
                  onActivity={setActivity}
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
      <CreateProject
        api={api}
        open={createOpen}
        onOpenChange={setCreateOpen}
        onCreated={async (group) => {
          await refresh();
          openGroup(group);
        }}
      />
      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        api={api}
        onRefresh={refresh}
      />
      {/* Work started here continues after the dialog closes and reports through the notice. */}
      <Dialog open={modal !== null} onOpenChange={(open) => !open && setModal(null)}>
        <DialogContent
          size={shownModal === 'remove' || shownModal === 'remove-worktree' ? 'sm' : 'md'}
          layout={shownModal === 'edit' ? 'scroll' : 'simple'}
        >
          <DialogHeader>
            <DialogTitle>
              {shownModal === 'worktree'
                ? 'Create a Git worktree'
                : shownModal === 'edit'
                  ? 'Edit repository'
                  : shownModal === 'remove'
                    ? `Remove ${modalProject?.name || 'repository'} from Kalkidan?`
                    : `Remove worktree ${worktreeTarget?.branch || ''}?`}
            </DialogTitle>
            <DialogDescription>
              {shownModal === 'worktree'
                ? 'Create a new branch in a separate folder. Kalkidan adds the folder to the project.'
                : shownModal === 'edit'
                  ? 'Name this repository and assign it to a project.'
                  : shownModal === 'remove'
                    ? 'Kalkidan stops showing this repository. The folder, its files, and its sessions stay on disk.'
                    : worktreeTarget?.dirty
                      ? 'This worktree has uncommitted changes. If you remove it, the changes are lost.'
                      : 'Kalkidan deletes the worktree folder. The branch and its commits stay in the repository.'}
            </DialogDescription>
          </DialogHeader>
          {shownModal === 'worktree' && (
            <form
              id="repository-dialog-form"
              className="grid gap-4"
              onSubmit={(event) => {
                event.preventDefault();
                if (!modalBusy && branch.trim()) createWorktree();
              }}
            >
              <label className="form-label">
                New branch name
                <Input
                  autoFocus
                  placeholder="feature/my-next-idea"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                />
              </label>
            </form>
          )}
          {shownModal === 'edit' && (
            <DialogBody>
              <form
                id="repository-dialog-form"
                className="grid gap-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!modalBusy && name.trim() && repoGroup) saveRepository();
                }}
              >
                <label className="form-label">
                  Repository name
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </label>
                <label className="form-label">
                  Project
                  <Choice
                    label="Project"
                    className="w-full"
                    value={repoGroup}
                    onChange={setRepoGroup}
                    options={[
                      { value: '', label: 'Choose a project' },
                      ...(data.groups || [])
                        .filter((g) => g.hostId === modalProject?.hostId)
                        .map((g) => ({ value: g.id, label: g.name })),
                    ]}
                  />
                </label>
                <label className="form-label">
                  Notes
                  <Textarea rows={5} value={notes} onChange={(e) => setNotes(e.target.value)} />
                </label>
                <div className="danger-zone">
                  <div>
                    <strong>Remove repository</strong>
                    <p>Kalkidan stops showing it. The folder and its files stay on disk.</p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    className="text-destructive hover:text-destructive"
                    onClick={() => {
                      setModalError('');
                      setModal('remove');
                    }}
                  >
                    <Trash2 /> Remove from Kalkidan…
                  </Button>
                </div>
                {modalError && (
                  <p role="alert" className="field-error">
                    {modalError}
                  </p>
                )}
              </form>
            </DialogBody>
          )}
          {shownModal !== 'edit' && modalError && (
            <p role="alert" className="field-error">
              {modalError}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              autoFocus={shownModal === 'remove' || shownModal === 'remove-worktree'}
              onClick={() => setModal(null)}
            >
              Cancel
            </Button>
            {shownModal === 'edit' && (
              <Button
                type="submit"
                form="repository-dialog-form"
                disabled={modalBusy || !name.trim() || !repoGroup}
              >
                <Check /> Save changes
              </Button>
            )}
            {shownModal === 'remove' && (
              <Button
                type="button"
                variant="destructive"
                disabled={modalBusy}
                onClick={() => {
                  const removed = modalProject?.name || 'Repository';
                  void runModal(async () => {
                    await api.remove(modalRepo);
                    setModal(null);
                  }, `${removed} removed from Kalkidan.`);
                }}
              >
                Remove from Kalkidan
              </Button>
            )}
            {shownModal === 'remove-worktree' && (
              <Button
                type="button"
                variant="destructive"
                disabled={modalBusy}
                onClick={removeWorktree}
              >
                {worktreeTarget?.dirty ? 'Remove anyway' : 'Remove worktree'}
              </Button>
            )}
            {shownModal === 'worktree' && (
              <Button
                type="submit"
                form="repository-dialog-form"
                disabled={modalBusy || !branch.trim()}
              >
                {modalBusy ? 'Creating…' : 'Create worktree'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
