import { GitHubViewLayout, SavedViewFilterChip } from './github-view-layout';
import { GitHubSavedViews, openSavedView } from './github-saved-views';
import type { SavedProjectView } from '../domain/github-resources';
import { TrackerRoadmap } from './tracker-roadmap';
import { trackerAuthPending } from '../domain/tracker';
import { GitHubItemEditor, ItemActionsMenu } from './github-item-editor';
import { useProjectBoard } from '../hooks/use-project-board';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  FolderPlus,
  ListFilter,
  Link2,
  X,
} from 'lucide-react';
import { interfaceConfig } from '../config/interface';
import { agentCatalog, agentLabel, isAgent } from '../config/agents';
import { trackerConnection } from '../domain/tracker';
import { useTracker } from '../hooks/use-tracker';
import { sessionRepo } from '../lib/session-repository';
import { pathBasename, plural } from '../lib/platform';
import { ActionMenu } from './action-menu';
import { TrackerBoard } from './tracker-board';
import {
  StatusIcon,
  TaskPullRequest,
  TrackerList,
  activityText,
  linkedChats,
  trackerColumns,
  type TaskSelection,
} from './tracker-list';
import { ProjectTabs } from './project-tabs';
import {
  DocsToIssuesDialog,
  PlanningToolDialog,
  ProjectInsights,
  type PlanningTool,
  type TaskFilter,
  useUncertainWritesToast,
} from './planning-tools';
import { ProjectSettingsDialog, type ProjectSettingsTab } from './project-settings-dialog';
import {
  ActivityDot,
  activityKey,
  useActivityState,
  type SessionActivityState,
} from './activity-dot';
import type { ProjectPage as RoutePage } from '../domain/workspace-route';
import { projectColors } from '../domain/project-colors';
import { EmptyState } from './ui/empty-state';
import { EntityIcon } from './ui/entity-icon';
import { PageHeader, SectionHeader } from './ui/page-header';
import { SegmentedControl } from './ui/segmented-control';
import { Radio } from './ui/checkbox';
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
import {
  Columns3,
  ExternalLink,
  FileText,
  Folder,
  Layers2,
  List,
  RefreshCw,
  Plus,
} from 'lucide-react';
import { Hint } from './hint';
import { DocPagePicker } from './doc-page-picker';
import { NewSessionSplit, ProjectHome } from './project-home';
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

/** The name of the tracker side: "GitHub Projects board", never just "project". */
export function boardNoun(providerName: string) {
  return providerName === 'GitHub' ? 'GitHub Projects board' : `${providerName} board`;
}

