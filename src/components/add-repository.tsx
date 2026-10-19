import { interfaceConfig } from '../config/interface';
import { RemoteRepositoryPicker } from './remote-repository-picker';
import { CreateProject } from './create-project';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import type { API, GitHubAuthState, GitHubRepository, Snapshot } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Choice } from './choice';
import { SegmentedControl } from './ui/segmented-control';
import { cn } from '../lib/utils';
import { fileManagerName } from '../lib/platform';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';

export function AddRepository({
  api,
  groupId,
  onRefresh,
  children,
  disabled,
  className,
  variant = 'ghost',
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
}) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('github');
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
    setError('');
    try {
      setRepos(await api.githubRepositories());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }
  async function show() {
    setOpen(true);
    setCreatingProject(false);
    setTarget(groupId || '');
    setSelected('');
    setQuery('');
    setManual('');
    setError('');
    setAuth({ status: 'idle' });
    try {
      setSnapshot(await api.snapshot());
    } catch {
      setError('Could not load your projects. Close this dialog and try again.');
    }
    void loadRepos();
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
  return (
    <>
      <Button
        variant={variant}
        disabled={disabled}
        className={className}
        onClick={() => void show()}
      >
        {children || (
          <>
            <Plus size={14} /> Add repositories
          </>
        )}
      </Button>
      <Dialog open={open} onOpenChange={(value) => !value && close()}>
        <DialogContent size="lg" className="flex flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 px-6 pt-6 pb-4">
            <DialogTitle>Add repositories</DialogTitle>
            <DialogDescription>
              Clone from GitHub, choose local folders, or organize repositories already in your
              library.
            </DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 gap-4 overflow-y-auto px-6 pb-6">
            <div className="form-label">
              <div className="flex items-center justify-between gap-2">
                <span>Project</span>
                <Button
                  variant="link"
                  className="h-auto p-0 text-xs"
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
              <>
                <div className="form-label">
                  <span>Source</span>
                  <SegmentedControl
                    className="justify-self-start"
                    label="Repository source"
                    value={mode}
                    onChange={(value) => {
                      setMode(value);
                      setSelected('');
                      setError('');
                    }}
                    options={[
                      { value: 'github', label: 'Clone from GitHub', disabled: busy },
                      { value: 'local', label: 'Local folders', disabled: busy },
                      { value: 'library', label: 'From library', disabled: busy },
                    ]}
                  />
                </div>
                {mode === 'github' && (
                  <>
                    <div className="flex gap-2">
                      <Input
                        aria-label="Search GitHub repositories"
                        placeholder="Search owner or repository…"
                        value={query}
                        disabled={busy}
                        onChange={(e) => setQuery(e.target.value)}
                      />
                      <Button
                        variant="outline"
                        size="icon"
                        aria-label="Refresh repositories"
                        disabled={busy || loading}
                        onClick={() => void loadRepos()}
                      >
                        <RefreshCw size={14} />
                      </Button>
                    </div>
                    <div
                      role="group"
                      className="list-box min-h-20 content-start"
                      aria-label="Available repositories"
                    >
                      {loading ? (
                        <p className="px-2 py-1.5 text-sm text-muted-foreground">
                          Loading repositories…
                        </p>
                      ) : (
                        repos
                          .filter((r) =>
                            r.nameWithOwner.toLowerCase().includes(query.toLowerCase()),
                          )
                          .map((repo) => {
                            const active = selected === repo.nameWithOwner;
                            return (
                              <button
                                type="button"
                                key={repo.nameWithOwner}
                                disabled={busy}
                                aria-pressed={active}
                                className={cn(
                                  'row-hover flex w-full items-start gap-3 rounded-md px-2 py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
                                  active && 'row-selected',
                                )}
                                onClick={() => {
                                  setSelected(repo.nameWithOwner);
                                  setManual('');
                                }}
                              >
                                <span
                                  aria-hidden="true"
                                  className={cn(
                                    'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
                                    active && 'border-primary',
                                  )}
                                >
                                  {active && <span className="size-2 rounded-full bg-primary" />}
                                </span>
                                <span className="min-w-0 flex-1">
                                  <span className="block text-sm font-medium break-all">
                                    {repo.nameWithOwner}
                                  </span>
                                  {repo.description && (
                                    <span className="block text-xs break-words text-muted-foreground">
                                      {repo.description}
                                    </span>
                                  )}
                                </span>
                                <Badge variant="outline" size="sm" className="shrink-0">
                                  {repo.isArchived
                                    ? 'Archived'
                                    : repo.isPrivate
                                      ? 'Private'
                                      : 'Public'}
                                </Badge>
                              </button>
                            );
                          })
                      )}
                      {!loading &&
                        !repos.some((r) =>
                          r.nameWithOwner.toLowerCase().includes(query.toLowerCase()),
                        ) && (
                          <p className="px-2 py-1.5 text-sm text-muted-foreground">
                            No matching repositories. Enter owner/repository below, or connect
                            GitHub.
                          </p>
                        )}
                    </div>
                    <p className="-mt-3 text-xs text-muted-foreground">
                      {repos.length} repositories · {repos.filter((repo) => repo.isPrivate).length}{' '}
                      private · personal and organization access
                    </p>
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
                    <p className="-mt-3 text-xs text-muted-foreground">
                      Is a repository missing?{' '}
                      <Button
                        variant="link"
                        className="h-auto p-0 text-xs"
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
                      <p role="alert" className="text-sm text-destructive">
                        {auth.message}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      Kalkidan will clone the repository into the project’s repos folder and add it
                      to the selected project.
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
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
            {busy && (
              <p role="status" className="text-sm text-muted-foreground">
                {mode === 'github'
                  ? 'Cloning… A large repository can take several minutes. You can close this window. The clone continues.'
                  : 'Working…'}
              </p>
            )}
          </div>
          <DialogFooter className="shrink-0 border-t px-6 py-4">
            <Button variant="outline" onClick={close}>
              {busy ? 'Close' : 'Cancel'}
            </Button>
            <Button
              hidden={!!remoteGroup}
              disabled={
                busy ||
                !target ||
                !snapshot ||
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
