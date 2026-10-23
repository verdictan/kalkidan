import { GitHubViewLayout, SavedViewFilterChip } from './github-view-layout';
import { SavedViewsMenu, openSavedView, useSavedViews } from './github-saved-views';
import type { SavedProjectView } from '../domain/github-resources';
import type { TrackerField } from '../domain/tracker';
import { GitHubItemEditor, ItemActionsMenu, fieldChoices } from './github-item-editor';
import { useProjectBoard } from '../hooks/use-project-board';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Popover } from 'radix-ui';
import {
  Archive,
  ArrowUpRight,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Columns3,
  FileText,
  Folder,
  FolderPlus,
  GitPullRequest,
  Layers2,
  List,
  LoaderCircle,
  Lock,
  Megaphone,
  MessageSquare,
  PenLine,
  Play,
  Plus,
  RefreshCw,
  Search,
  SearchX,
  Settings,
  TriangleAlert,
  X,
} from 'lucide-react';
import { agentLabel } from '../config/agents';
import { trackerConnection } from '../domain/tracker';
import { useTracker } from '../hooks/use-tracker';
import { sessionRepo } from '../lib/session-repository';
import {
  relinkTaskChats,
  revertIssuesToDrafts,
  type DraftRevertTarget,
} from '../lib/tracker-client';
import { pathBasename, plural } from '../lib/platform';
import { relativeTime } from '../lib/relative-time';
import { cn } from '../lib/utils';
import { TrackerBoard, itemUrl } from './tracker-board';
import {
  StatusIcon,
  TrackerList,
  activityText,
  isDoneStatus,
  linkedChats,
  pullRequestStateWord,
  taskFolderName,
  taskPullRequest,
  trackerColumns,
  type LiveActivity,
  type TaskIdentity,
  type TaskSelection,
} from './tracker-list';
import { AgentMenuItems, openToolsSettings, startAgent, useDetectedAgents } from './task-agents';
import { useWorkspaceIdentity, type WorkspaceIdentity } from '../hooks/use-workspace-identity';
import { IdentityMark } from './ui/identity-mark';
import { StatusGlyph } from './ui/status-glyph';
import { boardNoun } from './project-header';
import {
  DocsToIssuesDialog,
  PlanningToolDialog,
  type PlanningTool,
  type TaskFilter,
} from './planning-tools';
import { UncertainWritesChip, useUncertainWriteRows } from './github-write-history';
import { checkWritesEvent } from './planning-kit';
import { BoardHealthLine, ProjectHealth } from './project-health';
import { safeWave, startTasksInWaves } from './parallel-dispatch';
import { setFieldOnTasks } from './project-batch';
import {
  activityKey,
  answerApproval,
  useActivityState,
  type SessionActivityState,
} from './activity-dot';
import { projectColors } from '../domain/project-colors';
import { EmptyState } from './ui/empty-state';
import { EntityIcon } from './ui/entity-icon';
import { PageHeader } from './ui/page-header';
import { Radio } from './ui/checkbox';
import { menuCollisionPadding, menuContentClass, menuShortcutClass } from './ui/menu-styles';
import { showToast } from './ui/toast';
import {
  Fragment,
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  type ComponentProps,
  type ReactElement,
} from 'react';
import { Hint } from './hint';
import { DocPagePicker } from './doc-page-picker';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { SearchInput } from './ui/search-input';
import { AgentIcon } from './ui/agent-icon';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { onPreferredAgentChange, savePreferredAgent } from '../lib/agent-preference';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { Tag } from './ui/tag';
import { Alert, AlertDescription } from './ui/alert';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from './ui/dialog';
import { ConnectBoardPanel, openConnectBoard } from './tracker-project-picker';
import type { API, ProjectGroup, Project, TrackerItem, Agent, Session } from '../types';
import { errorMessage } from '../lib/errors';

type TrackerFilters = {
  query: string;
  status: string;
  repoFilter: string;
  sort: string;
  view: string;
};
const defaultFilters: TrackerFilters = {
  query: '',
  status: 'all',
  repoFilter: 'all',
  sort: 'project',
  view: 'board',
};
// The tracker shows "Authorize access" only for errors about sign-in or permissions.
const authErrorPattern =
  /\bauth|sign in|log in|login|not accessible|no longer accessible|access|token|permission|forbidden|unauthori[sz]ed|\b40[13]\b/i;

export { boardNoun };

/** Opens Project settings › Board. */
function openBoardSettings(groupId: string) {
  window.dispatchEvent(
    new CustomEvent('kalkidan-open-project-settings', { detail: { groupId, section: 'board' } }),
  );
}
// The code folder of the last task that the user created or started, for each project.
function folderKey(groupId: string) {
  return `kalkidan-task-folder:${groupId}`;
}
function readFolder(groupId: string) {
  try {
    return localStorage.getItem(folderKey(groupId)) || '';
  } catch {
    return '';
  }
}
function saveFolder(groupId: string, repoId: string) {
  try {
    if (repoId) localStorage.setItem(folderKey(groupId), repoId);
  } catch {
    // The choice then resets on the next visit.
  }
}

// The code folder of each new task, by task ID. A draft has no GitHub repository, so the board
// keeps the repo that the user chose when adding it.
function taskReposKey(groupId: string) {
  return `kalkidan-task-repos:${groupId}`;
}
/** A draft that became an issue on Start. Undo makes a draft from it again. */
type ConvertedDraft = DraftRevertTarget & { folderId: string };
function readTaskRepos(groupId: string): Record<string, string> {
  try {
    const value = JSON.parse(localStorage.getItem(taskReposKey(groupId)) || '{}');
    return value && typeof value === 'object' ? value : {};
  } catch {
    return {};
  }
}
function saveTaskRepo(groupId: string, itemId: string, repoId: string) {
  try {
    const next = { ...readTaskRepos(groupId), [itemId]: repoId };
    localStorage.setItem(taskReposKey(groupId), JSON.stringify(next));
  } catch {
    // The card then shows "Draft" until the task becomes an issue.
  }
}

type LinkedDoc = { id: string; title: string };
// Older versions kept the related docs of a task in local storage. The desktop app now keeps
// them in the project folder. The local links move there once.
const docLinkPrefix = (groupId: string) => `kalkidan-task-docs:${groupId}:`;
function docLinkKey(groupId: string, taskId: string) {
  return docLinkPrefix(groupId) + taskId;
}
function readDocLinks(key: string): LinkedDoc[] {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value)
      ? value.filter(
          (doc): doc is LinkedDoc => typeof doc?.id === 'string' && typeof doc?.title === 'string',
        )
      : [];
  } catch {
    return [];
  }
}
function writeDocLinks(key: string, docs: LinkedDoc[]) {
  try {
    if (docs.length) localStorage.setItem(key, JSON.stringify(docs));
    else localStorage.removeItem(key);
  } catch {
    // Storage can be unavailable. The links then stay for this run only.
  }
}
/** The local links of a project, by task ID. */
function localDocLinks(groupId: string) {
  const links: Record<string, LinkedDoc[]> = {};
  try {
    const prefix = docLinkPrefix(groupId);
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index);
      if (key?.startsWith(prefix)) links[key.slice(prefix.length)] = readDocLinks(key);
    }
  } catch {
    // Without storage there is nothing to move.
  }
  return links;
}

// The project page opens on the overview, the tasks or the insights, as the user left it.
type ProjectPage = 'overview' | 'tasks' | 'insights';
function pageKey(groupId: string) {
  return `kalkidan-project-page:${groupId}`;
}
function readPage(groupId: string): ProjectPage | null {
  try {
    const value = localStorage.getItem(pageKey(groupId));
    return value === 'overview' || value === 'tasks' || value === 'insights' ? value : null;
  } catch {
    return null;
  }
}

/** Suggests a branch name for a task: "12-fix-login" or "fix-login" for a draft. */
export function taskBranchName(item: Pick<TrackerItem, 'number' | 'title'>) {
  const slug = item.title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .slice(0, 40)
    .replace(/-+$/, '');
  return `${item.number ? `${item.number}-` : ''}${slug}`;
}

/** The first message of a chat that starts on a task. */
function taskPrompt(item: Pick<TrackerItem, 'title'>) {
  return `Work on this task: ${item.title}. Review the repository and propose an implementation plan first.`;
}

// Filters are kept per project board, so that they stay when the view changes.
function filterKey(groupId: string, embedded: boolean) {
  return `kalkidan-tracker-filters:${groupId}${embedded ? ':embedded' : ''}`;
}

function readFilters(key: string): TrackerFilters {
  try {
    const value = JSON.parse(localStorage.getItem(key) || 'null');
    if (!value || typeof value !== 'object') return defaultFilters;
    const text = (name: keyof TrackerFilters) =>
      typeof value[name] === 'string' ? value[name] : defaultFilters[name];
    return {
      query: text('query'),
      status: text('status'),
      repoFilter: text('repoFilter'),
      sort: text('sort'),
      // Roadmap is on GitHub now. An old saved Roadmap opens the board.
      view: text('view') === 'list' ? 'list' : 'board',
    };
  } catch {
    return defaultFilters;
  }
}

function writeFilters(key: string, filters: TrackerFilters) {
  try {
    localStorage.setItem(key, JSON.stringify(filters));
  } catch {
    // Storage can be unavailable. The filters then reset on the next visit.
  }
}

function ExternalAnchor({ node: _node, ...props }: ComponentProps<'a'> & { node?: unknown }) {
  return <a {...props} target="_blank" rel="noreferrer" />;
}