/** Opens Settings at a section. The shell listens for this event. */
function openSettings(section: string) {
  window.dispatchEvent(new CustomEvent('kalkidan-open-settings', { detail: { section } }));
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
const toRoutePage = (page: ProjectPage): RoutePage => (page === 'overview' ? 'board' : page);

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
  dispatch: 'Run in parallel…',
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
  // The latest connection, for handlers that run after a refresh.
  const connectedRef = useRef(false);
  connectedRef.current = !!linkedProject;
  const [settingsTab, setSettingsTab] = useState<ProjectSettingsTab | null>(null);
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
  const [checkout, setCheckout] = useState('current');
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
  const cloneFromGitHub = () => (onCloneFromGitHub ? onCloneFromGitHub() : addFolder());
  const startSession = (repo: Project, agent: Agent) =>
    onNewSession ? onNewSession(repo, agent) : onRepo(repo);
  const openChat = (session: Session) => (onOpenSession || onResume)(session);
  const chooseAgent = (agent: Agent) => {
    if (isAgent(agent)) savePreferredAgent(agent);
  };
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
  /** The code folder of a task: the folder of its GitHub repository, else the usual folder. */
  function taskFolder(item: TrackerItem) {
    const matches = item.repository
      ? repos.filter((r) => r.name === pathBasename(item.repository!))
      : [];
    return matches.length === 1
      ? matches[0].id
      : preferredRepoId || (repos.length === 1 ? repos[0].id : '');
  }
  function chooseTask(item: TrackerItem) {
    setTask(item);
    lastTaskId.current = item.id;
    setCheckout('current');
    checkoutTouched.current = false;
    setTaskBranch('');
    setTaskError('');
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
    try {
      const target = await workTarget(repo, task, checkout, taskBranch.trim());
      launch(target, agent, task);
      setTask(null);
    } catch (e) {
      setTaskError(errorMessage(e));
    } finally {
      setTaskBusy(false);
    }
  }
  /**
   * "Start" on a card: the preferred agent in the recommended place. On the default branch
   * that is a branch copy. When the code folder is not clear, the task sheet opens instead.
   */
  const [quickBusy, setQuickBusy] = useState('');
  async function quickStart(item: TrackerItem) {
    if (quickBusy) return;
    const repo = repos.find((r) => r.id === taskFolder(item));
    if (!repo) {
      chooseTask(item);
      return;
    }
    setQuickBusy(item.id);
    try {
      let mode = 'current';
      if (typeof api.workingStatus === 'function') {
        const value = await api.workingStatus(repo.id).catch(() => null);
        if (value?.branch && value.branch === value.defaultBranch) mode = 'worktree';
      }
      const target = await workTarget(repo, item, mode, taskBranchName(item));
      launch(target, readPreferredAgent(), item);
    } catch (e) {
      showToast({
        message: `Could not start a chat on “${item.title}”. ${errorMessage(e)}`,
        tone: 'error',
        actions: [{ label: 'Open task', onClick: () => chooseTask(item) }],
      });
    } finally {
      setQuickBusy('');
    }
  }
  // On the default branch, the agent works in a branch copy unless the user chooses otherwise.
  useEffect(() => {
    setRepoStatus(null);
    if (!taskId || !repoId || typeof api.workingStatus !== 'function') return;
    let live = true;
    api
      .workingStatus(repoId)
      .then((value) => {
        if (!live) return;
        setRepoStatus({ branch: value.branch, defaultBranch: value.defaultBranch });
        if (!checkoutTouched.current && value.branch && value.branch === value.defaultBranch) {
          setCheckout('worktree');
          setTaskBranch((current) => current || (task ? taskBranchName(task) : ''));
        }
      })
      .catch(() => {
        // Without a status, the choice stays as it is.
      });
    return () => {
      live = false;
    };
  }, [api, taskId, repoId]);
  /** The usage chip of a chat opens Insights at its task. The Usage section selects it. */
  const [usageTaskId, setUsageTaskId] = useState<string>();
  // Open the requested task once for each new ID. On Insights, the task is for the Usage
  // section, so the task sheet does not open.
  const openedTask = useRef('');
  useEffect(() => {
    if (!initialTaskId || !board || openedTask.current === initialTaskId) return;
    if (requestedPage === 'insights') {
      openedTask.current = initialTaskId;
      setUsageTaskId(initialTaskId);
    } else if (openTaskById(initialTaskId)) openedTask.current = initialTaskId;
  }, [initialTaskId, board, requestedPage]);
  async function refreshBoard() {
    const next = await reloadBoard();
    if (!next) return;
    setTask((previous) =>
      previous
        ? [...next.items, ...(next.archivedItems || [])].find((item) => item.id === previous.id) ||
          null
        : null,
    );
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
  const currentRepository = embedded
    ? repos.find((repo) => repo.id === preferredRepoId)
    : undefined;
  const repositoryName = currentRepository && pathBasename(currentRepository.path);
  const items =
    (savedView
      ? [...(board?.items || []), ...(board?.archivedItems || [])]
      : archived
        ? board?.archivedItems
        : board?.items
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
    return trackerColumns(board).flatMap((column) =>
      sortedItems.filter(
        (item) => (options.some((o) => o.id === item.statusId) ? item.statusId : '') === column.id,
      ),
    );
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
  // A GitHub write with an unknown result shows a toast with a Review action.
  useUncertainWritesToast(api, group.id, github);
  const [selectedIds, setSelectedIds] = useState<ReadonlySet<string>>(new Set());
  const selectionAnchor = useRef('');
  const visibleIds = visualOrder.map((item) => item.id);
  const selectedVisible = visibleIds.filter((id) => selectedIds.has(id));
  const selection: TaskSelection | undefined =
    planningTools.length && !savedView && view !== 'roadmap'
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
    setTool({ tool: name, ids });
  }

  function newItem(statusId = '') {
    setTitle('');
    setBody('');
    setDraftStatus(statusId);
    setModalError('');
    setModal('draft');
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
    settings: (tab?: string) => void;
    openTask: (id: string) => void;
    view: (id: string) => void;
    reload: () => void;
    usage: (taskId: string) => void;
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
    settings(tab) {
      setSettingsTab(tab === 'automation' || tab === 'fields' || tab === 'github' ? tab : 'board');
    },
    openTask(id) {
      if (!openTaskById(id)) pendingTask.current = id;
    },
    usage(taskId) {
      rememberPage('insights');
      setUsageTaskId(taskId);
    },
    reload() {
      void action(refreshBoard, false);
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
      [
        'kalkidan-open-project-settings',
        (event) => {
          const detail = forGroup(event);
          if (detail) eventRef.current.settings(detail.tab as string | undefined);
        },
      ],
      ['kalkidan-github-writes', (event) => forGroup(event) && eventRef.current.reload()],
      [
        'kalkidan-open-project-page',
        (event) => {
          const detail = forGroup(event);
          if (detail?.page === 'insights' && typeof detail.taskId === 'string')
            eventRef.current.usage(detail.taskId);
        },
      ],
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
  const taskIndex = sortedItems.findIndex((item) => item.id === task?.id);
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
  async function submitModal() {
    if (!modalReady) return;
    setBusy(true);
    setModalError('');
    // After the dialog closes, an error shows on the page.
    let closed = false;
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
        if (draftStatus) {
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
      }
      setModal(null);
      closed = true;
      setError('');
      await refreshBoard();
      showToast(
        kind === 'connect'
          ? `Connected the ${boardName}.`
          : kind === 'issue'
            ? `Added the task to the ${boardName}.`
            : `Created the task on the ${boardName}.`,
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
      void submitModal();
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
  const syncStatus = busy
    ? `Syncing with ${providerName}…`
    : board && !error
      ? `Synced with ${providerName}`
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
      ? 'Choose where to work first'
      : checkout === 'worktree' && !taskBranch.trim()
        ? 'Enter a branch name first'
        : '';
  const startReady = !taskBusy && !startBlocker;
  // The GitHub editor of an issue or a pull request shows the description with Edit, so the
  // sheet does not show it a second time.
  const editsItem = provider === 'github' && !!board?.writable && !!task;
  const editsContent = editsItem && (task?.kind === 'Issue' || task?.kind === 'PullRequest');
  const taskRepo = repos.find((r) => r.id === repoId);
  const shownPage: ProjectPage = embedded ? 'tasks' : page;
  const showOverview = shownPage === 'overview';
  const showTasks = shownPage === 'tasks';
  const canStart = repos.length > 0;
  const savedViewsAvailable = github && typeof api.trackerSavedView === 'function';
  const archivedCount = board?.archivedItems?.length || 0;
  const planMenu = board && (planningTools.length > 0 || docsPlanAvailable) && (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">
          <ClipboardList />
          Plan
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        {planningTools.length > 0 && (
          <DropdownMenuLabel>
            {selectedVisible.length
              ? `For ${plural(selectedVisible.length, 'selected task')}`
              : `For ${plural(visibleIds.length, 'visible task')}`}
          </DropdownMenuLabel>
        )}
        {planningTools.map((name) => (
          <DropdownMenuItem
            key={name}
            disabled={!visibleIds.length}
            onSelect={() => openTool(name)}
          >
            {planningLabels[name]}
          </DropdownMenuItem>
        ))}
        {docsPlanAvailable && (
          <>
            {planningTools.length > 0 && <DropdownMenuSeparator />}
            <DropdownMenuItem onSelect={() => setDocsPlanOpen(true)}>
              Create tasks from a doc…
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  // After the bar closes, the focus goes back to the tasks.
  const endSelection = () => {
    selection?.clear();
    document.querySelector<HTMLElement>('.project-tracker .tracker-board, .tracker-list')?.focus();
  };
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
        {plural(selectedVisible.length, 'task')} selected
      </span>
      {selectedVisible.length < visibleIds.length && (
        <Hint label="Select all visible tasks (⌘A)">
          <Button variant="ghost" size="sm" onClick={() => selection.selectAll()}>
            Select all {visibleIds.length}
          </Button>
        </Hint>
      )}
      <span className="tracker-filter-divider" aria-hidden="true" />
      {planningTools.map((name) => (
        <Button key={name} variant="ghost" size="sm" onClick={() => openTool(name)}>
          {planningLabels[name]}
        </Button>
      ))}
      <Hint label="Clear the selection (Esc)">
        <Button variant="ghost" size="sm" aria-keyshortcuts="Escape" onClick={endSelection}>
          <X />
          Clear
        </Button>
      </Hint>
    </div>
  );
  // While tasks are selected, the toolbar shows the actions for them. Escape or Clear ends it.
  const taskToolbar = selectionBar ? (
    <div className="tracker-filterbar">{selectionBar}</div>
  ) : (
    <div className="tracker-filterbar" role="toolbar" aria-label="Task tools">
      <SearchInput
        size="sm"
        variant="filled"
        className="min-w-40 flex-1 sm:max-w-64"
        aria-label="Search tasks"
        placeholder="Search tasks…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
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
      <div className="tracker-filter-end">
        {board && savedViewsAvailable && (
          <GitHubSavedViews
            key={'views:' + group.id}
            api={api}
            groupId={group.id}
            revision={board.cache?.revision}
            onChange={changeSavedView}
          />
        )}
        {savedView && <SavedViewFilterChip view={savedView} />}
        {!!archivedCount && !savedView && (
          <Hint label={archived ? 'Show the active tasks' : 'Show the archived tasks'}>
            <Button
              variant="chip"
              size="sm"
              className="tracker-archived-chip"
              aria-pressed={archived}
              onClick={() => setArchived(!archived)}
            >
              Archived
              <span className="tracker-filter-count">{archivedCount}</span>
            </Button>
          </Hint>
        )}
        <SegmentedControl
          size="sm"
          label="Task view"
          value={view}
          onChange={setView}
          options={[
            { value: 'board', label: 'Board', icon: <Columns3 aria-hidden="true" /> },
            { value: 'list', label: 'List', icon: <List aria-hidden="true" /> },
            { value: 'roadmap', label: 'Roadmap' },
          ]}
        />
        {planMenu}
      </div>
    </div>
  );
  const trackerMenu = linkedProject && (
    <ActionMenu
      label="Board actions"
      size="md"
      disabled={busy}
      items={[
        ...(connection &&
        board?.statusField &&
        descriptor?.capabilities.updateStatus &&
        typeof api.trackerConfigure === 'function'
          ? [{ label: 'Automatic status changes…', action: () => setSettingsTab('automation') }]
          : []),
        ...(github && typeof api.trackerSettings === 'function'
          ? [{ label: 'GitHub project settings…', action: () => setSettingsTab('github') }]
          : []),
        ...(github && typeof api.trackerResources === 'function'
          ? [{ label: 'Fields, views and reports…', action: () => setSettingsTab('fields') }]
          : []),
        { label: `Change ${boardName}…`, action: () => setSettingsTab('board') },
      ]}
    />
  );
  const newTaskButton = (
    <div className="split-button" role="group" aria-label="New task">
      <Button
        className={descriptor?.capabilities.importItem ? 'rounded-r-none' : undefined}
        disabled={busy || !descriptor?.capabilities.createItem}
        onClick={() => newItem()}
      >
        <Plus size={16} />
        New task
      </Button>
      {descriptor?.capabilities.importItem && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              size="icon"
              disabled={busy}
              className="rounded-l-none border-l border-primary-foreground/20"
              aria-label="More ways to add a task"
            >
              <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => newItem()}>
              <Plus />
              New task
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={addExisting}>
              <Link2 />
              Add existing issue or pull request…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
  const restricted = board?.restrictedItems || 0;
  return (
    <section
      className={embedded ? 'project-tracker embedded-tracker' : 'project-tracker'}
      data-page={shownPage}
      aria-label={embedded ? 'Repository project tasks' : 'Project tracker'}
    >
      <PageHeader
        className="tracker-project-heading"
        icon={
          <EntityIcon size="lg" color={group.color ? projectColors[group.color] : undefined}>
            <Folder />
          </EntityIcon>
        }
        title={embedded ? 'Project tasks' : group.name}
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
            {showTasks && restricted > 0 && (
              <Hint label="You cannot see these tasks. Ask for access on GitHub.">
                <span className="tracker-subtitle-count" tabIndex={0}>
                  · {restricted} restricted
                </span>
              </Hint>
            )}
          </>
        }
        actions={
          showOverview ? (
            <>
              <NewSessionSplit
                repos={repos}
                sessions={sessions}
                agent={preferredAgent}
                preferredRepoId={preferredRepoId}
                onAgent={chooseAgent}
                onStart={startSession}
              />
              {!!repos.length && (
                <Button variant="outline" onClick={addFolder}>
                  <FolderPlus />
                  Add a code folder
                </Button>
              )}
              {trackerMenu}
            </>
          ) : linkedProject ? (
            <>
              <span role="status" className="tracker-sync-status">
                {syncStatus}
              </span>
              <Hint label="Refresh board">
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Refresh board"
                  disabled={busy}
                  onClick={() => void action(refreshBoard, false)}
                >
                  <RefreshCw size={16} className={busy ? 'animate-spin' : ''} />
                </Button>
              </Hint>
              {showTasks && newTaskButton}
              {trackerMenu}
            </>
          ) : null
        }
      />
      {!embedded && (
        <ProjectTabs
          groupId={group.id}
          page={toRoutePage(shownPage)}
          onSelect={(next) => {
            if (next === 'board') rememberPage('overview');
            else if (next === 'tasks' || next === 'insights') rememberPage(next);
          }}
        />
      )}
      <ProjectSettingsDialog
        api={api}
        group={group}
        open={!!settingsTab}
        tab={settingsTab || undefined}
        onOpenChange={(open) => {
          if (open) return;
          setSettingsTab(null);
          void action(refreshBoard, false);
          void onRefresh();
        }}
        onConnected={async () => {
          // Connect and disconnect both end here. After the refresh, a connected board shows
          // its tasks, and a disconnected project shows the overview.
          await onRefresh();
          window.setTimeout(() => setPage(connectedRef.current ? 'tasks' : 'overview'), 0);
        }}
        onChanged={() => void action(refreshBoard, false)}
      />
      {error && (
        <Alert variant="destructive" size="sm">
          <AlertDescription>
            {error}
            {linkedProject &&
              (authErrorPattern.test(error) ? (
                <Button variant="outline" size="sm" onClick={() => openSettings('accounts')}>
                  Sign in to {providerName}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={busy}
                  onClick={() => void action(refreshBoard, false)}
                >
                  Retry
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
      {showOverview ? (
        <ProjectHome
          api={api}
          group={group}
          repos={repos}
          sessions={sessions}
          agent={preferredAgent}
          board={board}
          boardName={boardName}
          connected={!!linkedProject}
          canCreateTask={!!descriptor?.capabilities.createItem && !busy}
          onRepo={onRepo}
          onNewSession={startSession}
          onOpenSession={openChat}
          onAddFolder={addFolder}
          onCloneFromGitHub={cloneFromGitHub}
          onOpenDocs={onOpenDocs}
          onAllSessions={onAllSessions}
          onConnectBoard={connect}
          onOpenTasks={() => setPage('tasks')}
          onNewTask={() => {
            setPage('tasks');
            newItem();
          }}
        />
      ) : shownPage === 'insights' ? (
        <ProjectInsights
          api={api}
          group={group}
          board={board || undefined}
          onOpenTask={(id) => void openTaskById(id)}
          onFilter={applyFilter}
          initialTaskId={usageTaskId}
        />
      ) : !linkedProject ? (
        <EmptyState
          title={`No ${boardName}`}
          action={<Button onClick={connect}>Connect a board</Button>}
        >
          Connect one to see the tasks of this project here.
        </EmptyState>
      ) : (
        !items.length && (
          <EmptyState compact className="tracker-empty-result">
            {busy
              ? 'Loading tasks…'
              : error
                ? 'Tasks could not be loaded. Use Retry above.'
                : filtered
                  ? 'No tasks match the search or filters. Clear them to see all tasks.'
                  : archived
                    ? 'No archived tasks.'
                    : `No tasks yet. Tasks come from your ${boardName}. Select New task, or add ` +
                      `tasks on ${providerName} and refresh.`}
          </EmptyState>
        )
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
            onOpenSettings={github ? () => setSettingsTab('fields') : undefined}
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
              busy={busy || !descriptor?.capabilities.updateStatus}
              onOpen={chooseTask}
              onStatus={(item, value) => void action(() => client.status(group.id, item.id, value))}
              activity={activity}
              onOpenChat={openChat}
              onStart={canStart && !archived ? (item) => void quickStart(item) : undefined}
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
              descriptor?.capabilities.createItem && descriptor?.capabilities.updateStatus
                ? newItem
                : undefined
            }
            onOpen={chooseTask}
            onStatus={(item, value) => void action(() => client.status(group.id, item.id, value))}
            activity={activity}
            onOpenChat={openChat}
            onStart={canStart && !archived ? (item) => void quickStart(item) : undefined}
            selection={selection}
          />
        ))}
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
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>
              {modal === 'connect'
                ? `Connect a ${boardName}`
                : modal === 'issue'
                  ? 'Add existing issue or pull request'
                  : 'New task'}
            </DialogTitle>
            <DialogDescription>
              {modal === 'connect'
                ? `Choose a ${boardName} or create a new one. Its tasks show in this project. ` +
                  'Your code folders and chats do not change.'
                : modal === 'issue'
                  ? `Paste the URL of a ${providerName} issue or pull request. ` +
                    `Kalkidan adds it to the ${boardName}.`
                  : `Kalkidan adds the task to the ${boardName}.`}
            </DialogDescription>
          </DialogHeader>
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
                    {auth.message || 'Waiting for approval. This dialog will update automatically.'}
                  </p>
                </>
              )}
              {auth.status === 'ready' && (
                <Badge variant="success">{providerName} access granted</Badge>
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
                        openSettings('accounts');
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
            <div className="space-y-4">
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
              {board?.statusField && descriptor?.capabilities.updateStatus && (
                <label className="form-label">
                  Status
                  <Choice
                    className="w-full"
                    label="Initial status"
                    value={draftStatus}
                    onChange={setDraftStatus}
                    options={[
                      { value: '', label: 'Board default' },
                      ...board.statusField.options.map((o) => ({ value: o.id, label: o.name })),
                    ]}
                  />
                </label>
              )}
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
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={closeModal}>
              Cancel
            </Button>
            <Button disabled={!modalReady} onClick={() => void submitModal()}>
              {busy ? 'Saving…' : modal === 'connect' ? 'Connect board' : `Add to ${providerName}`}
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
              {linkedProject?.title || 'Task'}
              {task?.number ? ` · #${task.number}` : ''}
            </span>
            <div>
              <Hint label="Previous task">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Previous task"
                  disabled={taskBusy || taskIndex <= 0}
                  onClick={() => chooseTask(sortedItems[taskIndex - 1])}
                >
                  <ChevronLeft size={16} />
                </Button>
              </Hint>
              <Hint label="Next task">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Next task"
                  disabled={taskBusy || taskIndex < 0 || taskIndex >= sortedItems.length - 1}
                  onClick={() => chooseTask(sortedItems[taskIndex + 1])}
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
              <span className="tracker-filter-divider" aria-hidden="true" />
              <Hint label="Close (Esc)">
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
              <DialogTitle
                ref={taskTitle}
                tabIndex={-1}
                className="text-xl break-words outline-none [overflow-wrap:anywhere] focus-visible:rounded-sm focus-visible:shadow-[var(--focus-ring)]"
              >
                {task?.title}
              </DialogTitle>
              <DialogDescription className="sr-only">
                {task?.repository || 'Project task'}
              </DialogDescription>
            </DialogHeader>
            <dl className="tracker-issue-properties">
              <dt>Status</dt>
              <dd>
                {task && board?.statusField ? (
                  <Choice
                    size="sm"
                    variant="ghost"
                    className="-ml-2.5"
                    label="Task status"
                    value={task.statusId || ''}
                    disabled={busy || !descriptor?.capabilities.updateStatus}
                    onChange={(value) =>
                      void action(() => client.status(group.id, task.id, value), true, setTaskError)
                    }
                    options={[
                      ...(!task.statusId ? [{ value: '', label: 'No status' }] : []),
                      ...board.statusField.options.map((o) => ({ value: o.id, label: o.name })),
                    ]}
                  />
                ) : (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <StatusIcon name={task?.status || 'No status'} />
                    <span className="truncate">{task?.status || 'No status'}</span>
                  </span>
                )}
              </dd>
              <dt>GitHub repository</dt>
              <dd>
                <span className="truncate" title={task?.repository}>
                  {task?.repository || 'None'}
                </span>
              </dd>
            </dl>
            {!editsContent && (
              <div className="tracker-issue-description prose-ui" data-size="sm">
                <Markdown remarkPlugins={[remarkGfm]} components={{ a: ExternalAnchor }}>
                  {task?.body || 'No description yet.'}
                </Markdown>
              </div>
            )}
            {task?.url && (
              <a
                className="text-link self-start text-sm"
                href={task.url}
                target="_blank"
                rel="noreferrer"
              >
                Open on {providerName}
                <ExternalLink size={14} aria-hidden="true" />
              </a>
            )}
            {provider === 'github' && board?.writable && task && (
              <GitHubItemEditor
                key={task.id}
                api={api}
                groupId={group.id}
                board={board}
                item={task}
                onSaved={refreshBoard}
              />
            )}
            <section className="tracker-related-docs" aria-label="Linked chats">
              <SectionHeader
                size="sm"
                title="Linked chats"
                count={linkedSessions.length || undefined}
                actions={
                  <Button variant="ghost" size="sm" onClick={() => setChatPickerOpen(true)}>
                    <Link2 />
                    Link a chat…
                  </Button>
                }
              />
              {linkedSessions.length ? (
                <ul className="tracker-doc-list">
                  {linkedSessions.map((s) => {
                    const state = activity[activityKey(s.agent, s.id)];
                    const name = s.organization?.title || s.title;
                    return (
                      <li
                        key={s.agent + s.id}
                        className="tracker-doc-row tracker-chat-row row-hover"
                      >
                        <button
                          type="button"
                          className="tracker-doc-open"
                          title={`${agentLabel(s.agent)} · ${name}`}
                          onClick={() => {
                            setTask(null);
                            openChat(s);
                          }}
                        >
                          <AgentIcon agent={s.agent} />
                          <span className="truncate">{name}</span>
                          {state && (
                            <span className="tracker-chat-state">
                              <ActivityDot state={state} />
                              {activityText(state)}
                            </span>
                          )}
                        </button>
                        <TaskPullRequest chats={[s]} />
                        <Button
                          variant="outline"
                          size="xs"
                          aria-label={`Open chat: ${name}`}
                          onClick={() => {
                            setTask(null);
                            openChat(s);
                          }}
                        >
                          Open
                        </Button>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <p className="form-help m-0">
                  No chat works on this task yet. Start one below, or link an existing chat.
                </p>
              )}
            </section>
            {docsAvailable && (
              <section className="tracker-related-docs" aria-label="Related docs">
                <SectionHeader
                  size="sm"
                  title="Related docs"
                  count={docLinks.length || undefined}
                  actions={
                    <Button variant="ghost" size="sm" onClick={() => setDocPickerOpen(true)}>
                      <Plus />
                      Link a page…
                    </Button>
                  }
                />
                {docLinks.length ? (
                  <ul className="tracker-doc-list">
                    {docLinks.map((doc) => (
                      <li key={doc.id} className="tracker-doc-row row-hover row-focus">
                        {onOpenDocs ? (
                          <button
                            type="button"
                            className="tracker-doc-open"
                            onClick={() => {
                              setTask(null);
                              onOpenDocs(doc.id);
                            }}
                          >
                            <FileText aria-hidden="true" />
                            <span className="truncate">{doc.title}</span>
                          </button>
                        ) : (
                          <span className="tracker-doc-open">
                            <FileText aria-hidden="true" />
                            <span className="truncate">{doc.title}</span>
                          </span>
                        )}
                        <Hint label="Remove link">
                          <Button
                            variant="ghost"
                            size="icon-xs"
                            aria-label={`Remove link to ${doc.title}`}
                            onClick={() =>
                              void changeDocLinks(docLinks.filter((d) => d.id !== doc.id))
                            }
                          >
                            <X />
                          </Button>
                        </Hint>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="form-help m-0">
                    Link the doc pages that help with this task, such as a plan or a spec. A new
                    chat on the task gets these pages.
                  </p>
                )}
              </section>
            )}
            <section className="tracker-work" aria-label="Work on this task">
              <SectionHeader title="Work on this task" />
              {repos.length ? (
                <div className="space-y-4">
                  <label className="form-label">
                    Code folder
                    <Choice
                      className="w-full"
                      label="Code folder for this task"
                      disabled={taskBusy}
                      value={repoId}
                      onChange={(value) => {
                        checkoutTouched.current = false;
                        setRepoId(value);
                      }}
                      options={[
                        { value: '', label: 'Choose a code folder' },
                        ...repos.map((r) => ({ value: r.id, label: r.name })),
                      ]}
                    />
                  </label>
                  <fieldset className="tracker-checkout" disabled={taskBusy}>
                    <legend className="form-label">Where the agent makes changes</legend>
                    {[
                      {
                        value: 'current',
                        label: taskRepo
                          ? `In ${taskRepo.name}${repoStatus?.branch ? ` on ${repoStatus.branch}` : ''}`
                          : 'In the code folder',
                      },
                      {
                        value: 'worktree',
                        label: 'In a branch copy on a new branch (recommended)',
                      },
                    ].map((option) => (
                      <label key={option.value} className="tracker-checkout-option">
                        <Radio
                          name="task-checkout"
                          value={option.value}
                          className="mt-0.5"
                          checked={checkout === option.value}
                          onChange={() => {
                            checkoutTouched.current = true;
                            setCheckout(option.value);
                            if (option.value === 'worktree' && task && !taskBranch.trim())
                              setTaskBranch(taskBranchName(task));
                          }}
                        />
                        <span className="min-w-0 break-words">{option.label}</span>
                      </label>
                    ))}
                    <p className="form-help m-0">
                      A branch copy is a separate folder on its own branch, so the agent&apos;s
                      changes stay apart from your work.
                    </p>
                  </fieldset>
                  {checkout === 'worktree' && (
                    <label className="form-label">
                      New branch
                      <Input
                        aria-label="Task branch"
                        disabled={taskBusy}
                        value={taskBranch}
                        onChange={(e) => setTaskBranch(e.target.value)}
                        placeholder="feature/task-name"
                      />
                    </label>
                  )}
                  {taskError && (
                    <p role="alert" className="field-error">
                      {taskError}
                    </p>
                  )}
                  <p className="form-help m-0">
                    You can review the prompt before you send it.
                    {docLinks.length > 0 &&
                      ` The chat gets ${plural(docLinks.length, 'related doc')}.`}
                  </p>
                </div>
              ) : (
                <div className="tracker-work-empty">
                  <p>This project has no code folders. Add one to start a chat on this task.</p>
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
                </div>
              )}
            </section>
          </div>
          <DialogFooter className="tracker-issue-footer">
            <Button variant="outline" disabled={taskBusy} onClick={() => setTask(null)}>
              Close
            </Button>
            <StartHint reason={taskBusy ? '' : startBlocker}>
              <div className="split-button" role="group" aria-label="Start a chat">
                <Button
                  className="rounded-r-none"
                  disabled={!startReady}
                  onClick={() => void startTask(preferredAgent)}
                >
                  <AgentIcon agent={preferredAgent} />
                  {taskBusy ? 'Starting…' : `New ${agentLabel(preferredAgent)} chat`}
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
                        <AgentIcon agent={agent} />
                        New {agentLabel(agent)} chat
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </StartHint>
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
            <EmptyState compact>
              {query ? 'No chat matches the search.' : 'This project has no other chats.'}
            </EmptyState>
          )}
          {error && (
            <Alert variant="destructive" size="sm">
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" disabled={!!busy} onClick={() => onOpenChange(false)}>
            Cancel
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
