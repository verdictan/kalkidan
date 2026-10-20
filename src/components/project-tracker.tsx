import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { TrackerWorkflow } from './tracker-workflow';
import { interfaceConfig } from '../config/interface';
import { agentCatalog, agentLabel } from '../config/agents';
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
import { useEffect, useRef, useState, type ComponentProps, type KeyboardEvent } from 'react';
import {
  Columns3,
  ExternalLink,
  Folder,
  GitFork,
  Layers2,
  List,
  RefreshCw,
  Plus,
} from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { SearchInput } from './ui/search-input';
import { AgentIcon } from './ui/agent-icon';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
  TrackerBoard as TrackerBoardData,
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
  onConnectTracker,
  onResume,
  onRefresh,
  onRepo,
  onTask,
  initialTaskId,
}: {
  /** Opens the detail of this task when the board loads, for example from a search result. */
  initialTaskId?: string;
  embedded?: boolean;
  preferredRepoId?: string;
  connectRequested?: boolean;
  onConnectHandled?: () => void;
  /** Starts the tracker connection. The empty state shows a connect button for it. */
  onConnectTracker?: () => void;
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
  const [workflowOpen, setWorkflowOpen] = useState(false);
  const filterStorage = filterKey(group.id, embedded);
  const [savedFilters] = useState(() => readFilters(filterStorage));
  const [repoFilter, setRepoFilter] = useState(savedFilters.repoFilter);
  const projectSessions = sessions.filter((session) => !!sessionRepo(session, repos));
  const [checkout, setCheckout] = useState('current');
  const [taskBranch, setTaskBranch] = useState('');
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskError, setTaskError] = useState('');
  const authActive = useRef(false);
  const [auth, setAuth] = useState<TrackerAuthState>({ status: 'idle' });
  const [board, setBoard] = useState<TrackerBoardData | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Each dialog shows its own error. The page error stays on the page.
  const [modalError, setModalError] = useState('');
  const [url, setUrl] = useState('');
  const [query, setQuery] = useState(savedFilters.query);
  const [status, setStatus] = useState(savedFilters.status);
  const [modal, setModal] = useState<'draft' | 'issue' | 'connect' | null>(null);
  const [draftStatus, setDraftStatus] = useState('');
  const [sort, setSort] = useState(savedFilters.sort);
  const [view, setView] = useState<'board' | 'list'>(
    savedFilters.view === 'list' ? 'list' : 'board',
  );
  useEffect(() => {
    writeFilters(filterStorage, { query, status, repoFilter, sort, view });
  }, [filterStorage, query, status, repoFilter, sort, view]);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [task, setTask] = useState<TrackerItem | null>(null);
  const [repoId, setRepoId] = useState(repos[0]?.id || '');
  const [preferredAgent, setPreferredAgent] = useState(readPreferredAgent);
  useEffect(() => onPreferredAgentChange(setPreferredAgent), []);
  async function authorize() {
    authActive.current = true;
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
    if (modal === 'connect') {
      authActive.current = false;
      void client.cancelAuth();
      setAuth({ status: 'idle' });
    }
    setModal(null);
  }
  useEffect(() => {
    if (modal !== 'connect' || !['checking', 'waiting'].includes(auth.status)) return;
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
  useEffect(
    () => () => {
      if (authActive.current) void client.cancelAuth();
    },
    [client, group.id],
  );
  function chooseTask(item: TrackerItem) {
    setTask(item);
    setCheckout('current');
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
      const target =
        checkout === 'worktree' ? await api.taskWorktree(repo.id, taskBranch.trim()) : repo;
      if (!target) {
        setTaskError('Could not create the worktree.');
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
  // Open the requested task once for each new ID.
  const openedTask = useRef('');
  useEffect(() => {
    if (!initialTaskId || !board || openedTask.current === initialTaskId) return;
    const item = board.items.find((i) => i.id === initialTaskId);
    if (!item) return;
    openedTask.current = initialTaskId;
    chooseTask(item);
  }, [initialTaskId, board]);
  async function refreshBoard() {
    const next = await client.board(group.id);
    setBoard(next);
    setTask((previous) =>
      previous ? next.items.find((item) => item.id === previous.id) || previous : null,
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
  useEffect(() => {
    let current = true;
    setBoard(null);
    if (!linkedProject) return;
    setBusy(true);
    client
      .board(group.id)
      .then((value) => {
        if (current) setBoard(value);
      })
      .catch((e) => {
        if (current) setError(errorMessage(e));
      })
      .finally(() => {
        if (current) setBusy(false);
      });
    return () => {
      current = false;
    };
  }, [group.id, linkedProject?.id, client, revision]);
  const currentRepository = embedded
    ? repos.find((repo) => repo.id === preferredRepoId)
    : undefined;
  const repositoryName = currentRepository && pathBasename(currentRepository.path);
  const items =
    board?.items.filter(
      (item) =>
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
    sort === 'title' ? [...items].sort((a, b) => a.title.localeCompare(b.title)) : items;
  function newItem(statusId = '') {
    setTitle('');
    setBody('');
    setDraftStatus(statusId);
    setModalError('');
    setModal('draft');
  }
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
  const filtered = query || status !== 'all' || repoFilter !== 'all';
  const startReady =
    !taskBusy &&
    repos.some((r) => r.id === repoId) &&
    (checkout !== 'worktree' || !!taskBranch.trim());
  return (
    <section
      className={embedded ? 'project-tracker embedded-tracker' : 'project-tracker'}
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
                  {providerName} · <span>{linkedProject.title}</span>
                  {linkedProject.number ? ` #${linkedProject.number}` : ''}
                </>
              ) : (
                `Not connected to ${providerName}`
              )}
            </span>
          </>
        }
        actions={
          linkedProject ? (
            <>
              <span role="status" className="tracker-sync-status">
                {syncStatus}
              </span>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Refresh ${providerName} project`}
                disabled={busy}
                onClick={() => void action(refreshBoard, false)}
              >
                <RefreshCw size={16} className={busy ? 'animate-spin' : ''} />
              </Button>
              <Button
                disabled={busy || !descriptor?.capabilities.createItem}
                onClick={() => newItem()}
              >
                <Plus size={16} />
                New task
              </Button>
              <ActionMenu
                label="Tracker actions"
                size="md"
                disabled={busy}
                items={[
                  ...(connection &&
                  board?.statusField &&
                  descriptor?.capabilities.updateStatus &&
                  typeof api.trackerConfigure === 'function'
                    ? [{ label: 'Workflow', action: () => setWorkflowOpen(true) }]
                    : []),
                  ...(descriptor?.capabilities.importItem
                    ? [
                        {
                          label: 'Add existing task',
                          action: () => {
                            setUrl('');
                            setModalError('');
                            setModal('issue');
                          },
                        },
                      ]
                    : []),
                  { label: 'Change project connection', action: connect },
                ]}
              />
            </>
          ) : null
        }
      />
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
        <Alert variant="destructive">
          <AlertDescription>
            {error}
            {linkedProject &&
              (authErrorPattern.test(error) ? (
                <Button variant="outline" size="sm" onClick={connect}>
                  Authorize {providerName} access
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
      {linkedProject ? (
        <div className="tracker-filterbar">
          <SearchInput
            size="sm"
            variant="filled"
            className="min-w-40 flex-1 sm:max-w-64"
            aria-label="Search tasks"
            placeholder="Search tasks…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
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
            <Choice
              size="sm"
              variant="filled"
              className="max-w-60"
              label="Filter by repository"
              value={repoFilter}
              onChange={setRepoFilter}
              options={[
                { value: 'all', label: 'All repositories' },
                { value: 'draft', label: 'Draft tasks' },
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
              { value: 'project', label: 'Project order' },
              { value: 'title', label: 'Title A–Z' },
            ]}
          />
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
            <span className="tracker-count">{plural(items.length, 'task')} shown</span>
            <SegmentedControl
              size="sm"
              label="Task view"
              value={view}
              onChange={setView}
              options={[
                { value: 'board', label: 'Board', icon: <Columns3 aria-hidden="true" /> },
                { value: 'list', label: 'List', icon: <List aria-hidden="true" /> },
              ]}
            />
          </div>
        </div>
      ) : embedded ? (
        <EmptyState compact>
          Connect {providerName} from the sidebar to see project tasks here.
        </EmptyState>
      ) : (
        <EmptyState
          icon={<GitFork />}
          title="Connect your project tracker"
          action={
            onConnectTracker && (
              <Button size="lg" onClick={onConnectTracker}>
                Connect {providerName} project
              </Button>
            )
          }
        >
          Connect a {providerName} project to show its tasks next to your repositories. Your
          repositories and sessions do not change.
        </EmptyState>
      )}
      {linkedProject && !items.length && (
        <EmptyState compact className="tracker-empty-result">
          {busy
            ? 'Loading tasks…'
            : error
              ? 'Tasks could not be loaded. Use Retry above.'
              : filtered
                ? 'No tasks to show. Clear the filters or create a new task.'
                : 'No tasks to show. Create a new task.'}
        </EmptyState>
      )}
      {board &&
        (view === 'list' ? (
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
      <Dialog open={!!modal} onOpenChange={(open) => !open && !busy && closeModal()}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>
              {modal === 'connect'
                ? `Connect ${providerName} project`
                : modal === 'issue'
                  ? 'Add existing task'
                  : 'New task'}
            </DialogTitle>
            <DialogDescription>
              {modal === 'connect'
                ? `Choose an existing ${providerName} project or create a new one.`
                : modal === 'issue'
                  ? `Paste the URL of a ${providerName} issue or pull request. ` +
                    `This action updates the linked ${providerName} project.`
                  : `This action updates the linked ${providerName} project.`}
            </DialogDescription>
          </DialogHeader>
          {modal === 'connect' && (
            <div className="space-y-3" aria-live="polite">
              {auth.status === 'checking' && (
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
              {auth.status === 'error' && (
                <>
                  <Alert variant="destructive">
                    <AlertDescription>{auth.message}</AlertDescription>
                  </Alert>
                  <Button variant="outline" onClick={() => void authorize()}>
                    Retry {providerName} authorization
                  </Button>
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
                      { value: '', label: 'Project default' },
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
              {busy
                ? 'Saving…'
                : modal === 'connect'
                  ? 'Connect project'
                  : `Add to ${providerName}`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={!!task} onOpenChange={(open) => !open && !taskBusy && setTask(null)}>
        <DialogContent className="tracker-issue-detail top-0 right-0 left-auto flex h-dvh max-h-dvh w-[min(var(--dialog-md),100vw)] max-w-[100vw] translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none border-0 border-l p-0 sm:max-w-[100vw] data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100 [&>[data-slot=dialog-close]]:top-4 [&>[data-slot=dialog-close]]:right-6">
          <div className="tracker-issue-body">
            <div className="tracker-issue-nav">
              <span>{task?.number ? `#${task.number}` : 'Draft task'}</span>
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
            <section className="tracker-work" aria-label="Work on this task">
              <SectionHeader title="Work on this task" />
              <div className="space-y-4">
                <label className="form-label">
                  Work in
                  <Choice
                    className="w-full"
                    label="Task repository"
                    disabled={taskBusy}
                    value={repoId}
                    onChange={setRepoId}
                    options={[
                      { value: '', label: 'Choose repository' },
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
                <label className="form-label">
                  Checkout
                  <Choice
                    className="w-full"
                    label="Task checkout"
                    disabled={taskBusy}
                    value={checkout}
                    onChange={(value) => {
                      setCheckout(value);
                      if (value === 'worktree' && task && !taskBranch.trim())
                        setTaskBranch(taskBranchName(task));
                    }}
                    options={[
                      { value: 'current', label: 'Current checkout' },
                      { value: 'worktree', label: 'New worktree' },
                    ]}
                  />
                </label>
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
                <p className="text-xs text-muted-foreground">
                  Choose where the agent should work. You can review the prompt before sending.
                </p>
              </div>
            </section>
          </div>
          <DialogFooter className="tracker-issue-footer">
            <div className="split-button" role="group" aria-label="Start a session">
              <Button
                className="rounded-r-none"
                disabled={!startReady}
                onClick={() => void startTask(preferredAgent)}
              >
                <AgentIcon agent={preferredAgent} />
                Start {agentLabel(preferredAgent)} session
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
                  {agentCatalog.map(({ id: agent }) => (
                    <DropdownMenuItem
                      key={agent}
                      onSelect={() => {
                        savePreferredAgent(agent);
                        void startTask(agent);
                      }}
                    >
                      <AgentIcon agent={agent} />
                      Start {agentLabel(agent)} session
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
