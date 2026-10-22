import { useTracker } from '../hooks/use-tracker';
import { useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { Check, ExternalLink, SquareKanban } from 'lucide-react';
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
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
export function useTrackerAuth(api: API, provider: string, active: boolean) {
  const { client, name: providerName } = useTracker(api, provider);
  const [auth, setAuth] = useState<TrackerAuthState>({ status: 'idle' });
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
    // Defer so that a remount in development does not start two checks.
    const timer = setTimeout(() => void authorize(), 0);
    return () => clearTimeout(timer);
  }, [active, client]);
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
}: {
  auth: TrackerAuthState;
  providerName: string;
  board: string;
  onRetry(): void;
  onOpenAuth(): void;
  onPreferences(): void;
}) {
  if (auth.status === 'ready') return null;
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
            Open Preferences…
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}

/**
 * The one Connect board dialog. Tasks, Knowledge (Make tasks), Insights and Project settings ›
 * Board all use it. It checks the tracker access, then the user chooses, creates or pastes a
 * board. The footer has one primary: "Connect board", or "Create and connect" for a new board.
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
  const provider = connection?.provider || 'github';
  const { client, name: providerName } = useTracker(api, provider);
  const board = boardLabel(providerName);
  const { auth, authorize, openAuth } = useTrackerAuth(api, provider, open);
  const [url, setUrl] = useState('');
  const [mode, setMode] = useState<BoardPickerMode>('pick');
  const [canCreate, setCanCreate] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const picker = useRef<BoardPickerActions>(null);
  useEffect(() => {
    if (!open) return;
    setUrl('');
    setError('');
    setMode('pick');
  }, [open]);
  const creating = mode === 'create';
  const ready =
    auth.status === 'ready' &&
    !busy &&
    !pickerBusy &&
    (creating ? canCreate : !!url.trim() && url !== connection?.project.url);
  async function connect() {
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      const target = creating ? await picker.current!.create() : url.trim();
      await client.link(group.id, target);
      showToast(connection ? 'The project now uses the new board.' : 'Board connected.');
      await onConnected?.();
      onOpenChange(false);
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent size="md" layout="scroll">
        <DialogHeader>
          <DialogTitle>{connection ? 'Change board' : 'Connect board'}</DialogTitle>
          <DialogDescription className="sr-only">
            Choose a {board}, create one or paste its URL.
          </DialogDescription>
        </DialogHeader>
        {/* A fixed minimum height, so the dialog does not move between the three tabs. */}
        <DialogBody className="grid min-h-60 content-start gap-4">
          <TrackerAccess
            auth={auth}
            providerName={providerName}
            board={board}
            onRetry={() => void authorize()}
            onOpenAuth={() => void openAuth()}
            onPreferences={() => {
              onOpenChange(false);
              window.dispatchEvent(
                new CustomEvent('kalkidan-open-settings', {
                  detail: { section: 'general', anchor: settingsAnchors.github },
                }),
              );
            }}
          />
          {auth.status === 'ready' && (
            <TrackerProjectPicker
              api={api}
              provider={provider}
              defaultTitle={group.name}
              value={url}
              onChange={setUrl}
              onBusy={setPickerBusy}
              actions={picker}
              onModeChange={(next, create) => {
                setMode(next);
                setCanCreate(create);
              }}
            />
          )}
          {error && (
            <p role="alert" className="field-error m-0">
              {error}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!ready} onClick={() => void connect()}>
            {busy && creating
              ? 'Creating…'
              : busy
                ? 'Connecting…'
                : creating
                  ? 'Create and connect'
                  : 'Connect board'}
          </Button>
        </DialogFooter>
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
