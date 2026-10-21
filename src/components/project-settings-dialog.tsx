import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Tabs as TabsPrimitive } from 'radix-ui';
import {
  Columns3,
  ExternalLink,
  FolderGit2,
  FolderKanban,
  Link2,
  Settings2,
  TriangleAlert,
  Workflow,
} from 'lucide-react';
import type { API, Project, ProjectGroup, RemoteHost } from '../types';
import { trackerAuthPending, trackerConnection, type TrackerAuthState } from '../domain/tracker';
import { useTracker } from '../hooks/use-tracker';
import { useProjectBoard } from '../hooks/use-project-board';
import { interfaceConfig } from '../config/interface';
import { errorMessage } from '../lib/errors';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Alert, AlertDescription } from './ui/alert';
import { SectionHeader } from './ui/page-header';
import { showToast } from './ui/toast';
import {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { DangerZone, FooterActions, holdDialogFocus } from './dialog-parts';
import { TrackerProjectPicker, boardLabel } from './tracker-project-picker';
import { TrackerWorkflowForm } from './tracker-workflow';
import { GitHubProjectResources } from './github-project-resources';
import { GitHubProjectSettingsForm } from './github-project-settings';
import { ProjectCodeFolders, ProjectDangerZone, ProjectGeneral } from './project-settings-sections';

export type ProjectSettingsTab =
  'general' | 'folders' | 'board' | 'automation' | 'fields' | 'github' | 'danger';

/**
 * The one place to configure a project: its name, color and location, its code folders, the
 * board connection, status automation, GitHub fields and views, the GitHub project itself, and
 * the removal of the project. Open it with the `kalkidan-open-project-settings` event.
 */
export function ProjectSettingsDialog({
  api,
  group,
  repos = [],
  host,
  open,
  onOpenChange,
  tab: requestedTab = 'general',
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
  /** The SSH host of the project, if it has one. */
  host?: RemoteHost;
  open: boolean;
  onOpenChange(open: boolean): void;
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
  /** Starts the removal of the project. Without it, the Danger zone does not show. */
  onRemoveProject?(): void;
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
  const tabs: { value: ProjectSettingsTab; label: string; icon: ReactNode }[] = [
    { value: 'general', label: 'General', icon: <Settings2 /> },
    ...(onAddFolder && onRemoveFolder
      ? [{ value: 'folders' as const, label: 'Code folders', icon: <FolderGit2 /> }]
      : []),
    { value: 'board', label: 'Board connection', icon: <Link2 /> },
    ...(connection &&
    descriptor?.capabilities.updateStatus !== false &&
    typeof api.trackerConfigure === 'function'
      ? [{ value: 'automation' as const, label: 'Status automation', icon: <Workflow /> }]
      : []),
    ...(github && typeof api.trackerResources === 'function'
      ? [{ value: 'fields' as const, label: 'Fields and views', icon: <Columns3 /> }]
      : []),
    ...(github && typeof api.trackerSettings === 'function'
      ? [{ value: 'github' as const, label: 'GitHub project', icon: <FolderKanban /> }]
      : []),
    ...(onRemoveProject
      ? [{ value: 'danger' as const, label: 'Danger zone', icon: <TriangleAlert /> }]
      : []),
  ];
  const available = (value: ProjectSettingsTab) => tabs.some((item) => item.value === value);
  const [tab, setTab] = useState<ProjectSettingsTab>(requestedTab);
  const [visited, setVisited] = useState<ProjectSettingsTab[]>([requestedTab]);
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!open) return;
    const next = available(requestedTab) ? requestedTab : 'general';
    setTab(next);
    setVisited([next]);
  }, [open, requestedTab]);
  const active = available(tab) ? tab : 'general';
  const changed = () => {
    void refresh().catch(() => undefined);
    onChanged?.();
  };
  const panel = (value: ProjectSettingsTab, body: ReactNode) =>
    visited.includes(value) && (
      <TabsPrimitive.Content
        forceMount
        value={value}
        className="outline-none data-[state=inactive]:hidden"
      >
        {body}
      </TabsPrimitive.Content>
    );
  const target = (value: ProjectSettingsTab) => (active === value ? footer : null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        size="lg"
        layout="scroll"
        onOpenAutoFocus={(event) => {
          const name = (event.currentTarget as HTMLElement | null)?.querySelector<HTMLInputElement>(
            '#project-general-form input',
          );
          if (!focusName || !name) return holdDialogFocus(event);
          // "Rename…" opens the dialog with the project name selected.
          event.preventDefault();
          name.select();
        }}
      >
        <DialogHeader className="border-b">
          <DialogTitle>Project settings</DialogTitle>
          <DialogDescription>
            {connection
              ? `${group.name} · ${connection.project.title}`
              : `${group.name} · No ${boardLabel(providerName)}`}
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="flex p-0">
          <TabsPrimitive.Root
            value={active}
            onValueChange={(value) => {
              const next = value as ProjectSettingsTab;
              setTab(next);
              setVisited((current) => (current.includes(next) ? current : [...current, next]));
            }}
            orientation="vertical"
            className="flex min-h-[min(460px,calc(100dvh-12rem))] min-w-0 flex-1"
          >
            <TabsPrimitive.List
              aria-label="Project settings sections"
              className="sticky top-0 flex w-44 shrink-0 flex-col gap-0.5 self-start px-3 py-4"
            >
              {tabs.map((item) => (
                <TabsPrimitive.Trigger
                  key={item.value}
                  value={item.value}
                  className="flex h-[var(--row-height)] items-center gap-2 rounded-md px-2 text-left text-sm text-muted-foreground outline-none transition-colors hover:bg-[var(--surface-hover)] hover:text-foreground focus-visible:shadow-[var(--focus-ring)] data-[state=active]:bg-[var(--surface-selected)] data-[state=active]:text-foreground [&_svg]:size-4 [&_svg]:shrink-0"
                >
                  {item.icon}
                  {item.label}
                </TabsPrimitive.Trigger>
              ))}
            </TabsPrimitive.List>
            <div className="min-w-0 flex-1 border-l px-6 py-4">
              {panel(
                'general',
                <ProjectGeneral
                  key={group.id}
                  api={api}
                  group={group}
                  host={host}
                  footer={target('general')}
                  onSaved={async () => {
                    onOpenChange(false);
                    await onSaved?.();
                  }}
                />,
              )}
              {onAddFolder &&
                onRemoveFolder &&
                panel(
                  'folders',
                  <ProjectCodeFolders
                    group={group}
                    repos={repos}
                    onAdd={() => {
                      onOpenChange(false);
                      onAddFolder();
                    }}
                    onRemove={(repo) => {
                      onOpenChange(false);
                      onRemoveFolder(repo);
                    }}
                  />,
                )}
              {onRemoveProject &&
                panel(
                  'danger',
                  <ProjectDangerZone
                    group={group}
                    onRemove={() => {
                      onOpenChange(false);
                      onRemoveProject();
                    }}
                  />,
                )}
              {panel(
                'board',
                <BoardConnection
                  api={api}
                  group={group}
                  provider={provider}
                  footer={target('board')}
                  onConnected={async () => {
                    changed();
                    await onConnected?.();
                  }}
                  onDisconnected={async () => {
                    onOpenChange(false);
                    changed();
                    await (onDisconnected || onConnected)?.();
                  }}
                />,
              )}
              {connection &&
                panel(
                  'automation',
                  board ? (
                    <TrackerWorkflowForm
                      api={api}
                      groupId={group.id}
                      connection={connection}
                      board={board}
                      defaults={descriptor?.statusNames}
                      footer={target('automation')}
                      onSaved={changed}
                    />
                  ) : boardState.error ? (
                    <Alert variant="destructive" size="sm">
                      <AlertDescription>{boardState.error}</AlertDescription>
                    </Alert>
                  ) : (
                    <p role="status" className="text-sm text-muted-foreground">
                      Loading the board…
                    </p>
                  ),
                )}
              {github &&
                panel(
                  'fields',
                  <GitHubProjectResources
                    api={api}
                    groupId={group.id}
                    footer={target('fields')}
                    onChanged={changed}
                  />,
                )}
              {github &&
                panel(
                  'github',
                  <GitHubProjectSettingsForm
                    api={api}
                    groupId={group.id}
                    footer={target('github')}
                    onSaved={changed}
                    onDeleted={() => onOpenChange(false)}
                  />,
                )}
            </div>
          </TabsPrimitive.Root>
        </DialogBody>
        <DialogFooter ref={setFooter} className="empty:hidden" />
      </DialogContent>
    </Dialog>
  );
}

