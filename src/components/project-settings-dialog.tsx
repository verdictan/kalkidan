import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ExternalLink, FolderGit2, Settings2, SquareKanban } from 'lucide-react';
import type { API, Project, ProjectGroup, RemoteHost } from '../types';
import { trackerAuthPending, trackerConnection, type TrackerAuthState } from '../domain/tracker';
import { useTracker } from '../hooks/use-tracker';
import { useProjectBoard } from '../hooks/use-project-board';
import { interfaceConfig } from '../config/interface';
import { settingsAnchors } from '../domain/settings-route';
import { errorMessage } from '../lib/errors';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Alert, AlertDescription } from './ui/alert';
import { showToast } from './ui/toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { holdDialogFocus } from './dialog-parts';
import { TrackerProjectPicker, boardLabel } from './tracker-project-picker';
import { TrackerWorkflowForm } from './tracker-workflow';
import { RoadmapDateButton, useRoadmapDateFields } from './github-project-resources';
import {
  ProjectCodeFolders,
  ProjectGeneral,
  SettingsDialogFrame,
  SettingsRow,
  SettingsRows,
  type SettingsSection,
} from './project-settings-sections';

export type ProjectSettingsSection = 'general' | 'folders' | 'board';
/**
 * The section names that callers can send. 'danger' opens General, where the removal is. The
 * old Board settings names ('automation', 'fields', 'views', 'updates', 'workflows', 'github')
 * open Board. 'roadmap-dates' opens Board with the row that adds the roadmap date fields.
 */
export type ProjectSettingsTab =
  | ProjectSettingsSection
  | 'automation'
  | 'fields'
  | 'views'
  | 'updates'
  | 'workflows'
  | 'github'
  | 'roadmap-dates'
  | 'danger';

const boardTabs: ProjectSettingsTab[] = [
  'board',
  'automation',
  'fields',
  'views',
  'updates',
  'workflows',
  'github',
  'roadmap-dates',
];

/** The pages of a GitHub project that the Board section links to. */
const githubPages = [
  { label: 'Fields', path: '/settings' },
  { label: 'Views', path: '' },
  { label: 'Workflows', path: '/workflows' },
  { label: 'Status updates', path: '' },
];

/**
 * The settings of a Kalkidan project: its name and color, its code folders, and its board with
 * the automatic status changes. Selects, switches and colors save at once with Undo. Text saves
 * when you press Enter or leave the field. The settings of the GitHub project itself open on
 * GitHub. Open it with the `kalkidan-open-project-settings` event.
 */
