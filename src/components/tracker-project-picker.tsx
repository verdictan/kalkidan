import { useTracker } from '../hooks/use-tracker';
import { useEffect, useImperativeHandle, useRef, useState, type ReactNode, type Ref } from 'react';
import {
  Check,
  ChevronDown,
  ExternalLink,
  Layers2,
  Link2,
  LoaderCircle,
  Plus,
  SquareKanban,
} from 'lucide-react';
import type { API, ProjectGroup, TrackerOwner, TrackerProject } from '../types';
import { trackerAuthPending, trackerConnection, type TrackerAuthState } from '../domain/tracker';
import { interfaceConfig } from '../config/interface';
import { settingsAnchors } from '../domain/settings-route';
import { errorMessage } from '../lib/errors';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Alert, AlertDescription } from './ui/alert';
import { Choice } from './choice';
import { SegmentedControl } from './ui/segmented-control';
import { SearchInput } from './ui/search-input';
import { EmptyState } from './ui/empty-state';
import { showToast } from './ui/toast';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { cn } from '../lib/utils';

/** The name of the board on the tracker side, for example "GitHub Projects board". */
export function boardLabel(providerName: string) {
  return providerName === 'GitHub' ? 'GitHub Projects board' : `${providerName} board`;
}

/** How the picker gets a board: choose an existing one, create one or paste its URL. */
export type BoardPickerMode = 'pick' | 'create' | 'url';
/** Lets the parent create the board from its own footer button. */
export interface BoardPickerActions {
  /** Creates the board with the typed name and returns its URL. */
  create(): Promise<string>;
}

