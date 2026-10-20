import { Onboarding, onboardingDismissed, dismissOnboarding } from './components/onboarding';
import { ProjectDocsPanel } from './components/project-docs';
import { WorkspaceSearch, type SearchAction } from './components/workspace-search';
import { ShortcutsSheet } from './components/shortcuts-sheet';
import { branchCopyHelp } from './components/session-menu';
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
import { SettingsDialog, type SettingsSectionId } from './components/settings-dialog';
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
import { Toaster, showToast } from './components/ui/toast';
import { Alert, AlertDescription } from './components/ui/alert';
import {
  PanelLeft,
  FolderPlus,
  ArrowUpRight,
  GitBranch,
  Plus,
  RefreshCw,
  Settings2,
  ArrowRight,
  ArrowLeft,
  Check,
  Trash2,
  Menu,
  ChevronDown,
  ChevronRight,
  Keyboard,
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
import { ProjectTree, type CloneProgress, type OpenChat } from './components/project-tree';
import { worktreeBranch, worktreeParent, worktreeSessions } from './lib/worktree-sessions';
import { sessionRepo } from './lib/session-repository';
import {
  activityKey,
  ActivityDot,
  type SessionActivity,
  type SessionActivityState,
} from './components/activity-dot';
import { AgentWorkspace } from './components/agent-workspace';
import type { MenuCommand } from './api/contracts';
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
type ProjectPage = 'board' | 'docs' | 'tasks';
/** The notification target of a session: its agent and ID. */
const notificationTarget = (session: { agent: string; id: string }) =>
  JSON.stringify({ agent: session.agent, id: session.id });
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
  const [settingsSection, setSettingsSection] = useState('general');
  function openSettings(section = 'general') {
    setSettingsSection(section);
    setSettingsOpen(true);
  }
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [projectPage, setProjectPage] = useState<ProjectPage>('board');
  // The list of all sessions in every project.
  const [sessionsPage, setSessionsPage] = useState(false);
  const [openChats, setOpenChats] = useState<OpenChat[]>([]);
  const [cloning, setCloning] = useState<CloneProgress[]>([]);
  const [boardGroup, setBoardGroup] = useState<string | null>(null);
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [git, setGit] = useState<GitInfo | null>(null);
  const [gitError, setGitError] = useState('');
  // True while a user action that changes data runs. A refresh does not set it.
  const [busy, setBusy] = useState(false);
  // Page errors show as error toasts. Dialogs show their own errors.
  const setError = (message: string) => {
    if (message) showToast({ message, tone: 'error' });
  };
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
    { home, boardGroup, projectPage, selected, chatOpen, chatSession, sessionsPage },
    (route) =>
      route.home
        ? 'home'
        : route.chatOpen && route.chatSession
          ? `chat:${route.chatSession.hostId || ''}:${route.chatSession.agent}:${route.chatSession.id}`
          : route.sessionsPage
            ? 'sessions'
            : route.boardGroup
              ? `${route.projectPage}:${route.boardGroup}`
              : `repo:${route.selected}`,
    (route) => {
      const valid =
        route.home ||
        route.sessionsPage ||
        (route.boardGroup
          ? data.groups?.some((group) => group.id === route.boardGroup)
          : data.projects.some((project) => project.id === route.selected));
      setHome(!valid || route.home);
      setSessionsPage(!!valid && route.sessionsPage);
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
      if (!hasPrimaryModifier(event) || event.altKey) return;
      const key = event.key.toLowerCase();
      if (event.shiftKey) {
        // The browser preview has no native menu. The desktop menu sends these commands.
        if (!preview || isTypingTarget(event.target) || dialogOpen()) return;
        if (event.code === 'KeyO') {
          event.preventDefault();
          commandRef.current('add-code-folder');
        } else if (event.code === 'KeyN') {
          event.preventDefault();
          commandRef.current('session-new');
        }
        return;
      }
      if (key === '/' && preview) {
        event.preventDefault();
        if (!dialogOpen()) setShortcutsOpen(true);
      } else if (key === 'k') {
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
  // Menu commands and keys read the latest state through this ref.
  const commandRef = useRef<(command: MenuCommand) => void>(() => {});
  commandRef.current = (command) => {
    if (command === 'back') navigationRef.current.back();
    else if (command === 'forward') navigationRef.current.forward();
    else if (command === 'new-project') setCreateOpen(true);
    else if (command === 'settings') openSettings();
    else if (command === 'search') focusSearch();
    else if (command === 'toggle-sidebar') toggleSidebar();
    else if (command === 'close-tab') closeTab();
    else if (command === 'shortcuts') setShortcutsOpen(true);
    else if (command === 'get-started') setOnboardingOpen(true);
    else if (command === 'add-code-folder') addCodeFolder();
    else if (command === 'new-task') newTask();
    else if (command === 'session-new') newSessionHere();
    else if (command.startsWith('session-'))
      window.dispatchEvent(new CustomEvent('kalkidan-session-command', { detail: { command } }));
  };
  useEffect(
    () =>
      api.onMenuCommand?.((command) => {
        if (dialogOpen()) return;
        commandRef.current(command);
      }),
    [api],
  );
  // Other components ask the shell for these actions with window events.
  useEffect(() => {
    const onSettings = (event: Event) =>
      openSettings((event as CustomEvent<{ section?: string }>).detail?.section || 'general');
    const onNewTask = (event: Event) => {
      // The board hears a forwarded event itself. Do not handle it again.
      if ((event as CustomEvent<{ forwarded?: boolean }>).detail?.forwarded) return;
      commandRef.current('new-task');
    };
    const onAddFolder = (event: Event) =>
      addFolderRef.current((event as CustomEvent<{ groupId?: string }>).detail?.groupId);
    const onClone = (event: Event) => {
      const detail = (event as CustomEvent<CloneProgress & { state: string; message?: string }>)
        .detail;
      if (!detail?.id) return;
      if (detail.state === 'start')
        setCloning((list) => [
          ...list.filter((item) => item.id !== detail.id),
          { id: detail.id, name: detail.name, groupId: detail.groupId },
        ]);
      else {
        setCloning((list) => list.filter((item) => item.id !== detail.id));
        if (detail.state === 'error')
          showToast({
            message: detail.message || `Could not clone ${detail.name}.`,
            tone: 'error',
          });
        else void reloadRef.current();
      }
    };
    window.addEventListener('kalkidan-open-settings', onSettings);
    window.addEventListener('kalkidan-new-task', onNewTask);
    window.addEventListener('kalkidan-add-code-folder', onAddFolder);
    window.addEventListener('kalkidan-clone-progress', onClone);
    return () => {
      window.removeEventListener('kalkidan-open-settings', onSettings);
      window.removeEventListener('kalkidan-new-task', onNewTask);
      window.removeEventListener('kalkidan-add-code-folder', onAddFolder);
      window.removeEventListener('kalkidan-clone-progress', onClone);
    };
  }, []);
  /** Success notices show as toasts. Errors stay until the user closes them. */
  function notify(message: string, failed = false) {
    showToast(failed ? { message, tone: 'error' } : message);
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
    try {
      await action();
      await refresh();
      if (message) showToast(message);
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
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
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
  const { client: connectionClient } = useTracker(api, connection?.provider);
  // The board connection that was checked, and if its sign-in works.
  const [verifiedConnection, setVerifiedConnection] = useState({ key: '', ready: true });
  const connectionKey = connection
    ? `${connectionGroup?.id}:${connection.provider}:${connection.project.id}`
    : '';
  useEffect(() => {
    let live = true;
    let request = 0;
    if (!connectionKey) return;
    const check = async () => {
      const current = ++request;
      try {
        const state = await connectionClient.authStatus();
        if (live && current === request)
          setVerifiedConnection({ key: connectionKey, ready: state.status === 'ready' });
      } catch {
        if (live && current === request)
          setVerifiedConnection({ key: connectionKey, ready: false });
      }
    };
    void check();
    window.addEventListener('focus', check);
    return () => {
      live = false;
      window.removeEventListener('focus', check);
    };
  }, [connectionClient, connectionKey, revision]);
  // A connected board whose sign-in stopped working. The button opens Settings › Accounts.
  const signInLost =
    !!connectionKey && verifiedConnection.key === connectionKey && !verifiedConnection.ready;
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
  // OS notifications: an agent asks for approval or finishes while the window is not focused.
  const previousActivity = useRef(new Map<string, SessionActivity>());
  useEffect(() => {
    const before = previousActivity.current;
    const now = new Map(activity.map((item) => [activityKey(item.agent, item.id), item]));
    previousActivity.current = now;
    const titleOf = (item: { agent: string; id: string }) => {
      const session = [...drafts, ...data.sessions].find(
        (s) => s.agent === item.agent && s.id === item.id,
      );
      return session?.organization?.title || session?.title || 'Agent session';
    };
    if (!document.hasFocus())
      for (const [key, item] of now) {
        if (item.state === 'approval' && before.get(key)?.state !== 'approval')
          void api.notify?.({
            title: `${agentLabel(item.agent as Agent)} needs your approval`,
            body: titleOf(item),
            target: notificationTarget(item),
          });
      }
    if (!document.hasFocus())
      for (const [key, item] of before)
        if (!now.has(key) && item.state === 'running')
          void api.notify?.({
            title: `${agentLabel(item.agent as Agent)} finished`,
            body: titleOf(item),
            target: notificationTarget(item),
          });
    void api.setBadgeCount?.(activity.filter((item) => item.state === 'approval').length);
  }, [activity]);
  const openRef = useRef<(session: Session) => void>(() => {});
  useEffect(
    () =>
      api.onNotificationClick?.((target) => {
        try {
          const { agent, id } = JSON.parse(target) as { agent: string; id: string };
          const session =
            openChats.find((chat) => chat.session.agent === agent && chat.session.id === id)
              ?.session || data.sessions.find((s) => s.agent === agent && s.id === id);
          if (session) openRef.current(session);
        } catch {
          /* A notification from an older version has no session target. */
        }
      }),
    [api, openChats, data.sessions],
  );
  const ownSessions =
    repositoryView?.id === selected
      ? visibleSessions
      : data.sessions.filter((s) => sessionRepo(s, data.projects)?.id === project?.id);
  // The branch copies of this code folder. Their chats show on this page with a branch badge.
  const projectGroupRepos = project
    ? data.projects.filter((p) =>
        data.groups?.find((g) => g.repoIds.includes(project.id))?.repoIds.includes(p.id),
      )
    : [];
  const branchCopies = project
    ? projectGroupRepos.filter((repo) => worktreeParent(repo, projectGroupRepos)?.id === project.id)
    : [];
  const sessionBranch = new Map<string, string>();
  const copySessions = data.sessions.filter((s) => {
    const repo = sessionRepo(s, data.projects);
    const copy = repo && branchCopies.find((item) => item.id === repo.id);
    if (copy && project) sessionBranch.set(s.agent + ':' + s.id, worktreeBranch(copy, project));
    return !!copy;
  });
  const sessions = [
    ...ownSessions,
    ...copySessions.filter((s) => !ownSessions.some((o) => o.agent === s.agent && o.id === s.id)),
  ];
  function openProject(p: Project) {
    setHome(false);
    setSessionsPage(false);
    setChatOpen(false);
    setBoardGroup(null);
    setSelected(p.id);
  }
  // A docs page or task chosen in search. The panel opens it once after it loads.
  const [searchTarget, setSearchTarget] = useState<{ page?: string; task?: string }>({});
  function openGroup(group: ProjectGroup, page: ProjectPage = 'board') {
    setHome(false);
    setSessionsPage(false);
    setChatOpen(false);
    setBoardGroup(group.id);
    setProjectPage(page);
  }
  function openAllSessions() {
    setHome(false);
    setChatOpen(false);
    setBoardGroup(null);
    setSessionsPage(true);
  }
  function connectTracker(group = connectionGroup) {
    if (!group) return;
    openGroup(group);
    setConnectRequest(group.id);
  }
  function openOverview() {
    setHome(true);
    setSessionsPage(false);
    setChatOpen(false);
    setBoardGroup(null);
  }
  /** The project of the current page, or the only project. */
  function currentProjectGroup() {
    if (boardGroup) return data.groups?.find((g) => g.id === boardGroup);
    const repo = chatOpen && chatSession ? sessionRepo(chatSession, data.projects) : project;
    if (!home && repo) return data.groups?.find((g) => g.repoIds.includes(repo.id));
    return data.groups?.length === 1 ? data.groups[0] : undefined;
  }
  /** Opens the Add code folder dialog of a project: the one in the sidebar project row. */
  function addCodeFolder(groupId?: string) {
    const group = groupId
      ? data.groups?.find((g) => g.id === groupId)
      : currentProjectGroup() || data.groups?.[0];
    if (!group) {
      setCreateOpen(true);
      return;
    }
    setNavigationOpen(true);
    setQuery('');
    // Wait for the sidebar to show the project row, then open its dialog.
    const open = (tries: number) =>
      requestAnimationFrame(() => {
        const button = document.querySelector<HTMLButtonElement>(
          `.project-group[data-group="${CSS.escape(group.id)}"] .project-group-actions button`,
        );
        if (button) button.click();
        else if (tries > 0) open(tries - 1);
      });
    open(10);
  }
  const addFolderRef = useRef(addCodeFolder);
  addFolderRef.current = addCodeFolder;
  /** Opens the board of the current project. The board opens New task. */
  function newTask() {
    const group = currentProjectGroup() || data.groups?.[0];
    if (!group) {
      setCreateOpen(true);
      return;
    }
    const mounted = !!boardGroup && boardGroup === group.id && projectPage !== 'docs';
    openGroup(group, 'tasks');
    if (!mounted)
      setTimeout(
        () =>
          window.dispatchEvent(
            new CustomEvent('kalkidan-new-task', { detail: { forwarded: true } }),
          ),
        50,
      );
    else
      window.dispatchEvent(new CustomEvent('kalkidan-new-task', { detail: { forwarded: true } }));
  }
  /** Starts a session in the open chat's or page's code folder, else opens the project home. */
  function newSessionHere() {
    const chatRepo = chatOpen && chatSession ? sessionRepo(chatSession, data.projects) : undefined;
    if (chatRepo) startSession(preferredAgent, chatRepo, chatSession?.cwd);
    else if (!home && !boardGroup && !sessionsPage && project) startSession(preferredAgent);
    else {
      const group = currentProjectGroup();
      if (group) openGroup(group);
      else openOverview();
    }
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
    home || (!currentGroup && !project && !sessionsPage)
      ? []
      : [
          { label: 'Projects', name: 'Projects overview', open: openOverview },
          ...(trailGroup && !sessionsPage && (projectPage !== 'board' || !currentGroup)
            ? [
                {
                  label: trailGroup.name,
                  name: `${trailGroup.name} project`,
                  open: () => openGroup(trailGroup),
                },
              ]
            : []),
        ];
  openRef.current = (session: Session) => openConversation(session);
  function openConversation(session: Session) {
    setHome(false);
    setSessionsPage(false);
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
    setSessionsPage(false);
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
    }, 'Code folder updated.');
  }
  function createWorktree() {
    void runModal(async () => {
      if (await api.worktree(modalRepo, branch.trim())) setModal(null);
    }, 'Branch copy created. It shows under its code folder in the sidebar.');
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
        notify(`Branch copy ${target.branch} deleted.`);
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
  // Where a new branch copy starts and where its folder goes, for the create dialog.
  const [worktreeInfo, setWorktreeInfo] = useState<{ base: string; path: string } | null>(null);
  useEffect(() => {
    setWorktreeInfo(null);
    const name = branch.trim();
    if (modal !== 'worktree' || !name || !api.worktreePreview) return;
    let live = true;
    const timer = window.setTimeout(() => {
      api
        .worktreePreview(modalRepo, name)
        .then((value) => live && setWorktreeInfo(value))
        .catch(() => live && setWorktreeInfo(null));
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [modal, modalRepo, branch]);
  // Each session row keeps its own busy state. A refresh does not disable the rows.
  const [sessionBusy, setSessionBusy] = useState(false);
  async function updateSession(session: Session, changes: import('./types').SessionOrganization) {
    setSessionBusy(true);
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
  }
  function sessionList() {
    return (
      <SessionBrowser
        api={api}
        onChanged={() => void reload()}
        activity={sessionActivity}
        storageKey={selected}
        sessions={sessions}
        query={sessionFilter}
        busy={sessionBusy}
        newSessionLabel={`New ${agentLabel(preferredAgent)} session`}
        branchOf={(session) => sessionBranch.get(session.agent + ':' + session.id)}
        onResume={openConversation}
        onUpdate={updateSession}
      />
    );
  }
  // Setup is done when there is a project with a code folder and one agent chat.
  const setupDone = !!data.groups?.length && data.projects.length > 0 && data.sessions.length > 0;
  const placeOf = (session: Session) => {
    const repo = sessionRepo(session, data.projects);
    return {
      folder: repo?.name,
      project: repo ? data.groups?.find((g) => g.repoIds.includes(repo.id))?.name : undefined,
    };
  };
  const currentRepoForActions =
    chatOpen && chatSession ? sessionRepo(chatSession, data.projects) : !home ? project : undefined;
  const searchActions: SearchAction[] = [
    ...(currentRepoForActions
      ? agentCatalog.map(({ id: agent }) => ({
          key: 'new-session-' + agent,
          label: `New ${agentLabel(agent)} session in ${currentRepoForActions.name}`,
          keywords: 'start chat agent',
          shortcut: agent === preferredAgent ? shortcutLabel(['mod', 'shift'], 'N') : undefined,
          run: () => startSession(agent, currentRepoForActions),
        }))
      : []),
    {
      key: 'add-folder',
      label: 'Add a code folder…',
      keywords: 'repository import clone',
      shortcut: shortcutLabel(['mod', 'shift'], 'O'),
      run: () => addCodeFolder(),
    },
    {
      key: 'new-project',
      label: 'New project…',
      keywords: 'create',
      shortcut: shortcutLabel(['mod'], 'N'),
      run: () => setCreateOpen(true),
    },
    { key: 'new-task', label: 'New task', keywords: 'issue board', run: newTask },
    {
      key: 'all-sessions',
      label: 'See all sessions',
      keywords: 'chats history',
      run: openAllSessions,
    },
    {
      key: 'settings',
      label: 'Open settings',
      keywords: 'preferences',
      shortcut: shortcutLabel(['mod'], ','),
      run: () => openSettings(),
    },
    {
      key: 'github',
      label: 'Connect GitHub',
      keywords: 'sign in account',
      run: () => openSettings('accounts'),
    },
    {
      key: 'shortcuts',
      label: 'Keyboard shortcuts',
      keywords: 'keys help',
      shortcut: shortcutLabel(['mod'], '/'),
      run: () => setShortcutsOpen(true),
    },
    {
      key: 'sidebar',
      label: 'Toggle sidebar',
      keywords: 'hide show',
      shortcut: shortcutLabel(['mod'], 'B'),
      run: toggleSidebar,
    },
    {
      key: 'get-started',
      label: 'Get started',
      keywords: 'setup guide help',
      run: () => setOnboardingOpen(true),
    },
  ];
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
  const host = project?.hostId ? data.hosts?.find((h) => h.id === project.hostId) : undefined;
  const [reconnecting, setReconnecting] = useState(false);
  async function reconnectHost() {
    if (!host) return;
    setReconnecting(true);
    try {
      await api.remoteConnect(host.id);
      await refresh();
    } catch (e) {
      setError(`Could not connect to ${host.name}: ${errorText(e)}`);
    } finally {
      setReconnecting(false);
    }
  }
  function deleteBranchCopy(repo: Project, branch: string) {
    setWorktreeTarget({ id: repo.id, branch, dirty: false });
    openModal('remove-worktree', repo.id);
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
                    title={part.label}
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
          actions={searchActions}
          activity={sessionActivity}
          onProject={(group) => openGroup(group)}
          onDoc={(group, doc) => {
            setSearchTarget({ page: doc.id });
            openGroup(group, 'docs');
          }}
          onTask={(group, task) => {
            setSearchTarget({ task: task.id });
            openGroup(group, 'tasks');
          }}
          onRepository={openProject}
          onSession={openConversation}
        >
          <ProjectTree
            activity={repoActivity}
            sessionActivity={sessionActivity}
            projectPage={projectPage}
            query={query}
            onDocs={(group) => openGroup(group, 'docs')}
            onTasks={(group) => openGroup(group, 'tasks')}
            onOverview={openOverview}
            overviewCurrent={home}
            onAllSessions={openAllSessions}
            allSessionsCurrent={sessionsPage && !chatOpen}
            onEditRepository={editRepository}
            onDeleteBranchCopy={deleteBranchCopy}
            onNewSession={(agent, repo) => startSession(agent, repo)}
            onConnect={(group) => connectTracker(group)}
            openChats={openChats}
            onCloseChat={(session) =>
              window.dispatchEvent(
                new CustomEvent('kalkidan-close-chat', {
                  detail: { agent: session.agent, id: session.id },
                }),
              )
            }
            cloning={cloning}
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
            selected={home || sessionsPage ? '' : selected}
            activeGroup={home || sessionsPage ? null : boardGroup}
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
          {signInLost && connectionGroup && (
            <Button
              variant="outline"
              className={sidebarAction + ' sidebar-github-connect'}
              title={`The GitHub sign-in for the ${connectionGroup.name} board stopped working.`}
              onClick={() => openSettings('accounts')}
            >
              <img src="./icons/github.svg" width="16" height="16" alt="" aria-hidden="true" />
              Sign in to GitHub again
            </Button>
          )}
          {!setupDone && (
            <Button
              variant="ghost"
              className={sidebarAction + ' font-normal'}
              onClick={() => setOnboardingOpen(true)}
            >
              <ArrowRight /> Get started
            </Button>
          )}
          <div className="sidebar-footer-row">
            <Button
              variant="ghost"
              className={sidebarAction + ' min-w-0 flex-1 font-normal'}
              onClick={() => openSettings()}
            >
              <Settings2 />
              Settings
            </Button>
            <Hint label={`Keyboard shortcuts (${shortcutLabel(['mod'], '/')})`}>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                aria-label="Keyboard shortcuts"
                onClick={() => setShortcutsOpen(true)}
              >
                <Keyboard />
              </Button>
            </Hint>
          </div>
        </div>
      </nav>
      {navigationOpen && <SidebarResizer {...sidebar} />}
      <main>
        <div className="page-content">
          {data.warnings.length > 0 && (
            <Collapsible className="warnings">
              <Alert size="sm">
                <AlertDescription>
                  <CollapsibleTrigger asChild>
                    <Button variant="link" size="xs" className="warnings-toggle">
                      Some past agent chats could not be loaded ({data.warnings.length})
                      <ChevronDown aria-hidden="true" />
                    </Button>
                  </CollapsibleTrigger>
                  <CollapsibleContent className="warnings-list">
                    {data.warnings.map((w, i) => (
                      <p key={i}>{w}</p>
                    ))}
                  </CollapsibleContent>
                </AlertDescription>
              </Alert>
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
                    activity={sessionActivity}
                    onRefresh={refresh}
                    onSelect={(group) => openGroup(group)}
                    onResume={openConversation}
                    onAllSessions={openAllSessions}
                  />
                ) : sessionsPage ? (
                  <section className="page" aria-label="All sessions">
                    <PageHeader
                      title="All sessions"
                      subtitle="The agent chats of every project. Use the filters to find one."
                    />
                    <SessionBrowser
                      api={api}
                      onChanged={() => void reload()}
                      activity={sessionActivity}
                      storageKey="all-sessions"
                      sessions={data.sessions.filter((s) => !!sessionRepo(s, data.projects))}
                      busy={sessionBusy}
                      placeOf={placeOf}
                      onResume={openConversation}
                      onUpdate={updateSession}
                    />
                  </section>
                ) : boardGroup && data.groups?.find((g) => g.id === boardGroup) ? (
                  projectPage === 'docs' ? (
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
                      key={boardGroup}
                      // The project row opens the overview. The Tasks row opens the board.
                      page={projectPage === 'tasks' ? 'tasks' : 'overview'}
                      onPageChange={(page) => setProjectPage(page === 'tasks' ? 'tasks' : 'board')}
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
                      onAddFolder={() => addCodeFolder(boardGroup)}
                      onNewSession={(repo, agent) => startSession(agent, repo)}
                      onOpenSession={openConversation}
                      onOpenDocs={(pageId) => {
                        const group = data.groups?.find((g) => g.id === boardGroup);
                        if (!group) return;
                        setSearchTarget({ page: pageId });
                        openGroup(group, 'docs');
                      }}
                      onAllSessions={openAllSessions}
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
                            <span className="inline-flex shrink-0 items-center gap-1.5">
                              SSH · {host?.name || 'Remote host'} · {host?.status || 'disconnected'}
                              {host && host.status !== 'connected' && (
                                <Button
                                  variant="link"
                                  size="xs"
                                  className="text-xs"
                                  disabled={reconnecting || host.status === 'connecting'}
                                  onClick={() => void reconnectHost()}
                                >
                                  Reconnect
                                </Button>
                              )}
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
                              className="path-button gap-1 text-xs font-normal text-muted-foreground hover:text-foreground"
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
                                label: 'Edit code folder…',
                                action: () => editRepository(project),
                              },
                              ...(!project.hostId
                                ? [
                                    {
                                      label: revealLabel(),
                                      action: () => void run(() => api.reveal(project.id)),
                                    },
                                    {
                                      label: 'Open in Terminal app',
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
                        aria-label="Repository branch copies"
                      >
                        <SectionHeader
                          title="Branch copies"
                          count={git?.worktrees.length}
                          actions={
                            <>
                              <Hint label="Refresh branch copies">
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label="Refresh branch copies"
                                  disabled={gitLoading}
                                  onClick={() => setRepositoryRevision((value) => value + 1)}
                                >
                                  <RefreshCw />
                                </Button>
                              </Hint>
                              <Button
                                variant="outline"
                                size="sm"
                                disabled={!git}
                                onClick={() => {
                                  setBranch('');
                                  openModal('worktree');
                                }}
                              >
                                <Plus /> New branch copy
                              </Button>
                            </>
                          }
                        />
                        <p className="section-help">{branchCopyHelp}</p>
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
                              const here = tree.path === project.path;
                              return (
                                <div className="worktree list-row" key={tree.path}>
                                  <EntityIcon className="mt-0.5">
                                    <GitBranch />
                                  </EntityIcon>
                                  <div className="worktree-text">
                                    <strong title={tree.branch}>{tree.branch}</strong>
                                    <span className="worktree-path" title={tree.path}>
                                      {here ? 'This folder' : tree.path}
                                    </span>
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
                                            className="justify-start"
                                            title={`${agentLabel(session.agent)} · ${title}`}
                                            onClick={() => openConversation(session)}
                                          >
                                            <AgentIcon agent={session.agent} />
                                            <span className="sr-only">
                                              {agentLabel(session.agent)}:
                                            </span>
                                            <span className="truncate">{title}</span>
                                            <ActivityDot
                                              state={
                                                sessionActivity[
                                                  activityKey(session.agent, session.id)
                                                ]
                                              }
                                            />
                                          </Button>
                                        );
                                      })}
                                    </div>
                                  </div>
                                  {here && (
                                    <Badge variant="secondary" size="sm">
                                      Open now
                                    </Badge>
                                  )}
                                  <ActionMenu
                                    size="xs"
                                    label={`${tree.branch} branch copy actions`}
                                    items={[
                                      ...agentCatalog.map(({ id: agent }) => ({
                                        label: `New ${agentLabel(agent)} session`,
                                        action: () =>
                                          treeRepo
                                            ? startSession(agent, treeRepo)
                                            : startSession(agent, project, tree.path),
                                      })),
                                      ...(linked && treeRepo
                                        ? [
                                            {
                                              label: 'Delete this branch copy…',
                                              danger: true,
                                              separator: true,
                                              action: () => deleteBranchCopy(treeRepo, tree.branch),
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
                            Checking branch copies…
                          </p>
                        ) : (
                          <EmptyState compact icon={<GitBranch />} title="Branch copies need Git">
                            This folder is not a Git repository, or it has no commits yet. Branch
                            copies need Git.
                          </EmptyState>
                        )}
                      </section>
                    </div>
                  </section>
                ) : (
                  <section className="page">
                    <EmptyState
                      icon={<FolderPlus />}
                      title="Add your first code folder"
                      action={
                        <div className="flex flex-wrap justify-center gap-2">
                          {data.groups?.length ? (
                            <Button size="lg" onClick={() => addCodeFolder()}>
                              <FolderPlus /> Add a code folder
                            </Button>
                          ) : (
                            <AddRepository
                              api={api}
                              variant="default"
                              size="lg"
                              onRefresh={reload}
                              onNotice={notify}
                            >
                              <FolderPlus /> Add a code folder
                            </AddRepository>
                          )}
                          <Button variant="outline" size="lg" onClick={() => setCreateOpen(true)}>
                            <Plus /> New project
                          </Button>
                        </div>
                      }
                    >
                      A code folder is a Git repository on this computer or on a remote host. Agents
                      work in it.
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
                      : 'Code folder details'
                  }
                  visible={chatOpen}
                  onSelect={openConversation}
                  onClose={closeConversation}
                  onOpenRepository={(repo) => openProject(repo)}
                  onOpenOverview={openOverview}
                  onOpenProject={(group) => openGroup(group)}
                  onOpenChats={setOpenChats}
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
      <Toaster />
      <ShortcutsSheet open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
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
            openSettings();
          }}
          onConnectBoard={(groupId) => {
            const group = data.groups?.find((g) => g.id === groupId);
            if (!group) return;
            setOnboardingOpen(false);
            dismissOnboarding();
            connectTracker(group);
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
        section={settingsSection as SettingsSectionId}
        api={api}
        onRefresh={refresh}
      />
      {/* Work started here continues after the dialog closes and reports through a toast. */}
      <Dialog open={modal !== null} onOpenChange={(open) => !open && setModal(null)}>
        <DialogContent
          size={shownModal === 'remove' || shownModal === 'remove-worktree' ? 'sm' : 'md'}
          layout={shownModal === 'edit' ? 'scroll' : 'simple'}
        >
          <DialogHeader>
            <DialogTitle>
              {shownModal === 'worktree'
                ? 'Create a branch copy'
                : shownModal === 'edit'
                  ? 'Edit code folder'
                  : shownModal === 'remove'
                    ? `Remove ${modalProject?.name || 'code folder'} from Kalkidan?`
                    : `Delete branch copy ${worktreeTarget?.branch || ''}?`}
            </DialogTitle>
            <DialogDescription>
              {shownModal === 'worktree'
                ? `${branchCopyHelp} Kalkidan adds the folder to the project.`
                : shownModal === 'edit'
                  ? 'Change the name, the project and the notes of this code folder.'
                  : shownModal === 'remove'
                    ? 'Kalkidan stops showing this code folder. The folder, its files, and its sessions stay on disk.'
                    : worktreeTarget?.dirty
                      ? 'This branch copy has changes that are not committed. If you delete it, the changes are lost.'
                      : 'Kalkidan deletes the branch copy folder. The branch and its commits stay in the repository.'}
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
              {worktreeInfo && (
                <dl className="worktree-preview">
                  <div>
                    <dt>Starts from</dt>
                    <dd title={worktreeInfo.base}>{worktreeInfo.base}</dd>
                  </div>
                  <div>
                    <dt>Folder</dt>
                    <dd title={worktreeInfo.path}>{worktreeInfo.path}</dd>
                  </div>
                </dl>
              )}
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
                  Code folder name
                  <Input
                    aria-label="Repository name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
                </label>
                <label className="form-label">
                  Project
                  <span className="form-help">
                    The sidebar shows each code folder under its project. Choose one.
                  </span>
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
                    <strong>Remove code folder</strong>
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
              <Hint label="Choose a project first" disabled={!!repoGroup}>
                <Button
                  type="submit"
                  form="repository-dialog-form"
                  disabled={modalBusy || !name.trim() || !repoGroup}
                >
                  <Check /> Save changes
                </Button>
              </Hint>
            )}
            {shownModal === 'remove' && (
              <Button
                type="button"
                variant="destructive"
                disabled={modalBusy}
                onClick={() => {
                  const removed = modalProject?.name || 'Code folder';
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
                {worktreeTarget?.dirty ? 'Delete anyway' : 'Delete branch copy'}
              </Button>
            )}
            {shownModal === 'worktree' && (
              <Button
                type="submit"
                form="repository-dialog-form"
                disabled={modalBusy || !branch.trim()}
              >
                {modalBusy ? 'Creating…' : 'Create branch copy'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