export function ProjectTrackerPanel({
  api,
  group,
  repos,
  sessions,
  revision,
  embedded = false,
  preferredRepoId,
  connectRequested,
  onConnectHandled,
  onResume,
  onRefresh,
  onRepo,
  onTask,
  initialTaskId,
  onAddFolder,
  onNewSession,
  onOpenSession,
  onOpenDocs,
  onAllSessions,
  page: requestedPage,
  onPageChange,
  identity: workspaceIdentity,
}: {
  /**
   * The identity colors of the sidebar tree. With them, the repo rings and the chat dots on the
   * cards match the tree. Without them, the panel picks the colors itself.
   */
  identity?: WorkspaceIdentity;
  /**
   * The page to show: the project overview, the tasks or the insights. Without it, the last
   * page shows. 'board' is the route name of the overview.
   */
  page?: ProjectPage | 'board';
  /** Called when the panel itself switches the page, for example after "New task". */
  onPageChange?: (page: ProjectPage) => void;
  /** Opens the detail of this task when the board loads, for example from a search result. */
  initialTaskId?: string;
  embedded?: boolean;
  preferredRepoId?: string;
  connectRequested?: boolean;
  onConnectHandled?: () => void;
  /**
   * Not used any more. The overview opens the board picker itself. Kept so that callers
   * that still pass it compile.
   */
  onConnectTracker?: () => void;
  /** Opens the Add code folder dialog. Without it, the panel sends kalkidan-add-code-folder. */
  onAddFolder?: () => void;
  /** Starts a new chat in a code folder. Without it, the panel opens the code folder. */
  onNewSession?: (repo: Project, agent: Agent) => void;
  /** Opens a chat. Without it, the panel uses onResume. */
  onOpenSession?: (session: Session) => void;
  /** Opens the docs page, at a page when `pageId` is set. Without it, Docs cards do not show. */
  onOpenDocs?: (pageId?: string) => void;
  /** Shows all chats of the project. Without it, "See all chats" does not show. */
  onAllSessions?: () => void;
  revision?: number;
  api: API;
  group: ProjectGroup;
  repos: Project[];
  sessions: Session[];
  onResume: (session: Session) => void;
  onRefresh: () => Promise<void>;
  onRepo: (repo: Project) => void;
  onTask: (repo: Project, agent: Agent, task: TrackerItem) => void;
}) {
  const connection = trackerConnection(group);
  const {
    client,
    provider,
    name: providerName,
    descriptor,
  } = useTracker(api, connection?.provider);
  const linkedProject = connection?.project;
  const filterStorage = filterKey(group.id, embedded);
  const [savedFilters] = useState(() => readFilters(filterStorage));
  const [repoFilter, setRepoFilter] = useState(savedFilters.repoFilter);
  const projectSessions = sessions.filter((session) => !!sessionRepo(session, repos));
  const { activity: liveActivity } = useActivityState();
  const activity = useMemo(
    () =>
      Object.fromEntries(
        liveActivity.map((item) => [activityKey(item.agent, item.id), item.state]),
      ),
    [liveActivity],
  );
  const live = useMemo(
    () =>
      Object.fromEntries(
        liveActivity.map((item) => [activityKey(item.agent, item.id), item as LiveActivity]),
      ),
    [liveActivity],
  );
  // The identity colors: the repo ring on the cards and the chat dot on the live line, the
  // same as in the sidebar tree.
  const localIdentity = useWorkspaceIdentity([group], repos, sessions);
  const colors = workspaceIdentity || localIdentity;
  const identity: TaskIdentity = {
    repoColor: (name) => {
      const repo = repos.find((item) => item.name === name);
      return repo && colors.repo(repo);
    },
    sessionColor: (session) => colors.session(session),
  };
  // The agent works in a branch copy unless the user changes it, or the folder has no Git.
  const [checkout, setCheckout] = useState('worktree');
  // "Where to work" in the start box of the task sheet: the code folder and branch popover.
  const [whereOpen, setWhereOpen] = useState(false);
  // The title or the description that the user edits in the task sheet.
  const [editing, setEditing] = useState<'title' | 'body' | null>(null);
  const [editText, setEditText] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  // The user chose a checkout. A loaded branch status then does not change it.
  const checkoutTouched = useRef(false);
  const [repoStatus, setRepoStatus] = useState<{ branch: string; defaultBranch: string } | null>(
    null,
  );
  const initialPage = requestedPage === 'board' ? 'overview' : requestedPage;
  const [page, setPageState] = useState<ProjectPage>(
    () => initialPage || readPage(group.id) || (connection?.project ? 'tasks' : 'overview'),
  );
  useEffect(() => {
    if (initialPage) setPageState(initialPage);
  }, [initialPage]);
  function rememberPage(value: ProjectPage) {
    setPageState(value);
    try {
      localStorage.setItem(pageKey(group.id), value);
    } catch {
      // The page then resets on the next visit.
    }
  }
  function setPage(value: ProjectPage) {
    if (value !== page) onPageChange?.(value);
    rememberPage(value);
  }
  // Search is an icon until the user opens it or a search is active.
  const [searchOpen, setSearchOpen] = useState(() => !!savedFilters.query);
  // The column that shows the New task field: ⏎ adds, ⌘⏎ adds and starts.
  const [adding, setAdding] = useState<string | null>(null);
  // "Start N" in the selection bar while the tasks start.
  const [waveBusy, setWaveBusy] = useState(false);
  // Board name menu › Post status update…
  const [statusOpen, setStatusOpen] = useState(false);
  const [docPickerOpen, setDocPickerOpen] = useState(false);
  const [chatPickerOpen, setChatPickerOpen] = useState(false);
  const [taskBranch, setTaskBranch] = useState('');
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskError, setTaskError] = useState('');
  const { state: boardState, refresh: reloadBoard } = useProjectBoard(
    api,
    client,
    provider,
    group.id,
    linkedProject,
    revision,
  );
  const board = boardState.value ?? null;
  // The toast Undo runs after later renders. It reads the board and the chats from these refs.
  const boardRef = useRef(board);
  boardRef.current = board;
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  // A task that starts moves to In progress at once. The chat then sets the status on the
  // board. The local move ends when the board shows the new status.
  const [moved, setMoved] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!board) return;
    setMoved((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(
          ([id, statusId]) => board.items.find((item) => item.id === id)?.statusId !== statusId,
        ),
      );
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [board]);
  useEffect(() => {
    if (!Object.keys(moved).length) return;
    const timer = window.setTimeout(() => setMoved({}), 120000);
    return () => window.clearTimeout(timer);
  }, [moved]);
  const withMove = (item: TrackerItem) =>
    moved[item.id] ? { ...item, statusId: moved[item.id] } : item;
  const [mutating, setBusy] = useState(false);
  const busy = mutating || boardState.status === 'loading' || boardState.status === 'refreshing';
  const [actionError, setError] = useState('');
  const [query, setQuery] = useState(savedFilters.query);
  const [status, setStatus] = useState(savedFilters.status);
  // One view: the board. ⌘K "Show as list" shows the same tasks as a dense list.
  const [view, setView] = useState<'board' | 'list'>(
    savedFilters.view === 'list' ? 'list' : 'board',
  );
  const [savedView, setSavedView] = useState<SavedProjectView | null>(null);
  const [savedViewPending, setSavedViewPending] = useState(false);
  const changeSavedView = useCallback((value: SavedProjectView | null, pending: boolean) => {
    setSavedView(value);
    setSavedViewPending(pending);
    if (value) setView(value.layout === 'TABLE_LAYOUT' ? 'list' : 'board');
  }, []);
  useEffect(() => {
    writeFilters(filterStorage, { query, status, repoFilter, sort: 'project', view });
  }, [filterStorage, query, status, repoFilter, view]);
  const [task, setTask] = useState<TrackerItem | null>(null);
  // The card that gets the focus back when the task sheet closes.
  const lastTaskId = useRef('');
  const taskTitle = useRef<HTMLHeadingElement>(null);
  const [archived, setArchived] = useState(false);
  const [repoId, setRepoId] = useState(repos[0]?.id || '');
  // A new choice of agent in any menu shows at once.
  const [, setAgentChoice] = useState(0);
  useEffect(() => onPreferredAgentChange(() => setAgentChoice((value) => value + 1)), []);
  // Start lists only the agent CLIs found on the computer of the repo.
  const agents = useDetectedAgents(
    api,
    (task && repos.find((repo) => repo.id === repoId)?.hostId) || 'local',
  );
  const preferredAgent = startAgent(agents);
  // The repo of the New task field: the repo used last, else the best match.
  const [addRepoId, setAddRepoId] = useState(
    () => preferredRepoId || readFolder(group.id) || repos[0]?.id || '',
  );
  const addRepo =
    repos.find((repo) => repo.id === addRepoId) ||
    repos.find((repo) => repo.id === preferredRepoId) ||
    repos[0];
  const [taskRepos, setTaskRepos] = useState(() => readTaskRepos(group.id));
  /** The code folder name on a card: its GitHub repository, else the repo chosen when added. */
  function cardFolder(item: TrackerItem) {
    const chosen = !item.repository && repos.find((repo) => repo.id === taskRepos[item.id]);
    return chosen ? chosen.name : taskFolderName(item);
  }
  const boardName = boardNoun(providerName);
  const addFolder = () =>
    onAddFolder
      ? onAddFolder()
      : window.dispatchEvent(
          new CustomEvent('kalkidan-add-code-folder', { detail: { groupId: group.id } }),
        );
  const openChat = (session: Session) => (onOpenSession || onResume)(session);
  /** Allow on a card: the chat that owns the run answers its oldest approval. */
  const allowChat = (session: Session) => answerApproval(session, true);
  /** The board list is on the page. This puts the focus in its search field. */
  function connect() {
    if (page !== 'tasks') setPage('tasks');
    window.setTimeout(
      () =>
        document.querySelector<HTMLInputElement>('.project-tracker .connect-board input')?.focus(),
      0,
    );
  }
  useEffect(() => {
    if (!connectRequested) return;
    // Defer until mount cleanup has finished before starting CLI authorization.
    const timer = setTimeout(() => {
      connect();
      onConnectHandled?.();
    }, 0);
    return () => clearTimeout(timer);
  }, [connectRequested]);
  /** The code folder that the user used last, when it is still in the project. */
  function lastFolder() {
    const id = readFolder(group.id);
    return repos.some((repo) => repo.id === id) ? id : '';
  }
  /**
   * The code folder of a task: the folder of its GitHub repository, else the folder of this
   * page, the folder used last or the only folder.
   */
  function taskFolder(item: TrackerItem) {
    const matches = item.repository
      ? repos.filter((r) => r.name === pathBasename(item.repository!))
      : [];
    const chosen = repos.find((repo) => repo.id === taskRepos[item.id]);
    return matches.length === 1
      ? matches[0].id
      : chosen?.id || preferredRepoId || lastFolder() || (repos.length === 1 ? repos[0].id : '');
  }
  function chooseTask(item: TrackerItem) {
    setTask(item);
    lastTaskId.current = item.id;
    setCheckout('worktree');
    checkoutTouched.current = false;
    setTaskBranch(taskBranchName(item));
    setTaskError('');
    setWhereOpen(false);
    setEditing(null);
    setRepoId(taskFolder(item));
  }
  function openTaskById(id: string) {
    const item = board && [...board.items, ...(board.archivedItems || [])].find((i) => i.id === id);
    if (item) {
      if (page !== 'tasks') setPage('tasks');
      chooseTask(item);
    }
    return !!item;
  }

  // Related docs. The desktop app keeps them in the project folder, so the doc page can show
  // its linked tasks. Older bridges keep them in local storage.
  const docsAvailable = typeof api.docsMetadata === 'function';
  const sharedLinks =
    typeof api.taskDocLinks === 'function' && typeof api.setTaskDocLinks === 'function';
  const [docMap, setDocMap] = useState<Record<string, string[]>>({});
  const [docTitles, setDocTitles] = useState<Record<string, string> | null>(null);
  const [localLinks, setLocalLinks] = useState<Record<string, LinkedDoc[]>>(() =>
    localDocLinks(group.id),
  );
  useEffect(() => {
    if (!sharedLinks) return;
    let live = true;
    void (async () => {
      try {
        let map = await api.taskDocLinks!(group.id);
        // Move the links of older versions to the project folder once.
        const local = localDocLinks(group.id);
        for (const [itemId, links] of Object.entries(local)) {
          if (!links.length) continue;
          const ids = [...new Set([...(map[itemId] || []), ...links.map((link) => link.id)])];
          await api.setTaskDocLinks!(group.id, itemId, ids);
          writeDocLinks(docLinkKey(group.id, itemId), []);
          map = { ...map, [itemId]: ids };
        }
        if (live) setDocMap(map);
      } catch {
        // The links show again on the next load.
      }
    })();
    return () => {
      live = false;
    };
  }, [api, group.id, sharedLinks, revision]);
  function docIdsFor(itemId: string) {
    return sharedLinks ? docMap[itemId] || [] : (localLinks[itemId] || []).map((link) => link.id);
  }
  const taskId = task?.id;
  // The titles of the docs. A removed page does not show.
  useEffect(() => {
    if (!taskId || !docsAvailable) return;
    let live = true;
    api
      .docsMetadata(group.id)
      .then((pages) => {
        if (live) setDocTitles(Object.fromEntries(pages.map((p) => [p.id, p.title || 'Untitled'])));
      })
      .catch(() => {
        // The saved titles show until the docs load.
      });
    return () => {
      live = false;
    };
  }, [api, group.id, taskId, docsAvailable]);
  const docLinks: LinkedDoc[] = taskId
    ? docIdsFor(taskId).flatMap((id) => {
        const saved = localLinks[taskId]?.find((link) => link.id === id)?.title;
        if (docTitles && !(id in docTitles)) return [];
        return [{ id, title: docTitles?.[id] || saved || 'Untitled' }];
      })
    : [];
  async function changeDocLinks(next: LinkedDoc[]) {
    if (!taskId) return;
    const ids = next.map((doc) => doc.id);
    if (!sharedLinks) {
      setLocalLinks((current) => ({ ...current, [taskId]: next }));
      writeDocLinks(docLinkKey(group.id, taskId), next);
      return;
    }
    const before = docMap[taskId] || [];
    setDocMap((current) => ({ ...current, [taskId]: ids }));
    try {
      await api.setTaskDocLinks!(group.id, taskId, ids);
    } catch (e) {
      setDocMap((current) => ({ ...current, [taskId]: before }));
      setTaskError(`Could not save the related docs. ${errorMessage(e)}`);
    }
  }

  /**
   * Starts a chat on a task in `target`. The related docs go with it: the shell opens a new
   * draft with the docs attached. Without docs, the usual start path runs.
   */
  function launch(target: Project, agent: Agent, item: TrackerItem) {
    const docIds = docIdsFor(item.id);
    if (docIds.length)
      window.dispatchEvent(
        new CustomEvent('kalkidan-new-session', {
          detail: {
            groupId: group.id,
            repoId: target.id,
            agent,
            taskId: item.id,
            docIds,
            prompt: taskPrompt(item),
          },
        }),
      );
    else onTask(target, agent, item);
  }
  /** Makes a branch copy for a task, or returns the code folder itself. */
  async function workTarget(repo: Project, item: TrackerItem, mode: string, branch: string) {
    if (mode !== 'worktree') return repo;
    const key = `kalkidan-task-checkout:${group.id}:${item.id}:${repo.id}:${branch}`;
    let operationId = '';
    try {
      operationId = localStorage.getItem(key) || '';
    } catch {
      // A new operation ID then follows.
    }
    operationId ||= crypto.randomUUID();
    try {
      localStorage.setItem(key, operationId);
    } catch {
      // A retry then makes a new operation.
    }
    const target = await api.taskWorktree(repo.id, branch, operationId);
    if (!target) throw new Error('Could not create the branch copy.');
    await onRefresh();
    return target;
  }
  async function startTask(agent: Agent) {
    const repo = repos.find((r) => r.id === repoId);
    if (!repo || !task || taskBusy) return;
    setTaskBusy(true);
    setTaskError('');
    const branch = taskBranch.trim();
    const converted: ConvertedDraft[] = [];
    try {
      const [item] = await ensureIssues([task], () => repo.id, converted);
      const target = await workTarget(repo, item, checkout, branch);
      saveFolder(group.id, repo.id);
      moveToProgress(item);
      launch(target, agent, item);
      setTask(null);
      if (checkout === 'worktree') showToast(`Started on branch ${branch}.`);
    } catch (e) {
      setTaskError(errorMessage(e));
    } finally {
      setTaskBusy(false);
      announceConverted(converted);
    }
  }
  /** The GitHub repository of a code folder: the board repository with the same name. */
  function githubRepository(repo: Project) {
    const name = repo.name.toLowerCase();
    const match = repositoryOptions.find((value) => pathBasename(value).toLowerCase() === name);
    return match || (linkedProject?.owner ? `${linkedProject.owner}/${repo.name}` : '');
  }
  /**
   * Drafts become issues on Start, in the GitHub repository of their code folder. Returns the
   * tasks as the board shows them after the change. A draft without a repository stays a draft.
   * `converted` gets the drafts that are issues now, for the "Converted N drafts" toast.
   */
  async function ensureIssues(
    list: TrackerItem[],
    folderFor: (item: TrackerItem) => string = taskFolder,
    converted: ConvertedDraft[] = [],
  ) {
    const drafts = list.filter((item) => item.kind === 'DraftIssue');
    if (!drafts.length || connection?.provider !== 'github' || board?.writable === false)
      return list;
    for (const draft of drafts) {
      const folderId = folderFor(draft);
      const repo = repos.find((item) => item.id === folderId);
      const repository = repo && githubRepository(repo);
      if (!repository) continue;
      await api.trackerItemAction(group.id, draft.id, { kind: 'convert', repository });
      converted.push({
        itemId: draft.id,
        title: draft.title,
        body: draft.body || '',
        statusId: draft.statusId,
        folderId,
      });
    }
    if (!converted.length) return list;
    const next = await refreshBoard();
    return list.map((item) => next?.items.find((found) => found.id === item.id) || item);
  }
  /** "Converted 2 drafts to issues" with Undo. Show it after the start toasts, so both show. */
  function announceConverted(converted: ConvertedDraft[]) {
    if (!converted.length) return;
    const count = converted.length;
    showToast({
      message:
        count === 1 ? 'Converted 1 draft to an issue.' : `Converted ${count} drafts to issues.`,
      actions: [{ label: 'Undo', onClick: () => void undoConvert(converted) }],
    });
  }
  /**
   * Undo of "Converted N drafts": each new issue closes on GitHub as not planned, and a draft
   * with the same title and description takes its place in the same column. The chats that
   * started continue. Each saved chat links to the new draft.
   */
  async function undoConvert(converted: ConvertedDraft[]) {
    const items = boardRef.current?.items || [];
    const results = await revertIssuesToDrafts(
      api,
      group.id,
      converted.map((draft) => ({
        ...draft,
        statusId: items.find((item) => item.id === draft.itemId)?.statusId || draft.statusId,
      })),
    );
    for (const result of results) {
      clearMove(result.itemId);
      const folderId = converted.find((draft) => draft.itemId === result.itemId)?.folderId;
      if (result.draftId && folderId) saveTaskRepo(group.id, result.draftId, folderId);
    }
    setTaskRepos(readTaskRepos(group.id));
    await relinkTaskChats(api, sessionsRef.current, results);
    window.dispatchEvent(
      new CustomEvent('kalkidan-github-writes', { detail: { groupId: group.id } }),
    );
    await refreshBoard().catch(() => undefined);
    const failed = results.filter((result) => result.error);
    if (failed.length)
      showToast({
        message:
          `${plural(failed.length, 'issue')} did not change back to a draft. ` +
          `${failed[0].error}`,
        tone: 'error',
      });
  }
  /**
   * Where a new chat on a task works: a branch copy, or the code folder itself when the folder
   * has no Git branch. The card Start and the sheet Start use the same default.
   */
  async function defaultMode(folderId: string) {
    if (typeof api.workingStatus !== 'function') return 'worktree';
    const value = await api.workingStatus(folderId).catch(() => null);
    return value && !value.branch ? 'current' : 'worktree';
  }
  /**
   * "Start" on a card: the preferred agent in a branch copy. When the code folder is not
   * clear, the task sheet opens instead.
   */
  const [quickBusy, setQuickBusy] = useState('');
  async function quickStart(item: TrackerItem, folderId = taskFolder(item)) {
    if (quickBusy) return;
    const repo = repos.find((r) => r.id === folderId);
    if (!repo) {
      chooseTask(item);
      return;
    }
    const agent = startAgent(agents);
    if (!agent) {
      openToolsSettings();
      return;
    }
    setQuickBusy(item.id);
    moveToProgress(item);
    const converted: ConvertedDraft[] = [];
    try {
      const [ready] = await ensureIssues([item], () => repo.id, converted);
      const mode = await defaultMode(repo.id);
      const branch = taskBranchName(ready);
      const target = await workTarget(repo, ready, mode, branch);
      saveFolder(group.id, repo.id);
      launch(target, agent, ready);
      if (mode === 'worktree') showToast(`Started on branch ${branch}.`);
    } catch (e) {
      clearMove(item.id);
      showToast({
        message: `Could not start a chat on “${item.title}”. ${errorMessage(e)}`,
        tone: 'error',
        actions: [{ label: 'Open task', onClick: () => chooseTask(item) }],
      });
    } finally {
      setQuickBusy('');
      announceConverted(converted);
    }
  }
  // A folder without a Git branch cannot have a branch copy. Then the agent works in it.
  useEffect(() => {
    setRepoStatus(null);
    if (!taskId || !repoId || typeof api.workingStatus !== 'function') return;
    let live = true;
    api
      .workingStatus(repoId)
      .then((value) => {
        if (!live) return;
        setRepoStatus({ branch: value.branch, defaultBranch: value.defaultBranch });
        if (!checkoutTouched.current) setCheckout(value.branch ? 'worktree' : 'current');
      })
      .catch(() => {
        // Without a status, the choice stays as it is.
      });
    return () => {
      live = false;
    };
  }, [api, taskId, repoId]);
  // Open the requested task once for each new ID.
  const openedTask = useRef('');
  useEffect(() => {
    if (!initialTaskId || !board || openedTask.current === initialTaskId) return;
    if (openTaskById(initialTaskId)) openedTask.current = initialTaskId;
  }, [initialTaskId, board]);
  async function refreshBoard() {
    const next = await reloadBoard();
    if (!next) return;
    setTask((previous) =>
      previous
        ? [...next.items, ...(next.archivedItems || [])].find((item) => item.id === previous.id) ||
          null
        : null,
    );
    return next;
  }
  async function action(
    fn: () => Promise<unknown>,
    refresh = true,
    showError: (message: string) => void = setError,
  ) {
    setBusy(true);
    showError('');
    try {
      await fn();
      if (refresh) await refreshBoard();
    } catch (e) {
      showError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  // Refresh reloads the board and the saved views together.
  const [viewsReload, setViewsReload] = useState(0);
  function refreshAll() {
    setViewsReload((value) => value + 1);
    // A failed sync shows in the toolbar, from the board state. It is not an action error.
    void action(refreshBoard, false, (message) => !message && setError(''));
  }
  const savedViews = useSavedViews({
    api,
    groupId: group.id,
    revision: board?.cache?.revision,
    reload: viewsReload,
    enabled:
      !!board && connection?.provider === 'github' && typeof api.trackerSavedView === 'function',
    onChange: changeSavedView,
  });
  // The time of the last good load, for "Synced 1 minute ago" in the refresh tooltip.
  const [syncedAt, setSyncedAt] = useState(0);
  const [now, setNow] = useState(0);
  useEffect(() => {
    if (board && boardState.status === 'ready') {
      const time = Date.now();
      setSyncedAt(time);
      setNow(time);
    }
  }, [board, boardState.status]);
  // The menu text ages without a new load.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, []);
  // The board loads again when the window gets the focus, at most once each 30 seconds.
  const focusRefresh = useRef(() => {});
  useEffect(() => {
    focusRefresh.current = () => {
      if (linkedProject && !busy && Date.now() - syncedAt > 30000) refreshAll();
    };
  });
  useEffect(() => {
    const handle = () => focusRefresh.current();
    window.addEventListener('focus', handle);
    return () => window.removeEventListener('focus', handle);
  }, []);
  const currentRepository = embedded
    ? repos.find((repo) => repo.id === preferredRepoId)
    : undefined;
  const repositoryName = currentRepository && pathBasename(currentRepository.path);
  const items =
    (savedView
      ? [...(board?.items || []), ...(board?.archivedItems || [])]
      : archived
        ? board?.archivedItems
        : board?.items.map(withMove)
    )?.filter(
      (item) =>
        !savedViewPending &&
        (!savedView || savedView.itemIds.includes(item.id)) &&
        (!embedded ||
          (!!currentRepository &&
            !!item.repository &&
            [repositoryName, currentRepository.name].includes(pathBasename(item.repository)))) &&
        (status === 'all' || item.statusId === status || (status === 'none' && !item.statusId)) &&
        (repoFilter === 'all' ||
          (repoFilter === 'draft' ? !item.repository : item.repository === repoFilter)) &&
        `${item.title} ${item.repository || ''}`.toLowerCase().includes(query.toLowerCase()),
    ) || [];
  const sortedItems = savedView
    ? [...items].sort((a, b) => savedView.itemIds.indexOf(a.id) - savedView.itemIds.indexOf(b.id))
    : items;
  // The order on screen: column by column, as the board and the list show the tasks.
  const visualOrder = useMemo(() => {
    if (!board) return sortedItems;
    const options = board.statusField?.options || [];
    const ordered = trackerColumns(board).flatMap((column) =>
      sortedItems.filter(
        (item) => (options.some((o) => o.id === item.statusId) ? item.statusId : '') === column.id,
      ),
    );
    // Archived tasks can have a status that no column shows. They go last.
    return ordered.length === sortedItems.length
      ? ordered
      : [...ordered, ...sortedItems.filter((item) => !ordered.includes(item))];
  }, [board, sortedItems]);

  // Planning tools: they act on the selected tasks, or on the visible tasks.
  const github = connection?.provider === 'github';
  const planningTools: PlanningTool[] = !github
    ? []
    : [
        ...(typeof api.trackerBatch === 'function' ? (['fields'] as const) : []),
        ...(typeof api.trackerBatch === 'function' && typeof api.trackerRelations === 'function'
          ? (['iteration'] as const)
          : []),
        ...(typeof api.trackerContent === 'function' && typeof api.trackerRelations === 'function'
          ? (['readiness'] as const)
          : []),
        ...(typeof api.dispatchPrepare === 'function' ? (['dispatch'] as const) : []),
      ];
  const docsPlanAvailable = github && typeof api.trackerDocsPlan === 'function';
  // A GitHub board that the user can only read: write controls are off with this reason.
  const readOnly = github && board?.writable === false ? 'Read only' : '';
  const canMove = !!board?.statusField && !!descriptor?.capabilities.updateStatus;
  const writeCheck = useUncertainWriteRows(api, group.id, github);
  const [checkOpen, setCheckOpen] = useState(false);
  const progressOption = useMemo(() => {
    const options = board?.statusField?.options || [];
    const mapped = connection?.statusMapping?.progress;
    const name = (descriptor?.statusNames.progress || 'In progress').toLowerCase();
    return options.find((o) => (mapped ? o.id === mapped : o.name.trim().toLowerCase() === name));
  }, [board, connection?.statusMapping?.progress, descriptor]);
  /** Shows a task in In progress at once when it starts from the first column. */
  function moveToProgress(item: TrackerItem) {
    const first = board?.statusField?.options[0];
    if (!progressOption || readOnly || !canMove || !first || item.statusId !== first.id) return;
    setMoved((current) => ({ ...current, [item.id]: progressOption.id }));
  }
  function clearMove(id: string) {
    setMoved((current) => {
      const { [id]: _removed, ...rest } = current;
      return rest;
    });
  }
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const selectionAnchor = useRef('');
  const visibleIds = visualOrder.map((item) => item.id);
  const selectedVisible = visibleIds.filter((id) => selectedIds.has(id));
  const selection: TaskSelection | undefined =
    (planningTools.length || canMove) && !savedView
      ? {
          ids: selectedIds,
          toggle(item, range) {
            const anchor = selectionAnchor.current;
            setSelectedIds((current) => {
              const next = new Set(current);
              const from = visibleIds.indexOf(anchor);
              const to = visibleIds.indexOf(item.id);
              if (range && from >= 0 && to >= 0) {
                for (const id of visibleIds.slice(Math.min(from, to), Math.max(from, to) + 1))
                  next.add(id);
              } else if (next.has(item.id)) next.delete(item.id);
              else next.add(item.id);
              return next;
            });
            selectionAnchor.current = item.id;
          },
          selectAll: () => setSelectedIds(new Set(visibleIds)),
          clear: () => {
            setSelectedIds(new Set());
            selectionAnchor.current = '';
          },
        }
      : undefined;
  // A new view, filter or project starts with no selection.
  useEffect(() => {
    setSelectedIds(new Set());
    selectionAnchor.current = '';
  }, [group.id, view, savedView, archived]);
  const [tool, setTool] = useState<{ tool: PlanningTool; ids: string[]; all: boolean } | null>(
    null,
  );
  const [docsPlanOpen, setDocsPlanOpen] = useState(false);
  function openTool(name: PlanningTool) {
    if (!board) return;
    const ids = selectedVisible.length ? selectedVisible : visibleIds;
    // Never open an empty dialog: chats start only on issues.
    if (
      name === 'dispatch' &&
      !board.items.some((item) => ids.includes(item.id) && item.kind === 'Issue')
    ) {
      showToast('Select issues on the board first.');
      return;
    }
    // Drafts cannot start, so a chat starts only on the issues of the selection.
    const issues = (id: string) => board.items.find((item) => item.id === id)?.kind === 'Issue';
    setTool({
      tool: name,
      ids: name === 'dispatch' ? ids.filter(issues) : ids,
      all: !selectedVisible.length,
    });
  }

  /**
   * New task: a title field at the top of the first column. It shows the active board, so a
   * saved view, a filter, the archive or the list give way to it.
   */
  function openNewTask() {
    if (!linkedProject) {
      connect();
      return;
    }
    if (!board || readOnly || !descriptor?.capabilities.createItem) return;
    setPage('tasks');
    setView('board');
    setArchived(false);
    if (savedView || savedViewPending) savedViews.choose('');
    setQuery('');
    setStatus('all');
    setRepoFilter('all');
    setAdding(trackerColumns(board)[0]?.id ?? '');
    document.querySelector('.project-tracker .tracker-board')?.scrollTo({ left: 0 });
  }
  /**
   * Creates a task from the New task field. A GitHub issue or pull request URL adds that item.
   * With `start`, a chat starts on the new task. Returns false when it fails, so the title stays.
   */
  async function createInColumn(statusId: string, value: string, start = false) {
    setBusy(true);
    setError('');
    try {
      if (itemUrl(value)) {
        await client.importItem(group.id, value);
        await refreshBoard();
        showToast(`Added the task to the ${boardName}.`);
        return true;
      }
      const createdId = await client.draft(group.id, value, '');
      // The card shows the repo of the new task, and Start works in it.
      if (createdId && addRepo) {
        saveTaskRepo(group.id, createdId, addRepo.id);
        saveFolder(group.id, addRepo.id);
        setTaskRepos(readTaskRepos(group.id));
      }
      if (statusId && createdId && descriptor?.capabilities.updateStatus) {
        try {
          await client.status(group.id, createdId, statusId);
        } catch (e) {
          // The task exists. Clear the field, so Enter does not create it again.
          await refreshBoard();
          setError(
            'Task created, but its status could not be set. ' +
              `Move it on the board to try again. ${errorMessage(e)}`,
          );
          return true;
        }
      }
      const next = await refreshBoard();
      const created = start && createdId && next?.items.find((item) => item.id === createdId);
      if (created) {
        setAdding(null);
        void quickStart(created);
      }
      return true;
    } catch (e) {
      showToast({ message: `Could not create the task. ${errorMessage(e)}`, tone: 'error' });
      return false;
    } finally {
      setBusy(false);
    }
  }
  // The shell and the command palette send these events after they open this page.
  const eventRef = useRef<{
    newTask: () => void;
    tool: (name: string) => void;
    filter: (filter: TaskFilter) => void;
    openTask: (id: string) => void;
    view: (id: string) => void;
    layout: (value: string) => void;
    reload: () => void;
    check: () => void;
  }>(null!);
  eventRef.current = {
    newTask() {
      openNewTask();
    },
    tool(name) {
      if (name === 'docs' || name === 'docs-to-issues') {
        if (docsPlanAvailable) setDocsPlanOpen(true);
        return;
      }
      // Add existing: the New task field takes an issue or pull request URL.
      if (name === 'add-existing') {
        openNewTask();
        return;
      }
      // Readiness and dispatch are "Start N" in the selection bar now. It checks first.
      if (name === 'readiness' || name === 'dispatch') {
        if (page !== 'tasks') setPage('tasks');
        if (selectedItems.length) void startSelected();
        else showToast('Select tasks on the board first. Then use Start.');
        return;
      }
      if (!planningTools.includes(name as PlanningTool)) return;
      if (page !== 'tasks') setPage('tasks');
      openTool(name as PlanningTool);
    },
    layout(value) {
      setPage('tasks');
      setView(value === 'list' ? 'list' : 'board');
    },
    filter(filter) {
      applyFilter(filter);
    },
    openTask(id) {
      if (!openTaskById(id)) pendingTask.current = id;
    },
    reload() {
      void action(refreshBoard, false, (message) => !message && setError(''));
    },
    check() {
      setPage('tasks');
      if (writeCheck.rows.length) setCheckOpen(true);
    },
    view(id) {
      setPage('tasks');
      openSavedView(group.id, id);
    },
  };
  const pendingTask = useRef('');
  useEffect(() => {
    if (board && pendingTask.current && openTaskById(pendingTask.current)) pendingTask.current = '';
  }, [board]);
  useEffect(() => {
    if (embedded) return;
    const forGroup = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown> | undefined>).detail;
      // An event without a project is for the project that shows.
      return !detail?.groupId || detail.groupId === group.id ? detail || {} : null;
    };
    const handlers: [string, (event: Event) => void][] = [
      ['kalkidan-new-task', (event) => forGroup(event) && eventRef.current.newTask()],
      [
        'kalkidan-planning-tool',
        (event) => {
          const detail = forGroup(event);
          if (detail && typeof detail.tool === 'string') eventRef.current.tool(detail.tool);
        },
      ],
      [
        'kalkidan-board-filter',
        (event) => {
          const detail = forGroup(event);
          if (detail) eventRef.current.filter(detail as TaskFilter);
        },
      ],
      ['kalkidan-github-writes', (event) => forGroup(event) && eventRef.current.reload()],
      [
        'kalkidan-board-layout',
        (event) => {
          const detail = forGroup(event);
          if (detail && typeof detail.layout === 'string') eventRef.current.layout(detail.layout);
        },
      ],
      [checkWritesEvent, (event) => forGroup(event) && eventRef.current.check()],
      [
        'kalkidan-board-view',
        (event) => {
          const detail = forGroup(event);
          if (detail && typeof detail.viewId === 'string') eventRef.current.view(detail.viewId);
        },
      ],
      [
        'kalkidan-open-task',
        (event) => {
          const detail = forGroup(event);
          if (detail && typeof detail.itemId === 'string') eventRef.current.openTask(detail.itemId);
        },
      ],
    ];
    for (const [name, handle] of handlers) window.addEventListener(name, handle);
    return () => {
      for (const [name, handle] of handlers) window.removeEventListener(name, handle);
    };
  }, [embedded, group.id]);
  // Previous and next follow the screen: column by column, then top to bottom.
  const sheetOrder = savedView ? sortedItems : visualOrder;
  const taskIndex = sheetOrder.findIndex((item) => item.id === task?.id);
  const repositoryOptions = [
    ...new Set(
      board?.items.map((item) => item.repository).filter((repo): repo is string => !!repo) || [],
    ),
  ].sort();
  /** Applies a filter from Insights, the overview or the command palette. */
  function applyFilter(filter: TaskFilter) {
    setPage('tasks');
    setArchived(false);
    if (filter.status !== undefined) {
      const options = board?.statusField?.options || [];
      // An empty value means the tasks with no status.
      const value = filter.status.trim() || 'none';
      // The value can be a status ID or a status name.
      const match =
        value === 'all' || value === 'none'
          ? value
          : options.find((o) => o.id === value)?.id ||
            options.find((o) => o.name.toLowerCase() === value.toLowerCase())?.id;
      setStatus(match || 'all');
    }
    if (filter.repository !== undefined) setRepoFilter(filter.repository || 'all');
    if (filter.query !== undefined) {
      setQuery(filter.query);
      if (filter.query) setSearchOpen(true);
    }
  }
  // A saved filter can point at a status or repository that no longer exists.
  useEffect(() => {
    if (!board) return;
    const statuses = board.statusField?.options.map((option) => option.id) || [];
    if (!['all', 'none', ...statuses].includes(status)) setStatus('all');
    if (!['all', 'draft', ...repositoryOptions].includes(repoFilter)) setRepoFilter('all');
  }, [board]);
  const linkedSessions = task ? linkedChats(projectSessions, task.id) : [];
  const taskPr = taskPullRequest(linkedSessions);
  // "Mark done" shows when the pull request is merged and the task is not done yet.
  const doneOption = board?.statusField?.options.find((o) => isDoneStatus(o.name));
  const markDoneOption =
    taskPr?.state === 'merged' &&
    doneOption &&
    task?.statusId !== doneOption.id &&
    descriptor?.capabilities.updateStatus
      ? doneOption
      : undefined;
  const syncFailed = !!boardState.error && !busy;
  const syncText = busy
    ? `Syncing with ${providerName}…`
    : syncFailed
      ? `Could not sync with ${providerName}`
      : syncedAt
        ? now - syncedAt < 60000
          ? 'Synced just now'
          : `Synced ${relativeTime(new Date(syncedAt).toISOString())}`
        : '';
  const filterCount = (status !== 'all' ? 1 : 0) + (repoFilter !== 'all' ? 1 : 0);
  const filtered = !!query || filterCount > 0 || !!savedView || savedViewPending;
  const total = board?.items.length || 0;
  const countText = filtered
    ? `${items.length} of ${plural(total, 'task')}`
    : archived
      ? plural(items.length, 'archived task')
      : plural(total, 'task');
  // The name of the active filter, for the chip in the toolbar: "Todo", "No repository".
  const filterName = [
    status === 'none'
      ? 'No status'
      : status !== 'all'
        ? board?.statusField?.options.find((o) => o.id === status)?.name
        : '',
    repoFilter === 'draft' ? 'No repository' : repoFilter !== 'all' ? pathBasename(repoFilter) : '',
  ]
    .filter(Boolean)
    .join(' · ');
  function clearFilters() {
    setQuery('');
    setStatus('all');
    setRepoFilter('all');
    setSearchOpen(false);
  }
  const startBlocker = !repos.length
    ? 'Add a code folder first'
    : !repos.some((r) => r.id === repoId)
      ? 'Choose a code folder first'
      : checkout === 'worktree' && !taskBranch.trim()
        ? 'Enter a branch name first'
        : '';
  const startReady = !taskBusy && !startBlocker;
  const taskRepo = repos.find((r) => r.id === repoId);
  // The second line of the start box: "⑂ 12-review-authentication" or "on main".
  const branchText =
    checkout === 'worktree'
      ? taskBranch.trim() || 'New branch'
      : repoStatus?.branch
        ? `on ${repoStatus.branch}`
        : 'in the folder';
  const shownPage: ProjectPage = embedded ? 'tasks' : page;
  const showTasks = shownPage === 'tasks';
  const canStart = repos.length > 0;
  const savedViewsAvailable = github && typeof api.trackerSavedView === 'function';
  const statusUpdateAvailable =
    github && !!board?.writable && typeof api.trackerResourceChange === 'function';
  const archivedCount = board?.archivedItems?.length || 0;
  // The selected tasks. Drafts among them become issues on Start.
  const selectedItems = visualOrder.filter((item) => selectedIds.has(item.id));
  // The GitHub editor of a task: fields, the issue or pull request, and its comments.
  const editsItem = provider === 'github' && !!board?.writable && !!task;
  // The title and the description of a draft, an issue or a pull request can change here.
  const canEditText =
    editsItem &&
    (task?.kind === 'DraftIssue' ||
      ((task?.kind === 'Issue' || task?.kind === 'PullRequest') &&
        typeof api.trackerContent === 'function'));
  // A new key for the GitHub editor after a title or description change, so it loads again.
  const [textRevision, setTextRevision] = useState(0);
  function startEdit(part: 'title' | 'body') {
    if (!task || !canEditText) return;
    setEditText(part === 'title' ? task.title : task.body || '');
    setTaskError('');
    setEditing(part);
  }
  /** Saves the title or the description on GitHub. Escape cancels; an empty title does not save. */
  async function saveText() {
    if (!task || !editing || editBusy) return;
    const next = {
      title: editing === 'title' ? editText.trim() : task.title,
      body: editing === 'body' ? editText : task.body,
    };
    if (!next.title || (next.title === task.title && next.body === task.body)) {
      setEditing(null);
      return;
    }
    setEditBusy(true);
    setTaskError('');
    try {
      if (task.kind === 'DraftIssue')
        await api.trackerItemAction(group.id, task.id, { kind: 'edit-draft', ...next });
      else {
        const content = await api.trackerContent(group.id, task.id);
        await api.trackerContentChange(group.id, task.id, content.revision, {
          kind: 'edit',
          ...next,
        });
      }
      setTask({ ...task, ...next });
      setEditing(null);
      setTextRevision((value) => value + 1);
      await refreshBoard();
    } catch (e) {
      setTaskError(`Could not save the change. ${errorMessage(e)}`);
    } finally {
      setEditBusy(false);
    }
  }
  // The board name is the board menu: Refresh, Open on GitHub (the Roadmap is there), the
  // list or the board, saved views, archived tasks, the status update and Board settings.
  const boardTitle = linkedProject
    ? `${linkedProject.title}${linkedProject.number ? ` #${linkedProject.number}` : ''}`
    : '';
  const boardMenu = board && linkedProject && (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="sm"
          className="tracker-board-name text-foreground has-[>svg]:px-2"
          aria-label={`Board: ${boardTitle}`}
        >
          <Layers2 aria-hidden="true" className="size-4 text-muted-foreground" />
          <span className="truncate">{linkedProject.title}</span>
          {!!linkedProject.number && (
            <span className="tracker-board-number">#{linkedProject.number}</span>
          )}
          <ChevronDown aria-hidden="true" className="tracker-board-chevron text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" width="wide">
        <DropdownMenuItem disabled={busy} onSelect={refreshAll}>
          <RefreshCw className={busy ? 'size-4 animate-spin' : 'size-4'} />
          Refresh
          {syncText && <span className={menuShortcutClass}>{syncText}</span>}
        </DropdownMenuItem>
        {linkedProject.url && (
          <DropdownMenuItem asChild>
            <a href={linkedProject.url} target="_blank" rel="noreferrer">
              <ArrowUpRight className="size-4" />
              Open on {providerName}
            </a>
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => setView(view === 'list' ? 'board' : 'list')}>
          {view === 'list' ? <Columns3 className="size-4" /> : <List className="size-4" />}
          {view === 'list' ? 'Show as board' : 'Show as list'}
        </DropdownMenuItem>
        {savedViewsAvailable && <SavedViewsMenu value={savedViews} />}
        {!!archivedCount && !savedView && (
          <DropdownMenuItem onSelect={() => setArchived(!archived)}>
            <Archive className="size-4" />
            {archived ? 'Active tasks' : 'Archived tasks'}
            {!archived && <span className={menuShortcutClass}>{archivedCount}</span>}
          </DropdownMenuItem>
        )}
        <DropdownMenuSeparator />
        {statusUpdateAvailable && (
          <DropdownMenuItem onSelect={() => setStatusOpen(true)}>
            <Megaphone className="size-4" />
            Post status update…
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onSelect={() => openBoardSettings(group.id)}>
          <Settings className="size-4" />
          Board settings…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
  // After the bar closes, the focus goes back to the tasks.
  const endSelection = () => {
    selection?.clear();
    document
      .querySelector<HTMLElement>(
        '.project-tracker .tracker-board [data-task-focus][tabindex="0"], ' +
          '.project-tracker .tracker-list [data-task-focus]',
      )
      ?.focus();
  };
  /** Moves the selected tasks to a status, one after the other. */
  function moveSelected(statusId: string) {
    const ids = selectedVisible;
    const statusName = board?.statusField?.options.find((o) => o.id === statusId)?.name || '';
    void action(async () => {
      for (const id of ids) {
        const item = board?.items.find((i) => i.id === id);
        if (item && item.statusId !== statusId) await client.status(group.id, id, statusId);
      }
      selection?.clear();
      showToast(`Moved ${plural(ids.length, 'task')} to ${statusName}.`);
    });
  }
  /** Sets one field choice on the selected tasks. The menu choice is the review. */
  function setSelectedField(field: TrackerField, choice: { id: string; name: string }) {
    const chosen = selectedItems;
    void action(async () => {
      showToast(await setFieldOnTasks(api, group.id, field, choice, chosen));
    });
  }
  /**
   * "Start N": checks the selected tasks, then starts the ready ones in safe waves, each in its
   * own branch copy with its own chat. No dialog: the toast says what started and what waits.
   */
  async function startSelected() {
    if (waveBusy || !board || !selectedItems.length) return;
    const agent = startAgent(agents);
    if (!agent) {
      openToolsSettings();
      return;
    }
    setWaveBusy(true);
    const converted: ConvertedDraft[] = [];
    try {
      // Drafts become issues first, so every selected task can start.
      const chosen = await ensureIssues(selectedItems, taskFolder, converted);
      const result = await startTasksInWaves({
        api,
        group,
        items: chosen,
        repos,
        sessions: projectSessions,
        agent,
        folderFor: taskFolder,
      });
      for (const item of result.started) moveToProgress(item);
      selection?.clear();
      const first = result.skipped[0];
      const started = result.started.length;
      const message = [
        started
          ? `Started ${plural(started, 'task')} with ${agentLabel(agent)}` +
            (started > safeWave ? `, ${safeWave} at a time.` : '.')
          : '',
        first
          ? `${plural(result.skipped.length, 'task')} did not start: ${first.reason.toLowerCase()}` +
            (result.skipped.length > 1 ? ' and more.' : '.')
          : '',
      ]
        .filter(Boolean)
        .join(' ');
      showToast({
        message,
        tone: started ? undefined : 'error',
        actions: first ? [{ label: 'Open task', onClick: () => chooseTask(first.item) }] : [],
      });
      if (started) void action(refreshBoard, false);
    } catch (e) {
      showToast({ message: `Could not start the tasks. ${errorMessage(e)}`, tone: 'error' });
    } finally {
      setWaveBusy(false);
      announceConverted(converted);
    }
  }
  const choiceFields = (board?.fields || []).filter(
    (field) => field.id !== board?.statusField?.id && !!fieldChoices(field)?.length,
  );
  const startAvailable = planningTools.includes('dispatch') && canStart && !archived;
  // "3 selected │ ▷ Start 3 with Codex │ Move to ▾ │ Set field ▾ │ ✕" floats over the board.
  const selectionBar = selection && selectedVisible.length > 0 && showTasks && (
    <div
      className="tracker-selection-bar"
      role="toolbar"
      aria-label="Selected tasks"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          endSelection();
        }
      }}
    >
      <span className="tracker-selection-count" role="status">
        {selectedVisible.length} selected
      </span>
      {startAvailable &&
        (preferredAgent ? (
          // "Start 3 with Codex" counts every selected task: drafts become issues on Start.
          <Button
            className="tracker-selection-start gap-1.5 [&_svg]:size-3.5"
            disabled={waveBusy}
            aria-label={`Start ${plural(selectedVisible.length, 'task')} with ${agentLabel(preferredAgent)}`}
            onClick={() => void startSelected()}
          >
            {waveBusy ? (
              <LoaderCircle className="size-3.5 animate-spin" />
            ) : (
              <Play className="size-3.5" />
            )}
            {waveBusy
              ? 'Starting…'
              : `Start ${selectedVisible.length} with ${agentLabel(preferredAgent)}`}
          </Button>
        ) : (
          <Button
            variant="ghost"
            className="gap-1.5 text-background hover:bg-background/15 hover:text-background"
            onClick={openToolsSettings}
          >
            No agent found
          </Button>
        ))}
      {canMove && (
        <DropdownMenu>
          <StartHint reason={readOnly}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="gap-1.5 px-2.5 text-background hover:bg-background/15 hover:text-background"
                disabled={busy || !!readOnly}
              >
                Move to
                <ChevronDown aria-hidden="true" className="size-3" />
              </Button>
            </DropdownMenuTrigger>
          </StartHint>
          <DropdownMenuContent align="start" side="top">
            {board?.statusField?.options.map((option) => (
              <DropdownMenuItem key={option.id} onSelect={() => moveSelected(option.id)}>
                <StatusIcon name={option.name} size={16} />
                {option.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      {planningTools.includes('fields') && choiceFields.length > 0 && (
        <DropdownMenu>
          <StartHint reason={readOnly}>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                className="gap-1.5 text-background hover:bg-background/15 hover:text-background [&_svg]:size-3"
                disabled={busy || !!readOnly}
              >
                Set field
                <ChevronDown aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
          </StartHint>
          <DropdownMenuContent align="start" side="top">
            {choiceFields.map((field) => (
              <DropdownMenuSub key={field.id}>
                <DropdownMenuSubTrigger>{field.name}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent>
                  {fieldChoices(field)!.map((choice) => (
                    <DropdownMenuItem
                      key={choice.id}
                      onSelect={() => setSelectedField(field, choice)}
                    >
                      {choice.name}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
      <span className="tracker-selection-divider" aria-hidden="true" />
      <Hint label="Clear selection" shortcut="Esc">
        <Button
          variant="ghost"
          size="icon"
          className="tracker-selection-clear w-[30px] text-background hover:bg-background/15 hover:text-background"
          aria-label="Clear selection"
          aria-keyshortcuts="Escape"
          onClick={endSelection}
        >
          <X className="size-3.5" />
        </Button>
      </Hint>
    </div>
  );
  // N opens New task, when the focus is not in a field and no dialog or menu is open.
  const newTaskKey = useRef(() => {});
  newTaskKey.current = () => openNewTask();
  const keyActive = showTasks && !!board && !readOnly && !embedded;
  useEffect(() => {
    if (!keyActive) return;
    const handle = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'n' && event.key !== 'N') return;
      if (event.metaKey || event.ctrlKey || event.altKey || event.defaultPrevented) return;
      const target = event.target as HTMLElement | null;
      if (
        target?.closest(
          'input, textarea, select, [contenteditable="true"], [role="dialog"], [role="menu"]',
        ) ||
        document.querySelector('[role="dialog"], [role="menu"]')
      )
        return;
      event.preventDefault();
      newTaskKey.current();
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [keyActive]);
  // A read-only board has no New task. The "Read only" badge tells why.
  const newTaskButton = !readOnly && (
    <Hint label="New task" shortcut="N">
      <Button
        size="sm"
        disabled={!descriptor?.capabilities.createItem}
        aria-keyshortcuts="N"
        onClick={() => {
          // While the field is open, the button puts the focus back in it.
          const open = document.querySelector<HTMLElement>('.project-tracker .tracker-quick-title');
          if (open) open.focus();
          else openNewTask();
        }}
      >
        <Plus size={16} />
        New task
        <kbd className="tracker-new-task-key" aria-hidden="true">
          N
        </kbd>
      </Button>
    </Hint>
  );
  // One row: the board name (the menu), the health line, then the GitHub check, search and New
  // task on the right.
  const taskToolbar = (
    <div className="tracker-filterbar" role="toolbar" aria-label="Task tools">
      {boardMenu}
      {readOnly && (
        <Hint label="You can only read this board. Ask the board owner for access.">
          <Badge variant="muted" size="md" className="tracker-read-only" tabIndex={0}>
            <Lock aria-hidden="true" />
            {readOnly}
          </Badge>
        </Hint>
      )}
      {board && (
        <BoardHealthLine
          board={board}
          syncing={busy && !!linkedProject}
          syncError={syncFailed && !actionError ? boardState.error || '' : undefined}
          onRetry={refreshAll}
          onSignIn={
            authErrorPattern.test(boardState.error || '')
              ? () => openConnectBoard({ groupId: group.id })
              : undefined
          }
          onFilter={applyFilter}
          noRepository={
            board.items.filter((item) => !item.repository && !taskRepos[item.id]).length
          }
        />
      )}
      {board && (
        <UncertainWritesChip
          api={api}
          groupId={group.id}
          board={board}
          rows={writeCheck.rows}
          open={checkOpen}
          onOpenChange={setCheckOpen}
          onChecked={writeCheck.reload}
          onOpenTask={(id) => void openTaskById(id)}
        />
      )}
      {filterName && (
        <Tag removeLabel={`Clear the filter ${filterName}`} onRemove={clearFilters}>
          {filterName}
        </Tag>
      )}
      {savedView && <SavedViewFilterChip view={savedView} />}
      {archived && (
        <Tag removeLabel="Show active tasks" onRemove={() => setArchived(false)}>
          Archived
        </Tag>
      )}
      <span id="tracker-sync-text" className="sr-only" role="status">
        {syncText}
      </span>
      <div className="tracker-filter-end">
        {searchOpen || query ? (
          <SearchInput
            autoFocus={searchOpen && !query}
            size="sm"
            className="tracker-search"
            aria-label="Search tasks"
            placeholder="Search tasks"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onBlur={() => !query && setSearchOpen(false)}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault();
                setQuery('');
                setSearchOpen(false);
              }
            }}
          />
        ) : (
          <Hint label="Search tasks">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Search tasks"
              onClick={() => setSearchOpen(true)}
            >
              <Search />
            </Button>
          </Hint>
        )}
        {newTaskButton}
      </div>
    </div>
  );
  return (
    <section
      className={embedded ? 'project-tracker embedded-tracker' : 'project-tracker'}
      data-page={shownPage}
      aria-label={embedded ? 'Repository project tasks' : 'Project tracker'}
    >
      {embedded ? (
        <PageHeader
          className="tracker-project-heading"
          icon={
            <EntityIcon color={group.color ? projectColors[group.color] : undefined}>
              <Folder />
            </EntityIcon>
          }
          title="Project tasks"
          subtitle={
            <>
              {connection?.provider === 'github' || !connection ? (
                <span
                  className="tracker-provider-mark"
                  style={{ maskImage: 'url(./icons/github.svg)' }}
                  aria-hidden="true"
                />
              ) : (
                <Layers2 size={12} aria-hidden="true" />
              )}
              <span className="truncate">
                {linkedProject ? (
                  <>
                    {boardName} · <span>{linkedProject.title}</span>
                    {linkedProject.number ? ` #${linkedProject.number}` : ''}
                  </>
                ) : (
                  `No ${boardName}`
                )}
              </span>
              {showTasks && board && <span className="tracker-subtitle-count">· {countText}</span>}
            </>
          }
        />
      ) : null}
      {/* A sync error shows in the health line. A failed action shows here, above the toolbar. */}
      {actionError && (
        <Alert variant="destructive" size="sm" className="tracker-alert">
          <TriangleAlert aria-hidden="true" />
          <AlertDescription>
            {actionError}
            {linkedProject &&
              (authErrorPattern.test(actionError) ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => openConnectBoard({ groupId: group.id })}
                >
                  Sign in to {providerName}
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled={busy} onClick={refreshAll}>
                  Try again
                </Button>
              ))}
          </AlertDescription>
        </Alert>
      )}
      {showTasks && linkedProject && taskToolbar}
      {!linkedProject ? (
        // No board: the page itself lists the boards. One click connects.
        <ConnectBoardPanel
          api={api}
          group={group}
          onConnected={async () => {
            setPage('tasks');
            await onRefresh();
          }}
        />
      ) : !board ? (
        busy ? (
          <div className="tracker-board tracker-skeleton" aria-hidden="true">
            {[0, 1, 2].map((column) => (
              <div key={column} className="tracker-column">
                <span className="tracker-skeleton-heading" />
                <span className="tracker-skeleton-card" />
                <span className="tracker-skeleton-card" />
              </div>
            ))}
          </div>
        ) : (
          <EmptyState compact className="tracker-empty-result">
            Could not load the tasks.
          </EmptyState>
        )
      ) : (
        !items.length &&
        (filtered ? (
          // The columns stay and dim (see the board). The x in the search field clears it.
          <span className="sr-only" role="status">
            No matching tasks
          </span>
        ) : archived ? (
          <EmptyState
            title="No archived tasks"
            className="tracker-empty-result"
            action={
              <Button variant="outline" onClick={() => setArchived(false)}>
                Show active tasks
              </Button>
            }
          />
        ) : view === 'list' ? (
          <EmptyState compact className="tracker-empty-result">
            No tasks yet.
          </EmptyState>
        ) : null)
      )}
      {board &&
        showTasks &&
        linkedProject &&
        (savedView ? (
          <GitHubViewLayout
            board={board}
            items={sortedItems}
            view={savedView}
            mode={view}
            onOpen={chooseTask}
          />
        ) : view === 'list' ? (
          !!items.length && (
            <div className="tracker-list-view">
              <TrackerList
                board={board}
                items={sortedItems}
                sessions={projectSessions}
                busy={busy || !!readOnly || !descriptor?.capabilities.updateStatus}
                onOpen={chooseTask}
                onStatus={(item, value) =>
                  void action(() => client.status(group.id, item.id, value))
                }
                activity={activity}
                live={live}
                identity={identity}
                onAllow={allowChat}
                folderOf={cardFolder}
                onOpenChat={openChat}
                onStart={canStart && !archived ? (item) => void quickStart(item) : undefined}
                startingId={quickBusy}
                readOnly={readOnly}
                selection={selection}
              />
            </div>
          )
        ) : (
          (!!items.length || !archived) && (
            <TrackerBoard
              board={board}
              items={sortedItems}
              dimmed={filtered && !items.length}
              sessions={projectSessions}
              busy={busy || !descriptor?.capabilities.updateStatus}
              onCreate={
                descriptor?.capabilities.createItem && !readOnly && !archived && !savedView
                  ? createInColumn
                  : undefined
              }
              adding={adding}
              onAddingChange={setAdding}
              folders={repos}
              addFolderId={addRepo?.id}
              onAddFolderChange={setAddRepoId}
              startLabel={preferredAgent ? `start with ${agentLabel(preferredAgent)}` : undefined}
              folderOf={cardFolder}
              onOpen={chooseTask}
              onStatus={(item, value) => void action(() => client.status(group.id, item.id, value))}
              activity={activity}
              live={live}
              identity={identity}
              onAllow={allowChat}
              onOpenChat={openChat}
              onStart={canStart && !archived ? (item) => void quickStart(item) : undefined}
              startingId={quickBusy}
              readOnly={readOnly}
              selection={selection}
            />
          )
        ))}
      {selectionBar}
      {board && tool && (
        <PlanningToolDialog
          key={tool.tool}
          tool={tool.tool}
          open
          onOpenChange={(open) => {
            if (open) return;
            setTool(null);
            void action(refreshBoard, false);
          }}
          api={api}
          group={group}
          board={board}
          selectedIds={tool.ids}
          allTasks={tool.all}
          onSaved={() => void action(refreshBoard, false)}
          onOpenTask={(id) => {
            setTool(null);
            openTaskById(id);
          }}
        />
      )}
      {docsPlanAvailable && (
        <DocsToIssuesDialog
          api={api}
          group={group}
          open={docsPlanOpen}
          onOpenChange={(open) => {
            setDocsPlanOpen(open);
            if (!open) void action(refreshBoard, false);
          }}
        />
      )}
      {board && statusUpdateAvailable && (
        <Dialog open={statusOpen} onOpenChange={setStatusOpen}>
          <DialogContent size="lg" layout="scroll">
            <DialogHeader>
              <DialogTitle>Post status update</DialogTitle>
              <DialogDescription className="sr-only">
                Write a status update for the board and post it on {providerName}.
              </DialogDescription>
            </DialogHeader>
            <DialogBody>
              <ProjectHealth
                api={api}
                groupId={group.id}
                board={board}
                onFilter={(filter) => {
                  setStatusOpen(false);
                  applyFilter(filter);
                }}
              />
            </DialogBody>
          </DialogContent>
        </Dialog>
      )}
      {/*
       * The task sheet floats on the right with a shadow and no scrim, so the board stays live
       * behind it (TK-9). A click on another card shows that task in the sheet.
       */}
      <Dialog
        modal={false}
        open={!!task}
        onOpenChange={(open) => !open && !taskBusy && setTask(null)}
      >
        <DialogContent
          showCloseButton={false}
          className="tracker-issue-detail top-0 right-0 left-auto flex h-dvh max-h-dvh w-[min(440px,100vw)] max-w-[100vw] translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:max-w-[100vw] data-[state=closed]:zoom-out-100 data-[state=closed]:slide-out-to-right-4 data-[state=open]:zoom-in-100 data-[state=open]:slide-in-from-right-4"
          onOpenAutoFocus={(event) => {
            // The title is the first stop, so a screen reader starts with the task name.
            event.preventDefault();
            taskTitle.current?.focus();
          }}
          onInteractOutside={(event) => {
            // A card, a menu or a toast does not close the sheet. A card shows its task here.
            const target = event.target as HTMLElement | null;
            if (target?.closest('.tracker-task, [role="menu"], [data-sonner-toaster], .toast'))
              event.preventDefault();
          }}
          onCloseAutoFocus={(event) => {
            // Return to the card of the last task that showed, also after previous and next.
            const card = document.querySelector<HTMLElement>(
              `[data-task-focus="${CSS.escape(lastTaskId.current)}"]`,
            );
            if (card?.offsetParent) {
              event.preventDefault();
              card.focus();
            }
          }}
        >
          <div className="tracker-issue-nav">
            <Hint label="Previous task">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Previous task"
                disabled={taskBusy || taskIndex <= 0}
                onClick={() => chooseTask(sheetOrder[taskIndex - 1])}
              >
                <ChevronLeft size={16} />
              </Button>
            </Hint>
            <Hint label="Next task">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Next task"
                disabled={taskBusy || taskIndex < 0 || taskIndex >= sheetOrder.length - 1}
                onClick={() => chooseTask(sheetOrder[taskIndex + 1])}
              >
                <ChevronRight size={16} />
              </Button>
            </Hint>
            {task && (
              <ItemActionsMenu
                api={api}
                groupId={group.id}
                item={task}
                onSaved={refreshBoard}
                size="sm"
                editable={editsItem}
                openLabel={`Open on ${providerName}`}
                extra={[
                  {
                    label: 'Link a chat…',
                    icon: <MessageSquare className="size-4" />,
                    action: () => setChatPickerOpen(true),
                  },
                  ...(docsAvailable
                    ? [
                        {
                          label: 'Link a page…',
                          icon: <FileText className="size-4" />,
                          action: () => setDocPickerOpen(true),
                        },
                        ...docLinks.map((doc) => ({
                          label: `Unlink “${doc.title}”`,
                          icon: <X className="size-4" />,
                          action: () =>
                            void changeDocLinks(docLinks.filter((d) => d.id !== doc.id)),
                        })),
                      ]
                    : []),
                ]}
              />
            )}
            <Hint label="Close" shortcut="Esc">
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Close task"
                disabled={taskBusy}
                onClick={() => setTask(null)}
              >
                <X size={16} />
              </Button>
            </Hint>
          </div>
          <div className="tracker-issue-body">
            <DialogHeader className="tracker-sheet-head pr-0">
              {editing === 'title' ? (
                <Input
                  autoFocus
                  aria-label="Task title"
                  className="tracker-edit-title h-9 text-[18px] leading-7 font-semibold"
                  maxLength={256}
                  value={editText}
                  disabled={editBusy}
                  onChange={(event) => setEditText(event.target.value)}
                  onBlur={() => void saveText()}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      event.stopPropagation();
                      setEditing(null);
                    } else if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                      event.preventDefault();
                      void saveText();
                    }
                  }}
                />
              ) : (
                <div className="tracker-issue-title-row">
                  <DialogTitle
                    ref={taskTitle}
                    tabIndex={-1}
                    className="tracker-issue-title py-0 text-[18px] leading-7"
                    data-editable={canEditText || undefined}
                    onClick={canEditText ? () => startEdit('title') : undefined}
                  >
                    {task?.title}
                  </DialogTitle>
                  {canEditText && (
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      className="tracker-edit-button"
                      aria-label="Edit title"
                      onClick={() => startEdit('title')}
                    >
                      <PenLine />
                    </Button>
                  )}
                </div>
              )}
              <DialogDescription className="sr-only">
                {task?.repository || 'Project task'}
              </DialogDescription>
              {/*
               * One line under the title: the status, the number and the links that exist
               * ("Todo · #142 · Search API spec"). Nothing shows for what is missing (TK-8).
               */}
              {task && (
                <div className="tracker-sheet-meta" role="group" aria-label="Task properties">
                  {board?.statusField && descriptor?.capabilities.updateStatus && !readOnly ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          className="tracker-sheet-link"
                          aria-label={`Status: ${task.status || 'No status'}`}
                          disabled={busy}
                        >
                          {task.status || 'No status'}
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start">
                        <DropdownMenuLabel>Status</DropdownMenuLabel>
                        {board.statusField.options.map((option) => (
                          <DropdownMenuItem
                            key={option.id}
                            disabled={option.id === task.statusId}
                            onSelect={() =>
                              void action(
                                () => client.status(group.id, task.id, option.id),
                                true,
                                setTaskError,
                              )
                            }
                          >
                            <StatusIcon name={option.name} size={16} />
                            {option.name}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : (
                    <span>{task.status || 'No status'}</span>
                  )}
                  {task.number ? (
                    <>
                      <span aria-hidden="true">·</span>
                      {task.url ? (
                        <a
                          className="tracker-sheet-link tabular-nums"
                          href={task.url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`#${task.number}. Opens on ${providerName}`}
                        >
                          #{task.number}
                        </a>
                      ) : (
                        <span className="tabular-nums">#{task.number}</span>
                      )}
                    </>
                  ) : (
                    task.kind === 'DraftIssue' && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>Draft</span>
                      </>
                    )
                  )}
                  {docLinks.map((doc) => (
                    <Fragment key={doc.id}>
                      <span aria-hidden="true">·</span>
                      {onOpenDocs ? (
                        <button
                          type="button"
                          className="tracker-sheet-link"
                          onClick={() => {
                            setTask(null);
                            onOpenDocs(doc.id);
                          }}
                        >
                          {doc.title}
                        </button>
                      ) : (
                        <span>{doc.title}</span>
                      )}
                    </Fragment>
                  ))}
                  {linkedSessions.map((s) => {
                    const state = activity[activityKey(s.agent, s.id)];
                    const name = s.organization?.title || s.title;
                    const color = identity.sessionColor(s);
                    return (
                      <Fragment key={s.agent + s.id}>
                        <span aria-hidden="true">·</span>
                        <button
                          type="button"
                          className="tracker-sheet-link tracker-sheet-chat"
                          aria-label={`Open chat: ${name}${state ? `. ${activityText(state, s.agent)}` : ''}`}
                          onClick={() => {
                            setTask(null);
                            openChat(s);
                          }}
                        >
                          {color && <IdentityMark kind="session" color={color} slot={false} />}
                          <span className="truncate">{name}</span>
                          <StatusGlyph
                            status={
                              state === 'running' ? 'working' : state ? 'needs-you' : undefined
                            }
                          />
                        </button>
                      </Fragment>
                    );
                  })}
                  {taskPr && (
                    <>
                      <span aria-hidden="true">·</span>
                      <a
                        className="tracker-sheet-link tabular-nums"
                        href={taskPr.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <GitPullRequest aria-hidden="true" />
                        {taskPr.number ? `#${taskPr.number}` : 'Pull request'}
                        {taskPr.state ? ` · ${pullRequestStateWord(taskPr.state)}` : ''}
                      </a>
                      {markDoneOption && (
                        <button
                          type="button"
                          className="tracker-sheet-link"
                          disabled={busy}
                          onClick={() =>
                            void action(
                              () => client.status(group.id, task.id, markDoneOption.id),
                              true,
                              setTaskError,
                            )
                          }
                        >
                          <CircleCheck aria-hidden="true" />
                          Mark done
                        </button>
                      )}
                    </>
                  )}
                </div>
              )}
            </DialogHeader>
            {/*
             * One 32px row: where the agent works (the repo; the branch is in its menu), then
             * Start with an agent found on this computer (TK-7, R6).
             */}
            <div className="tracker-start-row">
              {repos.length > 0 ? (
                <Popover.Root open={whereOpen} onOpenChange={setWhereOpen}>
                  <Popover.Trigger asChild>
                    <Button
                      variant="secondary"
                      className="tracker-start-repo gap-1.5 bg-background px-3 shadow-[inset_0_0_0_1px_var(--border)] hover:bg-[var(--fill)] has-[>svg]:px-3"
                      disabled={taskBusy}
                      aria-label={`Where to work: ${taskRepo?.name || 'Choose a code folder'} · ${branchText}`}
                    >
                      {taskRepo && identity.repoColor(taskRepo.name) && (
                        <IdentityMark
                          kind="repo"
                          color={identity.repoColor(taskRepo.name)!}
                          slot={false}
                        />
                      )}
                      <span className="truncate">{taskRepo?.name || 'Choose a code folder'}</span>
                      <ChevronDown aria-hidden="true" className="size-3 text-muted-foreground" />
                    </Button>
                  </Popover.Trigger>
                  <Popover.Portal>
                    <Popover.Content
                      align="start"
                      sideOffset={6}
                      collisionPadding={menuCollisionPadding}
                      aria-label="Where to work"
                      className={cn(menuContentClass, 'tracker-start-options grid w-72 gap-3 p-3')}
                    >
                      <fieldset disabled={taskBusy}>
                        <legend className="group-label">Code folder</legend>
                        {repos.map((r) => {
                          const color = identity.repoColor(r.name);
                          return (
                            <label key={r.id} className="tracker-radio-row">
                              <Radio
                                name="task-folder"
                                value={r.id}
                                checked={repoId === r.id}
                                onChange={() => {
                                  checkoutTouched.current = false;
                                  setRepoId(r.id);
                                }}
                              />
                              {color && <IdentityMark kind="repo" color={color} slot={false} />}
                              <span className="truncate">{r.name}</span>
                            </label>
                          );
                        })}
                      </fieldset>
                      <fieldset disabled={taskBusy}>
                        <legend className="group-label">Branch</legend>
                        <label className="tracker-radio-row">
                          <Radio
                            name="task-checkout"
                            value="worktree"
                            checked={checkout === 'worktree'}
                            onChange={() => {
                              checkoutTouched.current = true;
                              setCheckout('worktree');
                              if (task && !taskBranch.trim()) setTaskBranch(taskBranchName(task));
                            }}
                          />
                          <Hint label="The agent works in a separate copy of the folder. Your work does not change.">
                            <span className="shrink-0">New branch</span>
                          </Hint>
                        </label>
                        <div className="tracker-branch-input">
                          <Input
                            size="sm"
                            aria-label="Task branch"
                            value={taskBranch}
                            onFocus={() => {
                              checkoutTouched.current = true;
                              setCheckout('worktree');
                            }}
                            onChange={(e) => setTaskBranch(e.target.value)}
                            onKeyDown={(event) => {
                              if (event.key === 'Enter') setWhereOpen(false);
                            }}
                            placeholder="feature/task-name"
                          />
                        </div>
                        <label className="tracker-radio-row">
                          <Radio
                            name="task-checkout"
                            value="current"
                            checked={checkout === 'current'}
                            onChange={() => {
                              checkoutTouched.current = true;
                              setCheckout('current');
                            }}
                          />
                          <span className="truncate">
                            {repoStatus?.branch
                              ? `Work on ${repoStatus.branch}`
                              : 'Work in the folder'}
                          </span>
                        </label>
                      </fieldset>
                    </Popover.Content>
                  </Popover.Portal>
                </Popover.Root>
              ) : null}
              {!repos.length ? (
                <Button
                  variant="secondary"
                  onClick={() => {
                    setTask(null);
                    addFolder();
                  }}
                >
                  <FolderPlus />
                  Add code folder…
                </Button>
              ) : !preferredAgent ? (
                <Button variant="secondary" className="ml-auto" onClick={openToolsSettings}>
                  No agent found
                </Button>
              ) : (
                <StartHint reason={taskBusy ? '' : startBlocker}>
                  <div className="split-button ml-auto" role="group" aria-label="Start task">
                    <Button
                      className="rounded-r-none px-3 has-[>svg]:px-3 [&_svg]:size-3.5"
                      disabled={!startReady}
                      aria-label={`Start task with ${agentLabel(preferredAgent)}`}
                      onClick={() => void startTask(preferredAgent)}
                    >
                      {taskBusy ? (
                        <LoaderCircle className="size-3.5 animate-spin" />
                      ) : (
                        <Play className="size-3.5" />
                      )}
                      {taskBusy ? 'Starting…' : `Start with ${agentLabel(preferredAgent)}`}
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          size="icon"
                          disabled={!startReady}
                          className="rounded-l-none border-l border-primary-foreground/20"
                          aria-label="Choose an agent"
                        >
                          <ChevronDown className="size-3.5" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent
                        align="end"
                        sideOffset={8}
                        className="tracker-agent-menu w-[232px]"
                      >
                        <AgentMenuItems
                          agents={agents}
                          current={preferredAgent}
                          onPick={(agent) => {
                            savePreferredAgent(agent);
                            void startTask(agent);
                          }}
                        />
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </StartHint>
              )}
            </div>
            {taskError && (
              <p role="alert" className="field-error">
                {taskError}
              </p>
            )}
            {editing === 'body' ? (
              <div className="grid gap-2">
                <Textarea
                  autoFocus
                  rows={6}
                  aria-label="Task description"
                  maxLength={20000}
                  value={editText}
                  disabled={editBusy}
                  onChange={(event) => setEditText(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault();
                      event.stopPropagation();
                      setEditing(null);
                    } else if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault();
                      void saveText();
                    }
                  }}
                />
                <div className="flex justify-end gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={editBusy}
                    onClick={() => setEditing(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={editBusy}
                    onClick={() => void saveText()}
                  >
                    {editBusy ? 'Saving…' : 'Save'}
                  </Button>
                </div>
              </div>
            ) : canEditText ? (
              <div
                role="button"
                tabIndex={0}
                aria-label="Edit description"
                className="tracker-issue-description tracker-editable prose-ui"
                data-size="sm"
                data-empty={!task?.body?.trim() || undefined}
                onClick={(event) => {
                  if (!(event.target as HTMLElement).closest('a')) startEdit('body');
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    startEdit('body');
                  }
                }}
              >
                <Markdown remarkPlugins={[remarkGfm]} components={{ a: ExternalAnchor }}>
                  {task?.body?.trim() || 'Add a description'}
                </Markdown>
              </div>
            ) : (
              task?.body?.trim() && (
                <div className="tracker-issue-description prose-ui" data-size="sm">
                  <Markdown remarkPlugins={[remarkGfm]} components={{ a: ExternalAnchor }}>
                    {task.body}
                  </Markdown>
                </div>
              )
            )}
            {provider === 'github' && board?.writable && task && (
              <GitHubItemEditor
                key={task.id + ':' + textRevision}
                api={api}
                groupId={group.id}
                board={board}
                item={task}
                onSaved={refreshBoard}
                showFields
              />
            )}
          </div>
        </DialogContent>
      </Dialog>
      {docsAvailable && (
        <DocPagePicker
          api={api}
          groupId={group.id}
          open={docPickerOpen}
          onOpenChange={setDocPickerOpen}
          title="Link a page to this task"
          onPick={(doc) => {
            if (!docLinks.some((d) => d.id === doc.id))
              void changeDocLinks([...docLinks, { id: doc.id, title: doc.title || 'Untitled' }]);
            setDocPickerOpen(false);
          }}
        />
      )}
      {task && (
        <LinkChatDialog
          open={chatPickerOpen}
          onOpenChange={setChatPickerOpen}
          task={task}
          sessions={projectSessions}
          repos={repos}
          activity={activity}
          onLink={async (session) => {
            await api.updateSession(session.agent, session.id, { taskId: task.id });
            await onRefresh();
            showToast(`Linked “${session.organization?.title || session.title}” to this task.`);
          }}
        />
      )}
    </section>
  );
}

/** A picker of the chats of the project. Choosing one links it to the task. */
function LinkChatDialog({
  open,
  onOpenChange,
  task,
  sessions,
  repos,
  activity,
  onLink,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: TrackerItem;
  sessions: Session[];
  repos: Project[];
  activity: Record<string, SessionActivityState>;
  onLink: (session: Session) => Promise<void>;
}) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setQuery('');
      setError('');
    }
  }, [open]);
  const choices = sessions
    .filter(
      (s) =>
        !s.organization?.archived &&
        s.organization?.taskId !== task.id &&
        `${s.organization?.title || s.title}`.toLowerCase().includes(query.trim().toLowerCase()),
    )
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 50);
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent size="md" layout="scroll">
        <DialogHeader>
          <DialogTitle>Link a chat to this task</DialogTitle>
          <DialogDescription>
            The chat then shows on the task card, and the task shows in the chat.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-3">
          <SearchInput
            size="sm"
            aria-label="Search chats"
            placeholder="Search chats…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {choices.length ? (
            <ul className="list-box max-h-80" aria-label="Chats of this project">
              {choices.map((s) => {
                const name = s.organization?.title || s.title;
                const folder = sessionRepo(s, repos)?.name;
                const state = activity[activityKey(s.agent, s.id)];
                return (
                  <li key={s.agent + s.id}>
                    <button
                      type="button"
                      className="list-box-row"
                      disabled={!!busy}
                      onClick={async () => {
                        setBusy(s.agent + s.id);
                        setError('');
                        try {
                          await onLink(s);
                          onOpenChange(false);
                        } catch (e) {
                          setError(`Could not link the chat. ${errorMessage(e)}`);
                        } finally {
                          setBusy('');
                        }
                      }}
                    >
                      <AgentIcon agent={s.agent} />
                      <span className="min-w-0 flex-1 truncate">{name}</span>
                      <StatusGlyph
                        status={state === 'running' ? 'working' : state ? 'needs-you' : undefined}
                      />
                      {s.organization?.taskId && (
                        <span className="text-xs text-muted-foreground">Linked to a task</span>
                      )}
                      {folder && (
                        <span className="max-w-32 truncate text-xs text-muted-foreground">
                          {folder}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState
              compact
              icon={query ? <SearchX /> : <MessageSquare />}
              title={query ? 'No matching chats' : 'No other chats'}
            >
              {query ? 'No chat matches the search.' : 'This project has no other chats.'}
            </EmptyState>
          )}
          {error && (
            <Alert variant="destructive" size="sm">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

/** Tells why Start is disabled. The split button gets one tooltip for both parts. */
function StartHint({ reason, children }: { reason: string; children: ReactElement }) {
  return reason ? (
    <Hint label={reason} disabled>
      {children}
    </Hint>
  ) : (
    children
  );
}
