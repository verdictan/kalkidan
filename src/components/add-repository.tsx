import { interfaceConfig } from '../config/interface';
import { RemoteRepositoryPicker } from './remote-repository-picker';
import { CreateProject } from './create-project';
import {
  useEffect,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import type { API, GitHubAuthState, GitHubRepository, Snapshot } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { SearchInput } from './ui/search-input';
import { Badge } from './ui/badge';
import { EmptyState } from './ui/empty-state';
import { Choice } from './choice';
import { Hint } from './hint';
import { cn } from '../lib/utils';
import { fileManagerName } from '../lib/platform';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';

type Source = 'github' | 'local' | 'library';

export function AddRepository({
  api,
  groupId,
  onRefresh,
  children,
  disabled,
  className,
  variant = 'ghost',
  size,
  onNotice,
}: {
  /** Reports the result of work that continues after the dialog closes. */
  onNotice?: (message: string, error?: boolean) => void;
  api: API;
  groupId?: string;
  onRefresh: () => Promise<unknown>;
  children?: ReactNode;
  disabled?: boolean;
  className?: string;
  variant?: 'ghost' | 'default' | 'outline';
  /** The size of the button that opens the dialog, for example 'lg' or 'icon-xs'. */
  size?: ComponentProps<typeof Button>['size'];
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Source>('github');
  // True after the first list of GitHub repositories loads or fails for this dialog.
  const [reposLoaded, setReposLoaded] = useState(false);
  // False while the dialog checks which source to show first.
  const [sourceReady, setSourceReady] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [target, setTarget] = useState(groupId || '');
  const [creatingProject, setCreatingProject] = useState(false);
  const [repos, setRepos] = useState<GitHubRepository[]>([]);
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const openRef = useRef(false);
  openRef.current = open;
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [auth, setAuth] = useState<GitHubAuthState>({ status: 'idle' });
  const remoteGroup = snapshot?.groups?.find((g) => g.id === target && g.hostId);
  async function loadRepos() {
    setLoading(true);
    setReposLoaded(true);
    setError('');
    try {
      setRepos(await api.githubRepositories());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }
  // Load GitHub repositories only when a part of the dialog uses them.
  useEffect(() => {
    if (open && sourceReady && !reposLoaded && (mode === 'github' || remoteGroup)) void loadRepos();
  }, [open, sourceReady, reposLoaded, mode, remoteGroup]);
  async function show() {
    setOpen(true);
    setCreatingProject(false);
    setTarget(groupId || '');
    setSelected('');
    setQuery('');
    setManual('');
    setError('');
    setAuth({ status: 'idle' });
    setRepos([]);
    setReposLoaded(false);
    setSourceReady(false);
    // Start with GitHub only when the GitHub CLI is ready. Otherwise local folders work first.
    const [projects, gh] = await Promise.allSettled([
      Promise.resolve().then(() => api.snapshot()),
      Promise.resolve().then(() => api.githubCliCheck()),
    ]);
    setMode(gh.status === 'fulfilled' && gh.value.status === 'ready' ? 'github' : 'local');
    if (projects.status === 'fulfilled') setSnapshot(projects.value);
    else setError('Could not load your projects. Close this dialog and try again.');
    setSourceReady(true);
  }
  // Work in progress continues after the dialog closes. `perform` reports its result.
  function close() {
    setOpen(false);
    if (auth.status === 'checking' || auth.status === 'waiting') void api.githubAuthCancel();
  }
  useEffect(() => {
    if (!open || !['checking', 'waiting'].includes(auth.status)) return;
    let active = true;
    const timer = setInterval(() => {
      void api
        .githubAuthStatus()
        .then((state) => {
          if (!active) return;
          setAuth(state);
          if (state.status === 'ready') void loadRepos();
        })
        .catch(() => {
          if (active)
            setAuth({ status: 'error', message: 'Authorization interrupted. Try again.' });
        });
    }, interfaceConfig.authPollMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [open, auth.status]);
  async function authorize() {
    setError('');
    setAuth({ status: 'checking' });
    try {
      const state = await api.githubAuthStart(true);
      setAuth(state);
      if (state.status === 'ready') await loadRepos();
    } catch {
      setAuth({
        status: 'error',
        message:
          'Could not start GitHub authorization. Restart Kalkidan to load its latest desktop integration, then retry.',
      });
    }
  }
  async function perform(fn: () => Promise<string | void>) {
    setBusy(true);
    setError('');
    try {
      const done = await fn();
      if (done && !openRef.current) onNotice?.(done);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      if (!openRef.current) onNotice?.(message, true);
    } finally {
      setBusy(false);
    }
  }
  async function add() {
    await perform(async () => {
      if (!target || !snapshot?.groups?.some((g) => g.id === target))
        throw new Error('Choose or create a project first.');
      if (mode === 'local') await api.add(target || undefined);
      else if (mode === 'library') await api.moveRepo(selected, target || null);
      else if (!(await api.cloneRepository(manual.trim() || selected, target || undefined))) return;
      await onRefresh();
      setOpen(false);
      return mode === 'github' ? 'Repository cloned and added to the project.' : undefined;
    });
  }
  const shown = repos.filter((r) => r.nameWithOwner.toLowerCase().includes(query.toLowerCase()));
  return (
    <>
      <Button
        variant={variant}
        size={size}
        disabled={disabled}
        className={className}
        onClick={() => void show()}
      >
        {children || (
          <>
            <Plus /> Add repositories
          </>
        )}
      </Button>
      {/* The dialog hides while the Create project dialog that it opens shows. */}
      <Dialog open={open && !creatingProject} onOpenChange={(value) => !value && close()}>
        <DialogContent size="lg" layout="scroll">
          <DialogHeader>
            <DialogTitle>Add repositories</DialogTitle>
            <DialogDescription>
              Clone from GitHub, choose local folders, or organize repositories already in your
              library.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid content-start gap-4">
            <div className="form-label">
              <div className="flex items-center justify-between gap-2">
                <span>Project</span>
                <Button
                  variant="bare"
                  className="h-auto p-0 text-xs text-link hover:underline"
                  disabled={busy}
                  onClick={() => setCreatingProject(true)}
                >
                  Create a new project
                </Button>
              </div>
              <Choice
                className="w-full"
                label="Add to project"
                value={target}
                disabled={busy}
                onChange={setTarget}
                options={[
                  { value: '', label: 'Choose a project' },
                  ...(snapshot?.groups || []).map((g) => ({ value: g.id, label: g.name })),
                ]}
              />
            </div>
            {remoteGroup ? (
              <RemoteRepositoryPicker
                key={remoteGroup.id}
                api={api}
                group={remoteGroup}
                repos={repos}
                onBusy={setBusy}
                onAdded={async () => {
                  await onRefresh();
                  if (!openRef.current) onNotice?.('Remote repository added to the project.');
                  setOpen(false);
                }}
              />
            ) : (
              sourceReady && (
                <>
                  <div className="form-label">
                    <span id="add-repository-source">Source</span>
                    <RadioList
                      labelledBy="add-repository-source"
                      className="grid-cols-3"
                      value={mode}
                      disabled={busy}
                      onChange={(value) => {
                        setMode(value as Source);
                        setSelected('');
                        setError('');
                      }}
                      options={[
                        { value: 'github', label: 'Clone from GitHub' },
                        { value: 'local', label: 'Local folders' },
                        { value: 'library', label: 'From library' },
                      ]}
                    />
                  </div>
                  {mode === 'github' && (
                    <>
                      <div className="flex gap-2">
                        <SearchInput
                          className="flex-1"
                          aria-label="Search GitHub repositories"
                          placeholder="Search owner or repository…"
                          value={query}
                          disabled={busy}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                        <Hint label="Refresh repositories">
                          <Button
                            variant="outline"
                            size="icon"
                            aria-label="Refresh repositories"
                            disabled={busy || loading}
                            onClick={() => void loadRepos()}
                          >
                            <RefreshCw className={loading ? 'animate-spin' : ''} />
                          </Button>
                        </Hint>
                      </div>
                      <div className="grid gap-2">
                        {loading ? (
                          <div className="list-box min-h-20 content-start" aria-busy="true">
                            <p role="status" className="px-2 py-1.5 text-sm text-muted-foreground">
                              Loading repositories…
                            </p>
                          </div>
                        ) : shown.length ? (
                          <RadioList
                            label="Available repositories"
                            className="min-h-20"
                            value={selected}
                            disabled={busy}
                            onChange={(value) => {
                              setSelected(value);
                              setManual('');
                            }}
                            options={shown.map((repo) => ({
                              value: repo.nameWithOwner,
                              label: repo.nameWithOwner,
                              description: repo.description || undefined,
                              badge: repo.isArchived
                                ? 'Archived'
                                : repo.isPrivate
                                  ? 'Private'
                                  : 'Public',
                            }))}
                          />
                        ) : (
                          <EmptyState
                            compact
                            className="rounded-lg border"
                            title={repos.length ? 'No matching repositories' : 'No repositories'}
                          >
                            Enter owner/repository below, or connect GitHub.
                          </EmptyState>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {repos.length} repositories ·{' '}
                          {repos.filter((repo) => repo.isPrivate).length} private · personal and
                          organization access
                        </p>
                      </div>
                      <div className="grid gap-2">
                        <Input
                          aria-label="GitHub repository name"
                          placeholder="Or enter owner/repository"
                          disabled={busy}
                          value={manual}
                          onChange={(e) => {
                            setManual(e.target.value);
                            setSelected('');
                          }}
                        />
                        <p className="text-xs text-muted-foreground">
                          Is a repository missing?{' '}
                          <Button
                            variant="bare"
                            className="h-auto p-0 text-xs text-link hover:underline"
                            disabled={busy || ['checking', 'waiting'].includes(auth.status)}
                            onClick={() => void authorize()}
                          >
                            {auth.status === 'checking'
                              ? 'Starting GitHub authorization…'
                              : auth.status === 'waiting'
                                ? 'Waiting for GitHub approval…'
                                : auth.status === 'ready'
                                  ? 'Authorize GitHub again'
                                  : 'Connect or authorize GitHub'}
                          </Button>
                        </p>
                      </div>
                      {auth.status === 'checking' && (
                        <p role="status" className="text-sm text-muted-foreground">
                          Checking GitHub CLI and opening browser authorization…
                        </p>
                      )}
                      {auth.status === 'ready' && (
                        <p role="status" className="text-sm">
                          GitHub connected. Your repository list has been refreshed.
                        </p>
                      )}
                      {auth.status === 'waiting' && (
                        <div className="panel space-y-3" aria-live="polite">
                          <p className="text-sm">
                            Approve access in your browser.
                            {auth.code ? ' Enter this code:' : ' Requesting code…'}
                          </p>
                          {auth.code && (
                            <>
                              <Input
                                aria-label="GitHub device code"
                                readOnly
                                value={auth.code}
                                onFocus={(e) => e.target.select()}
                              />
                              <Button
                                variant="outline"
                                onClick={() =>
                                  void api
                                    .githubAuthOpen()
                                    .catch(() =>
                                      setError(
                                        'Could not open your browser. Visit https://github.com/login/device and enter the displayed code.',
                                      ),
                                    )
                                }
                              >
                                Open GitHub
                              </Button>
                            </>
                          )}
                          <p className="text-xs text-muted-foreground">
                            {auth.message || 'This dialog updates automatically after approval.'}
                          </p>
                        </div>
                      )}
                      {auth.status === 'error' && (
                        <p role="alert" className="field-error">
                          {auth.message}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground">
                        Kalkidan clones the repository into the repos folder of the project and adds
                        it to the selected project.
                      </p>
                    </>
                  )}
                  {mode === 'local' && (
                    <p className="text-sm text-muted-foreground">
                      Choose one or more existing folders in {fileManagerName()}. Kalkidan adds them
                      to the selected project.
                    </p>
                  )}
                  {mode === 'library' && (
                    <Choice
                      className="w-full"
                      label="Repository from library"
                      value={selected}
                      disabled={busy}
                      onChange={setSelected}
                      options={[
                        { value: '', label: 'Choose a repository' },
                        ...(snapshot?.projects || [])
                          .filter((p) => !p.hostId)
                          .map((p) => ({ value: p.id, label: p.name + ' · ' + p.path })),
                      ]}
                    />
                  )}
                </>
              )
            )}
            {error && (
              <p role="alert" className="field-error">
                {error}
              </p>
            )}
            {busy && (
              <p role="status" className="text-sm text-muted-foreground">
                {mode === 'github'
                  ? 'Cloning… A large repository can take several minutes. You can close this dialog. The clone continues.'
                  : 'Working…'}
              </p>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={close}>
              {busy ? 'Close' : 'Cancel'}
            </Button>
            <Button
              hidden={!!remoteGroup}
              disabled={
                busy ||
                !target ||
                !snapshot ||
                !sourceReady ||
                (mode !== 'local' && !selected && !(mode === 'github' && manual.trim()))
              }
              onClick={() => void add()}
            >
              {mode === 'github'
                ? 'Clone into project'
                : mode === 'local'
                  ? 'Choose folders'
                  : 'Add to project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <CreateProject
        api={api}
        open={creatingProject}
        onOpenChange={setCreatingProject}
        onCreated={async (group) => {
          setSnapshot(await api.snapshot());
          setTarget(group.id);
          await onRefresh();
        }}
      />
    </>
  );
}

/**
 * A list of options where one is chosen. Arrow keys move the choice, and only the chosen
 * option is in the tab order.
 */
function RadioList({
  label,
  labelledBy,
  value,
  options,
  disabled,
  className,
  onChange,
}: {
  label?: string;
  labelledBy?: string;
  value: string;
  options: { value: string; label: string; description?: string; badge?: string }[];
  disabled?: boolean;
  className?: string;
  onChange: (value: string) => void;
}) {
  const list = useRef<HTMLDivElement>(null);
  const focusable = options.some((o) => o.value === value) ? value : options[0]?.value;
  function move(event: KeyboardEvent, index: number) {
    const last = options.length - 1;
    const next =
      event.key === 'ArrowDown' || event.key === 'ArrowRight'
        ? index === last
          ? 0
          : index + 1
        : event.key === 'ArrowUp' || event.key === 'ArrowLeft'
          ? index === 0
            ? last
            : index - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? last
              : -1;
    if (next < 0) return;
    event.preventDefault();
    onChange(options[next].value);
    list.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
  }
  return (
    <div
      ref={list}
      role="radiogroup"
      aria-label={label}
      aria-labelledby={labelledBy}
      className={cn('list-box content-start', className)}
    >
      {options.map((option, index) => {
        const checked = option.value === value;
        return (
          <button
            type="button"
            role="radio"
            key={option.value}
            aria-checked={checked}
            tabIndex={option.value === focusable ? 0 : -1}
            disabled={disabled}
            title={option.label}
            className={cn(
              'list-box-row text-sm disabled:opacity-50',
              option.description && 'items-start py-1.5',
            )}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => move(event, index)}
          >
            <span
              aria-hidden="true"
              className={cn(
                'flex size-3.5 shrink-0 items-center justify-center rounded-full border',
                option.description && 'mt-[3px]',
                checked && 'border-primary',
              )}
            >
              {checked && <span className="size-1.5 rounded-full bg-primary" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className={cn('block truncate', option.description && 'font-medium')}>
                {option.label}
              </span>
              {option.description && (
                <span className="block text-xs break-words text-muted-foreground">
                  {option.description}
                </span>
              )}
            </span>
            {option.badge && (
              <Badge variant="outline" size="sm" className="shrink-0">
                {option.badge}
              </Badge>
            )}
          </button>
        );
      })}
    </div>
  );
}