export function TrackerProjectPicker({
  api,
  provider = 'github',
  defaultTitle,
  value,
  onChange,
  onBusy,
  autoFocus = true,
  onModeChange,
  actions,
}: {
  api: API;
  provider?: string;
  defaultTitle: string;
  value: string;
  onChange: (url: string) => void;
  onBusy: (busy: boolean) => void;
  /** Puts the focus in the search field when the picker shows, so the user can type at once. */
  autoFocus?: boolean;
  /**
   * Tells the parent the mode, and if "Create new" can create now. With this prop, the parent
   * owns the create button (through `actions`), so the picker shows no button of its own.
   */
  onModeChange?: (mode: BoardPickerMode, canCreate: boolean) => void;
  actions?: Ref<BoardPickerActions>;
}) {
  const { client, name: providerName, descriptor } = useTracker(api, provider);
  const board = boardLabel(providerName);
  const [mode, setMode] = useState<BoardPickerMode>('pick');
  const [owners, setOwners] = useState<TrackerOwner[]>([]);
  const [ownerId, setOwnerId] = useState('');
  const [projects, setProjects] = useState<TrackerProject[]>([]);
  const [query, setQuery] = useState('');
  const [title, setTitle] = useState(defaultTitle);
  const [titleEdited, setTitleEdited] = useState(false);
  useEffect(() => {
    if (!titleEdited) setTitle(defaultTitle);
  }, [defaultTitle, titleEdited]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);
  const owner = owners.find((o) => o.id === ownerId);
  const select = useRef(onChange);
  select.current = onChange;
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    client
      .owners()
      .then((result) => {
        if (active) {
          setOwners(result);
          setOwnerId((current) =>
            result.some((o) => o.id === current) ? current : result[0]?.id || '',
          );
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, revision]);
  useEffect(() => {
    if (!owner) return;
    let active = true;
    setLoading(true);
    setProjects([]);
    setError('');
    client
      .projects(owner)
      .then((result) => {
        if (active) setProjects(result);
      })
      .catch((e) => {
        if (active) setError(e.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, owner, revision]);
  // When the owner has only one board, select it, so that the user can connect at once.
  useEffect(() => {
    if (mode === 'pick' && !loading && !value && projects.length === 1)
      select.current(projects[0].url);
  }, [mode, loading, projects]);
  const canCreate = !!owner && !loading && !creating && !!title.trim();
  const modeChange = useRef(onModeChange);
  modeChange.current = onModeChange;
  useEffect(() => {
    modeChange.current?.(mode, canCreate);
  }, [mode, canCreate]);
  async function create() {
    if (!owner || creating) throw new Error('Choose an owner for the board.');
    setCreating(true);
    onBusy(true);
    setError('');
    try {
      const project = await client.createProject(owner, title);
      setProjects((current) => [project, ...current]);
      setQuery('');
      onChange(project.url);
      return project;
    } finally {
      setCreating(false);
      onBusy(false);
    }
  }
  useImperativeHandle(actions, () => ({ create: async () => (await create()).url }));
  async function createHere() {
    try {
      const project = await create();
      setMode('pick');
      setNotice(`Created “${project.title}”.`);
    } catch (e) {
      setError(errorMessage(e));
    }
  }
  const matches = projects.filter((p) =>
    `${p.title} ${p.number}`.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <div className="grid content-start gap-4">
      <SegmentedControl
        size="sm"
        className="justify-self-start"
        label="Board connection method"
        value={mode}
        onChange={(next) => {
          setMode(next);
          onChange('');
          setNotice('');
        }}
        options={[
          { value: 'pick' as const, label: 'Choose existing', disabled: creating },
          ...(descriptor?.capabilities.createProject
            ? [{ value: 'create' as const, label: 'Create new', disabled: creating }]
            : []),
          { value: 'url' as const, label: 'Use URL', disabled: creating },
        ]}
      />
      {mode !== 'url' && (
        <div className="form-label">
          <span aria-hidden="true">Owner</span>
          <Choice
            className="w-full"
            label="Owner"
            disabled={loading || creating}
            value={ownerId}
            onChange={(id) => {
              setOwnerId(id);
              onChange('');
              setNotice('');
            }}
            options={owners.map((o) => ({
              value: o.id,
              label: `${o.login}${o.kind === 'user' ? ' (personal)' : ''}`,
            }))}
          />
        </div>
      )}
      {error && (
        <Alert variant="destructive" size="sm">
          <AlertDescription>
            {error}
            <Button
              variant="outline"
              size="sm"
              disabled={creating}
              onClick={() => setRevision((n) => n + 1)}
            >
              Load boards again
            </Button>
          </AlertDescription>
        </Alert>
      )}
      {mode === 'url' ? (
        <label className="form-label">
          Board URL
          <Input
            autoFocus
            aria-label="Board URL"
            placeholder={`https://github.com/orgs/…/projects/1`}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        </label>
      ) : mode === 'create' ? (
        <>
          <label className="form-label">
            Board name
            <Input
              autoFocus
              aria-label="Board name"
              maxLength={256}
              value={title}
              disabled={creating}
              onChange={(e) => {
                setTitleEdited(true);
                setTitle(e.target.value);
              }}
            />
          </label>
          {!onModeChange && (
            <Button
              variant="outline"
              className="justify-self-end"
              disabled={!canCreate}
              onClick={() => void createHere()}
            >
              {creating ? 'Creating…' : `Create ${board}`}
            </Button>
          )}
        </>
      ) : (
        <>
          <SearchInput
            autoFocus={autoFocus}
            aria-label={`Search ${board}s`}
            placeholder={`Search ${board}s…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <div
            className="list-box tracker-picker-list"
            role="group"
            aria-label={`Available ${board}s`}
          >
            {loading ? (
              <p role="status" className="list-box-row m-0 text-muted-foreground">
                Loading boards…
              </p>
            ) : (
              matches.map((project) => (
                <button
                  type="button"
                  key={project.id}
                  aria-pressed={value === project.url}
                  aria-label={
                    project.number ? `${project.title} #${project.number}` : project.title
                  }
                  className="list-box-row"
                  onClick={() => onChange(project.url)}
                >
                  <span className="min-w-0 flex-1 truncate">{project.title}</span>
                  {project.number ? (
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      #{project.number}
                    </span>
                  ) : null}
                  <Check aria-hidden="true" className={cn(value !== project.url && 'invisible')} />
                </button>
              ))
            )}
            {!loading && !error && !matches.length && (
              <EmptyState compact icon={<SquareKanban />}>
                {query ? 'No matching boards.' : 'No open boards yet.'}
              </EmptyState>
            )}
          </div>
        </>
      )}
      {notice && (
        <p role="status" className="form-help m-0">
          {notice}
        </p>
      )}
    </div>
  );
}

