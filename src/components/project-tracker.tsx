import { useVerdictanEpoch } from '../hooks/use-verdictan-epoch';
import { TaskUsageHistoryPanel } from './task-usage-history';
import { ProjectServicesPanel } from './project-services';
import { ParallelDispatchPanel } from './parallel-dispatch';
import { ProjectPortfolio } from './project-portfolio';
import { ProjectReadiness } from './project-readiness';
import { DocsToIssues } from './docs-to-issues';
import { IterationPlanner } from './iteration-planner';
import { GitHubWriteHistory } from './github-write-history';
import { ProjectBatch } from './project-batch';
import { GitHubViewLayout } from './github-view-layout';
import { GitHubSavedViews } from './github-saved-views';
import type { SavedProjectView } from '../domain/github-resources';
import { ProjectHealth } from './project-health';
import { TrackerRoadmap } from './tracker-roadmap';
import { GitHubProjectResourcesDialog } from './github-project-resources';
import { GitHubProjectSettingsDialog } from './github-project-settings';
import { trackerAuthPending } from '../domain/tracker';
import { GitHubItemEditor } from './github-item-editor';
import { useProjectBoard } from '../hooks/use-project-board';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronDown, ChevronLeft, ChevronRight, FolderPlus, ListFilter, X } from 'lucide-react';
import { TrackerWorkflow } from './tracker-workflow';
import { interfaceConfig } from '../config/interface';
import { agentCatalog, agentLabel, isAgent } from '../config/agents';
import { trackerConnection } from '../domain/tracker';
import { useTracker } from '../hooks/use-tracker';
import { sessionRepo } from '../lib/session-repository';
import { pathBasename, plural } from '../lib/platform';
import { ActionMenu } from './action-menu';
import { TrackerBoard } from './tracker-board';
import { StatusIcon, TrackerList } from './tracker-list';
import { projectColors } from '../domain/project-colors';
import { EmptyState } from './ui/empty-state';
import { EntityIcon } from './ui/entity-icon';
import { PageHeader, SectionHeader } from './ui/page-header';
import { SegmentedControl } from './ui/segmented-control';
import {
  useEffect,
  useRef,
  useState,
  useCallback,
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
// Related docs are kept in local storage for each task. The docs files do not change.
function docLinkKey(groupId: string, taskId: string) {
  return `kalkidan-task-docs:${groupId}:${taskId}`;
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

// The project page opens on the overview or on the tasks, as the user left it.
type ProjectPage = 'overview' | 'tasks';
function pageKey(groupId: string) {
  return `kalkidan-project-page:${groupId}`;
}
function readPage(groupId: string): ProjectPage | null {
  try {
    const value = localStorage.getItem(pageKey(groupId));
    return value === 'overview' || value === 'tasks' ? value : null;
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
  /** The page to show: the project overview or the tasks. Without it, the last page shows. */
  page?: 'overview' | 'tasks';
  /** Called when the user switches between the overview and the tasks. */
  onPageChange?: (page: 'overview' | 'tasks') => void;
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
  /** Starts a new session in a code folder. Without it, the panel opens the code folder. */
  onNewSession?: (repo: Project, agent: Agent) => void;
  /** Opens a session from the overview. Without it, the panel uses onResume. */
  onOpenSession?: (session: Session) => void;
  /** Opens the docs page, at a page when `pageId` is set. Without it, Docs cards do not show. */
  onOpenDocs?: (pageId?: string) => void;
  /** Shows all sessions of the project. Without it, "See all sessions" does not show. */
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
  const verdictanEpoch = useVerdictanEpoch(api);
  const connection = trackerConnection(group);
  const {
    client,
    provider,
    name: providerName,
    descriptor,
  } = useTracker(api, connection?.provider);
  const linkedProject = connection?.project;
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [resourcesOpen, setResourcesOpen] = useState(false);
  const filterStorage = filterKey(group.id, embedded);
  const [savedFilters] = useState(() => readFilters(filterStorage));
  const [repoFilter, setRepoFilter] = useState(savedFilters.repoFilter);
  const projectSessions = sessions.filter((session) => !!sessionRepo(session, repos));
  const [checkout, setCheckout] = useState('current');
  // The user chose a checkout. A loaded branch status then does not change it.
  const checkoutTouched = useRef(false);
  const [repoStatus, setRepoStatus] = useState<{ branch: string; defaultBranch: string } | null>(
    null,
  );
  const [page, setPageState] = useState<ProjectPage>(
    () => requestedPage || readPage(group.id) || (connection?.project ? 'tasks' : 'overview'),
  );
  useEffect(() => {
    if (requestedPage) setPageState(requestedPage);
  }, [requestedPage]);
  function setPage(value: ProjectPage) {
    setPageState(value);
    if (value !== page) onPageChange?.(value);
    try {
      localStorage.setItem(pageKey(group.id), value);
    } catch {
      // The page then resets on the next visit.
    }
  }
  const [filtersOpen, setFiltersOpen] = useState(
    () =>
      savedFilters.status !== 'all' ||
      savedFilters.repoFilter !== 'all' ||
      savedFilters.sort !== 'project',
  );
  const [docLinks, setDocLinks] = useState<LinkedDoc[]>([]);
  const [docPickerOpen, setDocPickerOpen] = useState(false);
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
  function chooseTask(item: TrackerItem) {
    setTask(item);
    setCheckout('current');
    checkoutTouched.current = false;
    setTaskBranch('');
    setTaskError('');
    const matches = item.repository
      ? repos.filter((r) => r.name === pathBasename(item.repository!))
      : [];
    setRepoId(
      matches.length === 1
        ? matches[0].id
        : preferredRepoId || (repos.length === 1 ? repos[0].id : ''),
    );
  }
  async function startTask(agent: Agent) {
    const repo = repos.find((r) => r.id === repoId);
    if (!repo || !task || taskBusy) return;
    setTaskBusy(true);
    setTaskError('');
    try {
      const key = `kalkidan-task-checkout:${group.id}:${task.id}:${repo.id}:${taskBranch.trim()}`;
      const operationId = localStorage.getItem(key) || crypto.randomUUID();
      if (checkout === 'worktree') localStorage.setItem(key, operationId);
      const target =
        checkout === 'worktree'
          ? await api.taskWorktree(repo.id, taskBranch.trim(), operationId)
          : repo;
      if (!target) {
        setTaskError('Could not create the branch copy.');
        return;
      }
      if (checkout === 'worktree') await onRefresh();
      onTask(target, agent, task);
      setTask(null);
    } catch (e) {
      setTaskError(errorMessage(e));
    } finally {
      setTaskBusy(false);
    }
  }
  // On the default branch, the agent works in a branch copy unless the user chooses otherwise.
  const taskId = task?.id;
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
  // Related docs: the saved links, with titles from the current docs. Removed pages go.
  const docsAvailable = typeof api.docsMetadata === 'function';
  useEffect(() => {
    if (!taskId) return;
    const key = docLinkKey(group.id, taskId);
    const saved = readDocLinks(key);
    setDocLinks(saved);
    if (!saved.length || !docsAvailable) return;
    let live = true;
    api
      .docsMetadata(group.id)
      .then((pages) => {
        if (!live) return;
        const next = saved.flatMap((link) => {
          const doc = pages.find((p) => p.id === link.id);
          return doc ? [{ id: doc.id, title: doc.title || 'Untitled' }] : [];
        });
        setDocLinks(next);
        writeDocLinks(key, next);
      })
      .catch(() => {
        // The saved titles show until the docs load.
      });
    return () => {
      live = false;
    };
  }, [api, group.id, taskId]);
  function changeDocLinks(next: LinkedDoc[]) {
    if (!taskId) return;
    setDocLinks(next);
    writeDocLinks(docLinkKey(group.id, taskId), next);
  }
  // Open the requested task once for each new ID.
  const openedTask = useRef('');
  useEffect(() => {
    if (!initialTaskId || !board || openedTask.current === initialTaskId) return;
    const item = board.items.find((i) => i.id === initialTaskId);
    if (!item) return;
    openedTask.current = initialTaskId;
    setPage('tasks');
    chooseTask(item);
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
  function newItem(statusId = '') {
    setTitle('');
    setBody('');
    setDraftStatus(statusId);
    setModalError('');
    setModal('draft');
  }
  // The shell sends this event for the "New task" menu command after it opens this page.
  const newTaskRef = useRef<() => void>(() => {});
  newTaskRef.current = () => {
    if (!linkedProject) {
      connect();
      return;
    }
    if (busy || !descriptor?.capabilities.createItem) return;
    setPage('tasks');
    newItem();
  };
  useEffect(() => {
    if (embedded) return;
    const handle = () => newTaskRef.current();
    window.addEventListener('kalkidan-new-task', handle);
    return () => window.removeEventListener('kalkidan-new-task', handle);
  }, [embedded]);
  const taskIndex = sortedItems.findIndex((item) => item.id === task?.id);
  const repositoryOptions = [
    ...new Set(
      board?.items.map((item) => item.repository).filter((repo): repo is string => !!repo) || [],
    ),
  ].sort();
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
  const linkedSessions = task
    ? projectSessions.filter((s) => !s.organization?.archived && s.organization?.taskId === task.id)
    : [];
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
    : plural(total, 'task');
  const startBlocker = !repos.length
    ? 'Add a code folder first'
    : !repos.some((r) => r.id === repoId)
      ? 'Choose where to work first'
      : checkout === 'worktree' && !taskBranch.trim()
        ? 'Enter a branch name first'
        : '';
  const startReady = !taskBusy && !startBlocker;
  const taskRepo = repos.find((r) => r.id === repoId);
  const showOverview = !embedded && (!linkedProject || page === 'overview');
  const taskToolbar = (
    <>
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
      {filtered && (
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
        <span className="tracker-count">{countText}</span>
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
      </div>
    </>
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
          ? [{ label: 'Automatic status changes…', action: () => setWorkflowOpen(true) }]
          : []),
        ...(descriptor?.capabilities.importItem
          ? [
              {
                label: 'Add existing task…',
                action: () => {
                  setUrl('');
                  setModalError('');
                  setModal('issue');
                },
              },
            ]
          : []),
        ...(connection?.provider === 'github' && typeof api.trackerSettings === 'function'
          ? [{ label: 'GitHub project settings…', action: () => setSettingsOpen(true) }]
          : []),
        ...(connection?.provider === 'github' && typeof api.trackerResources === 'function'
          ? [{ label: 'Fields, views, and reports…', action: () => setResourcesOpen(true) }]
          : []),
        { label: `Change ${boardName}…`, action: connect },
      ]}
    />
  );
  return (
    <section
      className={embedded ? 'project-tracker embedded-tracker' : 'project-tracker'}
      data-page={showOverview ? 'overview' : 'tasks'}
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
            {!showOverview && linkedProject && (
              <span className="tracker-subtitle-count">· {countText}</span>
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
              <Button
                disabled={busy || !descriptor?.capabilities.createItem}
                onClick={() => newItem()}
              >
                <Plus size={16} />
                New task
              </Button>
              {trackerMenu}
            </>
          ) : null
        }
      />
      {resourcesOpen && (
        <GitHubProjectResourcesDialog
          key={'resources:' + group.id}
          api={api}
          groupId={group.id}
          onClose={() => setResourcesOpen(false)}
          onChanged={() => {
            void action(refreshBoard, false);
            onRefresh();
          }}
        />
      )}
      {settingsOpen && (
        <GitHubProjectSettingsDialog
          key={'settings:' + group.id}
          api={api}
          groupId={group.id}
          open={settingsOpen}
          onOpenChange={setSettingsOpen}
          onSaved={() => {
            void action(refreshBoard, false);
            onRefresh();
          }}
        />
      )}
      {connection && board && (
        <TrackerWorkflow
          api={api}
          groupId={group.id}
          connection={connection}
          board={board}
          defaults={descriptor?.statusNames}
          open={workflowOpen}
          onOpenChange={setWorkflowOpen}
          onSaved={onRefresh}
        />
      )}
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
      {linkedProject && !embedded && (
        <div className="tracker-filterbar">
          <SegmentedControl
            size="sm"
            label="Project page"
            value={showOverview ? 'overview' : 'tasks'}
            onChange={setPage}
            options={[
              { value: 'overview', label: 'Overview' },
              { value: 'tasks', label: 'Tasks' },
            ]}
          />
          {!showOverview && <span className="tracker-filter-divider" aria-hidden="true" />}
          {!showOverview && taskToolbar}
        </div>
      )}
      {linkedProject && embedded && <div className="tracker-filterbar">{taskToolbar}</div>}
      {!showOverview && filtersVisible && (
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
            // The title shows the full name when the chosen code folder is truncated.
            <span
              className="contents"
              title={
                repoFilter === 'all'
                  ? undefined
                  : repoFilter === 'draft'
                    ? 'Not linked to a repository'
                    : repoFilter
              }
            >
              <Choice
                size="sm"
                variant="filled"
                className="max-w-60"
                label="Filter by repository"
                value={repoFilter}
                onChange={setRepoFilter}
                options={[
                  { value: 'all', label: 'All repositories' },
                  { value: 'draft', label: 'Not linked to a repository' },
                  ...repositoryOptions.map((repo) => ({ value: repo, label: repo })),
                ]}
              />
            </span>
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
          onOpenSession={onOpenSession || onResume}
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
      ) : linkedProject ? (
        !items.length && (
          <EmptyState compact className="tracker-empty-result">
            {busy
              ? 'Loading tasks…'
              : error
                ? 'Tasks could not be loaded. Use Retry above.'
                : filtered
                  ? 'No tasks match the search or filters. Clear them to see all tasks.'
                  : `No tasks yet. Tasks come from your ${boardName}. Select New task, or add ` +
                    `tasks on ${providerName} and refresh.`}
          </EmptyState>
        )
      ) : (
        <EmptyState compact>
          Connect a {boardName} on the project page to see its tasks here.
        </EmptyState>
      )}
      {board &&
        !showOverview &&
        connection?.provider === 'github' &&
        typeof api.trackerSavedView === 'function' && (
          <GitHubSavedViews
            key={'views:' + group.id}
            api={api}
            groupId={group.id}
            revision={board.cache?.revision}
            onChange={changeSavedView}
          />
        )}
      {board && !showOverview && (
        <div className="flex items-center gap-3 py-2">
          {!!board.archivedItems?.length && (
            <Button size="sm" variant="ghost" onClick={() => setArchived(!archived)}>
              {archived ? 'Show active items' : `Archived items (${board.archivedItems.length})`}
            </Button>
          )}
          {!!board.restrictedItems && (
            <span className="text-xs text-muted-foreground">
              {board.restrictedItems} restricted items. Request access on GitHub to view them.
            </span>
          )}
        </div>
      )}
      {board &&
        !showOverview &&
        (view === 'roadmap' ? (
          <TrackerRoadmap
            key={'roadmap:' + group.id}
            board={board}
            items={sortedItems}
            onOpen={chooseTask}
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
          />
        ))}
      {board && !showOverview && connection?.provider === 'github' && (
        <div key={'health:' + group.id + ':' + board.project.id}>
          {typeof api.trackerBatch === 'function' && (
            <ProjectBatch
              api={api}
              groupId={group.id}
              board={board}
              onSaved={() => action(async () => {})}
            />
          )}
          {typeof api.trackerBatch === 'function' && typeof api.trackerRelations === 'function' && (
            <IterationPlanner
              api={api}
              groupId={group.id}
              board={board}
              sessions={projectSessions}
              onSaved={refreshBoard}
              onOpen={(id) => {
                const item = board.items.find((item) => item.id === id);
                if (item) chooseTask(item);
              }}
            />
          )}
          {typeof api.trackerDocsPlan === 'function' && (
            <DocsToIssues api={api} groupId={group.id} board={board} onSaved={refreshBoard} />
          )}
          {typeof api.trackerContent === 'function' &&
            typeof api.trackerRelations === 'function' && (
              <ProjectReadiness
                api={api}
                groupId={group.id}
                board={board}
                sessions={projectSessions}
                onOpen={(id) => {
                  const item = board.items.find((item) => item.id === id);
                  if (item) {
                    chooseTask(item);
                    setCheckout('worktree');
                  }
                }}
              />
            )}
          {typeof api.taskUsageHistory === 'function' && (
            <TaskUsageHistoryPanel
              key={`usage-${group.id}:${verdictanEpoch}`}
              api={api}
              groupId={group.id}
              board={board}
            />
          )}
          {typeof api.projectServicesStatus === 'function' && (
            <ProjectServicesPanel
              key={`services-${group.id}:${verdictanEpoch}`}
              api={api}
              groupId={group.id}
              board={board}
            />
          )}
          {typeof api.dispatchPrepare === 'function' && (
            <ParallelDispatchPanel
              key={`${group.id}:${verdictanEpoch}`}
              api={api}
              groupId={group.id}
              board={board}
            />
          )}
          {typeof api.trackerPortfolio === 'function' && <ProjectPortfolio api={api} />}
          {typeof api.trackerMutationHistory === 'function' && (
            <GitHubWriteHistory api={api} groupId={group.id} url={board.project.url} />
          )}
          {typeof api.trackerResources === 'function' && (
            <ProjectHealth api={api} groupId={group.id} />
          )}
        </div>
      )}
      <Dialog open={!!modal} onOpenChange={(open) => !open && !busy && closeModal()}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>
              {modal === 'connect'
                ? `Connect a ${boardName}`
                : modal === 'issue'
                  ? 'Add existing task'
                  : 'New task'}
            </DialogTitle>
            <DialogDescription>
              {modal === 'connect'
                ? `Choose a ${boardName} or create a new one. Its tasks show in this project. ` +
                  'Your code folders and sessions do not change.'
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
                <Badge variant="secondary">{providerName} access granted</Badge>
              )}
              {!trackerAuthPending(auth) && auth.status !== 'ready' && (
                <>
                  <Alert variant="destructive">
                    <AlertDescription>{auth.message}</AlertDescription>
                  </Alert>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => void authorize()}>
                      Try again
                    </Button>
                    <Button
                      variant="ghost"
                      onClick={() => {
                        closeModal();
                        openSettings('accounts');
                      }}
                    >
                      Open account settings
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
        <DialogContent className="tracker-issue-detail top-0 right-0 left-auto flex h-dvh max-h-dvh w-[min(var(--dialog-md),100vw)] max-w-[100vw] translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 border-l p-0 sm:max-w-[100vw] data-[state=closed]:zoom-out-100 data-[state=closed]:slide-out-to-right-4 data-[state=open]:zoom-in-100 data-[state=open]:slide-in-from-right-4 [&>[data-slot=dialog-close]]:top-4 [&>[data-slot=dialog-close]]:right-6">
          <div className="tracker-issue-body">
            <div className="tracker-issue-nav">
              <span className="truncate">
                {linkedProject?.title || 'Task'}
                {task?.number ? ` · #${task.number}` : ''}
              </span>
              <div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Previous task"
                  disabled={taskBusy || taskIndex <= 0}
                  onClick={() => chooseTask(sortedItems[taskIndex - 1])}
                >
                  <ChevronLeft size={16} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Next task"
                  disabled={taskBusy || taskIndex < 0 || taskIndex >= sortedItems.length - 1}
                  onClick={() => chooseTask(sortedItems[taskIndex + 1])}
                >
                  <ChevronRight size={16} />
                </Button>
              </div>
            </div>
            <DialogHeader className="pr-0">
              <DialogTitle className="text-xl break-words [overflow-wrap:anywhere]">
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
              <dt>Repository</dt>
              <dd>
                <span className="truncate" title={task?.repository}>
                  {task?.repository || 'None'}
                </span>
              </dd>
              <dt>Linked sessions</dt>
              <dd>
                <span className="truncate">{linkedSessions.length || 'None'}</span>
              </dd>
            </dl>
            <div className="tracker-issue-description prose-ui" data-size="sm">
              <Markdown remarkPlugins={[remarkGfm]} components={{ a: ExternalAnchor }}>
                {task?.body || 'No description yet.'}
              </Markdown>
            </div>
            {task?.url && (
              <Button asChild variant="outline" size="sm" className="self-start">
                <a href={task.url} target="_blank" rel="noreferrer">
                  <ExternalLink size={14} aria-hidden="true" />
                  Open issue on {providerName}
                </a>
              </Button>
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
            {docsAvailable && (
              <section className="tracker-related-docs" aria-label="Related docs">
                <SectionHeader
                  size="sm"
                  title="Related docs"
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
                            onClick={() => changeDocLinks(docLinks.filter((d) => d.id !== doc.id))}
                          >
                            <X />
                          </Button>
                        </Hint>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="form-help m-0">
                    Link the doc pages that help with this task, such as a plan or a spec.
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
                      label="Task repository"
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
                  {linkedSessions.length > 0 && (
                    <div className="form-label">
                      Continue existing work
                      <div className="space-y-2 font-normal text-foreground">
                        {linkedSessions.map((s) => (
                          <Button
                            className="w-full justify-start"
                            variant="outline"
                            key={s.agent + s.id}
                            title={`${agentLabel(s.agent)} · ${s.organization?.title || s.title}`}
                            onClick={() => {
                              onResume(s);
                              setTask(null);
                            }}
                          >
                            <AgentIcon agent={s.agent} />
                            <span className="min-w-0 truncate">
                              {agentLabel(s.agent)} · {s.organization?.title || s.title}
                            </span>
                          </Button>
                        ))}
                      </div>
                    </div>
                  )}
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
                        label: 'In a separate copy on a new branch (recommended)',
                      },
                    ].map((option) => (
                      <label key={option.value} className="tracker-checkout-option">
                        <input
                          type="radio"
                          name="task-checkout"
                          value={option.value}
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
                  <p className="form-help m-0">You can review the prompt before you send it.</p>
                </div>
              ) : (
                <div className="tracker-work-empty">
                  <p>This project has no code folders. Add one to start a session on this task.</p>
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
              Done
            </Button>
            <StartHint reason={taskBusy ? '' : startBlocker}>
              <div className="split-button" role="group" aria-label="Start a session">
                <Button
                  className="rounded-r-none"
                  disabled={!startReady}
                  onClick={() => void startTask(preferredAgent)}
                >
                  <AgentIcon agent={preferredAgent} />
                  {taskBusy ? 'Starting…' : `New ${agentLabel(preferredAgent)} session`}
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
                        New {agentLabel(agent)} session
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
              changeDocLinks([...docLinks, { id: doc.id, title: doc.title || 'Untitled' }]);
            setDocPickerOpen(false);
          }}
        />
      )}
    </section>
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