export function ProjectSettingsDialog({
  api,
  group,
  repos = [],
  host,
  open,
  onOpenChange,
  section,
  tab,
  focusName = false,
  onConnected,
  onDisconnected,
  onChanged,
  onSaved,
  onAddFolder,
  onRemoveFolder,
  onRemoveProject,
}: {
  api: API;
  group: ProjectGroup;
  /** All code folders. The Code folders section shows the code folders of this project. */
  repos?: Project[];
  /** The SSH host of the project, if it has one. The nav shows its name. */
  host?: RemoteHost;
  open: boolean;
  onOpenChange(open: boolean): void;
  /** The section that shows first. */
  section?: ProjectSettingsTab;
  /** The old name of `section`. */
  tab?: ProjectSettingsTab;
  /** Moves the focus to the project name, for "Rename…". */
  focusName?: boolean;
  /** Called after the project connects to a board. */
  onConnected?(): void | Promise<void>;
  /** Called after the project disconnects from its board. Without it, onConnected is called. */
  onDisconnected?(): void | Promise<void>;
  /** Called after each board write, so that the page can load the board again. */
  onChanged?(): void;
  /** Called after the name or the color changes. */
  onSaved?(): void | Promise<void>;
  /** Opens the Add code folders dialog. Without it, the Code folders section does not show. */
  onAddFolder?(): void;
  /** Starts the removal of a code folder. It asks for a confirmation. */
  onRemoveFolder?(repo: Project): void;
  /** Starts the removal of the project. Without it, the Remove project row does not show. */
  onRemoveProject?(): void;
}) {
  // The old `tab` can be more exact than `section`, for example 'roadmap-dates' with 'board'.
  const requested = (tab && boardTabs.includes(tab) ? tab : section || tab) || 'general';
  const sections: SettingsSection<ProjectSettingsSection>[] = [
    { value: 'general', label: 'General', icon: <Settings2 /> },
    ...(onAddFolder && onRemoveFolder
      ? [{ value: 'folders' as const, label: 'Code folders', icon: <FolderGit2 /> }]
      : []),
    { value: 'board', label: 'Board', icon: <SquareKanban /> },
  ];
  const sectionOf = (value: ProjectSettingsTab): ProjectSettingsSection =>
    boardTabs.includes(value)
      ? 'board'
      : sections.some((item) => item.value === value)
        ? (value as ProjectSettingsSection)
        : 'general';
  const [active, setActive] = useState<ProjectSettingsSection>(sectionOf(requested));
  useEffect(() => {
    if (open) setActive(sectionOf(requested));
  }, [open, requested]);
  const close = () => onOpenChange(false);
  const connection = trackerConnection(group);
  const panels: Partial<Record<ProjectSettingsSection, ReactNode>> = {
    general: (
      <ProjectGeneral
        key={group.id}
        api={api}
        group={group}
        onSaved={async () => {
          await onSaved?.();
        }}
        onRemove={
          onRemoveProject &&
          (() => {
            close();
            onRemoveProject();
          })
        }
      />
    ),
    folders: onAddFolder && onRemoveFolder && (
      <ProjectCodeFolders
        group={group}
        repos={repos}
        onAdd={() => {
          close();
          onAddFolder();
        }}
        onRemove={(repo) => {
          close();
          onRemoveFolder(repo);
        }}
      />
    ),
    board: (
      <BoardSection
        api={api}
        group={group}
        open={open}
        roadmapDates={open && requested === 'roadmap-dates'}
        onChanged={() => onChanged?.()}
        onConnected={async () => {
          onChanged?.();
          await onConnected?.();
        }}
        onDisconnected={async () => {
          close();
          onChanged?.();
          await (onDisconnected || onConnected)?.();
        }}
      />
    ),
  };
  // A project on an SSH host shows the host below its name. A local project shows nothing.
  const remote = group.hostId ? host?.name || host?.target || 'SSH host' : '';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <SettingsDialogFrame
        title={
          <>
            <span className="sr-only">Project settings: </span>
            {group.name}
          </>
        }
        subtitle={remote || undefined}
        description={
          connection ? `${group.name} · ${connection.project.title}` : `${group.name} · No board`
        }
        sections={sections}
        value={active}
        onValueChange={setActive}
        panels={panels}
        onOpenAutoFocus={(event) => {
          const name = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLInputElement>(
            '#project-general-form input',
          );
          if (!focusName || !name) return holdDialogFocus(event);
          // "Rename…" opens the dialog with the project name selected.
          event.preventDefault();
          name.select();
        }}
      />
    </Dialog>
  );
}

/**
 * Project settings › Board: the connected board with Open on GitHub and Change…, the automatic
 * status changes, links to the GitHub side of the board, and Disconnect board…. The picker shows
 * only when there is no board, or after Change….
 */
