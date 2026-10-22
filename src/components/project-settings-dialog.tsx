import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ExternalLink, FolderGit2, Settings2, SquareKanban } from 'lucide-react';
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
import { Dialog } from './ui/dialog';
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
import {
  SettingsRow,
  SettingsRows,
  SettingsShell,
  type SettingsSection,
} from './settings-disclosure';

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
  onConnected,
  onDisconnected,
  onChanged,
  onSaved,
  onAddFolder,
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
  /** Called after the project connects to a board. */
  onConnected?(): void | Promise<void>;
  /** Called after the project disconnects from its board. Without it, onConnected is called. */
  onDisconnected?(): void | Promise<void>;
  /** Called after each board write, so that the page can load the board again. */
  onChanged?(): void;
  /** Called after the name or the color changes. */
  onSaved?(): void | Promise<void>;
  /** Opens the Add code folder dialog. Without it, the Code folders section does not show. */
  onAddFolder?(): void;
  /** Starts the removal of the project. Without it, the Remove project row does not show. */
  onRemoveProject?(): void;
}) {
  // The old `tab` can be more exact than `section`, for example 'roadmap-dates' with 'board'.
  const requested = (tab && boardTabs.includes(tab) ? tab : section || tab) || 'general';
  const sections: SettingsSection<ProjectSettingsSection>[] = [
    { value: 'general', label: 'General', icon: <Settings2 /> },
    ...(onAddFolder
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
    folders: onAddFolder && (
      <ProjectCodeFolders
        group={group}
        repos={repos}
        onAdd={() => {
          close();
          onAddFolder();
        }}
        onRemove={async (repo) => {
          // Project settings stays open. The confirmation opens over it.
          await api.remove(repo.id);
          showToast(`${repo.name} removed from ${group.name}.`);
          await onSaved?.();
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
      <SettingsShell
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
        navLabel="Project settings sections"
        sections={sections}
        value={active}
        onValueChange={setActive}
        panels={panels}
      />
    </Dialog>
  );
}

/**
 * Project settings › Board: the connected board with "Open on GitHub" and "Change…", the
 * automatic status changes, and "Disconnect board…" in the Danger zone. Without a board, it
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
          icon={<SquareKanban />}
          title="No board"
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
        <SettingsRows title="Danger zone">
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
