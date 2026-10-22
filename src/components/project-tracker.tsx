import { GitHubViewLayout, SavedViewFilterChip } from './github-view-layout';
import { SavedViewsMenu, openSavedView, useSavedViews } from './github-saved-views';
import type { SavedProjectView } from '../domain/github-resources';
import { TrackerRoadmap } from './tracker-roadmap';
import { trackerAuthPending } from '../domain/tracker';
import { GitHubItemEditor, ItemActionsMenu } from './github-item-editor';
import { useProjectBoard } from '../hooks/use-project-board';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  Archive,
  ArrowRightLeft,
  ArrowUpRight,
  CalendarRange,
  Check,
  CircleCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  FileStack,
  FolderPlus,
  GitBranch,
  GitPullRequest,
  ListChecks,
  ListFilter,
  Link2,
  Lock,
  MessageSquare,
  PenLine,
  Play,
  SearchX,
  Settings,
  ShieldCheck,
  SquareCheck,
  TriangleAlert,
  X,
} from 'lucide-react';
import { interfaceConfig } from '../config/interface';
import { agentCatalog, agentLabel } from '../config/agents';
import { trackerConnection } from '../domain/tracker';
import { useTracker } from '../hooks/use-tracker';
import { sessionRepo } from '../lib/session-repository';
import { pathBasename, plural } from '../lib/platform';
import { relativeTime } from '../lib/relative-time';
import { TrackerBoard } from './tracker-board';
import {
  StatusIcon,
  TrackerList,
  activityText,
  isDoneStatus,
  linkedChats,
  pullRequestStateWord,
  taskPullRequest,
  trackerColumns,
  type TaskSelection,
} from './tracker-list';
import { boardNoun } from './project-header';
import {
  DocsToIssuesDialog,
  PlanningToolDialog,
  type PlanningTool,
  type TaskFilter,
} from './planning-tools';
import {
  UncertainWritesPopover,
  uncertainWritesText,
  useUncertainWriteRows,
} from './github-write-history';
import { checkWritesEvent } from './planning-kit';
import {
  ActivityDot,
  activityKey,
  useActivityState,
  type SessionActivityState,
} from './activity-dot';
import { projectColors } from '../domain/project-colors';
import { EmptyState } from './ui/empty-state';
import { EntityIcon } from './ui/entity-icon';
import { PageHeader, SectionHeader } from './ui/page-header';
import { SegmentedControl } from './ui/segmented-control';
import { Radio } from './ui/checkbox';
import { MoreButton } from './ui/more-button';
import { menuShortcutClass } from './ui/menu-styles';
import { showToast } from './ui/toast';
import {
  useEffect,
  useRef,
  useState,
  useCallback,
  useMemo,
  type ComponentProps,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { Columns3, FileText, Folder, Layers2, List, RefreshCw, Plus } from 'lucide-react';
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
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import {
  onPreferredAgentChange,
  readPreferredAgent,
  savePreferredAgent,
} from '../lib/agent-preference';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { Alert, AlertDescription } from './ui/alert';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import { TrackerProjectPicker } from './tracker-project-picker';
import { Choice } from './choice';
import type {
  API,
  ProjectGroup,
  Project,
  TrackerItem,
  Agent,
  Session,
  TrackerAuthState,
} from '../types';
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
// The filter button shows when the board has more tasks than this. Search always shows.
const filterThreshold = 10;

export { boardNoun };

/** Opens Settings at a section. The shell listens for this event. */
function openSettings(section: 'general' | 'account' | 'agents' | 'computers' | 'about') {
  window.dispatchEvent(new CustomEvent('kalkidan-open-settings', { detail: { section } }));
}

/** Opens Project settings › Board. */
function openBoardSettings(groupId: string) {
  window.dispatchEvent(
    new CustomEvent('kalkidan-open-project-settings', { detail: { groupId, section: 'board' } }),
  );
}
/** Opens the board settings at its fields, with a suggested "Start date" and "End date". */
function openRoadmapDates(groupId: string) {
  window.dispatchEvent(
    new CustomEvent('kalkidan-open-project-settings', {
      detail: { groupId, section: 'board', tab: 'roadmap-dates' },
    }),
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

/** The chat command that opens the "Create pull request" dialog of the chat that shows. */
const createPullRequestCommand = 'create-pull-request';

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
      view: ['list', 'roadmap'].includes(text('view')) ? text('view') : 'board',
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

const planningLabels: Record<PlanningTool, string> = {
  fields: 'Edit fields…',
  iteration: 'Plan an iteration…',
  readiness: 'Check readiness…',
  dispatch: 'Start chats…',
};
const planningIcons: Record<PlanningTool, ReactElement> = {
  fields: <PenLine className="size-4" />,
  iteration: <CalendarRange className="size-4" />,
  readiness: <ShieldCheck className="size-4" />,
  dispatch: <Play className="size-4" />,
};

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
  onCloneFromGitHub,
  onNewSession,
  onOpenSession,
  onOpenDocs,
  onAllSessions,
  page: requestedPage,
  onPageChange,
}: {
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
  /** Opens the clone dialog. Without it, the panel opens the Add code folder dialog. */
  onCloneFromGitHub?: () => void;
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
  // The agent works in a branch copy unless the user changes it, or the folder has no Git.
  const [checkout, setCheckout] = useState('worktree');
  // "Change" in the footer of the task sheet shows the code folder and branch choices.
  const [changing, setChanging] = useState(false);
  // The title or the description that the user edits in the task sheet.
  const [editing, setEditing] = useState<'title' | 'body' | null>(null);
  const [editText, setEditText] = useState('');
  const [editBusy, setEditBusy] = useState(false);
  // The sheet footer mounts after the task opens, so the effect below waits for the node.
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
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
  const [filtersOpen, setFiltersOpen] = useState(
    () =>
      savedFilters.status !== 'all' ||
      savedFilters.repoFilter !== 'all' ||
      savedFilters.sort !== 'project',
  );
  const [docPickerOpen, setDocPickerOpen] = useState(false);
  const [chatPickerOpen, setChatPickerOpen] = useState(false);
  const [taskBranch, setTaskBranch] = useState('');
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskError, setTaskError] = useState('');
  const [auth, setAuth] = useState<TrackerAuthState>({ status: 'idle' });
  const { state: boardState, refresh: reloadBoard } = useProjectBoard(
    api,
    client,
    provider,
    group.id,
    linkedProject,
    revision,
  );
  const board = boardState.value ?? null;
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
  const error = actionError || boardState.error || '';
  // Each dialog shows its own error. The page error stays on the page.
  const [modalError, setModalError] = useState('');
  const [url, setUrl] = useState('');
  const [query, setQuery] = useState(savedFilters.query);
  const [status, setStatus] = useState(savedFilters.status);
  const [modal, setModal] = useState<'draft' | 'issue' | 'connect' | null>(null);
  const [draftStatus, setDraftStatus] = useState('');
  // The code folder of the New task dialog, for "Create and start".
  const [draftRepoId, setDraftRepoId] = useState('');
  const [sort, setSort] = useState(savedFilters.sort);
  const [view, setView] = useState<'board' | 'list' | 'roadmap'>(
    savedFilters.view === 'roadmap' ? 'roadmap' : savedFilters.view === 'list' ? 'list' : 'board',
  );
  const [savedView, setSavedView] = useState<SavedProjectView | null>(null);
  const [savedViewPending, setSavedViewPending] = useState(false);
  const changeSavedView = useCallback((value: SavedProjectView | null, pending: boolean) => {
    setSavedView(value);
    setSavedViewPending(pending);
    if (value)
      setView(
        value.layout === 'TABLE_LAYOUT'
          ? 'list'
          : value.layout === 'ROADMAP_LAYOUT'
            ? 'roadmap'
            : 'board',
      );
  }, []);
  useEffect(() => {
    writeFilters(filterStorage, { query, status, repoFilter, sort, view });
  }, [filterStorage, query, status, repoFilter, sort, view]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [task, setTask] = useState<TrackerItem | null>(null);
  // The card that gets the focus back when the task sheet closes.
  const lastTaskId = useRef('');
  const taskTitle = useRef<HTMLHeadingElement>(null);
  const [archived, setArchived] = useState(false);
  const [repoId, setRepoId] = useState(repos[0]?.id || '');
  const [preferredAgent, setPreferredAgent] = useState(readPreferredAgent);
  useEffect(() => onPreferredAgentChange(setPreferredAgent), []);
  const boardName = boardNoun(providerName);
  const addFolder = () =>
    onAddFolder
      ? onAddFolder()
      : window.dispatchEvent(
          new CustomEvent('kalkidan-add-code-folder', { detail: { groupId: group.id } }),
        );
  const openChat = (session: Session) => (onOpenSession || onResume)(session);
  async function authorize() {
    setAuth({ status: 'checking' });
    setModalError('');
    try {
      setAuth(await client.authorize());
    } catch (e) {
      setAuth({
        status: 'error',
        message:
          `Could not start ${providerName} authorization. ${errorMessage(e).replace(/\.?$/, '.')} ` +
          'Make sure that you are online, then try again. ' +
          'If the problem continues, restart Kalkidan.',
      });
    }
  }
  function connect() {
    setUrl(linkedProject?.url || '');
    setModalError('');
    setModal('connect');
    void authorize();
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
  function closeModal() {
    setModal(null);
  }
  useEffect(() => {
    if (modal !== 'connect' || !trackerAuthPending(auth)) return;
    let active = true;
    const timer = setInterval(() => {
      void client
        .authStatus()
        .then((value) => {
          if (active) setAuth(value);
        })
        .catch(() => {
          if (active)
            setAuth({
              status: 'error',
              message: `Lost connection to ${providerName} authorization. Try again.`,
            });
        });
    }, interfaceConfig.authPollMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [modal, auth.status, client]);
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
    return matches.length === 1
      ? matches[0].id
      : preferredRepoId || lastFolder() || (repos.length === 1 ? repos[0].id : '');
  }
  function chooseTask(item: TrackerItem) {
    setTask(item);
    lastTaskId.current = item.id;
    setCheckout('worktree');
    checkoutTouched.current = false;
    setTaskBranch(taskBranchName(item));
    setTaskError('');
    setChanging(false);
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
    try {
      const target = await workTarget(repo, task, checkout, branch);
      saveFolder(group.id, repo.id);
      moveToProgress(task);
      launch(target, agent, task);
      setTask(null);
      if (checkout === 'worktree') showToast(`Started on branch ${branch}.`);
    } catch (e) {
      setTaskError(errorMessage(e));
    } finally {
      setTaskBusy(false);
    }
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
    setQuickBusy(item.id);
    moveToProgress(item);
    try {
      const mode = await defaultMode(repo.id);
      const branch = taskBranchName(item);
      const target = await workTarget(repo, item, mode, branch);
      saveFolder(group.id, repo.id);
      launch(target, readPreferredAgent(), item);
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
  // Refresh reloads the board and the saved views together.
  const [viewsReload, setViewsReload] = useState(0);
  function refreshAll() {
    setViewsReload((value) => value + 1);
    void action(refreshBoard, false);
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
  const sortedItems =
    sort === 'title'
      ? [...items].sort((a, b) => a.title.localeCompare(b.title))
      : savedView
        ? [...items].sort(
            (a, b) => savedView.itemIds.indexOf(a.id) - savedView.itemIds.indexOf(b.id),
          )
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
    (planningTools.length || canMove) && !savedView && view !== 'roadmap'
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
  const [tool, setTool] = useState<{ tool: PlanningTool; ids: string[] } | null>(null);
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
    setTool({ tool: name, ids });
  }

  /** Opens New task. The task goes to the first status of the board. */
  function newItem(statusId = '') {
    setTitle('');
    setBody('');
    setDraftStatus(statusId || board?.statusField?.options[0]?.id || '');
    setDraftRepoId(preferredRepoId || lastFolder() || repos[0]?.id || '');
    setModalError('');
    setModal('draft');
  }
  /** Creates a task from the title field of a column. Returns false when it fails. */
  async function createInColumn(statusId: string, value: string) {
    setBusy(true);
    setError('');
    try {
      const createdId = await client.draft(group.id, value, '');
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
      await refreshBoard();
      return true;
    } catch (e) {
      showToast({ message: `Could not create the task. ${errorMessage(e)}`, tone: 'error' });
      return false;
    } finally {
      setBusy(false);
    }
  }
  function addExisting() {
    setUrl('');
    setModalError('');
    setModal('issue');
  }
  // The shell and the command palette send these events after they open this page.
  const eventRef = useRef<{
    newTask: () => void;
    tool: (name: string) => void;
    filter: (filter: TaskFilter) => void;
    openTask: (id: string) => void;
    view: (id: string) => void;
    reload: () => void;
    check: () => void;
  }>(null!);
  eventRef.current = {
    newTask() {
      if (!linkedProject) {
        connect();
        return;
      }
      if (busy || !descriptor?.capabilities.createItem) return;
      setPage('tasks');
      newItem();
    },
    tool(name) {
      if (name === 'docs' || name === 'docs-to-issues') {
        if (docsPlanAvailable) setDocsPlanOpen(true);
        return;
      }
      if (name === 'add-existing') {
        if (!linkedProject) connect();
        else if (descriptor?.capabilities.importItem) {
          setPage('tasks');
          addExisting();
        }
        return;
      }
      if (!planningTools.includes(name as PlanningTool)) return;
      if (page !== 'tasks') setPage('tasks');
      openTool(name as PlanningTool);
    },
    filter(filter) {
      applyFilter(filter);
    },
    openTask(id) {
      if (!openTaskById(id)) pendingTask.current = id;
    },
    reload() {
      void action(refreshBoard, false);
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
  const sheetOrder = view === 'roadmap' || savedView ? sortedItems : visualOrder;
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
    if (filter.query !== undefined) setQuery(filter.query);
    if (filter.status || filter.repository) setFiltersOpen(true);
  }
  const modalReady =
    !busy &&
    (modal !== 'connect' || auth.status === 'ready') &&
    (modal === 'draft' ? !!title.trim() : !!url.trim());
  async function submitModal(start = false) {
    if (!modalReady) return;
    setBusy(true);
    setModalError('');
    // After the dialog closes, an error shows on the page.
    let closed = false;
    let startCreated = '';
    const kind = modal;
    try {
      if (modal === 'connect') {
        await client.link(group.id, url);
        setPage('tasks');
        await onRefresh();
      } else if (modal === 'issue') await client.importItem(group.id, url);
      else {
        const createdId = await client.draft(group.id, title, body);
        setModal(null);
        closed = true;
        if (draftStatus && board?.statusField && descriptor?.capabilities.updateStatus) {
          try {
            if (!createdId) throw new Error('This tracker did not return the new task ID.');
            await client.status(group.id, createdId, draftStatus);
          } catch (e) {
            await refreshBoard();
            throw new Error(
              'Task created, but its status could not be set. ' +
                `Move it on the board to try again. ${errorMessage(e)}`,
            );
          }
        }
        if (start && createdId) startCreated = createdId;
      }
      setModal(null);
      closed = true;
      setError('');
      const next = await refreshBoard();
      const created = startCreated && next?.items.find((item) => item.id === startCreated);
      if (created) void quickStart(created, draftRepoId || taskFolder(created));
      if (kind === 'draft' && draftRepoId) saveFolder(group.id, draftRepoId);
      showToast(
        kind === 'connect'
          ? `Connected the ${boardName}.`
          : kind === 'issue'
            ? `Added the task to the ${boardName}.`
            : startCreated
              ? 'Created the task. Starting a chat…'
              : 'Created the task.',
      );
    } catch (e) {
      (closed ? setError : setModalError)(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  function submitOnEnter(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      void submitModal(event.metaKey || event.ctrlKey);
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
  /** Opens the chat and asks it for its "Create pull request" dialog. */
  function createPullRequest(session: Session) {
    setTask(null);
    openChat(session);
    setTimeout(
      () =>
        window.dispatchEvent(
          new CustomEvent('kalkidan-session-command', {
            detail: { command: createPullRequestCommand },
          }),
        ),
      250,
    );
  }
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
  // Few tasks need no filters. A saved filter keeps the button, so that it can be cleared.
  const showFilterButton = total > filterThreshold || filterCount > 0 || sort !== 'project';
  const filtersVisible = showFilterButton && filtersOpen;
  const countText = filtered
    ? `${items.length} of ${plural(total, 'task')}`
    : archived
      ? plural(items.length, 'archived task')
      : plural(total, 'task');
  const startBlocker = !repos.length
    ? 'Add a code folder first'
    : !repos.some((r) => r.id === repoId)
      ? 'Choose a code folder first'
      : checkout === 'worktree' && !taskBranch.trim()
        ? 'Enter a branch name first'
        : '';
  const startReady = !taskBusy && !startBlocker;
  const taskRepo = repos.find((r) => r.id === repoId);
  // "api-service · new branch 12-review-authentication", or "api-service · on main".
  const whereText = taskRepo
    ? checkout === 'worktree'
      ? `${taskRepo.name} · new branch ${taskBranch.trim()}`
      : `${taskRepo.name}${repoStatus?.branch ? ` · on ${repoStatus.branch}` : ''}`
    : 'Choose a code folder';
  const shownPage: ProjectPage = embedded ? 'tasks' : page;
  const showTasks = shownPage === 'tasks';
  const canStart = repos.length > 0;
  const savedViewsAvailable = github && typeof api.trackerSavedView === 'function';
  const boardSettingsAvailable = github && typeof api.trackerResources === 'function';
  const archivedCount = board?.archivedItems?.length || 0;
  const hasDateField = !!board?.fields?.some((field) => field.dataType === 'DATE');
  const hasIterationField = !!board?.fields?.some((field) => field.dataType === 'ITERATION');
  // The sheet footer raises the toasts, so that a toast does not cover Start.
  useEffect(() => {
    const root = document.documentElement;
    if (!task || !footer) return;
    const update = () => root.style.setProperty('--toast-offset', `${footer.offsetHeight}px`);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(footer);
    return () => {
      observer.disconnect();
      root.style.removeProperty('--toast-offset');
    };
  }, [task?.id, !!task, footer]);
  // The selected tasks that can start: issues only. Drafts must become issues first.
  const selectedItems = visualOrder.filter((item) => selectedIds.has(item.id));
  const selectedIssues = selectedItems.filter((item) => item.kind === 'Issue');
  const selectedDrafts = selectedItems.filter((item) => item.kind === 'DraftIssue');
  const [convertOpen, setConvertOpen] = useState(false);
  const startManyBlocker = selectedDrafts.length
    ? "Draft tasks can't start. Convert them to issues first."
    : !selectedIssues.length
      ? 'Only issues can start'
      : '';
  // Planning only: the tools that act on many tasks are in the selection bar.
  const planTools = planningTools.filter((name) => name === 'iteration' || name === 'readiness');
  const planMenu = board && (planTools.length > 0 || docsPlanAvailable) && (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">
          Plan
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width="wide">
        {planTools.map((name) => {
          const reason =
            name === 'iteration' && !hasIterationField
              ? 'Needs an Iteration field on GitHub'
              : name === 'iteration' && readOnly
                ? readOnly
                : !visibleIds.length
                  ? 'No tasks'
                  : '';
          return (
            <DropdownMenuItem key={name} disabled={!!reason} onSelect={() => openTool(name)}>
              {planningIcons[name]}
              {planningLabels[name]}
              {reason && <span className={menuShortcutClass}>{reason}</span>}
            </DropdownMenuItem>
          );
        })}
        {docsPlanAvailable && (
          <>
            {planTools.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem disabled={!!readOnly} onSelect={() => setDocsPlanOpen(true)}>
              <FileStack className="size-4" />
              Create tasks from a doc…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  const restricted = board?.restrictedItems || 0;
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
  // The board "⋯" menu: the board name, refresh, the GitHub changes to check, saved views,
  // Roadmap, archived tasks, the board on GitHub and Board settings.
  const boardMenu = board && linkedProject && (
    <UncertainWritesPopover
      api={api}
      groupId={group.id}
      board={board}
      rows={writeCheck.rows}
      open={checkOpen}
      onOpenChange={setCheckOpen}
      onChecked={writeCheck.reload}
      onOpenTask={(id) => void openTaskById(id)}
    >
      <span className="tracker-board-menu">
        <DropdownMenu>
          <Hint label="Board actions">
            <DropdownMenuTrigger asChild>
              <MoreButton
                label={
                  writeCheck.rows.length
                    ? `Board actions. ${uncertainWritesText(writeCheck.rows.length)}`
                    : 'Board actions'
                }
              />
            </DropdownMenuTrigger>
          </Hint>
          <DropdownMenuContent align="end" width="wide">
            <DropdownMenuLabel className="truncate">
              {linkedProject.title}
              {linkedProject.number ? ` #${linkedProject.number}` : ''}
              {restricted > 0 ? ` · ${restricted} hidden` : ''}
            </DropdownMenuLabel>
            <DropdownMenuItem disabled={busy} onSelect={refreshAll}>
              <RefreshCw className={busy ? 'size-4 animate-spin' : 'size-4'} />
              Refresh
              {syncText && <span className={menuShortcutClass}>{syncText}</span>}
            </DropdownMenuItem>
            {writeCheck.rows.length > 0 && (
              <DropdownMenuItem onSelect={() => setCheckOpen(true)}>
                <TriangleAlert className="size-4 text-warning" />
                <span className="min-w-0 truncate">
                  {uncertainWritesText(writeCheck.rows.length)}
                </span>
                <span className={menuShortcutClass}>Check</span>
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {savedViewsAvailable && <SavedViewsMenu value={savedViews} />}
            {github && (
              <DropdownMenuItem
                disabled={!hasDateField}
                onSelect={() => setView(view === 'roadmap' ? 'board' : 'roadmap')}
              >
                <CalendarRange className="size-4" />
                Roadmap
                <span className={menuShortcutClass}>
                  {!hasDateField ? 'Needs a date field' : view === 'roadmap' ? <Check /> : ''}
                </span>
              </DropdownMenuItem>
            )}
            {!!archivedCount && !savedView && (
              <DropdownMenuItem onSelect={() => setArchived(!archived)}>
                <Archive className="size-4" />
                {archived ? 'Active tasks' : 'Archived tasks'}
                {!archived && <span className={menuShortcutClass}>{archivedCount}</span>}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {linkedProject.url && (
              <DropdownMenuItem asChild>
                <a href={linkedProject.url} target="_blank" rel="noreferrer">
                  <ArrowUpRight className="size-4" />
                  Open on {providerName}
                </a>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => openBoardSettings(group.id)}>
              <Settings className="size-4" />
              Board settings…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        {writeCheck.rows.length > 0 && <span className="tracker-board-dot" aria-hidden="true" />}
      </span>
    </UncertainWritesPopover>
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
  const moreTools = planningTools.filter((name) => name !== 'dispatch');
  // "2 selected ✕ │ Move to ▾ │ Start 2 │ ⋯" floats at the bottom of the board.
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
      <Hint label="Clear selection" shortcut="Esc">
        <Button
          variant="ghost"
          size="icon-xs"
          className="tracker-selection-clear"
          aria-label="Clear selection"
          aria-keyshortcuts="Escape"
          onClick={endSelection}
        >
          <X />
        </Button>
      </Hint>
      <span className="tracker-filter-divider" aria-hidden="true" />
      {canMove && (
        <DropdownMenu>
          <StartHint reason={readOnly}>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" disabled={busy || !!readOnly}>
                <ArrowRightLeft />
                Move to
                <ChevronDown aria-hidden="true" />
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
      {planningTools.includes('dispatch') && (
        <>
          <StartHint reason={startManyBlocker}>
            <Button
              variant="ghost"
              size="sm"
              disabled={!!startManyBlocker}
              aria-label={`Start ${plural(selectedIssues.length, 'chat')}`}
              onClick={() => openTool('dispatch')}
            >
              <Play />
              Start {selectedIssues.length || ''}
            </Button>
          </StartHint>
          {selectedDrafts.length > 0 && !readOnly && (
            <Button variant="ghost" size="sm" onClick={() => setConvertOpen(true)}>
              Convert to issues
            </Button>
          )}
        </>
      )}
      {moreTools.length > 0 && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <MoreButton size="sm" label="More actions for the selected tasks" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="top">
            {moreTools.map((name) => (
              <DropdownMenuItem
                key={name}
                disabled={
                  (name !== 'readiness' && !!readOnly) ||
                  (name === 'iteration' && !hasIterationField)
                }
                onSelect={() => openTool(name)}
              >
                {planningIcons[name]}
                {planningLabels[name]}
              </DropdownMenuItem>
            ))}
            {selectedVisible.length < visibleIds.length && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => selection.selectAll()}>
                  <SquareCheck className="size-4" />
                  Select all
                  <span className={menuShortcutClass}>⌘A</span>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
  const newTaskButton = (
    <StartHint reason={readOnly}>
      <div className="split-button" role="group" aria-label="New task">
        <Button
          size="sm"
          className={descriptor?.capabilities.importItem ? 'rounded-r-none' : undefined}
          disabled={busy || !!readOnly || !descriptor?.capabilities.createItem}
          onClick={() => newItem()}
        >
          <Plus size={16} />
          New task
        </Button>
        {(descriptor?.capabilities.importItem || docsPlanAvailable) && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                size="icon-sm"
                disabled={busy || !!readOnly}
                className="rounded-l-none border-l border-primary-foreground/20"
                aria-label="More ways to add a task"
              >
                <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => newItem()}>
                <Plus className="size-4" />
                New task
              </DropdownMenuItem>
              {descriptor?.capabilities.importItem && (
                <DropdownMenuItem onSelect={addExisting}>
                  <Link2 className="size-4" />
                  Add existing issue or pull request…
                </DropdownMenuItem>
              )}
              {docsPlanAvailable && (
                <DropdownMenuItem onSelect={() => setDocsPlanOpen(true)}>
                  <FileStack className="size-4" />
                  Create tasks from a doc…
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </StartHint>
  );
  // One row: search and Board/List on the left; Plan, the board menu and New task on the right.
  const taskToolbar = (
    <div className="tracker-filterbar" role="toolbar" aria-label="Task tools">
      <SearchInput
        size="sm"
        className="tracker-search"
        aria-label="Search tasks"
        placeholder="Search tasks"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <SegmentedControl
        size="sm"
        label="Task view"
        className="tracker-view-switch"
        value={view}
        onChange={setView}
        options={[
          {
            value: 'board',
            label: <span className="tracker-view-label">Board</span>,
            icon: <Columns3 aria-hidden="true" />,
          },
          {
            value: 'list',
            label: <span className="tracker-view-label">List</span>,
            icon: <List aria-hidden="true" />,
          },
        ]}
      />
      {showFilterButton && (
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={filtersVisible}
          onClick={() => setFiltersOpen((open) => !open)}
        >
          <ListFilter />
          Filter
          {filterCount > 0 && (
            <span className="tracker-filter-count">
              {filterCount}
              <span className="sr-only"> active</span>
            </span>
          )}
        </Button>
      )}
      {(!!query || filterCount > 0) && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setQuery('');
            setStatus('all');
            setRepoFilter('all');
          }}
        >
          Clear filters
        </Button>
      )}
      {savedView && <SavedViewFilterChip view={savedView} />}
      {readOnly && (
        <Hint label="You can only read this board. Ask the board owner for access.">
          <Badge variant="muted" size="sm" className="tracker-read-only" tabIndex={0}>
            <Lock aria-hidden="true" />
            {readOnly}
          </Badge>
        </Hint>
      )}
      <span id="tracker-sync-text" className="sr-only" role="status">
        {syncText}
      </span>
      <div className="tracker-filter-end">
        {planMenu}
        {boardMenu}
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
      {error && (
        <Alert variant="destructive" size="sm">
          <AlertDescription>
            {error}
            {linkedProject &&
              (authErrorPattern.test(error) ? (
                <Button variant="outline" size="sm" onClick={() => openSettings('account')}>
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
      {showTasks && linkedProject && filtersVisible && (
        <div className="tracker-filters" role="group" aria-label="Task filters">
          <Choice
            size="sm"
            variant="filled"
            label="Filter by status"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: 'All statuses' },
              { value: 'none', label: 'No status' },
              ...(board?.statusField?.options.map((o) => ({ value: o.id, label: o.name })) || []),
            ]}
          />
          {!embedded && (
            // The title shows the full name when the chosen repository is truncated.
            <Choice
              size="sm"
              variant="filled"
              className="max-w-60"
              label="Filter by GitHub repository"
              title={
                repoFilter === 'all'
                  ? undefined
                  : repoFilter === 'draft'
                    ? 'Not linked to a GitHub repository'
                    : repoFilter
              }
              value={repoFilter}
              onChange={setRepoFilter}
              options={[
                { value: 'all', label: 'All GitHub repositories' },
                { value: 'draft', label: 'Not linked to a GitHub repository' },
                ...repositoryOptions.map((repo) => ({ value: repo, label: repo })),
              ]}
            />
          )}
          <Choice
            label="Sort tasks"
            size="sm"
            variant="filled"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'project', label: 'Board order' },
              { value: 'title', label: 'Title A–Z' },
            ]}
          />
        </div>
      )}
      {!linkedProject ? (
        <EmptyState
          className="w-full"
          icon={<Columns3 />}
          title={`Connect a ${boardName}`}
          action={<Button onClick={connect}>Connect a board</Button>}
        />
      ) : (
        !items.length &&
        view !== 'roadmap' &&
        (busy || error ? (
          <EmptyState compact className="tracker-empty-result">
            {busy ? 'Loading tasks…' : 'Tasks could not be loaded. Use Try again above.'}
          </EmptyState>
        ) : filtered ? (
          <EmptyState
            icon={<SearchX />}
            title="No matching tasks"
            className="tracker-empty-result"
            action={
              !!query || filterCount > 0 ? (
                <Button
                  variant="outline"
                  onClick={() => {
                    setQuery('');
                    setStatus('all');
                    setRepoFilter('all');
                  }}
                >
                  Clear filters
                </Button>
              ) : undefined
            }
          />
        ) : archived ? (
          <EmptyState
            icon={<Archive />}
            title="No archived tasks"
            className="tracker-empty-result"
            action={
              <Button variant="outline" onClick={() => setArchived(false)}>
                Show active tasks
              </Button>
            }
          />
        ) : (
          <EmptyState
            icon={<ListChecks />}
            title="No tasks yet"
            className="tracker-empty-result"
            action={
              descriptor?.capabilities.createItem && !readOnly ? (
                <Button variant="outline" onClick={() => newItem()}>
                  <Plus />
                  New task
                </Button>
              ) : undefined
            }
          />
        ))
      )}
      {board &&
        showTasks &&
        linkedProject &&
        (view === 'roadmap' ? (
          <TrackerRoadmap
            key={'roadmap:' + group.id}
            board={board}
            items={sortedItems}
            onOpen={chooseTask}
            onAddDateFields={boardSettingsAvailable ? () => openRoadmapDates(group.id) : undefined}
          />
        ) : savedView ? (
          <GitHubViewLayout
            board={board}
            items={sortedItems}
            view={savedView}
            mode={view}
            onOpen={chooseTask}
          />
        ) : view === 'list' ? (
          <div className="tracker-list-view">
            <TrackerList
              board={board}
              items={sortedItems}
              sessions={projectSessions}
              busy={busy || !!readOnly || !descriptor?.capabilities.updateStatus}
              onOpen={chooseTask}
              onStatus={(item, value) => void action(() => client.status(group.id, item.id, value))}
              activity={activity}
              onOpenChat={openChat}
              onStart={canStart && !archived ? (item) => void quickStart(item) : undefined}
              startingId={quickBusy}
              readOnly={readOnly}
              selection={selection}
            />
          </div>
        ) : (
          <TrackerBoard
            board={board}
            items={sortedItems}
            sessions={projectSessions}
            busy={busy || !descriptor?.capabilities.updateStatus}
            onCreate={
              descriptor?.capabilities.createItem &&
              descriptor?.capabilities.updateStatus &&
              !readOnly &&
              !archived &&
              !savedView
                ? createInColumn
                : undefined
            }
            onOpen={chooseTask}
            onStatus={(item, value) => void action(() => client.status(group.id, item.id, value))}
            activity={activity}
            onOpenChat={openChat}
            onStart={canStart && !archived ? (item) => void quickStart(item) : undefined}
            startingId={quickBusy}
            readOnly={readOnly}
            selection={selection}
          />
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
          onSaved={() => void action(refreshBoard, false)}
          onOpenTask={(id) => {
            setTool(null);
            openTaskById(id);
          }}
        />
      )}
      {selectedDrafts.length > 0 && (
        <ConvertDraftsDialog
          open={convertOpen}
          onOpenChange={setConvertOpen}
          drafts={selectedDrafts}
          repositories={repositoryOptions}
          onConvert={async (repository) => {
            for (const item of selectedDrafts)
              await api.trackerItemAction(group.id, item.id, { kind: 'convert', repository });
            await refreshBoard();
            showToast(`Converted ${plural(selectedDrafts.length, 'draft')} to issues.`);
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
      <Dialog open={!!modal} onOpenChange={(open) => !open && !busy && closeModal()}>
        <DialogContent size="md" layout="scroll">
          <DialogHeader>
            <DialogTitle>
              {modal === 'connect'
                ? `Connect a ${boardName}`
                : modal === 'issue'
                  ? 'Add existing issue or pull request'
                  : 'New task'}
            </DialogTitle>
            <DialogDescription className="sr-only">
              {modal === 'connect'
                ? `Choose a ${boardName} or create a new one.`
                : modal === 'issue'
                  ? `Paste the URL of a ${providerName} issue or pull request.`
                  : `Kalkidan adds the task to the ${boardName}.`}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-4">
            {modal === 'connect' && (
              <div className="space-y-3" aria-live="polite">
                {['checking', 'verifying'].includes(auth.status) && (
                  <p className="text-sm text-muted-foreground">Checking {providerName} access…</p>
                )}
                {auth.status === 'waiting' && (
                  <>
                    <p className="text-sm">
                      {auth.code
                        ? `Enter this code on ${providerName} and approve access:`
                        : `Requesting a code from ${providerName}…`}
                    </p>
                    {auth.code && (
                      <>
                        <Input
                          aria-label={`${providerName} device code`}
                          readOnly
                          value={auth.code}
                          className="text-center font-mono text-lg tracking-widest"
                          onFocus={(event) => event.target.select()}
                        />
                        <Button
                          variant="outline"
                          onClick={() => void action(() => client.openAuth(), false)}
                        >
                          Open {providerName}
                        </Button>
                      </>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {auth.message ||
                        'Waiting for approval. This dialog will update automatically.'}
                    </p>
                  </>
                )}
                {!trackerAuthPending(auth) && auth.status !== 'ready' && (
                  <>
                    <Alert variant="destructive" size="sm">
                      <AlertDescription>{auth.message}</AlertDescription>
                    </Alert>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="ghost"
                        onClick={() => {
                          closeModal();
                          openSettings('account');
                        }}
                      >
                        Open account settings
                      </Button>
                      <Button variant="outline" onClick={() => void authorize()}>
                        Try again
                      </Button>
                    </div>
                  </>
                )}
              </div>
            )}
            {modal === 'draft' ? (
              <div className="grid gap-4">
                <label className="form-label">
                  Title
                  <Input
                    maxLength={256}
                    aria-label="Task title"
                    onKeyDown={submitOnEnter}
                    placeholder="What needs to be done?"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </label>
                <label className="form-label">
                  Description
                  <Textarea
                    rows={4}
                    className="field-sizing-fixed resize-y"
                    maxLength={20000}
                    aria-label="Task description"
                    placeholder="Description and acceptance criteria"
                    value={body}
                    onChange={(e) => setBody(e.target.value)}
                  />
                </label>
                {repos.length > 1 && (
                  <div className="tracker-new-folder">
                    <span aria-hidden="true">Code folder:</span>
                    <Choice
                      size="sm"
                      variant="ghost"
                      label="Code folder"
                      value={draftRepoId}
                      onChange={setDraftRepoId}
                      options={repos.map((r) => ({ value: r.id, label: r.name }))}
                    />
                  </div>
                )}
              </div>
            ) : modal === 'connect' ? (
              auth.status === 'ready' && (
                <TrackerProjectPicker
                  provider={provider}
                  api={api}
                  defaultTitle={group.name}
                  value={url}
                  onChange={setUrl}
                  onBusy={setBusy}
                />
              )
            ) : (
              <Input
                aria-label={`${providerName} URL`}
                placeholder="Issue or pull request URL"
                onKeyDown={submitOnEnter}
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            )}
            {modalError && (
              <p role="alert" className="field-error">
                {modalError}
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={closeModal}>
              Cancel
            </Button>
            {modal === 'draft' && repos.length > 0 && (
              <Hint label="⌘↵">
                <Button
                  variant="outline"
                  disabled={!modalReady}
                  onClick={() => void submitModal(true)}
                >
                  Create and start
                </Button>
              </Hint>
            )}
            <Button disabled={!modalReady} onClick={() => void submitModal()}>
              {busy
                ? 'Saving…'
                : modal === 'connect'
                  ? 'Connect board'
                  : modal === 'issue'
                    ? 'Add task'
                    : 'Create task'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!task} onOpenChange={(open) => !open && !taskBusy && setTask(null)}>
        <DialogContent
          showCloseButton={false}
          className="tracker-issue-detail top-0 right-0 left-auto flex h-dvh max-h-dvh w-[min(var(--dialog-md),100vw)] max-w-[100vw] translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 border-l p-0 sm:max-w-[100vw] data-[state=closed]:zoom-out-100 data-[state=closed]:slide-out-to-right-4 data-[state=open]:zoom-in-100 data-[state=open]:slide-in-from-right-4"
          onOpenAutoFocus={(event) => {
            // The title is the first stop, so a screen reader starts with the task name.
            event.preventDefault();
            taskTitle.current?.focus();
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
            <span className="truncate">
              {[
                task?.number ? `#${task.number}` : task?.kind === 'DraftIssue' ? 'Draft' : '',
                linkedProject?.title,
              ]
                .filter(Boolean)
                .join(' · ')}
            </span>
            <div>
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
              {editsItem && task && (
                <ItemActionsMenu
                  api={api}
                  groupId={group.id}
                  item={task}
                  onSaved={refreshBoard}
                  size="sm"
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
          </div>
          <div className="tracker-issue-body">
            <DialogHeader className="pr-0">
              {editing === 'title' ? (
                <Input
                  autoFocus
                  aria-label="Task title"
                  className="tracker-edit-title"
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
                    className="tracker-issue-title"
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
                  {task?.url && (
                    <Hint label={`Open on ${providerName}`}>
                      <Button asChild variant="ghost" size="icon-xs" className="shrink-0">
                        <a
                          href={task.url}
                          target="_blank"
                          rel="noreferrer"
                          aria-label={`Open on ${providerName}`}
                        >
                          <ArrowUpRight />
                        </a>
                      </Button>
                    </Hint>
                  )}
                </div>
              )}
              <DialogDescription className="sr-only">
                {task?.repository || 'Project task'}
              </DialogDescription>
            </DialogHeader>
            <dl className="tracker-issue-properties">
              <dt>Status</dt>
              <dd>
                {task && board?.statusField ? (
                  <StartHint reason={readOnly}>
                    <Choice
                      size="sm"
                      variant="ghost"
                      className="-ml-2.5"
                      label="Task status"
                      value={task.statusId || ''}
                      disabled={busy || !!readOnly || !descriptor?.capabilities.updateStatus}
                      onChange={(value) =>
                        void action(
                          () => client.status(group.id, task.id, value),
                          true,
                          setTaskError,
                        )
                      }
                      options={[
                        ...(!task.statusId ? [{ value: '', label: 'No status' }] : []),
                        ...board.statusField.options.map((o) => ({ value: o.id, label: o.name })),
                      ]}
                    />
                  </StartHint>
                ) : (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <StatusIcon name={task?.status || 'No status'} />
                    <span className="truncate">{task?.status || 'No status'}</span>
                  </span>
                )}
              </dd>
              <dt>Repository</dt>
              <dd>
                <span className="truncate" title={task?.repository}>
                  {task?.repository
                    ? `${task.repository}${task.number ? ` #${task.number}` : ''}`
                    : 'None'}
                </span>
              </dd>
              <dt>Pull request</dt>
              <dd className="tracker-issue-pr">
                {taskPr ? (
                  <>
                    <GitPullRequest className="size-3.5 shrink-0 text-muted-foreground" />
                    <a
                      className="text-link underline-offset-2 hover:underline tabular-nums"
                      href={taskPr.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {taskPr.number ? `#${taskPr.number}` : 'Pull request'}
                    </a>
                    {taskPr.state && (
                      <Badge
                        size="sm"
                        variant={
                          taskPr.state === 'merged'
                            ? 'default'
                            : taskPr.state === 'open'
                              ? 'success'
                              : 'muted'
                        }
                      >
                        {pullRequestStateWord(taskPr.state)}
                      </Badge>
                    )}
                    {markDoneOption && (
                      <Button
                        variant="outline"
                        size="xs"
                        className="ml-auto"
                        disabled={busy}
                        onClick={() =>
                          void action(
                            () => client.status(group.id, task!.id, markDoneOption.id),
                            true,
                            setTaskError,
                          )
                        }
                      >
                        <CircleCheck />
                        Mark done
                      </Button>
                    )}
                  </>
                ) : linkedSessions.length ? (
                  <Button
                    variant="ghost"
                    size="xs"
                    className="-ml-2"
                    onClick={() => createPullRequest(linkedSessions[0])}
                  >
                    <GitBranch />
                    Create pull request…
                  </Button>
                ) : (
                  <span className="text-muted-foreground">Opens when the agent pushes</span>
                )}
              </dd>
            </dl>
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
                    variant="outline"
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
              <div className="tracker-issue-description prose-ui" data-size="sm">
                <Markdown remarkPlugins={[remarkGfm]} components={{ a: ExternalAnchor }}>
                  {task?.body || 'No description.'}
                </Markdown>
              </div>
            )}
            <section className="tracker-context" aria-label="Context">
              <SectionHeader size="sm" title="Context" />
              <dl className="tracker-issue-properties">
                <dt>Chats</dt>
                <dd className="tracker-context-values">
                  {linkedSessions.map((s) => {
                    const state = activity[activityKey(s.agent, s.id)];
                    const name = s.organization?.title || s.title;
                    return (
                      <button
                        key={s.agent + s.id}
                        type="button"
                        className="tracker-context-chip"
                        title={`${agentLabel(s.agent)} · ${name}`}
                        aria-label={`Open chat: ${name}${state ? `. ${activityText(state, s.agent)}` : ''}`}
                        onClick={() => {
                          setTask(null);
                          openChat(s);
                        }}
                      >
                        <AgentIcon agent={s.agent} />
                        <span className="truncate">{name}</span>
                        {state && <ActivityDot state={state} />}
                      </button>
                    );
                  })}
                  {!linkedSessions.length && <span className="text-muted-foreground">None</span>}
                  <Hint label="Link a chat">
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Link a chat"
                      onClick={() => setChatPickerOpen(true)}
                    >
                      <Link2 />
                    </Button>
                  </Hint>
                </dd>
                {docsAvailable && (
                  <>
                    <dt>Docs</dt>
                    <dd className="tracker-context-values">
                      {docLinks.map((doc) => (
                        <span key={doc.id} className="tracker-context-chip" data-removable>
                          {onOpenDocs ? (
                            <button
                              type="button"
                              className="tracker-context-open"
                              onClick={() => {
                                setTask(null);
                                onOpenDocs(doc.id);
                              }}
                            >
                              <FileText aria-hidden="true" />
                              <span className="truncate">{doc.title}</span>
                            </button>
                          ) : (
                            <span className="tracker-context-open">
                              <FileText aria-hidden="true" />
                              <span className="truncate">{doc.title}</span>
                            </span>
                          )}
                          <button
                            type="button"
                            className="tracker-context-remove"
                            aria-label={`Remove link to ${doc.title}`}
                            onClick={() =>
                              void changeDocLinks(docLinks.filter((d) => d.id !== doc.id))
                            }
                          >
                            <X aria-hidden="true" />
                          </button>
                        </span>
                      ))}
                      {!docLinks.length && <span className="text-muted-foreground">None</span>}
                      <Hint label="Link a page">
                        <Button
                          variant="ghost"
                          size="icon-xs"
                          aria-label="Link a page"
                          onClick={() => setDocPickerOpen(true)}
                        >
                          <Link2 />
                        </Button>
                      </Hint>
                    </dd>
                  </>
                )}
              </dl>
            </section>
            {provider === 'github' && board?.writable && task && (
              <GitHubItemEditor
                key={task.id + ':' + textRevision}
                api={api}
                groupId={group.id}
                board={board}
                item={task}
                onSaved={refreshBoard}
              />
            )}
          </div>
          <DialogFooter
            ref={setFooter}
            className="tracker-issue-footer flex-col items-stretch sm:flex-col sm:justify-start"
          >
            {changing && repos.length > 0 && (
              <div className="tracker-start-options" role="group" aria-label="Where to work">
                <fieldset disabled={taskBusy}>
                  <legend className="form-label">Code folder</legend>
                  {repos.map((r) => (
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
                      <span className="truncate">{r.name}</span>
                    </label>
                  ))}
                </fieldset>
                <fieldset disabled={taskBusy}>
                  <legend className="form-label">Branch</legend>
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
                    <span className="shrink-0">New branch</span>
                    <Input
                      size="sm"
                      aria-label="Task branch"
                      className="min-w-0 flex-1"
                      value={taskBranch}
                      onFocus={() => {
                        checkoutTouched.current = true;
                        setCheckout('worktree');
                      }}
                      onChange={(e) => setTaskBranch(e.target.value)}
                      placeholder="feature/task-name"
                    />
                    <Hint label="The agent works in a separate copy of the folder. Your work does not change.">
                      <span className="text-xs text-muted-foreground" tabIndex={0}>
                        (recommended)
                      </span>
                    </Hint>
                  </label>
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
                        ? `Work on ${repoStatus.branch} instead`
                        : 'Work in the folder instead'}
                    </span>
                  </label>
                </fieldset>
              </div>
            )}
            {taskError && (
              <p role="alert" className="field-error">
                {taskError}
              </p>
            )}
            <div className="tracker-start-row">
              {repos.length ? (
                <span className="tracker-start-where">
                  <GitBranch aria-hidden="true" />
                  <span className="truncate" title={whereText}>
                    {whereText}
                  </span>
                  <Button
                    type="button"
                    variant="link"
                    className="shrink-0"
                    aria-expanded={changing}
                    disabled={taskBusy}
                    onClick={() => setChanging((open) => !open)}
                  >
                    {changing ? 'Done' : 'Change'}
                  </Button>
                </span>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setTask(null);
                    addFolder();
                  }}
                >
                  <FolderPlus />
                  Add a code folder
                </Button>
              )}
              <StartHint reason={taskBusy ? '' : startBlocker}>
                <div className="split-button" role="group" aria-label="Start task">
                  <Button
                    className="rounded-r-none"
                    disabled={!startReady}
                    aria-label={`Start task with ${agentLabel(preferredAgent)}`}
                    onClick={() => void startTask(preferredAgent)}
                  >
                    <AgentIcon agent={preferredAgent} />
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
                        <ChevronDown />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuLabel>Agent</DropdownMenuLabel>
                      {agentCatalog.map(({ id: agent }) => (
                        <DropdownMenuItem
                          key={agent}
                          onSelect={() => {
                            savePreferredAgent(agent);
                            void startTask(agent);
                          }}
                        >
                          <AgentIcon agent={agent} className="size-4" />
                          Start with {agentLabel(agent)}
                        </DropdownMenuItem>
                      ))}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </StartHint>
            </div>
          </DialogFooter>
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
                      {state && <ActivityDot state={state} />}
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

/** Converts draft tasks to issues in one GitHub repository, so that they can start. */
function ConvertDraftsDialog({
  open,
  onOpenChange,
  drafts,
  repositories,
  onConvert,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  drafts: TrackerItem[];
  /** The repositories of the board, as "owner/name". */
  repositories: string[];
  onConvert: (repository: string) => Promise<void>;
}) {
  const [repository, setRepository] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setRepository(repositories[0] || '');
      setError('');
    }
  }, [open]);
  const valid = /^[\w.-]+\/[\w.-]+$/.test(repository.trim());
  async function submit() {
    if (!valid || busy) return;
    setBusy(true);
    setError('');
    try {
      await onConvert(repository.trim());
      onOpenChange(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>Convert {plural(drafts.length, 'draft')} to issues</DialogTitle>
          <DialogDescription className="sr-only">
            Choose the GitHub repository of the new issues.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-4">
          <label className="form-label">
            Repository
            {repositories.length ? (
              <Choice
                className="w-full"
                label="Repository"
                value={repository}
                disabled={busy}
                onChange={setRepository}
                options={repositories.map((value) => ({ value, label: value }))}
              />
            ) : (
              <Input
                aria-label="Repository"
                placeholder="owner/repository"
                value={repository}
                disabled={busy}
                onChange={(event) => setRepository(event.target.value)}
              />
            )}
          </label>
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!valid || busy} onClick={() => void submit()}>
            {busy ? 'Converting…' : 'Convert'}
          </Button>
        </DialogFooter>
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