function BoardSection({
  api,
  group,
  open,
  roadmapDates,
  onChanged,
  onConnected,
  onDisconnected,
}: {
  api: API;
  group: ProjectGroup;
  open: boolean;
  /** Shows the row that adds the "Start date" and "End date" fields for the roadmap. */
  roadmapDates: boolean;
  onChanged(): void;
  onConnected(): Promise<void>;
  onDisconnected(): Promise<void>;
}) {
  const connection = trackerConnection(group);
  const provider = connection?.provider || 'github';
  const { client, descriptor, name: providerName } = useTracker(api, provider);
  const { state: boardState, refresh } = useProjectBoard(
    api,
    client,
    provider,
    group.id,
    open ? connection?.project : undefined,
  );
  const board = boardState.value ?? null;
  const github = connection?.provider === 'github';
  const automation =
    !!connection &&
    descriptor?.capabilities.updateStatus !== false &&
    typeof api.trackerConfigure === 'function';
  const [picking, setPicking] = useState(!connection);
  useEffect(() => {
    if (!connection) setPicking(true);
  }, [connection]);
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const [error, setError] = useState('');
  const changed = () => {
    void refresh().catch(() => undefined);
    onChanged();
  };
  async function disconnect() {
    if (unlinking) return;
    setUnlinking(true);
    setError('');
    try {
      await api.trackerUnlink(group.id);
      setConfirmUnlink(false);
      showToast('Board disconnected.');
      await onDisconnected();
    } catch (failure) {
      setConfirmUnlink(false);
      setError(errorMessage(failure));
    } finally {
      setUnlinking(false);
    }
  }
  const title = connection
    ? `${connection.project.title}${connection.project.number ? ` #${connection.project.number}` : ''}`
    : '';
  const url = connection?.project.url.replace(/\/+$/, '');
  return (
    <div className="flex flex-1 flex-col gap-6">
      {error && (
        <Alert variant="destructive" size="sm">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {connection && !picking && (
        <>
          <SettingsRows label="Connected board">
            <SettingsRow
              icon={<SquareKanban />}
              label={title}
              help={[connection.project.owner, boardLabel(providerName)]
                .filter(Boolean)
                .join(' · ')}
            >
              {url && (
                <Button variant="ghost" size="sm" asChild>
                  <a href={url} target="_blank" rel="noreferrer">
                    Open on {providerName}
                    <ExternalLink aria-hidden="true" />
                  </a>
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={() => setPicking(true)}>
                Change…
              </Button>
            </SettingsRow>
          </SettingsRows>
          {automation &&
            (board ? (
              <TrackerWorkflowForm
                api={api}
                groupId={group.id}
                connection={connection}
                board={board}
                defaults={descriptor?.statusNames}
                onSaved={changed}
              />
            ) : boardState.error ? (
              <Alert variant="destructive" size="sm">
                <AlertDescription>{boardState.error}</AlertDescription>
              </Alert>
            ) : (
              <p role="status" className="project-settings-value m-0">
                Loading the board…
              </p>
            ))}
          {github && roadmapDates && (
            <RoadmapDates api={api} groupId={group.id} onChanged={changed} />
          )}
          {github && url && (
            <section aria-labelledby="project-settings-github" className="project-settings-group">
              <h3 id="project-settings-github" className="project-settings-group-label">
                On GitHub
              </h3>
              <div className="project-settings-links">
                {githubPages.map((page) => (
                  <a
                    key={page.label}
                    className="project-settings-link"
                    href={url + page.path}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {page.label}
                    <ExternalLink aria-hidden="true" />
                  </a>
                ))}
              </div>
            </section>
          )}
          <div className="mt-auto flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              disabled={unlinking}
              onClick={() => setConfirmUnlink(true)}
            >
              Disconnect board…
            </Button>
          </div>
        </>
      )}
      {picking && (
        <BoardPicker
          api={api}
          group={group}
          provider={provider}
          onCancel={connection ? () => setPicking(false) : undefined}
          onConnected={async () => {
            setPicking(false);
            changed();
            await onConnected();
          }}
        />
      )}
      {connection && (
        <Dialog open={confirmUnlink} onOpenChange={(next) => !unlinking && setConfirmUnlink(next)}>
          <DialogContent size="sm">
            <DialogHeader>
              <DialogTitle>
                Disconnect {connection.project.title} from {group.name}?
              </DialogTitle>
              <DialogDescription>
                Tasks stay on {providerName}. Chats keep their links.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button
                variant="outline"
                disabled={unlinking}
                onClick={() => setConfirmUnlink(false)}
              >
                Cancel
              </Button>
              <Button variant="destructive" disabled={unlinking} onClick={() => void disconnect()}>
                {unlinking ? 'Disconnecting…' : 'Disconnect'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/** The row that adds the "Start date" and "End date" fields that the roadmap needs. */
function RoadmapDates({
  api,
  groupId,
  onChanged,
}: {
  api: API;
  groupId: string;
  onChanged(): void;
}) {
  const state = useRoadmapDateFields(api, groupId, onChanged);
  return (
    <SettingsRows title="Roadmap">
      {state.error && (
        <Alert variant="destructive" size="sm" className="my-2">
          <AlertDescription>{state.error}</AlertDescription>
        </Alert>
      )}
      {(state.loaded || !state.error) && (
        <SettingsRow label="Start date and End date fields">
          <RoadmapDateButton state={state} />
        </SettingsRow>
      )}
    </SettingsRows>
  );
}

/** Checks the tracker access, then shows the picker and Connect board. */
function BoardPicker({
  api,
  group,
  provider,
  onCancel,
  onConnected,
}: {
  api: API;
  group: ProjectGroup;
  provider: string;
  /** Closes the picker. Without it, there is no Cancel button. */
  onCancel?(): void;
  onConnected(): Promise<void>;
}) {
  const connection = trackerConnection(group);
  const { client, name: providerName } = useTracker(api, provider);
  const board = boardLabel(providerName);
  const [auth, setAuth] = useState<TrackerAuthState>({ status: 'idle' });
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
  const [error, setError] = useState('');
  const started = useRef(false);
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
    if (started.current) return;
    started.current = true;
    // Defer so that a remount in development does not start two checks.
    const timer = setTimeout(() => void authorize(), 0);
    return () => {
      clearTimeout(timer);
      started.current = false;
    };
  }, []);
  useEffect(() => {
    if (!trackerAuthPending(auth)) return;
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
  }, [auth.status, client]);
  const changed = !!url && url !== connection?.project.url;
  async function connect() {
    if (!changed || busy) return;
    setBusy(true);
    setError('');
    try {
      await client.link(group.id, url);
      showToast(connection ? 'The project now uses the new board.' : 'Board connected.');
      setUrl('');
      await onConnected();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label={connection ? 'Change board' : 'Connect a board'} className="grid gap-3">
      {['checking', 'verifying', 'idle'].includes(auth.status) && (
        <p role="status" className="text-sm text-muted-foreground">
          Checking {providerName} access…
        </p>
      )}
      {auth.status === 'waiting' && (
        <div className="panel grid gap-3" aria-live="polite">
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
              <Button variant="outline" onClick={() => void client.openAuth()}>
                Open {providerName}
                <ExternalLink aria-hidden="true" />
              </Button>
            </div>
          )}
          <p className="form-help m-0">
            {auth.message || 'Waiting for approval. This updates automatically.'}
          </p>
        </div>
      )}
      {!trackerAuthPending(auth) && !['ready', 'idle'].includes(auth.status) && (
        <Alert variant="destructive" size="sm">
          <AlertDescription>
            {auth.message || `Sign in to ${providerName} to choose a ${board}.`}
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => void authorize()}>
                Try again
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent('kalkidan-open-settings', {
                      detail: { section: 'general', anchor: settingsAnchors.github },
                    }),
                  )
                }
              >
                Open Preferences
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      )}
      {auth.status === 'ready' && (
        <TrackerProjectPicker
          api={api}
          provider={provider}
          defaultTitle={group.name}
          value={url}
          onChange={setUrl}
          onBusy={setPickerBusy}
        />
      )}
      {error && (
        <Alert variant="destructive" size="sm">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button disabled={!changed || busy || pickerBusy} onClick={() => void connect()}>
          {busy ? 'Connecting…' : 'Connect board'}
        </Button>
      </div>
    </section>
  );
}