/** Asks the tracker for access, and polls while the user approves it in the browser. */
export function useTrackerAuth(api: API, provider: string, active: boolean, start = true) {
  const { client, name: providerName } = useTracker(api, provider);
  const [auth, setAuth] = useState<TrackerAuthState>({ status: start ? 'checking' : 'idle' });
  async function authorize() {
    setAuth({ status: 'checking' });
    try {
      setAuth(await client.authorize());
    } catch (failure) {
      setAuth({
        status: 'error',
        message:
          `Could not check ${providerName} access. ` +
          `${errorMessage(failure).replace(/\.?$/, '.')} Make sure that you are online, then try again.`,
      });
    }
  }
  useEffect(() => {
    if (!active) return;
    // Defer so that a remount in development does not start two checks. Without `start`, only
    // read the access: a sign-in starts when the person asks for it, never when a page opens.
    const timer = setTimeout(() => {
      if (start) void authorize();
      else
        void client.authStatus().then(
          // Signed out is not an error here: the page shows "Connect" instead.
          (value) => setAuth(value.status === 'signed-out' ? { status: 'idle' } : value),
          () => setAuth({ status: 'idle' }),
        );
    }, 0);
    return () => clearTimeout(timer);
  }, [active, client, start]);
  useEffect(() => {
    if (!active || !trackerAuthPending(auth)) return;
    let live = true;
    const timer = setInterval(() => {
      void client.authStatus().then(
        (value) => live && setAuth(value),
        () =>
          live &&
          setAuth({
            status: 'error',
            message: `Lost the connection to ${providerName}. Try again.`,
          }),
      );
    }, interfaceConfig.authPollMs);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [active, auth.status, client]);
  return { auth, authorize, openAuth: () => client.openAuth() };
}

/** The tracker access step of the Connect board dialog. It shows nothing when access is ready. */
function TrackerAccess({
  auth,
  providerName,
  board,
  onRetry,
  onOpenAuth,
  onPreferences,
  onConnect,
}: {
  auth: TrackerAuthState;
  providerName: string;
  board: string;
  onRetry(): void;
  onOpenAuth(): void;
  onPreferences(): void;
  /** Starts the sign-in. Given when access is read, not started, as the page opens. */
  onConnect?(): void;
}) {
  if (auth.status === 'ready') return null;
  if (auth.status === 'idle' && onConnect)
    return (
      <div>
        <Button onClick={onConnect}>Connect {providerName}</Button>
      </div>
    );
  if (['checking', 'verifying', 'idle'].includes(auth.status))
    return (
      <p role="status" className="m-0 text-sm text-muted-foreground">
        Checking {providerName} access…
      </p>
    );
  if (auth.status === 'waiting')
    return (
      <div className="grid gap-3" aria-live="polite">
        <p className="m-0 text-sm">
          {auth.code
            ? `Enter this code on ${providerName} and approve access.`
            : `Requesting a code from ${providerName}…`}
        </p>
        {auth.code && (
          <div className="flex gap-2">
            <Input
              aria-label={`${providerName} device code`}
              readOnly
              value={auth.code}
              className="flex-1 text-center font-mono tracking-widest"
              onFocus={(event) => event.target.select()}
            />
            <Button variant="outline" onClick={onOpenAuth}>
              Open {providerName}
              <ExternalLink aria-hidden="true" />
            </Button>
          </div>
        )}
        <p className="form-help m-0">
          {auth.message || 'Waiting for approval. This updates automatically.'}
        </p>
      </div>
    );
  return (
    <Alert variant="destructive" size="sm">
      <AlertDescription>
        {auth.message || `Sign in to ${providerName} to choose a ${board}.`}
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onRetry}>
            Try again
          </Button>
          <Button variant="ghost" size="sm" onClick={onPreferences}>
            Open Settings…
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

/** True when the text looks like the URL of a board, for example a GitHub Projects URL. */
function boardUrl(text: string) {
  return /^https?:\/\/\S+$/i.test(text.trim());
}

/**
 * Puts the best match first: a board whose name contains the project name, then a board that
 * shares a word with it. The order of the tracker stays for the others.
 */
export function rankBoards(projects: TrackerProject[], projectName: string) {
  const name = projectName.trim().toLowerCase();
  const words = name.split(/[^a-z0-9]+/).filter((word) => word.length > 2);
  const score = (project: TrackerProject) => {
    const title = project.title.toLowerCase();
    if (name && title.includes(name)) return 2;
    return words.some((word) => title.includes(word)) ? 1 : 0;
  };
  return projects
    .map((project, index) => ({ project, index, score: score(project) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.project);
}

/**
 * Connect a board in one list: a search field that also takes a board URL, the owner as a menu
 * button, the boards with the best match first and "New board for <project>" last. A click on
 * a board connects it. The Tasks tab shows this list on the page; the dialog shows the same
 * list.
 */
export function ConnectBoardPanel({
  api,
  group,
  onConnected,
  variant = 'page',
}: {
  api: API;
  group: ProjectGroup;
  /** Called after the project is connected to the board. */
  onConnected?(): void | Promise<void>;
  /** 'page' shows the "Connect a GitHub board" heading. 'dialog' does not. */
  variant?: 'page' | 'dialog';
}) {
  const connection = trackerConnection(group);
  const provider = connection?.provider || 'github';
  const { client, name: providerName, descriptor } = useTracker(api, provider);
  const board = boardLabel(providerName);
  // On the Tasks page the panel only reads the access; the sign-in starts on a click.
  const { auth, authorize, openAuth } = useTrackerAuth(api, provider, true, variant === 'dialog');
  const ready = auth.status === 'ready';
  const [owners, setOwners] = useState<TrackerOwner[]>([]);
  const [ownerId, setOwnerId] = useState('');
  const [projects, setProjects] = useState<TrackerProject[]>([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const owner = owners.find((o) => o.id === ownerId);
  useEffect(() => {
    if (!ready) return;
    let active = true;
    setLoading(true);
    setError('');
    client
      .owners()
      .then((result) => {
        if (!active) return;
        setOwners(result);
        setOwnerId((current) =>
          result.some((o) => o.id === current) ? current : result[0]?.id || '',
        );
        if (!result.length) setLoading(false);
      })
      .catch((e) => {
        if (!active) return;
        setError(errorMessage(e));
        setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, ready, revision]);
  useEffect(() => {
    if (!owner) return;
    let active = true;
    setLoading(true);
    setProjects([]);
    setError('');
    client
      .projects(owner)
      .then((result) => {
        if (active) setProjects(result);
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [client, owner, revision]);
  const text = query.trim();
  const pasted = boardUrl(text);
  const matches = pasted
    ? []
    : rankBoards(projects, group.name).filter((p) =>
        `${p.title} ${p.number ?? ''}`.toLowerCase().includes(text.toLowerCase()),
      );
  async function connect(key: string, target: () => Promise<string>) {
    if (busy) return;
    setBusy(key);
    setError('');
    try {
      const url = await target();
      if (url === connection?.project.url) return;
      await client.link(group.id, url);
      showToast(connection ? 'The project now uses the new board.' : 'Board connected.');
      await onConnected?.();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy('');
    }
  }
  const canCreate = !!owner && !!descriptor?.capabilities.createProject;
  const name = (project: TrackerProject) =>
    project.number ? `${project.title} #${project.number}` : project.title;
  return (
    <section
      className="connect-board"
      data-variant={variant}
      aria-labelledby={variant === 'page' ? 'connect-board-title' : undefined}
      aria-label={variant === 'page' ? undefined : `Available ${board}s`}
      aria-busy={!!busy || undefined}
    >
      {variant === 'page' && (
        <h2 id="connect-board-title" className="connect-board-title">
          Connect a {providerName} board
        </h2>
      )}
      <TrackerAccess
        auth={auth}
        providerName={providerName}
        board={board}
        onRetry={() => void authorize()}
        onConnect={variant === 'page' ? () => void authorize() : undefined}
        onOpenAuth={() => void openAuth()}
        onPreferences={() =>
          window.dispatchEvent(
            new CustomEvent('kalkidan-open-settings', {
              detail: { section: 'account', anchor: settingsAnchors.github },
            }),
          )
        }
      />
      {ready && (
        <>
          <div className="connect-board-search">
            <SearchInput
              autoFocus={variant === 'dialog'}
              className="min-w-0 flex-1"
              aria-label={`Search ${board}s or paste a URL`}
              placeholder="Search or paste a URL"
              value={query}
              disabled={!!busy}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && pasted && !event.nativeEvent.isComposing) {
                  event.preventDefault();
                  void connect('url', async () => text);
                }
              }}
            />
            {owners.length > 0 && (
              // The owner shows also when it is the only one: the rows do not repeat it.
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    className="connect-board-owner"
                    disabled={!!busy}
                    aria-label={`Owner: ${owner?.login || ''}`}
                  >
                    <span className="max-w-40 truncate">{owner?.login}</span>
                    <ChevronDown aria-hidden="true" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuRadioGroup value={ownerId} onValueChange={setOwnerId}>
                    {owners.map((o) => (
                      <DropdownMenuRadioItem key={o.id} value={o.id}>
                        <span className="truncate">{o.login}</span>
                      </DropdownMenuRadioItem>
                    ))}
                  </DropdownMenuRadioGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          {error && (
            <Alert variant="destructive" size="sm">
              <AlertDescription>
                {error}
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!!busy}
                  onClick={() => setRevision((n) => n + 1)}
                >
                  Try again
                </Button>
              </AlertDescription>
            </Alert>
          )}
          <ul className="connect-board-list" aria-label={`Available ${board}s`}>
            {pasted ? (
              <li>
                <ConnectRow
                  first
                  icon={<Link2 aria-hidden="true" />}
                  title="Board at this URL"
                  meta={text}
                  label={`Connect the board at ${text}`}
                  busy={busy === 'url'}
                  disabled={!!busy}
                  onConnect={() => void connect('url', async () => text)}
                />
              </li>
            ) : loading ? (
              <li className="connect-board-note" role="status">
                Loading boards…
              </li>
            ) : (
              matches.map((project, index) => (
                <li key={project.id}>
                  <ConnectRow
                    first={index === 0}
                    icon={<Layers2 aria-hidden="true" />}
                    title={project.title}
                    meta={project.number ? `#${project.number}` : undefined}
                    label={`Connect ${name(project)}`}
                    current={project.url === connection?.project.url}
                    busy={busy === project.id}
                    disabled={!!busy}
                    onConnect={() => void connect(project.id, async () => project.url)}
                  />
                </li>
              ))
            )}
            {!pasted && !loading && !error && !matches.length && (
              <li className="connect-board-note">
                {text ? 'No matching boards.' : `${owner?.login || 'This owner'} has no boards.`}
              </li>
            )}
            {!pasted && canCreate && !loading && (
              <li>
                <button
                  type="button"
                  className="connect-board-new"
                  disabled={!!busy}
                  onClick={() =>
                    void connect(
                      'new',
                      async () => (await client.createProject(owner!, group.name)).url,
                    )
                  }
                >
                  {busy === 'new' ? (
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Plus aria-hidden="true" />
                  )}
                  {busy === 'new' ? 'Creating the board…' : `New board for ${group.name}`}
                </button>
              </li>
            )}
          </ul>
        </>
      )}
    </section>
  );
}

/** One board in the connect list. The whole row is the Connect button. */
function ConnectRow({
  icon,
  title,
  meta,
  label,
  first,
  current,
  busy,
  disabled,
  onConnect,
}: {
  icon: ReactNode;
  title: string;
  meta?: string;
  label: string;
  /** The best match. Its Connect shows without hover. */
  first?: boolean;
  /** The board that the project uses now. */
  current?: boolean;
  busy: boolean;
  disabled: boolean;
  onConnect(): void;
}) {
  return (
    <button
      type="button"
      className="connect-board-row"
      data-first={first || undefined}
      data-busy={busy || undefined}
      aria-label={current ? `${title}. Connected` : label}
      disabled={disabled || current}
      onClick={onConnect}
    >
      {icon}
      <span className="connect-board-name">
        <span className="truncate">{title}</span>
        {meta && <small className="truncate">{meta}</small>}
      </span>
      {current ? (
        <span className="connect-board-state">
          <Check aria-hidden="true" />
          Connected
        </span>
      ) : (
        <span className="connect-board-action" aria-hidden="true">
          {busy ? 'Connecting…' : 'Connect'}
        </span>
      )}
    </button>
  );
}

/**
 * The one Connect board dialog, for pages other than Tasks (Knowledge, Project settings, ⌘K).
 * It shows the same list as the Tasks page. A click on a board connects it and closes the
 * dialog, so there is no footer.
 */
export function ConnectBoardDialog({
  api,
  group,
  open,
  onOpenChange,
  onConnected,
}: {
  api: API;
  group: ProjectGroup;
  open: boolean;
  onOpenChange(open: boolean): void;
  /** Called after the project is connected to the board, before the dialog closes. */
  onConnected?(): void | Promise<void>;
}) {
  const connection = trackerConnection(group);
  const { name: providerName } = useTracker(api, connection?.provider || 'github');
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" layout="scroll">
        <DialogHeader>
          <DialogTitle>{connection ? 'Change board' : 'Connect board'}</DialogTitle>
          <DialogDescription className="sr-only">
            Choose a {boardLabel(providerName)} or paste its URL.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid min-h-60 content-start">
          {open && (
            <ConnectBoardPanel
              api={api}
              group={group}
              variant="dialog"
              onConnected={async () => {
                await onConnected?.();
                onOpenChange(false);
              }}
            />
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

/** The window event that opens the Connect board dialog. ConnectBoardHost listens for it. */
export const connectBoardEvent = 'kalkidan-connect-board';

export interface ConnectBoardRequest {
  /** The project to connect. */
  groupId: string;
  /** Called after the board is connected and the app has reloaded the project. */
  onConnected?(): void;
}

/**
 * Opens the one Connect board dialog for a project, from any page. Use `onConnected` to
 * continue the action that needed the board, for example Make tasks.
 */
export function openConnectBoard(request: ConnectBoardRequest) {
  window.dispatchEvent(
    new CustomEvent<ConnectBoardRequest>(connectBoardEvent, { detail: request }),
  );
}

/** Mount this one time. It shows the Connect board dialog for `openConnectBoard`. */
export function ConnectBoardHost({
  api,
  groups,
  onChanged,
}: {
  api?: API;
  groups: ProjectGroup[];
  /** Reloads the app data after a project connects to a board. */
  onChanged?(groupId: string): void | Promise<void>;
}) {
  const [request, setRequest] = useState<ConnectBoardRequest | null>(null);
  useEffect(() => {
    const onOpen = (event: Event) => {
      const detail = (event as CustomEvent<ConnectBoardRequest>).detail;
      if (detail?.groupId) setRequest(detail);
    };
    window.addEventListener(connectBoardEvent, onOpen);
    return () => window.removeEventListener(connectBoardEvent, onOpen);
  }, []);
  const group = request && groups.find((item) => item.id === request.groupId);
  if (!api || !request || !group) return null;
  return (
    <ConnectBoardDialog
      key={group.id}
      api={api}
      group={group}
      open
      onOpenChange={(open) => !open && setRequest(null)}
      onConnected={async () => {
        await onChanged?.(group.id);
        window.dispatchEvent(
          new CustomEvent('kalkidan-github-writes', { detail: { groupId: group.id } }),
        );
        request.onConnected?.();
      }}
    />
  );
}
