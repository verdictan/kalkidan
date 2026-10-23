import { SshQuitDialog } from './components/ssh-quit-dialog';
import {
  routeKey,
  reconcileRoute,
  resolveRouteSession,
  restoreRoute,
  saveableRoute,
  projectPageOf,
  type KnowledgeSection,
  type WorkspacePage,
  type WorkspaceRoute,
  type ProjectPage,
} from './domain/workspace-route';
import { retainProjectResources } from './hooks/use-project-resource';
import { GetStartedButton, dismissOnboarding, startFirstChat } from './components/onboarding';
import { KnowledgePanel, knowledgeFindEvent } from './components/knowledge-panel';
import { newPageEvent, recentlyDeletedEvent } from './components/project-docs';
import { ProjectUsageSheetHost, openProjectUsage } from './components/project-usage';
import { ProjectHomePage } from './components/project-home';
import { recordRecentItem, useRecentItems } from './lib/recent-items';
import {
  WorkspaceSearch,
  type RecentPlace,
  type SearchAction,
} from './components/workspace-search';
import { ShortcutsSheet } from './components/shortcuts-sheet';
import { DiagnosticsDialog, openDiagnostics } from './components/diagnostics-section';
import { branchCopyHelp } from './components/session-menu';
import { useSidebarOpen, useSidebarWidth } from './hooks/use-sidebar-width';
import { useProjectBoards, sessionTask } from './hooks/use-project-boards';
import { setPendingDraft } from './lib/pending-draft';
import { ProjectFrame } from './components/project-header';
import { projectTabs } from './components/project-tabs';
import { SidebarResizer } from './components/sidebar-resizer';
import { useNavigationHistory } from './hooks/use-navigation-history';
import { agentCatalog, agentLabel } from './config/agents';
import {
  agentInstalled,
  agentMenuLabel,
  loadAgentInstallations,
  onPreferredAgentChange,
  readPreferredAgent,
  savePreferredAgent,
} from './lib/agent-preference';
import { trackerConnection } from './domain/tracker';
import { addForkLink, forkDraft } from './domain/chat-fork';
import { ForkChatDialog, type ForkChoice } from './components/fork-chat-dialog';
import { sessionTitle } from './components/session-actions';
import { settingsAnchors, settingsTarget, type SettingsSection } from './domain/settings-route';
import {
  chatActionMenu,
  isChatCommand,
  leafChatActions,
  sessionActionState,
} from './domain/chat-actions';
import { useTracker } from './hooks/use-tracker';
import { SettingsPage } from './components/settings-page';
import { Welcome, useWelcomeGate } from './components/welcome';
import { hideSplash } from './lib/splash';
import { ProxySignInDialog } from './components/proxy-sign-in';
import { AccountMenu, SessionBanner, SignInFlow } from './components/account-menu';
import { BoardSettingsHost } from './components/board-settings-dialog';
import { openConnectBoard } from './components/tracker-project-picker';
import { recentRepo } from './components/new-chat-button';
import type { TreeAction } from './components/tree-context-menu';
import { ProjectOverview, useNeedsYou } from './components/project-overview';
import { useWorkspaceIdentity } from './hooks/use-workspace-identity';
import { currentWindowScope } from './lib/window-scope';
import { IdentityMark } from './components/ui/identity-mark';
import { NavRow } from './components/ui/nav-row';
import { Hint } from './components/hint';
import { CreateProject } from './components/create-project';
import {
  hasPrimaryModifier,
  isMac,
  isTypingTarget,
  platform,
  plural,
  revealLabel,
  shortcutLabel,
} from './lib/platform';

import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Toaster, showToast } from './components/ui/toast';
import { Alert, AlertDescription } from './components/ui/alert';
import {
  PanelLeft,
  FolderGit2,
  FolderPlus,
  GitBranch,
  GitPullRequest,
  Settings2,
  Check,
  Trash2,
  Menu,
  ChevronDown,
  Keyboard,
  SquarePen,
  MessageSquare,
  FilePlus2,
  ListPlus,
  CalendarRange,
  ListChecks,
  Rows3,
  FileInput,
  Link2,
  Activity,
  History,
  Terminal,
  GitCompare,
  Eye,
  Pin,
  LogIn,
  UserPlus,
  AppWindow,
  PanelLeftClose,
  Folder,
  FolderOpen,
  LoaderCircle,
  Pencil,
  Trash,
  Download,
  Layers2,
  BookOpen,
  Search,
  ArchiveRestore,
  MessageSquarePlus,
  type LucideIcon,
} from 'lucide-react';
import { ConfirmDialog } from './components/confirm-dialog';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
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
import { Textarea } from './components/ui/textarea';
import { PageHeader } from './components/ui/page-header';
import { ProjectTrackerPanel } from './components/project-tracker';
import { Choice } from './components/choice';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from './components/ui/collapsible';
import { ProjectTree, type CloneProgress, type OpenChat } from './components/project-tree';
import { worktreeBranch, worktreeParent } from './lib/worktree-sessions';
import { sessionRepo } from './lib/session-repository';
import {
  activityKey,
  answerApproval,
  markFinished,
  markSeen,
  publishActivity,
  strongestActivity,
  waitsForUser,
  type SessionActivity,
  type SessionActivityState,
} from './components/activity-dot';
import { AgentWorkspace } from './components/agent-workspace';
import type { MenuCommand } from './api/contracts';
import type { API, Snapshot, Agent, Project, ProjectGroup, Session, TrackerItem } from './types';

// The footer buttons of the sidebar: full width and start aligned. Utilities, so they win
// over the Button padding.
const sidebarAction = 'sidebar-action w-full justify-start px-2 has-[>svg]:px-2';
type RepositoryModal = 'worktree' | 'edit' | 'remove' | 'remove-worktree';
/** The notification target of a session: its agent and ID. */
const notificationTarget = (session: { agent: string; id: string }, review = false) =>
  JSON.stringify({ agent: session.agent, id: session.id, ...(review ? { review } : {}) });
/** The detail of a window event, or an empty object. */
const detailOf = (event: Event) =>
  ((event as CustomEvent<unknown>).detail || {}) as Record<string, unknown>;
const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);
/** A Knowledge section from an event, or undefined. */
const sectionOf = (value: unknown): KnowledgeSection | undefined =>
  value === 'pages' || value === 'memory' || value === 'insights' ? value : undefined;
const sameChat = (a: { agent: string; id: string } | null | undefined, b: Session) =>
  !!a && a.agent === b.agent && a.id === b.id;
