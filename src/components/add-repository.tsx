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
import type { API, GitHubRepository, ProjectGroup, Snapshot } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { SearchInput } from './ui/search-input';
import { Badge } from './ui/badge';
import { EmptyState } from './ui/empty-state';
import { SegmentedControl } from './ui/segmented-control';
import { Choice } from './choice';
import { Hint } from './hint';
import { showToast } from './ui/toast';
import { cn } from '../lib/utils';
import { openAccountSettings } from './github-account';
import { codeFolders, useFolderImport } from './repository-import';
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
  onProjectCreated = openCreatedProject,
  trigger = true,
  openRequest = 0,
}: {
  /** False hides the button. The caller then opens the dialog with `openRequest`. */
  trigger?: boolean;
  /** Each new value above 0 opens the dialog. */
  openRequest?: number;
  /** Reports the result of work that continues after the dialog closes. */
  onNotice?: (message: string, error?: boolean) => void;
  /**
   * Shows a project that the user created from this dialog. The dialog closes first. By default,
   * the app opens the project page.
   */
  onProjectCreated?: (group: ProjectGroup) => void;
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
  const folderImport = useFolderImport(api, `${open}:${target}:${mode}`);
  const remoteGroup = snapshot?.groups?.find((g) => g.id === target && g.hostId);
  /** Finished adds give a toast. A caller with onNotice shows its own. */
  function report(message: string, failed = false) {
    if (onNotice) onNotice(message, failed);
    else showToast(failed ? { message, tone: 'error' } : message);
  }
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
  }
  async function perform(fn: () => Promise<string | void>) {
    setBusy(true);
    setError('');
    try {
      const done = await fn();
      if (done) report(done);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      if (!openRef.current) report(message, true);
    } finally {
      setBusy(false);
    }
  }
  const projectName = snapshot?.groups?.find((g) => g.id === target)?.name || 'the project';
  async function add() {
    await perform(async () => {
      if (!target || !snapshot?.groups?.some((g) => g.id === target))
        throw new Error('Choose or create a project first.');
      if (mode === 'local') {
        // Older desktop builds have only the native multi-select dialog.
        if (!folderImport.supported) {
          // This dialog does not say if the user canceled it, so it gives no toast.
          await api.add(target);
          await onRefresh();
          setOpen(false);
          return;
        } else {
          const result = await folderImport.choose('Choose a code folder', 'Choose');
          if (!result) return;
          const { added } = await api.addRepositories(target, result.paths);
          await onRefresh();
          setOpen(false);
          return `Added ${codeFolders(added)} to ${projectName}.`;
        }
      } else if (mode === 'library') {
        const name = snapshot.projects.find((p) => p.id === selected)?.name || 'The code folder';
        await api.moveRepo(selected, target);
        await onRefresh();
        setOpen(false);
        return `Moved ${name} to ${projectName}.`;
      } else return clone(manual.trim() || selected);
    });
  }
  /** Clones in the background. The sidebar shows the progress after the dialog closes. */
  async function clone(name: string) {
    const id = `clone-${Date.now()}`;
    const short =
      name
        .replace(/\.git$/, '')
        .split('/')
        .pop() || name;
    const progress = (state: 'start' | 'done' | 'error', message?: string) =>
      window.dispatchEvent(
        new CustomEvent('kalkidan-clone-progress', {
          detail: { id, name: short, groupId: target, state, message },
        }),
      );
    progress('start');
    try {
      const done = await api.cloneRepository(name, target);
      progress(done ? 'done' : 'error', done ? undefined : 'Clone stopped.');
      if (!done) return;
    } catch (e) {
      progress('error', e instanceof Error ? e.message : String(e));
      throw e;
    }
    await onRefresh();
    setOpen(false);
    return `Cloned ${short} into ${projectName}.`;
  }
  useEffect(() => {
    if (openRequest > 0) void show();
  }, [openRequest]);
  const shown = repos.filter((r) => r.nameWithOwner.toLowerCase().includes(query.toLowerCase()));
  return (
    <>
      {trigger && (
        <Button
          variant={variant}
          size={size}
          disabled={disabled}
          className={className}
          onClick={() => void show()}
        >
          {children || (
            <>
              <Plus /> Add code folder
            </>
          )}
        </Button>
      )}
      {/* The dialog hides while the Create project dialog that it opens shows. */}
      <Dialog open={open && !creatingProject} onOpenChange={(value) => !value && close()}>
        <DialogContent size="lg" layout="scroll">
          <DialogHeader>
            <DialogTitle>Add code folders</DialogTitle>
            <DialogDescription>
              A code folder is a Git repository that agents can work in.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid content-start gap-4">
            <div className="form-label">
              <div className="flex items-center justify-between gap-2">
                <span>Project</span>
                <Button
                  variant="bare"
                  className="text-xs text-link hover:underline"
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
                  report(`Added a code folder to ${projectName}.`);
                  setOpen(false);
                }}
              />
            ) : (
              sourceReady && (
                <>
                  <div className="form-label">
                    <span>Source</span>
                    <SegmentedControl
                      className="justify-self-start"
                      label="Source"
                      value={mode}
                      onChange={(value) => {
                        setMode(value);
                        setSelected('');
                        setError('');
                      }}
                      options={[
                        { value: 'github', label: 'Clone from GitHub', disabled: busy },
                        { value: 'local', label: 'Local folder', disabled: busy },
                        { value: 'library', label: 'Already in Kalkidan', disabled: busy },
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
                                  : undefined,
                            }))}
                          />
                        ) : (
                          <EmptyState
                            compact
                            className="rounded-lg border"
                            title={repos.length ? 'No matching repositories' : 'No repositories'}
                          >
                            Enter owner/repository below, or sign in to GitHub in Settings.
                          </EmptyState>
                        )}
                        <p className="text-xs text-muted-foreground">
                          {repos.length} repositories ·{' '}
                          {repos.filter((repo) => repo.isPrivate).length} private
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
                            className="text-xs text-link hover:underline"
                            onClick={openAccountSettings}
                          >
                            Check your GitHub account in Settings
                          </Button>
                        </p>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Kalkidan clones the repository into the project folder and adds it to the
                        project.
                      </p>
                    </>
                  )}
                  {mode === 'local' && (
                    <p className="text-sm text-muted-foreground">
                      Choose a folder on this computer. If it holds more than one Git repository,
                      Kalkidan finds each one and asks which to add.
                    </p>
                  )}
                  {mode === 'library' && (
                    <label className="form-label">
                      Code folder
                      <span className="form-help">
                        Move a folder you added before into this project.
                      </span>
                      <Choice
                        className="w-full"
                        label="Code folder already in Kalkidan"
                        value={selected}
                        disabled={busy}
                        onChange={setSelected}
                        options={[
                          { value: '', label: 'Choose a code folder' },
                          ...(snapshot?.projects || [])
                            .filter((p) => !p.hostId)
                            .map((p) => ({ value: p.id, label: p.name + ' · ' + p.path })),
                        ]}
                      />
                    </label>
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
                  ? 'Cloning… A large repository can take some minutes. You can close this dialog. The sidebar shows the progress.'
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
                  ? 'Choose folder'
                  : 'Move to project'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {folderImport.dialog}
      <CreateProject
        api={api}
        open={creatingProject}
        onOpenChange={setCreatingProject}
        onCreated={async (group) => {
          // Creating a project ends this flow. The dialog does not open again for the new
          // project, and it does not change the project that the user chose before.
          await onRefresh();
          setOpen(false);
          onProjectCreated(group);
        }}
      />
    </>
  );
}

/** Opens the page of a new project. The app shell changes the route. */
function openCreatedProject(group: ProjectGroup) {
  window.dispatchEvent(
    new CustomEvent('kalkidan-open-project-page', { detail: { groupId: group.id, page: 'board' } }),
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
