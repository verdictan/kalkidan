import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ExternalLink, SquareKanban } from 'lucide-react';
import type { API, Project, ProjectGroup, RemoteHost } from '../types';
import { trackerConnection } from '../domain/tracker';
import { useTracker } from '../hooks/use-tracker';
import { useProjectBoard } from '../hooks/use-project-board';
import { errorMessage } from '../lib/errors';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';
import { EmptyState } from './ui/empty-state';
import { EntityIcon } from './ui/entity-icon';
import { showToast } from './ui/toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { ConfirmDialog } from './confirm-dialog';
import { ConnectBoardDialog, boardLabel } from './tracker-project-picker';
import { TrackerWorkflowForm } from './tracker-workflow';
import { RoadmapDateButton, useRoadmapDateFields } from './github-project-resources';
import { ProjectCodeFolders, ProjectGeneral } from './project-settings-sections';
import { SettingsRow, SettingsRows } from './settings-disclosure';
import { codeFolders } from './repository-import';

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

/** The pages of a GitHub project that "Open on GitHub" lists. */
const githubPages = [
  { label: 'Board', path: '' },
  { label: 'Fields', path: '/settings' },
  { label: 'Views', path: '' },
  { label: 'Workflows', path: '/workflows' },
  { label: 'Status updates', path: '' },
];

/** The element IDs of the parts of a project section. A request names a part with a tab. */
const projectParts: Record<string, string> = {
  folders: 'project-folders',
  board: 'project-board',
  danger: 'project-remove',
};

/** The part of a project section that a tab name opens. General is the top. */
export function projectPart(tab: string | undefined) {
  if (!tab || tab === 'general') return undefined;
  return boardTabs.includes(tab as ProjectSettingsTab) ? projectParts.board : projectParts[tab];
}

/**
 * Settings › <project>: one page with the name and color of the project, its code folders, its
 * board with the automatic status changes, and Remove project. Selects, switches and colors save
 * at once with Undo. Text saves when you press Enter or leave the field. The settings of the
 * GitHub project itself open on GitHub. `tab` moves to a part, for example 'board'.
 */