const routeStorageKey = 'kalkidan-last-route';
type SavedView = { id: string; name: string };
const openChatsStorageKey = 'kalkidan-open-chats';
function readStored(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) || 'null');
  } catch {
    return null;
  }
}
function writeStored(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* The app starts on Projects next time. */
  }
}
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
  useEffect(() => {
    if (data.groups) retainProjectResources(api, data.groups);
  }, [api, data.groups]);
  const [route, navigate] = useState<WorkspaceRoute>(() => {
    const scoped = currentWindowScope();
    return scoped.kind === 'project'
      ? { kind: 'project', groupId: scoped.groupId, page: 'board' }
      : { kind: 'home' };
  });
  const basePage = route.kind === 'conversation' ? route.parent : route;
  const home = route.kind === 'home';
  // A project window shows one project: its tree, its views and its chats.
  const [scope] = useState(currentWindowScope);
  const scopeGroup = scope.kind === 'project' ? scope.groupId : undefined;
  // A project window keeps its own page and chats.
  const routeKeyOf = (key: string) => (scopeGroup ? `${key}:${scopeGroup}` : key);
  const chatOpen = route.kind === 'conversation';
  const boardGroup = basePage.kind === 'project' ? basePage.groupId : null;
  const projectPage: ProjectPage = basePage.kind === 'project' ? basePage.page : 'board';
  const knowledgeSection: KnowledgeSection | undefined =
    basePage.kind === 'project' ? basePage.section : undefined;
  function setProjectPage(page: ProjectPage) {
    navigate((current) => {
      if (current.kind === 'project') return { ...current, page };
      if (current.kind === 'conversation' && current.parent.kind === 'project')
        return { ...current, parent: { ...current.parent, page } };
      return current;
    });
  }
  const sidebar = useSidebarWidth();
  // Below 900 px the sidebar starts closed. The user's choice is kept for each window size.
  const { open: navigationOpen, setOpen: setNavigationOpen } = useSidebarOpen();
  const [connectRequest, setConnectRequest] = useState<string | null>(null);
  // The element that opened a dialog. Focus goes back to it when the dialog closes.
  const lastFocus = useRef<HTMLElement | null>(null);
  const dialogTrigger = useRef<HTMLElement | null>(null);
  useEffect(() => {
    // A menu item is not a good return target: it is removed when its menu closes.
    const onFocus = (event: FocusEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      // A menu button does not get the focus when it opens its menu. Keep the button instead.
      const menu = target.closest('[role="menu"]');
      const button = menu?.id
        ? document.querySelector<HTMLElement>(`[aria-controls="${CSS.escape(menu.id)}"]`)
        : null;
      if (button && !button.closest('[role="dialog"], [role="alertdialog"]'))
        lastFocus.current = button;
      else if (!target.closest('[role="menu"], [role="dialog"], [role="alertdialog"]'))
        lastFocus.current = target;
    };
    document.addEventListener('focusin', onFocus);
    return () => document.removeEventListener('focusin', onFocus);
  }, []);
  function rememberTrigger() {
    dialogTrigger.current = lastFocus.current;
  }
  /** Moves the focus back to the element that opened the dialog, after Radix restores it. */
  function returnFocus() {
    const target = dialogTrigger.current;
    dialogTrigger.current = null;
    if (!target) return;
    setTimeout(() => {
      if (target.isConnected && !document.querySelector('[role="dialog"]')) target.focus();
    }, 0);
  }
  /** Focus-return handler for dialogs that this file renders. */
  const restoreTriggerFocus = (event: Event) => {
    if (dialogTrigger.current?.isConnected) {
      event.preventDefault();
      returnFocus();
    }
  };
  // The part of the Settings page to show. ⌘, the app menu and the gear open the page.
  const [settings, setSettings] = useState<{
    section: SettingsSection;
    anchor?: string;
  }>({ section: 'general' });
  const settingsOpenRef = useRef(false);
  const settingsGroup = useRef<string | undefined>(undefined);
  settingsOpenRef.current = route.kind === 'settings';
  /**
   * Opens the one Settings window at a section: 'general', 'computers', 'account' or
   * 'project:<id>'. Older section names and anchors, such as 'accounts', open their new place.
   */
  function openSettings(section = 'general', anchor?: string) {
    const target = settingsTarget(section, anchor);
    // Read through a ref: the event listeners keep the openSettings of the first render.
    // A request for the account while nobody is signed in starts the sign-in.
    if (target.anchor === settingsAnchors.account && !signedInRef.current) {
      if (dialogOpen())
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      signIn('login');
      return;
    }
    // A dialog that links to Settings closes first, so Settings does not open on top.
    if (dialogOpen())
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    setSettings({ section: target.tab, anchor: target.anchor });
    navigate((current) =>
      current.kind === 'settings' && current.tab === target.tab
        ? current
        : { kind: 'settings', tab: target.tab },
    );
  }
  // The first-run Welcome screen: before the workspace, until the user signs in or skips it.
  const welcome = useWelcomeGate(api, preview);
  // The launch splash stays until the app knows which page to show: Welcome or the workspace.
  useEffect(() => {
    // The first-run tools check moves the splash into its heading itself.
    if (welcome.show === false) hideSplash();
  }, [welcome.show]);
  // True when a Verdictan account is signed in. Search hides "Sign in" then.
  const [signedIn, setSignedIn] = useState(false);
  const signedInRef = useRef(signedIn);
  signedInRef.current = signedIn;
  useEffect(() => {
    if (typeof api.verdictanStatus !== 'function') return;
    let live = true;
    const read = () =>
      Promise.resolve()
        .then(() => api.verdictanStatus())
        .then((status) => live && setSignedIn(status.phase === 'authenticated'))
        .catch(() => undefined);
    void read();
    const stop = api.onVerdictanChanged?.(() => void read());
    return () => {
      live = false;
      stop?.();
    };
  }, [api]);
  // The data notice: once, after the first sign-in and before the first request.

  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  // The list of all sessions in every project.
  const [openChats, setOpenChats] = useState<OpenChat[]>([]);
  const [cloning, setCloning] = useState<CloneProgress[]>([]);
  // The code folder of the last chat. New chats start there when the page has no other.
  const [lastRepository, setLastRepository] = useState('');
  const selected =
    route.kind === 'conversation' ? route.repositoryId || lastRepository : lastRepository;
  // True when the command palette ("Search or run") shows.
  const [searchOpen, setSearchOpen] = useState(false);
  const searchOpenRef = useRef(false);
  searchOpenRef.current = searchOpen;
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
  const [activity, setActivity] = useState<SessionActivity[]>([]);
  // Keep the last modal content while the dialog animates closed.
  const lastModal = useRef(modal);
  if (modal) lastModal.current = modal;
  const shownModal = modal ?? lastModal.current;
  function openModal(kind: RepositoryModal, repo = selected) {
    if (!modal) rememberTrigger();
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
  // The chat of the open fork dialog.
  const [forkSource, setForkSource] = useState<Session | null>(null);
  const [chatSession, setChatSession] = useState<Session | null>(null);
  // Effects read the open chat through these refs.
  const chatSessionRef = useRef(chatSession);
  chatSessionRef.current = chatSession;
  const chatOpenRef = useRef(false);
  chatOpenRef.current = route.kind === 'conversation';
  // Chats to show in "Open chats" after a launch. AgentWorkspace adds them as tabs.
  const [restoredChats, setRestoredChats] = useState<Session[]>([]);
  const navigation = useNavigationHistory(route, routeKey, (next) => {
    const valid = reconcileRoute(next, data.groups || [], data.projects);
    navigate(valid);
    if (valid.kind === 'conversation') setChatSession(valid.session);
  });
  const sidebarRef = useRef<HTMLElement>(null);
  const sidebarToggleRef = useRef<HTMLButtonElement>(null);
  // Window listeners read the latest history through this ref.
  const navigationRef = useRef(navigation);
  navigationRef.current = navigation;
  // Navigation must not change the selection under an open dialog.
  const dialogOpen = () => !!document.querySelector('[role="dialog"], [role="alertdialog"]');
  function openSearch() {
    setSearchOpen(true);
  }
  // A tool pane does not hide the sidebar: the chat fits a narrow area by itself.
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
          // Shift+Mod+N is New project. Mod+N is New chat.
          event.preventDefault();
          commandRef.current('new-project');
        } else if (event.code === 'KeyK') {
          event.preventDefault();
          commandRef.current('new-task');
        }
        return;
      }
      // The browser preview has no native Go menu. Mod+1 to Mod+3 open the project views in
      // the order of the view switch.
      const goKeys = ['go-overview', 'go-tasks', 'go-knowledge'];
      if (preview && /^Digit[1-3]$/.test(event.code)) {
        if (isTypingTarget(event.target) || dialogOpen()) return;
        event.preventDefault();
        commandRef.current(goKeys[Number(event.code.slice(5)) - 1] as MenuCommand);
        return;
      }
      if (preview && event.code === 'KeyN') {
        if (isTypingTarget(event.target) || dialogOpen()) return;
        event.preventDefault();
        commandRef.current('session-new');
        return;
      }
      if (key === '/' && preview) {
        event.preventDefault();
        if (!dialogOpen()) setShortcutsOpen(true);
      } else if (key === 'k') {
        // Mod+K always opens search. In a doc, Mod+L adds a link.
        event.preventDefault();
        // Mod+K closes the open palette, or opens it when no other dialog is open.
        if (searchOpenRef.current) setSearchOpen(false);
        else if (!dialogOpen()) openSearch();
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
  commandRef.current = (menuCommand) => {
    // The backend adds the newer commands to `menuCommands`. Compare them as text.
    const command: string = menuCommand;
    const goPage: Record<string, string> = {
      'go-overview': 'board',
      'go-tasks': 'tasks',
      'go-knowledge': 'knowledge',
      'go-docs': 'docs',
      'go-memory': 'memory',
    };
    if (command === 'back') navigationRef.current.back();
    else if (command === 'forward') navigationRef.current.forward();
    else if (command === 'new-project') {
      rememberTrigger();
      setCreateOpen(true);
    } else if (command === 'settings') openSettings();
    else if (command === 'search') openSearch();
    else if (command === 'toggle-sidebar') toggleSidebar();
    else if (command === 'close-tab') closeTab();
    else if (command === 'shortcuts') {
      rememberTrigger();
      setShortcutsOpen(true);
    } else if (command === 'add-code-folder') addCodeFolder();
    else if (command === 'new-task') newTask();
    else if (command === 'session-new' || command === 'new-chat') newChat();
    else if (goPage[command]) {
      const group = currentProjectGroup() || data.groups?.[0];
      const target = projectPageOf(goPage[command]);
      if (group && target) openGroup(group, target.page, target.section);
      else openOverview();
    } else if (command === 'go-insights') {
      // Insights moved: the usage of a project is a sheet now.
      const group = currentProjectGroup() || data.groups?.[0];
      if (group) openProjectUsage(group.id);
    } else if (command === 'go-computers') openComputers();
    else if (command === 'sign-in') signIn('login');
    else if (isChatCommand(command) || command.startsWith('session-')) sessionCommand(command);
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
      openSettings(
        (event as CustomEvent<{ section?: string }>).detail?.section || 'general',
        (event as CustomEvent<{ anchor?: string }>).detail?.anchor,
      );
    const onNewTask = (event: Event) => {
      // The board hears a forwarded event itself. Do not handle it again.
      if ((event as CustomEvent<{ forwarded?: boolean }>).detail?.forwarded) return;
      commandRef.current('new-task');
    };
    const onAddFolder = (event: Event) => {
      const detail = (event as CustomEvent<{ groupId?: string; source?: string }>).detail;
      addFolderRef.current(detail?.groupId, detail?.source === 'github' ? 'github' : undefined);
    };
    const onShortcuts = () => {
      if (dialogOpen()) return;
      rememberTrigger();
      setShortcutsOpen(true);
    };

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
    // Routing events from the pages. Each one reads the latest state through routeEvents.
    const handlers: [string, (event: Event) => void][] = [
      ['kalkidan-open-settings', onSettings],
      ['kalkidan-open-computers', (event) => routeEvents.current.openComputers(detailOf(event))],
      [
        'kalkidan-open-project-settings',
        (event) => routeEvents.current.openProjectSettings(detailOf(event)),
      ],
      ['kalkidan-new-task', onNewTask],
      ['kalkidan-add-code-folder', onAddFolder],
      ['kalkidan-show-shortcuts', onShortcuts],
      ['kalkidan-clone-progress', onClone],
      ['kalkidan-open-task', (event) => routeEvents.current.openTask(detailOf(event))],
      ['kalkidan-open-project-page', (event) => routeEvents.current.openPage(detailOf(event))],
      ['kalkidan-open-session', (event) => routeEvents.current.openSession(detailOf(event))],
      ['kalkidan-fork-chat', (event) => routeEvents.current.forkSession(detailOf(event))],
      ['kalkidan-new-session', (event) => void routeEvents.current.newSession(detailOf(event))],
      ['kalkidan-doc-selected', (event) => routeEvents.current.docSelected(detailOf(event))],
    ];
    for (const [name, handler] of handlers) window.addEventListener(name, handler);
    return () => {
      for (const [name, handler] of handlers) window.removeEventListener(name, handler);
    };
  }, []);
  /** Success notices show as toasts. Errors stay until the user closes them. */
  function notify(message: string, failed = false) {
    showToast(failed ? { message, tone: 'error' } : message);
  }
  // Async handlers read the latest snapshot through this ref.
  const dataRef = useRef(data);
  const refreshSequence = useRef(0);
  async function refresh() {
    const request = ++refreshSequence.current;
    const value = await api.snapshot();
    if (request !== refreshSequence.current) return;
    dataRef.current = value;
    setData(value);
    navigate((current) => reconcileRoute(current, value.groups || [], value.projects));
    setLastRepository((id) =>
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
  useEffect(() => {
    // Coalesce bursts of connection events into one library refresh.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribe = api.onRemoteHostsChange?.(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void reloadRef.current();
      }, 150);
    });
    return () => {
      clearTimeout(timer);
      unsubscribe?.();
    };
  }, [api]);
  // The first snapshot opens a deep link, else the page and the chats of the last run.
  const routed = useRef(false);
  useEffect(() => {
    if (routed.current || revision === 0) return;
    routed.current = true;
    if (location.hash.length > 1) {
      openDeepLink(location.hash.slice(1));
      return;
    }
    const groups = data.groups || [];
    const chats = (
      Array.isArray(readStored(routeKeyOf(openChatsStorageKey)))
        ? (readStored(routeKeyOf(openChatsStorageKey)) as unknown[])
        : []
    )
      .map((value) =>
        restoreRoute(
          { ...(value as object), kind: 'conversation', parent: { kind: 'home' } },
          groups,
          data.projects,
          data.sessions,
        ),
      )
      .flatMap((value) => (value?.kind === 'conversation' ? [value.session] : []));
    const saved = restoreRoute(
      readStored(routeKeyOf(routeStorageKey)),
      groups,
      data.projects,
      data.sessions,
    );
    if (saved?.kind === 'conversation') {
      setRestoredChats(chats);
      openConversation(saved.session, saved.parent);
    } else {
      if (saved) navigate(saved);
      if (chats.length) {
        // The chats show in "Open chats". The page stays where it was.
        setRestoredChats(chats);
        setChatSession(chats[0]);
      }
    }
  }, [revision]);
  // Save the page and the open chats, so the next launch opens them again.
  useEffect(() => {
    // Settings returns null and keeps the last saved page.
    const saved = saveableRoute(route);
    if (routed.current && saved) writeStored(routeKeyOf(routeStorageKey), saved);
  }, [routeKey(route)]);
  useEffect(() => {
    if (!routed.current) return;
    writeStored(
      routeKeyOf(openChatsStorageKey),
      openChats
        .filter((chat) => !chat.session.id.startsWith('draft-'))
        .map(({ session }) => ({ agent: session.agent, id: session.id, hostId: session.hostId })),
    );
  }, [openChats]);
  /**
   * Opens a link such as #session={"agent":"codex","id":"…"}, #task=groupId/itemId,
   * #doc=groupId/docId or #settings=accounts.
   */
  function openDeepLink(hash: string) {
    const [kind, ...rest] = hash.split('=');
    const raw = decodeURIComponent(rest.join('='));
    const pair = (): [string, string] | null => {
      try {
        const value = JSON.parse(raw) as Record<string, unknown>;
        const first = text(value.groupId);
        const second = text(value.itemId) || text(value.docId) || text(value.id);
        return first && second ? [first, second] : null;
      } catch {
        const index = raw.indexOf('/');
        return index > 0 ? [raw.slice(0, index), raw.slice(index + 1)] : null;
      }
    };
    if (kind === 'session') {
      try {
        const target = JSON.parse(raw) as { agent?: string; id?: string };
        const session = data.sessions.find((s) => s.id === target.id && s.agent === target.agent);
        if (session) openConversation(session);
        else setError('This chat is no longer available.');
      } catch {
        setError('This chat link is not valid.');
      }
    } else if (kind === 'task' || kind === 'doc') {
      const target = pair();
      const group = target && data.groups?.find((g) => g.id === target[0]);
      if (!target || !group) setError(`This ${kind === 'doc' ? 'doc' : 'task'} link is not valid.`);
      else if (kind === 'task')
        routeEvents.current.openTask({ groupId: group.id, itemId: target[1] });
      else
        routeEvents.current.openPage({
          groupId: group.id,
          page: 'knowledge',
          section: 'pages',
          docId: target[1],
        });
    } else if (kind === 'settings') openSettings(raw || 'general');
    else setError('This link is not valid.');
  }
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
  // A connected board whose sign-in stopped working. The button opens the board in Settings.
  const signInLost =
    !!connectionKey && verifiedConnection.key === connectionKey && !verifiedConnection.ready;
  // Status dots for open chats that work, wait for approval or wait for an answer.
  const sessionActivity: Record<string, SessionActivityState> = {};
  const repoActivity: Record<string, SessionActivityState> = {};
  for (const item of activity) {
    sessionActivity[activityKey(item.agent, item.id)] = item.state;
    const repo = sessionRepo(item, data.projects);
    if (repo) repoActivity[repo.id] = strongestActivity([repoActivity[repo.id], item.state])!;
  }
  const boards = useProjectBoards(api, data.groups || [], revision);
  // The chats of the tree: the drafts that are not saved yet, then the saved chats.
  const treeSessions = [
    ...drafts.filter((d) => !data.sessions.some((s) => s.agent === d.agent && s.id === d.id)),
    ...data.sessions,
  ];
  // The identity color of every project, code folder, chat and subagent.
  const identity = useWorkspaceIdentity(data.groups || [], data.projects, treeSessions);
  // OS notifications: an agent asks for approval, asks a question, or finishes while the
  // window is not focused. A run that finishes out of view is marked for "Needs you".
  const previousActivity = useRef(new Map<string, SessionActivity>());
  useEffect(() => {
    publishActivity(activity);
    const before = previousActivity.current;
    const now = new Map(activity.map((item) => [activityKey(item.agent, item.id), item]));
    previousActivity.current = now;
    const sessionOf = (item: { agent: string; id: string }) =>
      [...drafts, ...data.sessions].find((s) => s.agent === item.agent && s.id === item.id);
    const titleOf = (item: { agent: string; id: string }) => {
      const session = sessionOf(item);
      return session?.organization?.title || session?.title || 'Agent chat';
    };
    const focused = document.hasFocus();
    for (const [key, item] of now) {
      const agent = agentLabel(item.agent as Agent);
      if (focused || item.state === 'running' || before.get(key)?.state === item.state) continue;
      void api.notify?.({
        kind: 'needs-input',
        title:
          item.state === 'question' ? `${agent} asks a question` : `${agent} needs your approval`,
        body: titleOf(item),
        target: notificationTarget(item),
      });
    }
    for (const [key, item] of before) {
      if (now.has(key) || item.state !== 'running') continue;
      const visible = focused && chatOpenRef.current && sameChat(item, chatSessionRef.current!);
      if (!visible) markFinished(item.agent, item.id);
      if (focused) continue;
      const session = sessionOf(item);
      const task = session && sessionTask(session, boards);
      const repo = sessionRepo(item, data.projects);
      // "Task #12 · 4 files changed". Each part shows only when it is known.
      void Promise.resolve()
        .then(() => (repo ? api.workingStatus?.(repo.id) : undefined))
        .catch(() => undefined)
        .then((status) => {
          const files = status ? status.changed + status.untracked : 0;
          const parts = [
            task?.number ? `Task #${task.number}` : task ? `Task: ${task.title}` : '',
            files ? plural(files, 'file') + ' changed' : '',
          ].filter(Boolean);
          void api.notify?.({
            kind: 'finished',
            title: `${agentLabel(item.agent as Agent)} finished`,
            body: parts.length ? `${titleOf(item)} · ${parts.join(' · ')}` : titleOf(item),
            target: notificationTarget(item, files > 0),
          });
        });
    }
    void api.setBadgeCount?.(activity.filter((item) => waitsForUser(item.state)).length);
  }, [activity]);
  const openRef = useRef<(session: Session) => void>(() => {});
  useEffect(
    () =>
      api.onNotificationClick?.((target) => {
        try {
          const { agent, id, review } = JSON.parse(target) as {
            agent: string;
            id: string;
            review?: boolean;
          };
          const session =
            openChats.find((chat) => chat.session.agent === agent && chat.session.id === id)
              ?.session || data.sessions.find((s) => s.agent === agent && s.id === id);
          if (!session) return;
          openRef.current(session);
          // A finished run with changes opens at the review controls.
          if (review) sessionCommandLater('session-changes');
        } catch {
          /* A notification from an older version has no session target. */
        }
      }),
    [api, openChats, data.sessions],
  );
  /**
   * Shows a code folder: the Overview of its project, with the code folder open in the tree.
   * The code folder has no page of its own.
   */
  function openProject(p: Project) {
    setLastRepository(p.id);
    const group = data.groups?.find((g) => g.repoIds.includes(p.id));
    if (group) openGroup(group);
  }
  // A docs page or task chosen in search. The panel opens it once after it loads.
  const [searchTarget, setSearchTarget] = useState<{
    page?: string;
    task?: string;
    topic?: string;
    heading?: string;
  }>({});
  function openGroup(group: ProjectGroup, page: ProjectPage = 'board', section?: KnowledgeSection) {
    // Knowledge has no Insights any more. Board health and GitHub checks are on Tasks.
    if (page === 'knowledge' && section === 'insights') {
      page = 'tasks';
      section = undefined;
    }
    navigate({
      kind: 'project',
      groupId: group.id,
      page,
      ...(page === 'knowledge' && section ? { section } : {}),
    });
  }
  /** Opens Settings at Tools, at a row such as a host. Older anchors open their new place. */
  function openComputers(anchor?: string) {
    openSettings('computers', anchor);
  }
  /** Opens the Projects page. A project window has one project: it opens its Overview. */
  function openOverview() {
    if (scopeGroup) navigate({ kind: 'project', groupId: scopeGroup, page: 'board' });
    else navigate({ kind: 'home' });
  }
  /** Opens a project in its own window, or moves its window to the front. */
  function openProjectWindow(group: ProjectGroup) {
    if (typeof api.openProjectWindow !== 'function') {
      showToast('Open the desktop app to open a project in its own window.');
      return;
    }
    void Promise.resolve()
      .then(() => api.openProjectWindow!(group.id))
      .catch((e) => setError(`Could not open the ${group.name} window: ${errorText(e)}`));
  }
  // The projects that show in their own window. The main window keeps their rows closed.
  const [windowed, setWindowed] = useState<string[]>([]);
  useEffect(() => {
    if (scopeGroup || typeof api.projectWindows !== 'function') return;
    let live = true;
    Promise.resolve()
      .then(() => api.projectWindows!())
      .then((list) => live && setWindowed(list))
      .catch(() => undefined);
    const stop = api.onProjectWindowsChange?.((list) => setWindowed(list));
    return () => {
      live = false;
      stop?.();
    };
  }, [api, scopeGroup]);
  /** The project of the current page, or the only project. */
  function currentProjectGroup() {
    if (scopeGroup) return data.groups?.find((g) => g.id === scopeGroup);
    if (boardGroup) return data.groups?.find((g) => g.id === boardGroup);
    const repo = chatOpen && chatSession ? sessionRepo(chatSession, data.projects) : project;
    if (!home && repo) return data.groups?.find((g) => g.repoIds.includes(repo.id));
    return data.groups?.length === 1 ? data.groups[0] : undefined;
  }
  // The sidebar opens its Add code folders dialog for each new request.
  const [addFolderRequest, setAddFolderRequest] = useState<{
    groupId: string;
    at: number;
    source?: 'github';
  }>();
  /**
   * Opens the Add code folders dialog of a project, on the GitHub source for "Clone from
   * GitHub". The sidebar keeps the dialog.
   */
  function addCodeFolder(groupId?: string, source?: 'github') {
    const group = groupId
      ? data.groups?.find((g) => g.id === groupId)
      : currentProjectGroup() || data.groups?.[0];
    if (!group) {
      setCreateOpen(true);
      return;
    }
    setAddFolderRequest({ groupId: group.id, at: Date.now(), source });
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
    const mounted = !!boardGroup && boardGroup === group.id && projectPage === 'tasks';
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
  /**
   * New chat (Mod+N): starts a chat in the code folder of the open chat or page. In a project,
   * it uses the code folder of its latest chat. Elsewhere, the code folder of the latest chat.
   */
  function newChat(agent: Agent = preferredAgent) {
    const chatRepo = chatOpen && chatSession ? sessionRepo(chatSession, data.projects) : undefined;
    if (chatRepo) return startSession(agent, chatRepo, chatSession?.cwd);
    const group = !home ? currentProjectGroup() : undefined;
    if (group) return newChatIn(group, agent);
    const repo = recentRepo(data.projects, data.sessions);
    if (repo) return startSession(agent, repo);
    // Without a project, the Projects page is the first composer.
    if (data.groups?.length) addCodeFolder();
    else openOverview();
  }
  /** Starts a chat in the code folder of the latest chat of a project. */
  function newChatIn(group: ProjectGroup, agent: Agent = preferredAgent) {
    const members = data.projects.filter((p) => group.repoIds.includes(p.id));
    const repo = recentRepo(members, data.sessions);
    if (repo) startSession(agent, repo);
    else addCodeFolder(group.id);
  }
  /** Starts the Verdictan sign-in. The sign-in flow shows the steps. */
  function signIn(intent: 'login' | 'register') {
    window.dispatchEvent(new CustomEvent('kalkidan-sign-in', { detail: { intent } }));
  }
  /** Sends a command to the session menu of the open chat. With `session`, opens it first. */
  function sessionCommand(command: string, session?: Session) {
    if (session && !(chatOpen && sameChat(chatSession, session))) {
      openConversation(session);
      sessionCommandLater(command);
      return;
    }
    if (!chatOpen) {
      showToast('Open a chat first. Then try again.');
      return;
    }
    window.dispatchEvent(new CustomEvent('kalkidan-session-command', { detail: { command } }));
  }
  /** Sends a session command after the chat that opens now has its menu. */
  function sessionCommandLater(command: string) {
    setTimeout(
      () =>
        window.dispatchEvent(new CustomEvent('kalkidan-session-command', { detail: { command } })),
      250,
    );
  }
  /** Opens a project page and then sends an event to the page that opens there. */
  /** The Knowledge page that shows now, from `kalkidan-doc-selected`. */
  const [openDoc, setOpenDoc] = useState<{ groupId: string; docId: string } | null>(null);
  /**
   * Opens Knowledge of the project (at Pages when `pages` is true), then sends a Knowledge event.
   * While that view shows, the event goes at once.
   */
  function knowledgeThen(group: ProjectGroup, event: string, pages = false) {
    const detail = { groupId: group.id };
    const shows =
      route.kind === 'project' && route.groupId === group.id && route.page === 'knowledge';
    if (shows && (!pages || route.section !== 'memory')) {
      window.dispatchEvent(new CustomEvent(event, { detail }));
      return;
    }
    routeEvents.current.openPage({
      groupId: group.id,
      page: 'knowledge',
      ...(pages ? { section: 'pages' } : {}),
    });
    setTimeout(() => window.dispatchEvent(new CustomEvent(event, { detail })), 120);
  }
  function openPageThen(group: ProjectGroup, page: ProjectPage, event: string, detail: object) {
    openGroup(group, page);
    setTimeout(() => window.dispatchEvent(new CustomEvent(event, { detail })), 60);
  }
  // Window events from the pages. They read the latest state through this ref.
  const routeEvents = useRef({
    openTask: (_: Record<string, unknown>) => {},
    openPage: (_: Record<string, unknown>) => {},
    openSession: (_: Record<string, unknown>) => {},
    forkSession: (_: Record<string, unknown>) => {},
    newSession: async (_: Record<string, unknown>) => {},
    docSelected: (_: Record<string, unknown>) => {},
    openComputers: (_: Record<string, unknown>) => {},
    openProjectSettings: (_: Record<string, unknown>) => {},
  });
  routeEvents.current = {
    openTask: (detail) => {
      const group = data.groups?.find((g) => g.id === detail.groupId);
      const itemId = text(detail.itemId);
      if (!group || !itemId) return;
      setSearchTarget({ task: itemId });
      const task = boards[group.id]?.items.find((item) => item.id === itemId);
      recordRecentItem({
        kind: 'task',
        id: itemId,
        groupId: group.id,
        title: task ? `${task.number ? `#${task.number} ` : ''}${task.title}` : 'Task',
      });
      openGroup(group, 'tasks');
    },
    openPage: (detail) => {
      // A project that was just created is in the latest snapshot before the next render.
      const group = (dataRef.current.groups || data.groups)?.find((g) => g.id === detail.groupId);
      // 'docs', 'memory' and 'insights' are sections of Knowledge now.
      const target = projectPageOf(detail.page) || { page: 'board' as const };
      const section =
        target.section || projectPageOf(detail.section)?.section || sectionOf(detail.section);
      if (!group) return;
      // The older Insights links: usage opens the Usage sheet, the others open Tasks.
      if (target.page === 'knowledge' && section === 'insights') {
        if (detail.view === 'usage' || text(detail.taskId))
          return openProjectUsage(group.id, text(detail.taskId));
        if (detail.view === 'github')
          return openPageThen(group, 'tasks', 'kalkidan-check-github-writes', {
            groupId: group.id,
          });
        return openGroup(group, 'tasks');
      }
      // The event is the source of truth for the route. Its targets go to the panels.
      if (text(detail.docId) || text(detail.topic) || text(detail.heading) || text(detail.taskId))
        setSearchTarget({
          page: text(detail.docId),
          topic: text(detail.topic),
          heading: text(detail.heading),
          task: text(detail.taskId),
        });
      openGroup(group, target.page, target.page === 'knowledge' ? section : undefined);
    },
    openSession: (detail) => {
      const session =
        openChats.find(
          (chat) => chat.session.agent === detail.agent && chat.session.id === detail.id,
        )?.session ||
        [...drafts, ...data.sessions].find((s) => s.agent === detail.agent && s.id === detail.id);
      if (session) openConversation(session);
      else setError('This chat is no longer available.');
    },
    forkSession: (detail) => {
      const session =
        openChats.find(
          (chat) => chat.session.agent === detail.agent && chat.session.id === detail.id,
        )?.session || data.sessions.find((s) => s.agent === detail.agent && s.id === detail.id);
      if (session && !session.id.startsWith('draft-')) setForkSource(session);
      else setError('This chat is no longer available.');
    },
    newSession: async (detail) => {
      // The board can create a branch copy just before it sends this event. Read the latest
      // snapshot, and refresh once when the code folder is not in it yet.
      const latest = dataRef.current;
      const repoId = text(detail.repoId);
      if (repoId && !latest.projects.some((p) => p.id === repoId) && !detail.retried) {
        await refresh().catch(() => undefined);
        // Run again with the handlers of the next render, which see the new snapshot.
        await new Promise((resolve) => setTimeout(resolve, 0));
        return routeEvents.current.newSession({ ...detail, retried: true });
      }
      const group =
        latest.groups?.find((g) => g.id === detail.groupId) ||
        latest.groups?.find((g) => g.repoIds.includes(repoId || ''));
      const repo =
        latest.projects.find((p) => p.id === repoId) ||
        (group && latest.projects.find((p) => group.repoIds.includes(p.id)));
      if (!repo) {
        // "New chat" in a project without code folders opens Add code folders at once.
        if (group && !repoId && !detail.taskId) {
          addCodeFolder(group.id);
          return;
        }
        showToast({
          message: 'Add a code folder to this project first. Agents work in a code folder.',
          actions: [{ label: 'Add code folder…', onClick: () => addCodeFolder(group?.id) }],
        });
        return;
      }
      const requested = agentCatalog.find((item) => item.id === detail.agent)?.id;
      const agent = requested && agentInstalled(requested) ? requested : preferredAgent;
      const taskId = text(detail.taskId);
      const task = taskId
        ? Object.values(boards)
            .flatMap((board) => board.items)
            .find((item) => item.id === taskId)
        : undefined;
      const prompt = text(detail.prompt);
      const draft = newSession(agent, repo, task, prompt);
      if (!draft) return;
      const docIds = Array.isArray(detail.docIds)
        ? detail.docIds.filter((id): id is string => typeof id === 'string')
        : [];
      // `send` asks the chat to send the prompt at once, as its first message.
      setPendingDraft(activityKey(draft.agent, draft.id), {
        prompt,
        docIds,
        groupId: group?.id || latest.groups?.find((g) => g.repoIds.includes(repo.id))?.id,
        taskId,
        ...(detail.send === true && prompt ? { send: true } : {}),
      });
    },
    docSelected: (detail) => {
      const groupId = text(detail.groupId);
      const docId = text(detail.docId);
      // ⌘K "Ask agent about this page" needs the page that shows now.
      setOpenDoc(groupId && docId ? { groupId, docId } : null);
      if (groupId && docId)
        recordRecentItem({ kind: 'doc', id: docId, groupId, title: text(detail.title) || '' });
    },
    openComputers: (detail) => openComputers(text(detail.anchor)),
    // The project section of the one Settings window. Without a project, the current one.
    openProjectSettings: (detail) => {
      const id = text(detail.groupId) || currentProjectGroup()?.id;
      if (id) openSettings('project:' + id, text(detail.tab) || text(detail.section));
    },
  };
  // Closing a session returns to the view before it. Without history, show the repository.
  function closeConversation() {
    if (navigation.canBack) navigation.back();
    else navigate((current) => (current.kind === 'conversation' ? current.parent : current));
  }
  const currentGroup = boardGroup ? data.groups?.find((g) => g.id === boardGroup) : undefined;
  const groupOfRepo = (repo?: Project) =>
    repo ? data.groups?.find((g) => g.repoIds.includes(repo.id)) : undefined;
  const pageNames: Record<ProjectPage, string> = Object.fromEntries(
    projectTabs.map((tab) => [tab.page, tab.label]),
  ) as Record<ProjectPage, string>;
  openRef.current = (session: Session) => openConversation(session);
  function openConversation(session: Session, parentPage?: WorkspacePage) {
    const repo = sessionRepo(session, data.projects);
    if (repo) setLastRepository(repo.id);
    const parent =
      parentPage ||
      (basePage.kind === 'project' &&
      data.groups?.find((group) => group.id === basePage.groupId)?.repoIds.includes(repo?.id || '')
        ? basePage
        : groupOfRepo(repo)
          ? { kind: 'project' as const, groupId: groupOfRepo(repo)!.id, page: 'board' as const }
          : { kind: 'home' as const });
    markSeen(session.agent, session.id);
    recordRecentItem({
      kind: 'chat',
      id: session.id,
      agent: session.agent,
      hostId: session.hostId,
      title: session.organization?.title || session.title,
    });
    setChatSession(session);
    navigate({ kind: 'conversation', session, repositoryId: repo?.id, parent });
  }
  function newSession(
    agent: Agent,
    repo = project,
    task?: TrackerItem,
    initialPrompt?: string,
    cwd = repo?.path,
  ): Session | undefined {
    if (!repo) return;
    if (!agentInstalled(agent)) {
      agentMissing(agent, (other) => newSession(other, repo, task, initialPrompt, cwd));
      return;
    }
    setLastRepository(repo.id);
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
      // A task chat has the name of its task. The agent icon shows the agent.
      title: task?.title || 'New chat',
      updatedAt: new Date().toISOString(),
    };
    setDrafts((previous) => [...previous, draft]);
    openConversation(draft);
    return draft;
  }
  /**
   * Opens a new chat that forks a chat. The first message gives the history of the source to
   * the agent as context. The draft keeps the link to the source.
   */
  function forkSession(source: Session, choice: ForkChoice) {
    const { agent, folder } = choice;
    if (!folder.hostId && !agentInstalled(agent)) {
      agentMissing(agent, (other) => forkSession(source, { ...choice, agent: other }));
      return;
    }
    setForkSource(null);
    const draft = forkDraft(
      { agent: source.agent, id: source.id, title: sessionTitle(source) },
      agent,
      folder,
      'draft-' + crypto.randomUUID(),
      new Date(),
      choice.lastMessageId,
    );
    setDrafts((previous) => [...previous, draft]);
    openConversation(draft);
  }
  /** Adds a new fork to the "Forked to" links of its source chat. */
  async function linkFork(draft: Session, id: string) {
    const source = draft.forkOf;
    if (!source) return;
    const current = data.sessions.find((s) => s.agent === source.agent && s.id === source.id);
    try {
      await api.updateSession(source.agent, source.id, {
        forks: addForkLink(current?.organization?.forks, {
          agent: draft.agent,
          id,
          title: draft.organization?.title || draft.title,
        }),
      });
      await refresh();
    } catch (e) {
      setError(
        'The fork is saved, but its link in the source chat could not be saved: ' + errorText(e),
      );
    }
  }
  /** Tells the user that an agent is not installed, and offers the other agent. */
  function agentMissing(agent: Agent, retry: (agent: Agent) => void) {
    const other = agentCatalog.find((item) => item.id !== agent && agentInstalled(item.id))?.id;
    showToast({
      message: `${agentLabel(agent)} is not installed on this computer.`,
      tone: 'error',
      actions: [
        ...(other
          ? [
              {
                label: `Use ${agentLabel(other)}`,
                onClick: () => {
                  savePreferredAgent(other);
                  retry(other);
                },
              },
            ]
          : []),
        { label: `Install ${agentLabel(agent)}`, onClick: () => openComputers() },
      ],
    });
  }
  // The split button starts the preferred agent. Settings and every "New chat" menu change
  // the preference. An agent that is not installed is never the default.
  const [preferredAgent, setPreferredAgent] = useState<Agent>(readPreferredAgent);
  useEffect(() => onPreferredAgentChange(setPreferredAgent), []);
  useEffect(() => {
    if (!preview) void loadAgentInstallations(() => api.agentInstallations());
  }, [api]);
  function startSession(agent: Agent, repo = project, cwd?: string) {
    if (agentInstalled(agent)) savePreferredAgent(agent);
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
  /** The pull request that a chat in this code folder opened, if any. */
  const pullRequestOf = (repo: Project) =>
    data.sessions.find(
      (s) => sessionRepo(s, data.projects)?.id === repo.id && s.organization?.pullRequest,
    )?.organization?.pullRequest;
  /** The menu of a code folder row in the tree: the work that a code folder page had. */
  function repoActions(repo: Project): TreeAction[] {
    const icon = (Icon: LucideIcon) => <Icon className="size-4" />;
    const pull = pullRequestOf(repo);
    const parent = worktreeParent(repo, data.projects);
    return [
      {
        label: 'New chat here',
        icon: icon(SquarePen),
        action: () => startSession(preferredAgent, repo),
      },
      ...(!repo.hostId
        ? [
            {
              label: revealLabel(),
              icon: icon(FolderOpen),
              action: () => void run(() => api.reveal(repo.id)),
            },
            {
              label: 'Open in Terminal app',
              icon: icon(Terminal),
              action: () => void run(() => api.launch(repo.id, 'terminal'), 'Opened in Terminal.'),
            },
          ]
        : []),
      {
        label: 'New branch copy…',
        icon: icon(GitBranch),
        separator: true,
        action: () => {
          setBranch('');
          openModal('worktree', repo.id);
        },
      },
      ...(pull
        ? [
            {
              label: pull.number ? `View pull request #${pull.number}` : 'View pull request',
              icon: icon(GitPullRequest),
              action: () => void window.open(pull.url, '_blank', 'noreferrer'),
            },
          ]
        : []),
      {
        label: 'Edit code folder…',
        icon: icon(Pencil),
        separator: true,
        action: () => editRepository(repo),
      },
      parent
        ? {
            label: 'Delete branch copy…',
            icon: icon(Trash2),
            destructive: true,
            action: () => deleteBranchCopy(repo, worktreeBranch(repo, parent)),
          }
        : {
            label: 'Remove code folder…',
            icon: icon(Trash2),
            destructive: true,
            action: () => {
              rememberTrigger();
              openModal('remove', repo.id);
            },
          },
    ];
  }
  const currentRepoForActions =
    chatOpen && chatSession ? sessionRepo(chatSession, data.projects) : !home ? project : undefined;
  const actionGroup = currentProjectGroup();
  // Saved GitHub views of the current project, for "View: …" in search.
  const [savedViews, setSavedViews] = useState<{ groupId: string; views: SavedView[] }>({
    groupId: '',
    views: [],
  });
  const viewsGroup = actionGroup && trackerConnection(actionGroup) ? actionGroup.id : '';
  useEffect(() => {
    let live = true;
    if (!viewsGroup || typeof api.trackerResources !== 'function') return;
    Promise.resolve()
      .then(() => api.trackerResources(viewsGroup, 'views'))
      .then((snapshot) => {
        if (live)
          setSavedViews({
            groupId: viewsGroup,
            views: snapshot.records.map((record) => ({
              id: String(record.id),
              name: String(record.name),
            })),
          });
      })
      .catch(() => {
        /* Without views, search shows no "View:" actions. */
      });
    return () => {
      live = false;
    };
  }, [api, viewsGroup, revision]);
  function openView(group: ProjectGroup, view: SavedView) {
    openPageThen(group, 'tasks', 'kalkidan-board-view', { groupId: group.id, viewId: view.id });
  }
  function planningTool(group: ProjectGroup, tool: string) {
    openPageThen(group, 'tasks', 'kalkidan-planning-tool', { groupId: group.id, tool });
  }
  const inProject = (group: ProjectGroup | undefined, label: string) =>
    group && (data.groups?.length || 0) > 1 ? `${label} in ${group.name}` : label;
  // Each action has its own icon. Chat actions use the icon of the chat menu.
  const chatIcons: Record<string, LucideIcon> = {
    rename: Pencil,
    pin: Pin,
    'link-task': Link2,
    'open-linked-task': ListChecks,
    notes: Pencil,
    commit: Check,
    'open-pull-request': GitPullRequest,
    'create-pull-request': GitPullRequest,
    'view-pull-request': GitPullRequest,
    duplicate: MessageSquare,
    'show-folder': FolderOpen,
    'save-to-docs': FilePlus2,
    'export-markdown': Download,
    'export-html': Download,
    'usage-history': Activity,
    archive: Trash,
  };
  const chatActions: SearchAction[] = chatOpen
    ? [
        {
          key: 'chat-changes',
          label: 'Show changes',
          keywords: 'diff review files',
          shortcut: shortcutLabel(['mod', 'shift'], 'G'),
          icon: <GitCompare />,
          run: () => sessionCommand('session-changes'),
        },
        // The chat actions come from the one chat action list. The chat menu checks each one.
        ...(chatSession
          ? leafChatActions(
              chatActionMenu(
                'palette',
                sessionActionState(chatSession, {
                  open: true,
                  usageHistory: typeof api.managedHistory === 'function',
                }),
                platform,
              ),
            )
          : []
        ).flatMap((action) => {
          const Icon = chatIcons[action.id] || MessageSquare;
          return action.command
            ? [
                {
                  key: `chat-${action.id}`,
                  label: action.label,
                  keywords: action.keywords || '',
                  icon: <Icon />,
                  run: () => sessionCommand(action.command!),
                },
              ]
            : [];
        }),
        {
          key: 'chat-terminal',
          label: 'Open terminal',
          keywords: 'shell console',
          shortcut: shortcutLabel([isMac ? 'ctrl' : 'mod'], '`'),
          icon: <Terminal />,
          run: () => sessionCommand('session-terminal'),
        },
        {
          key: 'chat-branch-copy',
          label: 'New branch copy…',
          keywords: 'worktree branch',
          icon: <GitBranch />,
          run: () => {
            const repo = chatSession && sessionRepo(chatSession, data.projects);
            if (!repo) return;
            setBranch('');
            openModal('worktree', repo.id);
          },
        },
      ]
    : [];
  const projectPageActions: SearchAction[] = (data.groups || []).flatMap((group) =>
    projectTabs.map(({ page }, index) => ({
      key: `go-${page}-${group.id}`,
      label:
        (data.groups?.length || 0) > 1
          ? `Go to ${pageNames[page]} of ${group.name}`
          : `Go to ${pageNames[page]}`,
      keywords: `open ${page === 'board' ? 'overview home project' : page} ${
        page === 'knowledge' ? 'docs pages memory facts insights' : ''
      }`,
      shortcut:
        group.id === actionGroup?.id ? shortcutLabel(['mod'], String(index + 1)) : undefined,
      icon: <Folder />,
      run: () => openGroup(group, page),
    })),
  );
  // Board actions show only for a project with a connected board.
  const boardReady = !!actionGroup && !!trackerConnection(actionGroup);
  const projectToolActions: SearchAction[] = actionGroup
    ? [
        // Knowledge actions of the project in view (KN-B). The Knowledge view handles them.
        {
          key: 'knowledge-find',
          label: inProject(actionGroup, 'Find in knowledge'),
          keywords: 'search docs pages memory wiki',
          shortcut: shortcutLabel(['mod'], 'F'),
          icon: <Search />,
          run: () => knowledgeThen(actionGroup, knowledgeFindEvent),
        },
        {
          key: 'new-page',
          label: inProject(actionGroup, 'New page'),
          keywords: 'docs wiki write note knowledge',
          shortcut: shortcutLabel(['alt', 'mod'], 'N'),
          icon: <FilePlus2 />,
          run: () => knowledgeThen(actionGroup, newPageEvent, true),
        },
        {
          key: 'knowledge-deleted',
          label: inProject(actionGroup, 'Recently deleted…'),
          keywords: 'restore trash deleted pages docs knowledge',
          icon: <ArchiveRestore />,
          run: () => knowledgeThen(actionGroup, recentlyDeletedEvent, true),
        },
        ...(openDoc?.groupId === actionGroup.id &&
        route.kind === 'project' &&
        route.groupId === actionGroup.id &&
        route.page === 'knowledge'
          ? [
              {
                key: 'knowledge-ask',
                label: 'Ask agent about this page',
                keywords: 'chat agent page doc knowledge question',
                icon: <MessageSquarePlus />,
                run: () =>
                  window.dispatchEvent(
                    new CustomEvent('kalkidan-new-session', {
                      detail: { groupId: actionGroup.id, docIds: [openDoc.docId] },
                    }),
                  ),
              },
            ]
          : []),
        ...(boardReady
          ? [
              {
                key: 'new-task',
                label: inProject(actionGroup, 'New task'),
                keywords: 'issue board',
                shortcut: shortcutLabel(['mod', 'shift'], 'K'),
                icon: <ListPlus />,
                run: newTask,
              },
              {
                key: 'plan-iteration',
                label: inProject(actionGroup, 'Plan an iteration…'),
                keywords: 'sprint planning cycle',
                icon: <CalendarRange />,
                run: () => planningTool(actionGroup, 'iteration'),
              },
              {
                key: 'edit-fields',
                label: inProject(actionGroup, 'Edit task fields…'),
                keywords: 'bulk batch change fields estimate',
                icon: <ListChecks />,
                run: () => planningTool(actionGroup, 'fields'),
              },
              ...(['board', 'list'] as const).map((layout) => ({
                key: `board-layout-${layout}`,
                label: inProject(
                  actionGroup,
                  layout === 'list' ? 'Show tasks as list' : 'Show tasks as board',
                ),
                keywords: 'tasks view layout',
                icon: layout === 'list' ? <Rows3 /> : <Layers2 />,
                run: () =>
                  openPageThen(actionGroup, 'tasks', 'kalkidan-board-layout', {
                    groupId: actionGroup.id,
                    layout,
                  }),
              })),
              {
                key: 'docs-to-issues',
                label: inProject(actionGroup, 'Make tasks from a page…'),
                keywords: 'issues plan docs',
                icon: <FileInput />,
                run: () => planningTool(actionGroup, 'docs-to-issues'),
              },
              {
                key: 'write-history',
                label: inProject(actionGroup, 'GitHub changes to check'),
                keywords: 'insights write history changes github undo confirm',
                icon: <History />,
                run: () =>
                  openPageThen(actionGroup, 'tasks', 'kalkidan-check-github-writes', {
                    groupId: actionGroup.id,
                  }),
              },
              {
                key: 'board-settings',
                label: inProject(actionGroup, 'Board settings…'),
                keywords: 'fields views workflows github automation',
                icon: <Layers2 />,
                run: () =>
                  window.dispatchEvent(
                    new CustomEvent('kalkidan-open-board-settings', {
                      detail: { groupId: actionGroup.id },
                    }),
                  ),
              },
            ]
          : [
              {
                key: 'connect-board',
                label: inProject(actionGroup, 'Connect board…'),
                keywords: 'github projects tasks tracker',
                icon: <Layers2 />,
                run: () => openConnectBoard({ groupId: actionGroup.id }),
              },
            ]),
        {
          key: 'usage',
          label: inProject(actionGroup, 'Usage…'),
          keywords: 'usage requests tokens cost models runs insights',
          icon: <Activity />,
          run: () => openProjectUsage(actionGroup.id),
        },
        {
          key: 'project-settings',
          label: inProject(actionGroup, 'Project settings…'),
          keywords: 'rename code folders board automation',
          icon: <Settings2 />,
          run: () =>
            window.dispatchEvent(
              new CustomEvent('kalkidan-open-project-settings', {
                detail: { groupId: actionGroup.id },
              }),
            ),
        },
        ...(!scopeGroup
          ? [
              {
                key: 'open-window',
                label: inProject(actionGroup, 'Open project in new window'),
                keywords: 'window separate dedicated',
                shortcut: shortcutLabel(['shift'], '↵'),
                icon: <AppWindow />,
                run: () => openProjectWindow(actionGroup),
              },
            ]
          : []),
        ...(savedViews.groupId === actionGroup.id && boardReady
          ? savedViews.views.map((view) => ({
              key: 'view-' + view.id,
              label: `View: ${view.name}`,
              keywords: 'saved github board filter',
              icon: <Eye />,
              run: () => openView(actionGroup, view),
            }))
          : []),
      ]
    : [];
  // New chat: here, with each agent, and in each code folder.
  const chatStartActions: SearchAction[] = data.projects.length
    ? [
        {
          key: 'new-chat',
          label: 'New chat',
          keywords: `start chat agent session conversation ${currentRepoForActions?.name || ''}`,
          shortcut: shortcutLabel(['mod'], 'N'),
          icon: <SquarePen />,
          run: () => newChat(),
        },
        ...agentCatalog.map(({ id: agent }) => ({
          key: 'new-chat-' + agent,
          label: agentMenuLabel(agent, `New ${agentLabel(agent)} chat`),
          keywords: 'new chat start agent session',
          icon: <AgentIcon agent={agent} />,
          run: () => newChat(agent),
        })),
        ...data.projects.map((repo) => ({
          key: 'new-chat-in-' + repo.id,
          label: `New chat in ${repo.name}`,
          // Only the code folder name finds it, not the name of its project.
          keywords: 'start chat agent code folder',
          icon: <MessageSquare />,
          run: () => startSession(preferredAgent, repo),
        })),
      ]
    : [];
  const searchActions: SearchAction[] = [
    ...chatStartActions,
    ...chatActions,
    ...projectToolActions,
    ...projectPageActions,
    {
      key: 'add-folder',
      label: 'Add code folder…',
      keywords: 'repository import open folder clone github',
      shortcut: shortcutLabel(['mod', 'shift'], 'O'),
      icon: <FolderPlus />,
      run: () => addCodeFolder(),
    },
    {
      // "Add code folder…" opens the folder picker for a local project, so cloning needs its
      // own entry.
      key: 'clone-folder',
      label: 'Clone from GitHub…',
      keywords: 'repository code folder add clone github',
      icon: <FolderPlus />,
      run: () => addCodeFolder(undefined, 'github'),
    },
    {
      key: 'new-project',
      label: 'New project…',
      keywords: 'create',
      shortcut: shortcutLabel(['mod', 'shift'], 'N'),
      icon: <FolderPlus />,
      run: () => {
        rememberTrigger();
        setCreateOpen(true);
      },
    },
    {
      key: 'tools',
      label: 'Tools…',
      keywords: 'settings ssh remote hosts agents codex claude github cli gh installed',
      icon: <Terminal />,
      run: () => openSettings('tools'),
    },
    ...(!signedIn
      ? [
          {
            key: 'sign-in',
            label: 'Sign in to Verdictan',
            keywords: 'account login verdictan gateway',
            icon: <LogIn />,
            run: () => signIn('login'),
          },
          {
            key: 'register',
            label: 'Create a Verdictan account',
            keywords: 'register sign up account',
            icon: <UserPlus />,
            run: () => signIn('register'),
          },
        ]
      : []),
    {
      key: 'settings',
      label: 'Settings…',
      keywords: 'settings preferences',
      shortcut: shortcutLabel(['mod'], ','),
      icon: <Settings2 />,
      run: () => openSettings(),
    },
    ...agentCatalog.map(({ id: agent }) => ({
      key: 'default-agent-' + agent,
      label: `Change default agent to ${agentLabel(agent)}`,
      keywords: 'prefer default agent new chats',
      icon: <AgentIcon agent={agent} />,
      run: () => {
        if (!agentInstalled(agent)) return openComputers();
        savePreferredAgent(agent);
        showToast(`New chats now use ${agentLabel(agent)}.`);
      },
    })),
    {
      key: 'github',
      label: 'Connect GitHub',
      keywords: 'sign in account',
      icon: <FolderGit2 />,
      // The GitHub CLI row of Settings › Tools shows the GitHub state and its install guide.
      run: () => openSettings('tools', settingsAnchors.github),
    },
    {
      key: 'support-bundle',
      label: 'Support bundle…',
      keywords: 'diagnostics help logs export',
      icon: <Download />,
      run: openDiagnostics,
    },
    {
      key: 'shortcuts',
      label: 'Keyboard shortcuts',
      keywords: 'keys help',
      shortcut: shortcutLabel(['mod'], '/'),
      icon: <Keyboard />,
      run: () => {
        rememberTrigger();
        setShortcutsOpen(true);
      },
    },
    {
      key: 'sidebar',
      label: 'Toggle sidebar',
      keywords: 'hide show',
      shortcut: shortcutLabel(['mod'], 'B'),
      icon: <PanelLeftClose />,
      run: toggleSidebar,
    },
  ];
  // "Needs you" in an empty search: the chats that wait for the user, first.
  const waitingChats = useNeedsYou(data.sessions, data.projects);
  /** A chat as a search row: its mark, its title and its project. */
  const chatPlace = (session: Session): RecentPlace => {
    const group = groupOfRepo(sessionRepo(session, data.projects));
    return {
      key: 'chat:' + activityKey(session.agent, session.id),
      kind: 'chat' as const,
      agent: session.agent,
      label: session.organization?.title || session.title,
      context: group?.name,
      mark: { kind: 'session', color: identity.session(session) },
      place: group && { name: group.name, color: identity.project(group) },
      open: () => openConversation(session),
    };
  };
  const needsYouPlaces: RecentPlace[] = waitingChats
    .filter((item) => !scopeGroup || groupOfRepo(item.repo)?.id === scopeGroup)
    .slice(0, 3)
    .map(({ session, state }) => ({
      ...chatPlace(session),
      allow: state === 'approval' ? () => answerApproval(session, true) : undefined,
    }));
  const waitingKeys = new Set(needsYouPlaces.map((place) => place.key));
  // "Recent" in an empty search: the chats, tasks and pages that the user opened. Not pages of
  // the app, such as a tab. The chat that shows now is left out. With few of them, the latest
  // chats and the other projects fill the list.
  const recentItems = useRecentItems();
  const openedPlaces = recentItems.flatMap((item): RecentPlace[] => {
    if (item.kind === 'chat') {
      const session = data.sessions.find(
        (s) =>
          s.agent === item.agent && s.id === item.id && (s.hostId || '') === (item.hostId || ''),
      );
      if (!session || (chatOpen && sameChat(chatSession, session))) return [];
      return [chatPlace(session)];
    }
    const group = data.groups?.find((g) => g.id === item.groupId);
    if (!group) return [];
    if (item.kind === 'task') {
      const task = boards[group.id]?.items.find((entry) => entry.id === item.id);
      return [
        {
          key: `task:${group.id}:${item.id}`,
          kind: 'task' as const,
          label: task ? `${task.number ? `#${task.number} ` : ''}${task.title}` : item.title,
          context: `${group.name} · Task`,
          open: () => routeEvents.current.openTask({ groupId: group.id, itemId: item.id }),
        },
      ];
    }
    return [
      {
        key: `doc:${group.id}:${item.id}`,
        kind: 'doc' as const,
        label: item.title || 'Untitled',
        context: `${group.name} · Page`,
        open: () =>
          routeEvents.current.openPage({
            groupId: group.id,
            page: 'knowledge',
            section: 'pages',
            docId: item.id,
          }),
      },
    ];
  });
  const latestChats: RecentPlace[] = data.sessions
    .filter(
      (s) =>
        !s.organization?.archived &&
        !s.id.startsWith('draft-') &&
        !(chatOpen && sameChat(chatSession, s)) &&
        !!sessionRepo(s, data.projects),
    )
    .sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''))
    .map(chatPlace);
  const otherProjects: RecentPlace[] = (data.groups || [])
    .filter((group) => group.id !== currentProjectGroup()?.id && !scopeGroup)
    .map((group) => ({
      key: 'project:' + group.id,
      kind: 'project' as const,
      label: group.name,
      context: 'Project',
      mark: { kind: 'project', color: identity.project(group) },
      open: () => openGroup(group),
    }));
  const recentPlaces = [...openedPlaces, ...latestChats, ...otherProjects]
    .filter(
      (place, index, list) =>
        !waitingKeys.has(place.key) && list.findIndex((item) => item.key === place.key) === index,
    )
    .slice(0, 4);
  /** Starts a chat with the search text as its first message, where the user works now. */
  function askAgent(prompt: string) {
    const chatRepo = chatOpen && chatSession ? sessionRepo(chatSession, data.projects) : undefined;
    const group = currentProjectGroup();
    const members = group ? data.projects.filter((p) => group.repoIds.includes(p.id)) : [];
    const repo = chatRepo || recentRepo(members.length ? members : data.projects, data.sessions);
    void routeEvents.current.newSession({
      groupId: group?.id,
      repoId: repo?.id,
      prompt,
      send: true,
    });
  }
  // With an empty search, these show under "Actions". They depend on the page, and New chat
  // is first wherever a chat can start. Three at most: search finds the others.
  const suggestedKeys = chatOpen
    ? ['new-chat', 'chat-changes', 'chat-terminal']
    : boardGroup
      ? [
          'new-chat',
          ...(boardReady ? ['new-task', 'new-page', 'plan-iteration'] : ['add-folder', 'new-page']),
          ...(boardReady ? [] : ['connect-board']),
          'open-window',
        ]
      : data.groups?.length
        ? ['new-chat', 'open-window', 'new-project']
        : ['new-project', 'add-folder', 'settings'];
  if (!signedIn) suggestedKeys.push('sign-in');
  const suggestedActions = suggestedKeys
    .map((key) => searchActions.find((action) => action.key === key))
    .filter((action): action is SearchAction => !!action)
    .slice(0, 3);
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
  function deleteBranchCopy(repo: Project, branch: string) {
    rememberTrigger();
    setWorktreeTarget({ id: repo.id, branch, dirty: false });
    openModal('remove-worktree', repo.id);
  }
  // A toast offers once to delete a branch copy whose pull request is merged.
  const checkedPulls = useRef(new Set<string>());
  useEffect(() => {
    if (typeof api.pullRequestStatus !== 'function') return;
    for (const repo of data.projects) {
      const parent = worktreeParent(repo, data.projects);
      if (!parent) continue;
      const pull = data.sessions.find(
        (s) => sessionRepo(s, data.projects)?.id === repo.id && s.organization?.pullRequest,
      )?.organization?.pullRequest;
      if (!pull || checkedPulls.current.has(pull.url)) continue;
      checkedPulls.current.add(pull.url);
      const branch = worktreeBranch(repo, parent);
      Promise.resolve()
        .then((): Promise<{ state: string }> =>
          pull.state === 'merged'
            ? Promise.resolve({ state: 'merged' })
            : api.pullRequestStatus!(repo.id, pull.url),
        )
        .then((status) => {
          if (status.state !== 'merged') return;
          const asked = readStored('kalkidan-merged-asked');
          const list = Array.isArray(asked) ? (asked as string[]) : [];
          if (list.includes(pull.url)) return;
          writeStored('kalkidan-merged-asked', [...list, pull.url].slice(-200));
          showToast({
            message: `The pull request of ${branch} is merged. You can delete the branch copy.`,
            actions: [
              {
                label: `Delete branch copy ${branch}`,
                onClick: () => deleteBranchCopy(repo, branch),
              },
            ],
          });
        })
        .catch(() => {
          // Try again on the next refresh.
          checkedPulls.current.delete(pull.url);
        });
    }
  }, [api, data.projects, data.sessions]);
  // A project window has the name of its project as the window title.
  const scopedName = scopeGroup ? data.groups?.find((g) => g.id === scopeGroup)?.name : undefined;
  useEffect(() => {
    if (scopedName) document.title = scopedName;
  }, [scopedName]);
  // The Welcome screen fills the window before the workspace shows.
  if (welcome.show === undefined) return <div className="app-shell" aria-busy="true" />;
  if (welcome.show)
    return (
      <>
        <Welcome
          api={api}
          onDone={(result) => {
            welcome.hide();
            if (!result.signedIn) dismissOnboarding();
            // The first window is the composer.
            openOverview();
          }}
        />
        <Toaster resetKey={routeKey(basePage)} />
        <SshQuitDialog api={api} />
      </>
    );
  const scoped = scopeGroup ? data.groups?.find((g) => g.id === scopeGroup) : undefined;
  // Settings shows the project that the user was in.
  if (route.kind !== 'settings') settingsGroup.current = currentProjectGroup()?.id;
  const parentName = currentGroup?.name || (scoped ? scoped.name : 'Projects');
  const chatColor = chatOpen && chatSession ? identity.session(chatSession) : undefined;
  const menuButton = !isMac && !preview && api.showAppMenu && (
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
  );
  return (
    <div
      className={
        'app-shell' +
        (!preview ? ' desktop-app' : '') +
        (!navigationOpen ? ' navigation-collapsed' : '') +
        (chatOpen ? ' conversation-open' : '') +
        (scoped ? ' project-window' : '')
      }
      style={
        {
          '--navigation-width': navigationOpen ? sidebar.width + 'px' : '0px',
          ...(scoped ? { '--id': `var(--id-${identity.project(scoped)})` } : {}),
        } as CSSProperties
      }
    >
      {/* The first Tab stop: it moves the focus past the sidebar. */}
      <a
        className="skip-link sr-only focus:not-sr-only"
        href="#main-content"
        onClick={(event) => {
          event.preventDefault();
          document.getElementById('main-content')?.focus();
        }}
      >
        Skip to content
      </a>
      <nav
        ref={sidebarRef}
        className="library-panel"
        hidden={!navigationOpen}
        aria-label={scoped ? `${scoped.name} code folders` : 'Projects and repositories'}
      >
        {/* The top of the sidebar is the title bar: the window buttons, then the toggle. A
            project window shows the project mark and name there. */}
        <div className={'sidebar-top' + (!preview ? ' desktop-titlebar' : '')}>
          {menuButton}
          {scoped ? (
            <button
              type="button"
              className="sidebar-project-open"
              aria-current={
                boardGroup === scoped.id && projectPage === 'board' && !chatOpen
                  ? 'page'
                  : undefined
              }
              onClick={() => openGroup(scoped)}
            >
              <IdentityMark kind="project" color={identity.project(scoped)} size="lg" />
              <span className="sidebar-project-name">{scoped.name}</span>
            </button>
          ) : (
            <span className="sidebar-top-space" />
          )}
          {navigationToggle}
        </div>
        <WorkspaceSearch
          api={api}
          open={searchOpen}
          onOpenChange={setSearchOpen}
          projects={data.projects}
          groups={scoped ? [scoped] : data.groups || []}
          sessions={data.sessions}
          actions={searchActions}
          suggested={suggestedActions}
          recent={recentPlaces}
          needsYou={needsYouPlaces}
          activity={sessionActivity}
          markOf={{
            session: (session) => identity.session(session),
            project: (group) => identity.project(group),
            repo: (repo) => identity.repo(repo),
          }}
          onProject={(group) => openGroup(group)}
          onDoc={(group, doc) =>
            routeEvents.current.openPage({
              groupId: group.id,
              page: 'knowledge',
              section: 'pages',
              docId: doc.id,
            })
          }
          onMemory={(group, entry) =>
            routeEvents.current.openPage({
              groupId: group.id,
              page: 'knowledge',
              section: 'memory',
              topic: entry.topic,
            })
          }
          onTask={(group, task) =>
            routeEvents.current.openTask({ groupId: group.id, itemId: task.id })
          }
          onAsk={askAgent}
          onRepository={openProject}
          onSession={openConversation}
        />
        <ProjectTree
          api={api}
          allRepos={data.projects}
          groups={data.groups || []}
          sessions={treeSessions}
          identity={identity}
          scope={scopeGroup}
          windowed={windowed}
          sessionActivity={sessionActivity}
          taskOf={(session) => sessionTask(session, boards)}
          onOpenTask={(groupId, itemId) => routeEvents.current.openTask({ groupId, itemId })}
          onSessionCommand={(command, session) => sessionCommand(command, session)}
          projectsCurrent={home && !chatOpen}
          onProjects={openOverview}
          onOpenWindow={scopeGroup ? undefined : openProjectWindow}
          onFocusWindow={openProjectWindow}
          openChats={openChats}
          cloning={cloning}
          addFolderRequest={addFolderRequest}
          hosts={data.hosts}
          activeGroup={home ? null : chatOpen ? null : boardGroup}
          activeSession={chatOpen ? chatSession : null}
          busy={busy}
          onProject={(group) => openGroup(group)}
          onResume={openConversation}
          onOpenSubagent={(session, subagent) => {
            openConversation(session);
            setTimeout(
              () =>
                window.dispatchEvent(
                  new CustomEvent('kalkidan-focus-subagent', {
                    detail: { agent: session.agent, id: session.id, subagentId: subagent.id },
                  }),
                ),
              250,
            );
          }}
          onNotice={notify}
          onRefresh={reload}
          onNewChat={() => newChat()}
          onNewChatIn={(group, repo) =>
            repo ? startSession(preferredAgent, repo) : newChatIn(group)
          }
          repoActions={repoActions}
          usage={{ sessions: data.sessions, repos: data.projects }}
        />
        {scoped && (
          <div className="sidebar-views" role="group" aria-label={`${scoped.name} views`}>
            <NavRow
              icon={<ListChecks />}
              label="Tasks"
              current={boardGroup === scoped.id && projectPage === 'tasks' && !chatOpen}
              onClick={() => openGroup(scoped, 'tasks')}
            />
            <NavRow
              icon={<BookOpen />}
              label="Knowledge"
              current={boardGroup === scoped.id && projectPage === 'knowledge' && !chatOpen}
              onClick={() => openGroup(scoped, 'knowledge')}
            />
          </div>
        )}
        <div className="sidebar-footer">
          {signInLost && connectionGroup && (
            <Button
              variant="outline"
              className={sidebarAction + ' sidebar-github-connect'}
              title={`The GitHub sign-in for the ${connectionGroup.name} board stopped working.`}
              // The board chip of Settings › project: "Change…" there signs in to GitHub again
              // (device code) and keeps the board. Settings › account has no GitHub sign-in.
              onClick={() => openSettings('project:' + connectionGroup.id, 'board')}
            >
              <img src="./icons/github.svg" width="16" height="16" alt="" aria-hidden="true" />
              Sign in to GitHub again
            </Button>
          )}
          <GetStartedButton
            api={api}
            data={data}
            onOpen={() => undefined}
            className={sidebarAction}
          />
          <div className="sidebar-footer-row">
            <AccountMenu api={api} />
          </div>
        </div>
      </nav>
      {navigationOpen && <SidebarResizer {...sidebar} />}
      {/* With the sidebar hidden, its toggle stays in the title bar, after the window buttons. */}
      {!navigationOpen && (
        <div className={'titlebar-controls' + (!preview ? ' desktop-titlebar' : '')}>
          {menuButton}
          {navigationToggle}
        </div>
      )}
      <main id="main-content" tabIndex={-1}>
        <div className="page-content">
          {/* The header of a chat. The chat puts its crumb, its pane toggle and its menu here. */}
          <PageHeader
            className="conversation-header"
            crumbs={<div id="conversation-titlebar-heading" className="conversation-crumbs" />}
            tint={chatColor}
            actions={
              <>
                <div id="conversation-titlebar-tabs" />
                <div id="conversation-titlebar-actions" />
              </>
            }
          />
          <SessionBanner api={api} />
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
                {route.kind === 'settings' ? (
                  <div className="project-frame" data-page="settings">
                    <PageHeader title="Settings" />
                    <div className="project-frame-body">
                      <section className="page settings-page-frame" aria-label="Settings">
                        <SettingsPage
                          api={api}
                          groups={data.groups || []}
                          repos={data.projects}
                          section={settings.section}
                          anchor={settings.anchor}
                          currentGroupId={settingsGroup.current}
                          onRefresh={refresh}
                          onClose={() => {
                            void reload();
                            if (navigation.canBack) navigation.back();
                            else openOverview();
                          }}
                        />
                      </section>
                    </div>
                  </div>
                ) : currentGroup ? (
                  <ProjectFrame
                    api={api}
                    group={currentGroup}
                    color={identity.project(currentGroup)}
                    host={data.hosts?.find((h) => h.id === currentGroup.hostId)}
                    page={projectPage}
                    usage={{ sessions: data.sessions, repos: data.projects }}
                    desktop={!preview}
                    onOpenWindow={scopeGroup ? undefined : () => openProjectWindow(currentGroup)}
                    onRefresh={refresh}
                  >
                    {projectPage === 'knowledge' ? (
                      <KnowledgePanel
                        key={boardGroup}
                        api={api}
                        group={currentGroup}
                        sessions={data.sessions}
                        repos={data.projects.filter((p) => currentGroup.repoIds.includes(p.id))}
                        section={knowledgeSection}
                        docId={searchTarget.page}
                        topic={searchTarget.topic}
                        heading={searchTarget.heading}
                        taskId={searchTarget.task}
                      />
                    ) : projectPage === 'board' ? (
                      <ProjectHomePage
                        key={boardGroup}
                        api={api}
                        group={currentGroup}
                        repos={data.projects.filter((p) => currentGroup.repoIds.includes(p.id))}
                        sessions={data.sessions}
                        identity={identity}
                        onOpenSession={openConversation}
                        onRepo={openProject}
                        onAddFolder={() => addCodeFolder(currentGroup.id)}
                      />
                    ) : (
                      <ProjectTrackerPanel
                        identity={identity}
                        initialTaskId={searchTarget.task}
                        connectRequested={connectRequest === boardGroup}
                        onConnectHandled={() => setConnectRequest(null)}
                        key={boardGroup}
                        // The Tasks tab opens the tasks, also without a board: the page then
                        // offers to connect one. Overview and Insights have their own pages.
                        page="tasks"
                        onPageChange={(page) =>
                          page === 'insights'
                            ? openGroup(currentGroup, 'knowledge', 'insights')
                            : setProjectPage(page === 'overview' ? 'board' : 'tasks')
                        }
                        revision={revision}
                        api={api}
                        sessions={data.sessions}
                        onResume={openConversation}
                        group={currentGroup}
                        repos={data.projects.filter((p) => currentGroup.repoIds.includes(p.id))}
                        onRefresh={refresh}
                        onRepo={openProject}
                        onTask={(repo, agent, task) => newSession(agent, repo, task)}
                        onAddFolder={() => addCodeFolder(currentGroup.id)}
                        onNewSession={(repo, agent) => startSession(agent, repo)}
                        onOpenSession={openConversation}
                        onOpenDocs={(pageId) =>
                          routeEvents.current.openPage({
                            groupId: currentGroup.id,
                            page: 'knowledge',
                            section: 'pages',
                            docId: pageId,
                          })
                        }
                      />
                    )}
                  </ProjectFrame>
                ) : (
                  <ProjectOverview
                    api={api}
                    groups={data.groups || []}
                    repos={data.projects}
                    sessions={data.sessions}
                    identity={identity}
                    onRefresh={refresh}
                    onSelect={(group) => openGroup(group)}
                    onOpenWindow={openProjectWindow}
                  />
                )}
              </div>
              {chatSession && (
                <AgentWorkspace
                  onDraft={(draft) => {
                    setDrafts((previous) => [...previous.filter((s) => s.id !== draft.id), draft]);
                    setChatSession((current) => (current?.id === draft.id ? draft : current));
                    navigate((current) => resolveRouteSession(current, draft, draft));
                  }}
                  onCreated={(draft, id, title) => {
                    void linkFork(draft, id);
                    navigation.replace((route) =>
                      resolveRouteSession(route, draft, { ...draft, id, title }),
                    );

                    setDrafts((previous) =>
                      previous.map((s) =>
                        s.id === draft.id && s.agent === draft.agent ? { ...s, id, title } : s,
                      ),
                    );
                    navigate((current) =>
                      resolveRouteSession(current, draft, { ...draft, id, title }),
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
                  hosts={data.hosts}
                  sessions={data.sessions}
                  initialTabs={restoredChats}
                  selected={chatSession}
                  returnLabel={`Back to ${parentName}`}
                  visible={chatOpen}
                  onSelect={openConversation}
                  onClose={closeConversation}
                  onOpenRepository={(repo) => openProject(repo)}
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
      <Toaster resetKey={routeKey(basePage)} />
      <SshQuitDialog api={api} />
      <SignInFlow api={api} />
      <ProjectUsageSheetHost
        api={api}
        groups={data.groups || []}
        sessions={data.sessions}
        repos={data.projects}
      />
      <BoardSettingsHost
        api={api}
        groups={data.groups || []}
        activeGroupId={currentProjectGroup()?.id}
        onChanged={() => reload()}
      />
      <ShortcutsSheet
        open={shortcutsOpen}
        onOpenChange={(open) => {
          setShortcutsOpen(open);
          if (!open) returnFocus();
        }}
      />
      <DiagnosticsDialog api={api} />
      <ProxySignInDialog api={api} />
      <ForkChatDialog
        api={api}
        session={forkSource}
        projects={data.projects}
        groups={data.groups || []}
        hosts={data.hosts || []}
        onOpenChange={(open) => !open && setForkSource(null)}
        onFork={(choice) => forkSource && forkSession(forkSource, choice)}
      />
      <CreateProject
        api={api}
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) returnFocus();
        }}
        onCreated={async (group) => {
          dialogTrigger.current = null;
          const first = !data.groups?.length;
          await refresh();
          openGroup(group);
          // The first project from a folder opens a first chat with a draft.
          if (first && group.repoIds.length)
            startFirstChat({ groupId: group.id, repoId: group.repoIds[0] });
        }}
      />
      {/* Work started here continues after the dialog closes and reports through a toast. */}
      <ConfirmDialog
        open={modal === 'remove'}
        title="Remove code folder"
        description={`Kalkidan stops showing ${modalProject?.name || 'this code folder'}. The folder, its files and its chats stay on disk.`}
        confirmLabel="Remove code folder"
        destructive
        busy={modalBusy}
        onCancel={() => setModal(null)}
        onConfirm={() => {
          const removed = modalProject?.name || 'Code folder';
          void runModal(async () => {
            await api.remove(modalRepo);
            setModal(null);
          }, `${removed} removed from Kalkidan.`);
        }}
      >
        {modalError && (
          <p role="alert" className="field-error">
            {modalError}
          </p>
        )}
      </ConfirmDialog>
      <ConfirmDialog
        open={modal === 'remove-worktree'}
        title="Delete branch copy"
        description={
          worktreeTarget?.dirty
            ? `${worktreeTarget.branch} has changes that are not committed. If you delete it, the changes are lost.`
            : `Kalkidan deletes the folder of ${worktreeTarget?.branch || 'the branch copy'}. The branch and its commits stay in the repository.`
        }
        confirmLabel="Delete branch copy"
        destructive
        busy={modalBusy}
        onCancel={() => setModal(null)}
        onConfirm={removeWorktree}
      >
        {modalError && (
          <p role="alert" className="field-error">
            {modalError}
          </p>
        )}
      </ConfirmDialog>
      <Dialog
        open={modal === 'edit' || modal === 'worktree'}
        onOpenChange={(open) => !open && setModal(null)}
      >
        <DialogContent size="md" layout="scroll" onCloseAutoFocus={restoreTriggerFocus}>
          <DialogHeader>
            <DialogTitle>
              {shownModal === 'worktree' ? 'New branch copy' : 'Edit code folder'}
            </DialogTitle>
            <DialogDescription>
              {shownModal === 'worktree'
                ? `${branchCopyHelp} Kalkidan adds the folder to the project.`
                : 'Change the name, the project and the notes of this code folder.'}
            </DialogDescription>
          </DialogHeader>
          {shownModal === 'worktree' && (
            <DialogBody>
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
            </DialogBody>
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
                    variant="destructive-outline"
                    onClick={() => {
                      setModalError('');
                      setModal('remove');
                    }}
                  >
                    <Trash2 /> Remove code folder…
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
            <Button type="button" variant="outline" onClick={() => setModal(null)}>
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
            {shownModal === 'worktree' && (
              <Button type="submit" form="repository-dialog-form" disabled={!branch.trim()}>
                {modalBusy && <LoaderCircle className="animate-spin" aria-hidden="true" />}
                Create branch copy
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
