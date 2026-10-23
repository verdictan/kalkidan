import { useEffect, useState } from 'react';
import { ChevronDown, ExternalLink, Plus, SquareKanban, X } from 'lucide-react';
import type { API, Project, ProjectGroup, RemoteHost } from '../types';
import { trackerConnection } from '../domain/tracker';
import { useTracker } from '../hooks/use-tracker';
import { useProjectBoard } from '../hooks/use-project-board';
import { errorMessage } from '../lib/errors';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';
import { EntityIcon } from './ui/entity-icon';
import { showToast } from './ui/toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { ConfirmDialog } from './confirm-dialog';
import { ConnectBoardDialog, boardLabel } from './tracker-project-picker';
import { TrackerWorkflowForm } from './tracker-workflow';
import { RoadmapDateButton, useRoadmapDateFields } from './github-project-resources';
import { setIdentityOverride } from '../domain/identity';
import { useIdentityOverrides } from '../hooks/use-identity';
import { useWorkspaceIdentity } from '../hooks/use-workspace-identity';
import { IdentityMark } from './ui/identity-mark';
import { IdentitySwatches } from './ui/identity-swatches';
import { menuDestructiveClass, menuLabelClass } from './ui/menu-styles';
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
 * Settings › the current project (ST-C4): its mark, name and color, its repos as chips (hover ×
 * removes one, + adds one), and the board chip. The board chip opens the board settings in
 * place, under the chips. The mark and name open the menu: Color, Automatic color, Rename… and
 * Remove project…. `tab` moves to a part, for example 'board'.
 */
/** The board of the board chip: a frame with two columns of cards. */
function BoardIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="12"
      height="12"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M9 4v16M15 4v10" />
    </svg>
  );
}

export function ProjectSettingsPanel({
  api,
  group,
  groups = [group],
  repos = [],
  open,
  tab,
  onRefresh,
}: {
  api: API;
  group: ProjectGroup;
  /** All projects, for the automatic colors. */
  groups?: ProjectGroup[];
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
  const [removingRepo, setRemovingRepo] = useState<Project>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const part = projectPart(tab);
  const [boardOpen, setBoardOpen] = useState(part === projectParts.board);
  useEffect(() => {
    if (part === projectParts.board) setBoardOpen(true);
  }, [part]);
  const identity = useWorkspaceIdentity(groups, repos, []);
  const overrides = useIdentityOverrides();
  const color = identity.project(group);
  const chosen = overrides['project:' + group.name] || null;
  /** Tells the project page to load its board again. */
  const boardChanged = () =>
    window.dispatchEvent(
      new CustomEvent('kalkidan-github-writes', { detail: { groupId: group.id } }),
    );
  const members = repos.filter((repo) => group.repoIds.includes(repo.id));
  const connection = trackerConnection(group);
  const boardTitle = connection?.project.title;
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
  async function removeRepo() {
    if (!removingRepo || busy) return;
    setBusy(true);
    setError('');
    try {
      await api.remove(removingRepo.id);
      showToast(`${removingRepo.name} removed from ${group.name}.`);
      setRemovingRepo(undefined);
      await onRefresh?.();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="st-section" id="settings-project" aria-label={group.name}>
      <div className="st-section-head">
        <h2 className="st-project-title" aria-label={group.name}>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className="st-project-menu"
                aria-label={`Actions for ${group.name}`}
              >
                <IdentityMark kind="project" color={color} slot={false} />
                {group.name}
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start">
              <div className="menu-color st-project-color" role="group" aria-label="Color">
                <div className={menuLabelClass} aria-hidden="true">
                  Color
                </div>
                <IdentitySwatches
                  label={`Color of ${group.name}`}
                  value={chosen}
                  automatic={color}
                  onChange={(next) => setIdentityOverride('project', group.name, next)}
                />
              </div>
              <DropdownMenuItem
                disabled={!chosen}
                onSelect={() => setIdentityOverride('project', group.name, null)}
              >
                Automatic color
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() =>
                  window.dispatchEvent(
                    new CustomEvent('kalkidan-rename-project', { detail: { groupId: group.id } }),
                  )
                }
              >
                Rename…
              </DropdownMenuItem>
              <DropdownMenuItem
                id={projectParts.danger}
                className={menuDestructiveClass}
                onSelect={() => setRemoving(true)}
              >
                Remove project…
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </h2>
      </div>
      <div className="st-project-row">
        <ul className="st-chips" id={projectParts.folders} aria-label={`Repos of ${group.name}`}>
          {members.map((repo) => (
            <li key={repo.id} className="st-chip" title={repo.path}>
              <IdentityMark kind="repo" color={identity.repo(repo)} slot={false} />
              <span className="st-chip-name">{repo.name}</span>
              <button
                type="button"
                className="st-chip-remove"
                aria-label={`Remove ${repo.name} from ${group.name}…`}
                onClick={() => {
                  setError('');
                  setRemovingRepo(repo);
                }}
              >
                <X aria-hidden="true" />
              </button>
            </li>
          ))}
          <li>
            <button
              type="button"
              className="st-chip st-chip-add"
              aria-label="Add repo…"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent('kalkidan-add-code-folder', { detail: { groupId: group.id } }),
                )
              }
            >
              <Plus aria-hidden="true" />
            </button>
          </li>
        </ul>
        <button
          type="button"
          className="st-chip st-board-chip"
          aria-expanded={boardOpen}
          aria-controls={projectParts.board}
          onClick={() => setBoardOpen((value) => !value)}
        >
          <BoardIcon />
          {boardTitle || 'Connect board'}
        </button>
      </div>
      {error && !removing && !removingRepo && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      {boardOpen && (
        <div id={projectParts.board} className="st-board" tabIndex={-1}>
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
        </div>
      )}
      <ConfirmDialog
        open={!!removingRepo}
        title={`Remove ${removingRepo?.name || 'the repo'} from ${group.name}?`}
        description="Kalkidan stops showing it. The folder and its files stay on disk."
        confirmLabel="Remove repo"
        destructive
        busy={busy}
        onCancel={() => setRemovingRepo(undefined)}
        onConfirm={() => void removeRepo()}
      >
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
      </ConfirmDialog>
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
    </section>
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
        // The same row shape as the rest of Settings: the state, then its one action.
        <SettingsRows label="Board">
          <SettingsRow label="No board">
            <Button variant="outline" size="sm" onClick={() => setConnecting(true)}>
              Connect board…
            </Button>
          </SettingsRow>
        </SettingsRows>
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