/** The current board, and the picker that connects the project to another board. */
function BoardConnection({
  api,
  group,
  provider,
  footer,
  onConnected,
  onDisconnected,
}: {
  api: API;
  group: ProjectGroup;
  provider: string;
  footer: HTMLElement | null;
  onConnected(): Promise<void>;
  onDisconnected(): Promise<void>;
}) {
  // Optional until every desktop bridge has it. The control hides when it is missing.
  const unlink = (api as API & { trackerUnlink?(groupId: string): Promise<void> }).trackerUnlink;
  const [confirmUnlink, setConfirmUnlink] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  async function disconnect() {
    if (!unlink || unlinking) return;
    setUnlinking(true);
    setError('');
    try {
      await unlink.call(api, group.id);
      setConfirmUnlink(false);
      showToast('Board disconnected');
      await onDisconnected();
    } catch (failure) {
      setConfirmUnlink(false);
      setError(errorMessage(failure));
    } finally {
      setUnlinking(false);
    }
  }
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
    <div className="grid gap-6">
      {connection && (
        <section aria-label="Connected board" className="grid gap-2">
          <SectionHeader size="sm" title="Connected board" className="mb-0" />
          <dl className="meta-list">
            <dt>Board</dt>
            <dd>
              {connection.project.title}
              {connection.project.number ? ` #${connection.project.number}` : ''}
            </dd>
            {connection.project.owner && (
              <>
                <dt>Owner</dt>
                <dd>{connection.project.owner}</dd>
              </>
            )}
            <dt>Provider</dt>
            <dd>{providerName}</dd>
          </dl>
          {connection.project.url && (
            <a
              className="text-link inline-flex items-center gap-1 justify-self-start text-sm"
              href={connection.project.url}
              target="_blank"
              rel="noreferrer"
            >
              Open on {providerName}
              <ExternalLink className="size-3.5" aria-hidden="true" />
            </a>
          )}
        </section>
      )}
      <section aria-label={connection ? 'Change board' : 'Connect a board'} className="grid gap-3">
        <div>
          <SectionHeader
            size="sm"
            className="mb-0.5"
            title={connection ? 'Change board' : `Connect a ${board}`}
          />
          <p className="form-help m-0">
            Tasks come from the board. Your code folders and chats do not change.
          </p>
        </div>
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
                        detail: { section: 'accounts' },
                      }),
                    )
                  }
                >
                  Open account settings
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
      </section>
      {connection && typeof unlink === 'function' && (
        <DangerZone
          title="Disconnect board"
          description="Tasks stay on GitHub. Chats keep their links."
          action={
            <Button
              variant="outline"
              className="text-destructive hover:text-destructive"
              disabled={busy || unlinking}
              onClick={() => setConfirmUnlink(true)}
            >
              Disconnect board…
            </Button>
          }
        />
      )}
      {connection && (
        <Dialog open={confirmUnlink} onOpenChange={(next) => !unlinking && setConfirmUnlink(next)}>
          <DialogContent size="sm">
            <DialogHeader>
              <DialogTitle>
                Disconnect {connection.project.title} from {group.name}?
              </DialogTitle>
              <DialogDescription>Tasks stay on GitHub. Chats keep their links.</DialogDescription>
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
      <FooterActions target={footer}>
        <DialogClose asChild>
          <Button variant="outline" disabled={busy}>
            Cancel
          </Button>
        </DialogClose>
        <Button
          data-primary
          disabled={!changed || busy || pickerBusy}
          onClick={() => void connect()}
        >
          {busy ? 'Connecting…' : 'Connect board'}
        </Button>
      </FooterActions>
    </div>
  );
}