export function ProjectSettingsPanel({
  api,
  group,
  repos = [],
  host,
  open,
  tab,
  onRefresh,
}: {
  api: API;
  group: ProjectGroup;
  /** All code folders. The section shows the code folders of this project. */
  repos?: Project[];
  /** The SSH host of the project, if it has one. */
  host?: RemoteHost;
  /** True while the section shows. The board reads only then. */
  open: boolean;
  /** The part to move to: 'board', 'roadmap-dates', 'folders' or 'danger'. */
  tab?: string;
  /** Reads the projects again after a change. */
  onRefresh?(): void | Promise<void>;
}) {
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  const part = projectPart(tab);
  useEffect(() => {
    if (!open || !part) return;
    let tries = 0;
    const timer = setInterval(() => {
      const element = root.current?.querySelector<HTMLElement>(`[id="${CSS.escape(part)}"]`);
      if (element || ++tries > 40) {
        clearInterval(timer);
        if (!element) return;
        element.scrollIntoView({ block: 'start' });
        element.focus({ preventScroll: true });
      }
    }, 50);
    return () => clearInterval(timer);
  }, [open, part]);
  /** Tells the project page to load its board again. */
  const boardChanged = () =>
    window.dispatchEvent(
      new CustomEvent('kalkidan-github-writes', { detail: { groupId: group.id } }),
    );
  const members = repos.filter((repo) => group.repoIds.includes(repo.id));
  async function remove() {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      await api.removeGroup(group.id, true);
      setRemoving(false);
      showToast(`${group.name} removed from Kalkidan.`);
      await onRefresh?.();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  // A project on an SSH host shows the host under its name.
  const remote = group.hostId ? host?.name || host?.target || 'SSH host' : '';
  return (
    <div ref={root} className="contents">
      <ProjectGeneral
        key={group.id}
        api={api}
        group={group}
        location={remote || undefined}
        onSaved={async () => {
          await onRefresh?.();
        }}
      />
      <ProjectCodeFolders
        group={group}
        repos={repos}
        onAdd={() =>
          window.dispatchEvent(
            new CustomEvent('kalkidan-add-code-folder', { detail: { groupId: group.id } }),
          )
        }
        onRemove={async (repo) => {
          await api.remove(repo.id);
          showToast(`${repo.name} removed from ${group.name}.`);
          await onRefresh?.();
        }}
      />
      <section
        id={projectParts.board}
        tabIndex={-1}
        className="settings-group outline-none"
        aria-labelledby="project-board-label"
      >
        <h3 id="project-board-label" className="group-label">
          Board
        </h3>
        <BoardSection
          api={api}
          group={group}
          open={open}
          roadmapDates={open && tab === 'roadmap-dates'}
          onChanged={boardChanged}
          onConnected={async () => {
            boardChanged();
            await onRefresh?.();
          }}
          onDisconnected={async () => {
            boardChanged();
            await onRefresh?.();
          }}
        />
      </section>
      <SettingsRows label="Remove project">
        <SettingsRow id={projectParts.danger} label="Remove project" help="All files stay on disk.">
          <Button variant="destructive-outline" size="sm" onClick={() => setRemoving(true)}>
            Remove project…
          </Button>
        </SettingsRow>
      </SettingsRows>
      <ConfirmDialog
        open={removing}
        title={`Remove ${group.name}?`}
        description={
          members.length
            ? `Kalkidan stops showing ${group.name} and its ${codeFolders(members.length)}. All files stay on disk.`
            : `Kalkidan stops showing ${group.name}. All files stay on disk.`
        }
        confirmLabel="Remove project"
        destructive
        busy={busy}
        onCancel={() => setRemoving(false)}
        onConfirm={() => void remove()}
      >
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}

/**
 * @deprecated Project settings is a section of the one Settings window. Use
 * `openProjectSettings(groupId, tab)` from './settings-dialog'. This component keeps older
 * callers working: when it opens, it opens that section and closes itself.
 */
export function ProjectSettingsDialog({
  group,
  open,
  onOpenChange,
  section,
  tab,
}: {
  api: API;
  group: ProjectGroup;
  repos?: Project[];
  host?: RemoteHost;
  open: boolean;
  onOpenChange(open: boolean): void;
  section?: ProjectSettingsTab;
  tab?: ProjectSettingsTab;
  onConnected?(): void | Promise<void>;
  onDisconnected?(): void | Promise<void>;
  onChanged?(): void;
  onSaved?(): void | Promise<void>;
  onAddFolder?(): void;
  onRemoveProject?(): void;
}) {
  useEffect(() => {
    if (!open) return;
    // The older `tab` can be more exact than `section`, for example 'roadmap-dates'.
    const requested = (tab && boardTabs.includes(tab) ? tab : section || tab) || undefined;
    window.dispatchEvent(
      new CustomEvent('kalkidan-open-settings', {
        detail: { section: `project:${group.id}`, anchor: requested },
      }),
    );
    onOpenChange(false);
  }, [open]);
  return null;
}

/**
 * Project settings › Board: the connected board with "Open on GitHub" and "Change…", the
 * automatic status changes, and "Disconnect board…". Without a board, it
 * shows "Connect board…". Both open the one Connect board dialog over Project settings.
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
  const [connecting, setConnecting] = useState(false);
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
    <>
      {error && (
        <Alert variant="destructive" size="sm">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {connection ? (
        <SettingsRows label="Connected board">
          <SettingsRow
            icon={
              <EntityIcon>
                <SquareKanban />
              </EntityIcon>
            }
            label={title}
            help={[connection.project.owner, boardLabel(providerName)].filter(Boolean).join(' · ')}
          >
            {url && <OpenOnProvider url={url} name={providerName} github={github} />}
            <Button variant="outline" size="sm" onClick={() => setConnecting(true)}>
              Change…
            </Button>
          </SettingsRow>
        </SettingsRows>
      ) : (
        <EmptyState
          compact
          title="No board."
          action={
            <Button variant="outline" size="sm" onClick={() => setConnecting(true)}>
              Connect board…
            </Button>
          }
        />
      )}
      {connection &&
        automation &&
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
      {connection && github && roadmapDates && (
        <RoadmapDates api={api} groupId={group.id} onChanged={changed} />
      )}
      {connection && (
        <SettingsRows label="Disconnect board">
          <SettingsRow
            label="Disconnect board"
            help={`Tasks stay on ${providerName}. Chats keep their links.`}
          >
            <Button
              variant="destructive-outline"
              size="sm"
              disabled={unlinking}
              onClick={() => setConfirmUnlink(true)}
            >
              Disconnect board…
            </Button>
          </SettingsRow>
        </SettingsRows>
      )}
      <ConnectBoardDialog
        api={api}
        group={group}
        open={connecting}
        onOpenChange={setConnecting}
        onConnected={async () => {
          changed();
          await onConnected();
        }}
      />
      {connection && (
        <ConfirmDialog
          open={confirmUnlink}
          title={`Disconnect ${connection.project.title} from ${group.name}?`}
          description={`Tasks stay on ${providerName}. Chats keep their links.`}
          confirmLabel="Disconnect board"
          destructive
          busy={unlinking}
          onCancel={() => setConfirmUnlink(false)}
          onConfirm={() => void disconnect()}
        />
      )}
    </>
  );
}

/**
 * "Open on GitHub": one menu with the board and the GitHub pages of the board: Fields, Views,
 * Workflows and Status updates. Other trackers open the board only.
 */
function OpenOnProvider({ url, name, github }: { url: string; name: string; github: boolean }) {
  if (!github)
    return (
      <Button variant="ghost" size="sm" asChild>
        <a href={url} target="_blank" rel="noreferrer">
          Open on {name}
          <ExternalLink aria-hidden="true" />
        </a>
      </Button>
    );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm">
          Open on GitHub
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {githubPages.map((page) => (
          <DropdownMenuItem key={page.label} asChild>
            <a href={url + page.path} target="_blank" rel="noreferrer">
              {page.label}
              <ExternalLink className="ml-auto" aria-label="Opens in the browser" />
            </a>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
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
