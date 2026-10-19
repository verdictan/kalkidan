import type { GitHubCliStatus } from '../domain/conversation';
import type { DocsAPI } from '../domain/docs';
import type {
  HistoryImportPreview,
  HistoryImportRequest,
  HistoryImportResult,
} from '../domain/history-import';
import type { TerminalRun, RepositoryDiff } from '../domain/terminal';
import type { BrowserSelection, BrowserState, BrowserBounds } from '../domain/browser';
import type {
  DirectoryListing,
  RemoteHost,
  RemoteFolders,
  Project,
  GitInfo,
  Snapshot,
} from '../domain/project';
import type {
  ChatOptions,
  ModelOption,
  Agent,
  SessionOrganization,
  Session,
  Transcript,
  ChatRun,
  AgentInstallation,
} from '../domain/conversation';
import type {
  GitHubRepository,
  GitHubOwner,
  GitHubAuthState,
  GitHubProject,
  GitHubBoard,
} from '../domain/github';
import type { SessionHostMethod } from '../domain/host';
import type {
  TrackerProject,
  TrackerBoard,
  TrackerOwner,
  TrackerAuthState,
  TrackerDescriptor,
  TrackerConnection,
} from '../domain/tracker';
export type {
  TrackerProject,
  TrackerItem,
  TrackerBoard,
  TrackerOwner,
  TrackerAuthState,
  TrackerDescriptor,
  TrackerConnection,
} from '../domain/tracker';
export interface TrackerAPI {
  trackerProviders(): Promise<TrackerDescriptor[]>;
  trackerAuthStart(provider: string, force?: boolean): Promise<TrackerAuthState>;
  trackerAuthStatus(provider: string): Promise<TrackerAuthState>;
  trackerAuthCancel(provider: string): Promise<TrackerAuthState>;
  trackerAuthOpen(provider: string): Promise<void>;
  trackerOwners(provider: string): Promise<TrackerOwner[]>;
  trackerProjects(provider: string, owner: TrackerOwner): Promise<TrackerProject[]>;
  trackerCreateProject(
    provider: string,
    owner: TrackerOwner,
    title: string,
  ): Promise<TrackerProject>;
  trackerLink(groupId: string, provider: string, reference: string): Promise<void>;
  trackerBoard(groupId: string): Promise<TrackerBoard>;
  trackerStatus(groupId: string, itemId: string, optionId: string): Promise<void>;
  trackerDraft(groupId: string, title: string, body: string): Promise<string | void>;
  trackerAddIssue(groupId: string, reference: string): Promise<void>;
  trackerConfigure(groupId: string, mapping: TrackerConnection['statusMapping']): Promise<void>;
}
export interface AgentAPI {
  githubCliCheck(): Promise<GitHubCliStatus>;
  agentInstallations(): Promise<AgentInstallation[]>;
  sessionAction(
    session: Session,
    action:
      | 'markdown'
      | 'html'
      | 'copy-transcript'
      | 'copy-id'
      | 'copy-path'
      | 'window'
      | 'finder'
      | 'vscode'
      | 'cursor',
  ): Promise<string | null>;
  models(agent: Agent): Promise<ModelOption[]>;
  chatCreate(
    projectId: string,
    agent: Agent,
    prompt: string,
    allowEdits: boolean,
    options?: ChatOptions,
  ): Promise<ChatRun>;
  transcript(agent: Agent, id: string): Promise<Transcript>;
  chatStart(
    agent: Agent,
    id: string,
    prompt: string,
    allowEdits: boolean,
    options?: ChatOptions,
  ): Promise<ChatRun>;
  chatStatus(runId: string): Promise<ChatRun>;
  chatApprove(runId: string, approvalId: string, allow: boolean): Promise<void>;
  chatStop(runId: string): Promise<void>;
  updateSession(agent: Agent, id: string, changes: SessionOrganization): Promise<void>;
}
export interface BrowserAPI {
  browserAction(id: string, action: string, value?: unknown): Promise<any>;
  browserLayout(id: string, bounds: BrowserBounds | null): Promise<void>;
  browserNavigate(id: string, action: 'back' | 'forward' | 'reload'): Promise<void>;
  browserState(id: string): Promise<BrowserState>;
  browserOpen(url: string, id?: string): Promise<void>;
  browserSelect(id?: string): Promise<BrowserSelection | null>;
  browserClose(id?: string): Promise<void>;
}
export interface TerminalAPI {
  ptyOpen(cwd: string, cols: number, rows: number): Promise<{ id: string }>;
  ptyRead(
    id: string,
    cursor: number,
  ): Promise<{
    id: string;
    data: string;
    cursor: number;
    exited: boolean;
    truncated?: boolean;
    error?: string;
  }>;
  ptyWrite(id: string, input: string): Promise<void>;
  ptyResize(id: string, cols: number, rows: number): Promise<void>;
  ptyClose(id: string): Promise<void>;
  terminalStart(cwd: string, command: string): Promise<TerminalRun>;
  terminalStatus(id: string): Promise<TerminalRun>;
  terminalInput(id: string, value: string): Promise<void>;
  terminalStop(id: string): Promise<void>;
  repositoryDiff(cwd: string): Promise<RepositoryDiff>;
}
export interface RemoteAPI {
  remoteHosts(): Promise<RemoteHost[]>;
  remoteAdd(name: string, target: string): Promise<RemoteHost>;
  remoteCheck(id: string): Promise<RemoteHost>;
  remoteInstall(id: string): Promise<RemoteHost>;
  remoteConnect(id: string): Promise<RemoteHost>;
  remoteDisconnect(id: string): Promise<void>;
  remoteCall<M extends SessionHostMethod>(
    hostId: string,
    method: M,
    args: Parameters<SessionHostAPI[M]>,
  ): ReturnType<SessionHostAPI[M]>;
  directoryList(path: string, hostId?: string): Promise<DirectoryListing>;
  remoteFolders(hostId: string, path: string): Promise<RemoteFolders>;
  remoteAddRepository(groupId: string, path: string, clone?: string): Promise<void>;
}
export interface GitHubAPI {
  githubRepositories(): Promise<GitHubRepository[]>;
  githubAuthStart(force?: boolean): Promise<GitHubAuthState>;
  githubAuthStatus(): Promise<GitHubAuthState>;
  githubAuthCancel(): Promise<GitHubAuthState>;
  githubAuthOpen(): Promise<void>;
  githubOwners(): Promise<GitHubOwner[]>;
  githubProjects(owner: GitHubOwner): Promise<GitHubProject[]>;
  githubCreateProject(owner: GitHubOwner, title: string): Promise<GitHubProject>;
  githubLink(groupId: string, url: string | null): Promise<void>;
  githubBoard(groupId: string): Promise<GitHubBoard>;
  githubStatus(groupId: string, itemId: string, optionId: string): Promise<void>;
  githubDraft(groupId: string, title: string, body: string): Promise<string | void>;
  githubAddIssue(groupId: string, url: string): Promise<void>;
}
export interface ProjectAPI {
  historyPreview(): Promise<HistoryImportPreview>;
  historyImport(request: HistoryImportRequest): Promise<HistoryImportResult>;
  cloneRepository(name: string, groupId?: string): Promise<boolean>;
  taskWorktree(repoId: string, branch: string): Promise<Project | null>;
  repositorySnapshot(id: string): Promise<import('../domain/project').RepositorySnapshot>;
  snapshot(): Promise<Snapshot>;
  add(groupId?: string): Promise<void>;
  createGroup(
    name: string,
    trackerReference: string,
    hostId?: string,
    provider?: string,
    rootPath?: string,
  ): Promise<string>;
  setGroupColor(
    id: string,
    color: import('../domain/project-colors').ProjectColor | null,
  ): Promise<void>;
  updateGroup(id: string, name: string): Promise<void>;
  removeGroup(id: string): Promise<void>;
  moveRepo(repoId: string, groupId: string | null): Promise<void>;
  discover(groupId: string): Promise<{ added: number }>;
  update(id: string, changes: { name?: string; favorite?: boolean; notes?: string }): Promise<void>;
  remove(id: string): Promise<void>;
  git(id: string): Promise<GitInfo | null>;
  launch(id: string, agent: 'terminal'): Promise<void>;
  reveal(id: string): Promise<void>;
  worktree(id: string, branch: string): Promise<boolean>;
}
// Commands that the native application menu sends to the focused window.
export const menuCommands = [
  'back',
  'forward',
  'new-project',
  'settings',
  'search',
  'toggle-sidebar',
] as const;
export type MenuCommand = (typeof menuCommands)[number];
export interface MenuAPI {
  onMenuCommand(callback: (command: MenuCommand) => void): () => void;
  /** Shows the application menu. Windows and Linux hide the menu bar with the title bar. */
  showAppMenu?(): Promise<void>;
  /** Sets the native light or dark appearance. The window title bar and the page follow it. */
  setAppearance?(mode: 'system' | 'light' | 'dark'): Promise<void>;
  /** Reports full screen changes. macOS hides the window buttons in full screen. */
  onFullScreenChange?(callback: (fullScreen: boolean) => void): () => void;
}
export interface API
  extends
    DocsAPI,
    TrackerAPI,
    AgentAPI,
    BrowserAPI,
    TerminalAPI,
    RemoteAPI,
    GitHubAPI,
    ProjectAPI,
    MenuAPI {}

export type SessionHostAPI = Pick<API, SessionHostMethod>;
