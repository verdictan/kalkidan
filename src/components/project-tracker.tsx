import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { TrackerWorkflow } from './tracker-workflow';
import { interfaceConfig } from '../config/interface';
import { trackerConnection } from '../domain/tracker';
import { useTracker } from '../hooks/use-tracker';
import { sessionRepo } from '../lib/session-repository';
import { ActionMenu } from './action-menu';
import { TrackerBoard } from './tracker-board';
import { useEffect, useRef, useState } from 'react';
import { GitFork, RefreshCw, Plus, Search } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
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
}: {
  embedded?: boolean;
  preferredRepoId?: string;
  connectRequested?: boolean;
  onConnectHandled?: () => void;
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
  const [repoFilter, setRepoFilter] = useState('all');
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
  const [url, setUrl] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [modal, setModal] = useState<'draft' | 'issue' | 'connect' | null>(null);
  const [draftStatus, setDraftStatus] = useState('');
  const [sort, setSort] = useState('project');
  const [syncNotice, setSyncNotice] = useState('');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [task, setTask] = useState<TrackerItem | null>(null);
  const [repoId, setRepoId] = useState(repos[0]?.id || '');
  async function authorize() {
    authActive.current = true;
    setAuth({ status: 'checking' });
    setError('');
    try {
      setAuth(await client.authorize());
    } catch {
      setAuth({
        status: 'error',
        message: `Could not start ${providerName} authorization. Restart Kalkidan and try again.`,
      });
    }
  }
  function connect() {
    setUrl(linkedProject?.url || '');
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
    const matches = repos.filter((r) => r.name === item.repository?.split('/').at(-1));
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
      if (!target) return;
      if (checkout === 'worktree') await onRefresh();
      onTask(target, agent, task);
      setTask(null);
    } catch (e) {
      setTaskError(e instanceof Error ? e.message : String(e));
    } finally {
      setTaskBusy(false);
    }
  }
  async function refreshBoard() {
    const next = await client.board(group.id);
    setBoard(next);
    setTask((previous) =>
      previous ? next.items.find((item) => item.id === previous.id) || previous : null,
    );
  }
  async function action(fn: () => Promise<unknown>, refresh = true) {
    setBusy(true);
    setError('');
    setSyncNotice('');
    try {
      await fn();
      if (refresh) await refreshBoard();
      setSyncNotice(`Synced with ${providerName}`);
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
        if (current) setError(e.message);
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
  const repositoryName = currentRepository?.path.replace(/\/$/, '').split('/').at(-1);
  const items =
    board?.items.filter(
      (item) =>
        (!embedded ||
          (!!currentRepository &&
            !!item.repository &&
            [repositoryName, currentRepository.name].includes(
              item.repository.split('/').at(-1),
            ))) &&
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
    setError('');
    setModal('draft');
  }
  const taskIndex = sortedItems.findIndex((item) => item.id === task?.id);
  const repositoryOptions = [
    ...new Set(
      board?.items.map((item) => item.repository).filter((repo): repo is string => !!repo) || [],
    ),
  ].sort();
  return (
    <section
      className={embedded ? 'project-tracker embedded-tracker' : 'project-tracker'}
      aria-label={embedded ? 'Repository project tasks' : 'Project tracker'}
    >
      <header className="tracker-project-heading">
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0">
            <h2>{embedded ? 'Project tasks' : group.name}</h2>
            <div className="tracker-project-source">
              <GitFork size={12} />
              <span>{linkedProject?.title || `Connect this project to ${providerName}`}</span>
              {linkedProject && (
                <span className="text-muted-foreground">
                  {linkedProject.number ? `#${linkedProject.number}` : ''}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {linkedProject ? (
            <>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Refresh ${providerName} project`}
                disabled={busy}
                onClick={() => void action(refreshBoard, false)}
              >
                <RefreshCw size={14} className={busy ? 'animate-spin' : ''} />
              </Button>
              <Button
                size="sm"
                disabled={busy || !descriptor?.capabilities.createItem}
                onClick={() => newItem()}
              >
                <Plus size={14} />
                New item
              </Button>
              {connection &&
                board?.statusField &&
                descriptor?.capabilities.updateStatus &&
                typeof api.trackerConfigure === 'function' && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={() => setWorkflowOpen(true)}
                  >
                    Workflow
                  </Button>
                )}
              <ActionMenu
                label="Tracker actions"
                disabled={busy}
                items={[
                  ...(descriptor?.capabilities.importItem
                    ? [
                        {
                          label: 'Add existing issue',
                          action: () => {
                            setUrl('');
                            setModal('issue');
                          },
                        },
                      ]
                    : []),
                  { label: 'Change project connection', action: connect },
                ]}
              />
            </>
          ) : null}
        </div>
      </header>
      {connection && board && (
        <TrackerWorkflow
          api={api}
          groupId={group.id}
          connection={connection}
          board={board}
          open={workflowOpen}
          onOpenChange={setWorkflowOpen}
          onSaved={onRefresh}
        />
      )}
      {error && !modal && (
        <Alert variant="destructive">
          <AlertDescription>
            {error}
            {linkedProject && (
              <Button variant="outline" size="sm" onClick={connect}>
                Authorize {providerName} access
              </Button>
            )}
          </AlertDescription>
        </Alert>
      )}
      {linkedProject ? (
        <div className="tracker-filterbar">
          <div className="relative min-w-40 flex-1 sm:max-w-64">
            <Search
              size={14}
              className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
            />
            <Input
              className="h-8 pl-8 text-xs"
              aria-label={`Search ${providerName} items`}
              placeholder="Search issues…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <Choice
            className="h-8 text-xs"
            label="Filter task status"
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
              className="h-8 max-w-60 text-xs"
              label="Filter issues by repository"
              value={repoFilter}
              onChange={setRepoFilter}
              options={[
                { value: 'all', label: 'All repositories' },
                { value: 'draft', label: 'Draft items' },
                ...repositoryOptions.map((repo) => ({ value: repo, label: repo })),
              ]}
            />
          )}
          <Choice
            label="Sort issues"
            className="h-8 text-xs"
            value={sort}
            onChange={setSort}
            options={[
              { value: 'project', label: 'Project order' },
              { value: 'title', label: 'Title A–Z' },
            ]}
          />
          {(query || status !== 'all' || repoFilter !== 'all') && (
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
        </div>
      ) : embedded ? (
        <p className="py-3 text-sm text-muted-foreground">
          Connect {providerName} from the sidebar to see project tasks here.
        </p>
      ) : (
        <div className="project-empty">
          <GitFork size={24} />
          <h3>Connect your project tracker</h3>
          <p>
            This existing project remains available. Use Connect {providerName} at the bottom of the
            sidebar to manage issues alongside your repositories.
          </p>
        </div>
      )}
      {board && (
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
      )}
      {linkedProject && !items.length && (
        <div className="tracker-empty-result">
          {busy
            ? 'Loading issues…'
            : error
              ? 'Issues could not be loaded. Retry the connection above.'
              : 'No tasks to show. Clear filters or create a new item.'}
        </div>
      )}
      {linkedProject && !embedded && (
        <footer className="tracker-footer">
          <span>
            {items.length} {items.length === 1 ? 'issue' : 'issues'} shown
          </span>
          <span role="status">
            {busy
              ? `Syncing with ${providerName}…`
              : syncNotice || `${providerName} · Status field`}
          </span>
        </footer>
      )}
      <Dialog open={!!modal} onOpenChange={(open) => !open && !busy && closeModal()}>
        <DialogContent className="max-h-[calc(100dvh-48px)] overflow-y-auto">
          <DialogHeader className="pr-6">
            <DialogTitle>
              {modal === 'connect'
                ? `Connect ${providerName} Project`
                : modal === 'issue'
                  ? 'Add existing issue or pull request'
                  : 'Create draft item'}
            </DialogTitle>
            <DialogDescription>
              {modal === 'connect'
                ? `Choose an existing ${providerName} project or create a new one.`
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
            <>
              <Input
                maxLength={256}
                aria-label="Item title"
                placeholder="What needs to be done?"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              {board?.statusField && descriptor?.capabilities.updateStatus && (
                <Choice
                  label="Initial status"
                  value={draftStatus}
                  onChange={setDraftStatus}
                  options={[
                    { value: '', label: 'Project default' },
                    ...board.statusField.options.map((o) => ({ value: o.id, label: o.name })),
                  ]}
                />
              )}
              <Textarea
                maxLength={20000}
                aria-label="Item description"
                placeholder="Description and acceptance criteria"
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </>
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
              placeholder="Issue URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          )}{' '}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={closeModal}>
              Cancel
            </Button>
            <Button
              disabled={
                busy ||
                (modal === 'connect' && auth.status !== 'ready') ||
                (modal === 'draft' ? !title.trim() : !url.trim())
              }
              onClick={() =>
                void action(async () => {
                  if (modal === 'connect') {
                    await client.link(group.id, url);
                    await onRefresh();
                  } else if (modal === 'issue') await client.importItem(group.id, url);
                  else {
                    const createdId = await client.draft(group.id, title, body);
                    setModal(null);
                    if (draftStatus) {
                      try {
                        if (!createdId)
                          throw new Error('This tracker did not return the new item ID.');
                        await client.status(group.id, createdId, draftStatus);
                      } catch (e) {
                        await refreshBoard();
                        throw new Error(
                          `Item created, but its status could not be set. Move it from the board to retry. ${e instanceof Error ? e.message : String(e)}`,
                        );
                      }
                    }
                  }
                  setModal(null);
                })
              }
            >
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
        <DialogContent className="tracker-issue-detail">
          <div className="tracker-issue-nav">
            <span>{task?.number ? `#${task.number}` : 'Draft item'}</span>
            <div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Previous issue"
                disabled={taskBusy || taskIndex <= 0}
                onClick={() => chooseTask(sortedItems[taskIndex - 1])}
              >
                <ChevronLeft size={16} />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Next issue"
                disabled={taskBusy || taskIndex < 0 || taskIndex >= sortedItems.length - 1}
                onClick={() => chooseTask(sortedItems[taskIndex + 1])}
              >
                <ChevronRight size={16} />
              </Button>
            </div>
          </div>
          <DialogHeader className="pr-6">
            <DialogTitle>{task?.title}</DialogTitle>
            <DialogDescription>
              {task?.repository || 'Project task'} · {task?.status || 'No status'}
            </DialogDescription>
          </DialogHeader>
          {task && board?.statusField && (
            <Choice
              label="Issue status"
              value={task.statusId || ''}
              disabled={busy || !descriptor?.capabilities.updateStatus}
              onChange={(value) => void action(() => client.status(group.id, task.id, value))}
              options={[
                ...(!task.statusId ? [{ value: '', label: 'No status' }] : []),
                ...board.statusField.options.map((o) => ({ value: o.id, label: o.name })),
              ]}
            />
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="tracker-issue-description">
            <Markdown remarkPlugins={[remarkGfm]}>{task?.body || 'No description yet.'}</Markdown>
          </div>
          {task?.url && <Input aria-label="Issue URL" readOnly value={task.url} />}
          <div className="tracker-work-heading">Work on this issue</div>
          <p className="text-xs font-medium text-muted-foreground">Work in repository</p>
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
          {task &&
            projectSessions.filter(
              (s) => !s.organization?.archived && s.organization?.taskId === task.id,
            ).length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium">Continue existing work</p>
                {projectSessions
                  .filter((s) => !s.organization?.archived && s.organization?.taskId === task.id)
                  .map((s) => (
                    <Button
                      className="w-full justify-start truncate"
                      variant="outline"
                      key={s.agent + s.id}
                      onClick={() => {
                        onResume(s);
                        setTask(null);
                      }}
                    >
                      {s.agent === 'codex' ? 'Codex' : 'Claude'} ·{' '}
                      {s.organization?.title || s.title}
                    </Button>
                  ))}
              </div>
            )}
          <p className="text-xs font-medium text-muted-foreground">Checkout</p>
          <Choice
            className="w-full"
            label="Task checkout"
            disabled={taskBusy}
            value={checkout}
            onChange={setCheckout}
            options={[
              { value: 'current', label: 'Current checkout' },
              { value: 'worktree', label: 'New worktree' },
            ]}
          />
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
            <p role="alert" className="text-sm text-destructive">
              {taskError}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Choose where the agent should work. You can review the prompt before sending.
          </p>
          <DialogFooter>
            {(['codex', 'claude'] as Agent[]).map((agent) => (
              <Button
                key={agent}
                disabled={
                  taskBusy ||
                  !repos.some((r) => r.id === repoId) ||
                  (checkout === 'worktree' && !taskBranch.trim())
                }
                variant={agent === 'codex' ? 'default' : 'outline'}
                onClick={() => void startTask(agent)}
              >
                {agent === 'codex' ? 'Open in Codex' : 'Open in Claude Code'}
              </Button>
            ))}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
