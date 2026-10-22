import type { ProjectServicesAPI } from '../domain/project-services';
import type { ParallelDispatchAPI } from '../domain/parallel-dispatch';
import type { GitHubContentAPI } from '../domain/github-content';
import type { GitHubRelationsAPI } from '../domain/github-relations';
import type { PublishAPI } from '../domain/publish';
import type { GitHubResourcesAPI } from '../domain/github-resources';
import type { GitHubProjectMutationAPI } from '../domain/github-mutations';
import type { GitHubCliStatus } from '../domain/conversation';
import type { VerdictanAPI } from '../domain/verdictan';
import type { UpdatesAPI } from '../domain/updates';
import type { DiagnosticsAPI } from '../domain/diagnostics';
import type { DocsAPI } from '../domain/docs';
import { chatCommands, type ChatActionState } from '../domain/chat-actions';
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
export interface TrackerAPI
  extends GitHubContentAPI, GitHubProjectMutationAPI, GitHubResourcesAPI, GitHubRelationsAPI {
  trackerProviders(): Promise<TrackerDescriptor[]>;
  trackerAuthStart(provider: string, force?: boolean): Promise<TrackerAuthState>;
  trackerAuthStatus(provider: string): Promise<TrackerAuthState>;
  trackerAuthCancel(provider: string, attemptId: string): Promise<TrackerAuthState>;
  trackerAuthOpen(provider: string): Promise<void>;
  trackerOwners(provider: string): Promise<TrackerOwner[]>;
  trackerProjects(provider: string, owner: TrackerOwner): Promise<TrackerProject[]>;
  trackerCreateProject(
    provider: string,
    owner: TrackerOwner,
    title: string,
  ): Promise<TrackerProject>;
  trackerLink(groupId: string, provider: string, reference: string): Promise<void>;
  /** Disconnects the board. Tasks stay on the tracker. Clears the status mapping. */
  trackerUnlink(groupId: string): Promise<void>;
  trackerBoard(groupId: string, force?: boolean): Promise<TrackerBoard>;
  trackerStatus(groupId: string, itemId: string, optionId: string): Promise<void>;
  trackerDraft(groupId: string, title: string, body: string): Promise<string | void>;
  trackerAddIssue(groupId: string, reference: string): Promise<void>;
  trackerConfigure(
    groupId: string,
    mapping: TrackerConnection['statusMapping'],
    statusFieldId?: string,
  ): Promise<void>;
}
export interface AgentAPI {
  githubCliCheck(): Promise<GitHubCliStatus>;
  /** Checks the agent programs. No host ID means this computer. */
  agentInstallations(hostId?: string): Promise<AgentInstallation[]>;
  /**
   * Keeps the program that launches use for an agent on one computer, then checks again.
   * `null` returns to automatic detection. Rejects a file that does not report a version.
   */
  chooseAgentExecutable?(
    agent: Agent,
    path: string | null,
    hostId?: string,
  ): Promise<AgentInstallation[]>;
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
  chatRespond(
    runId: string,
    requestId: string,
    answers: import('../domain/conversation').AgentAnswers,
  ): Promise<void>;
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
  onRemoteHostsChange?(callback: () => void): () => void;
  onTrackerChange?(callback: () => void): () => void;
  onProjectResourceChange?(
    callback: (event: { groupId: string; resource: 'docs' | 'memory' }) => void,
  ): () => void;
  remoteHosts(): Promise<RemoteHost[]>;
  remoteAdd(name: string, target: string): Promise<RemoteHost>;
  remoteCheck(id: string): Promise<RemoteHost>;
  remoteInstall(id: string): Promise<RemoteHost>;
  remoteConnect(id: string): Promise<RemoteHost>;
  remoteDisconnect(id: string): Promise<void>;
  /** Removes a saved host. Rejects when a project still runs on it. */
  remoteRemove(id: string): Promise<void>;
  remoteCall<M extends SessionHostMethod>(
    hostId: string,
    method: M,
    args: Parameters<SessionHostAPI[M]>,
  ): ReturnType<SessionHostAPI[M]>;
  directoryList(path: string, hostId?: string): Promise<DirectoryListing>;
  /** The files of a chat folder for the "@" picker. No host ID means this computer. */
  mentionFiles(cwd: string, hostId?: string): Promise<import('../domain/mentions').MentionFileList>;
  remoteFolders(hostId: string, path: string): Promise<RemoteFolders>;
  remoteAddRepository(groupId: string, path: string, clone?: string): Promise<void>;
}
export interface GitHubAPI {
  githubRepositories(): Promise<GitHubRepository[]>;
  githubAuthStart(force?: boolean): Promise<GitHubAuthState>;
  githubAuthStatus(): Promise<GitHubAuthState>;
  githubAuthCancel(attemptId: string): Promise<GitHubAuthState>;
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
  taskUsageHistory(
    groupId: string,
    taskId: string,
  ): Promise<import('../domain/conversation').TaskUsageHistory[]>;
  /** The Verdictan history of a task or a chat. One page of at most 25 requests. */
  managedHistory(
    target: import('../domain/managed-history').ManagedHistoryTarget,
  ): Promise<import('../domain/managed-history').ManagedHistoryPage>;
  /**
   * The managed-agent usage of the chats of a project, from the Verdictan history. The backend
   * reads only chats in the code folders of the project. It keeps the result of each chat for
   * a short time. `fresh` reads each chat again.
   */
  projectUsage(
    groupId: string,
    chats: import('../domain/project-usage').ProjectUsageChatRef[],
    options?: { fresh?: boolean },
  ): Promise<import('../domain/project-usage').ProjectUsage>;
  historyPreview(): Promise<HistoryImportPreview>;
  historyImport(request: HistoryImportRequest): Promise<HistoryImportResult>;
  cloneRepository(name: string, groupId?: string): Promise<boolean>;
  taskWorktree(repoId: string, branch: string, operationId?: string): Promise<Project | null>;
  repositorySnapshot(id: string): Promise<import('../domain/project').RepositorySnapshot>;
  snapshot(): Promise<Snapshot>;
  add(groupId?: string): Promise<void>;
  /** An empty `trackerReference` creates a project without a tracker. Connect it later. */
  createGroup(
    name: string,
    trackerReference: string,
    hostId?: string,
    provider?: string,
    rootPath?: string,
    operationId?: string,
    paths?: string[],
  ): Promise<string>;
  setGroupColor(
    id: string,
    color: import('../domain/project-colors').ProjectColor | null,
  ): Promise<void>;
  updateGroup(id: string, name: string): Promise<void>;
  /**
   * Removes a project from Kalkidan. With `withRepositories`, also removes its repository
   * entries. Files on disk always stay.
   */
  removeGroup(id: string, withRepositories?: boolean): Promise<void>;
  moveRepo(repoId: string, groupId: string | null): Promise<void>;
  discover(groupId: string): Promise<{ added: number }>;
  /** Reads the state of a pull request with `gh`. `id` is the repository entry. */
  pullRequestStatus(
    id: string,
    url: string,
  ): Promise<{ state: 'open' | 'merged' | 'closed'; number: number; title?: string }>;
  /** Opens the native folder dialog. Resolves null when the user cancels. Electron only. */
  chooseFolder(title?: string, buttonLabel?: string): Promise<string | null>;
  /**
   * Finds Git repositories in a folder: the folder itself and its subfolders to depth 3.
   * Skips hidden folders, node_modules and the folders inside a repository.
   */
  scanRepositories(path: string, hostId?: string): Promise<FolderScan>;
  /** Adds these folders to a project as repositories. Skips folders that are already added. */
  addRepositories(groupId: string, paths: string[]): Promise<{ added: number }>;
  /**
   * Shows where a new worktree starts from and where its folder goes. `base` is the current
   * branch, or the short commit when no branch is checked out. `path` is the folder that
   * `worktree` and `taskWorktree` create for this branch. Rejects when the branch name is not
   * valid.
   */
  worktreePreview(id: string, branch: string): Promise<{ base: string; path: string }>;
  /** Creates a new branch from the current state and switches to it. Changes stay. */
  gitSwitchNewBranch(id: string, branch: string): Promise<void>;
  /**
   * Lists the changed and untracked files in the checkout, one entry for each file. Untracked
   * folders are listed file by file. `from` is the earlier path of a renamed file.
   */
  workingFiles(id: string): Promise<WorkingFile[]>;
  update(id: string, changes: { name?: string; favorite?: boolean; notes?: string }): Promise<void>;
  remove(id: string): Promise<void>;
  git(id: string): Promise<GitInfo | null>;
  launch(id: string, agent: 'terminal'): Promise<void>;
  reveal(id: string): Promise<void>;
  worktree(id: string, branch: string): Promise<boolean>;
  /**
   * Removes a linked worktree folder and its repository entry. `id` is the repository
   * entry of the worktree. Rejects with "uncommitted changes" unless `force` is true.
   * The main checkout cannot be removed.
   */
  worktreeRemove(id: string, force?: boolean): Promise<void>;
  /** Counts changed and untracked files in the repository or worktree checkout. */
  workingStatus(id: string): Promise<WorkingStatus>;
  /**
   * Stages changes and commits them. Returns the new commit hash. With `files` (paths from
   * workingFiles), commits only those files and keeps other staged changes staged. Without
   * `files`, stages and commits all changes.
   */
  gitCommit(id: string, message: string, files?: string[]): Promise<{ commit: string }>;
  /**
   * Pushes the current branch to origin and opens a GitHub pull request with `gh`.
   * Returns the pull request URL. Rejects on the default branch.
   */
  gitPullRequest(id: string, title: string, body: string): Promise<{ url: string }>;
}
export interface FolderScan {
  /** The folder that was scanned, as a canonical path. */
  root: string;
  /** True when `root` is itself a Git repository. */
  rootIsRepository: boolean;
  /** Repositories found, the root first when it is one. Paths are canonical. */
  repositories: { path: string; name: string; branch?: string; added: boolean }[];
  /** True when the scan stopped at 200 repositories or at its folder limit. */
  truncated?: boolean;
}
export type WorkingFileStatus =
  'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'conflicted';
export interface WorkingFile {
  path: string;
  status: WorkingFileStatus;
  /** The earlier path of a renamed file. */
  from?: string;
}
export interface WorkingStatus {
  branch: string;
  changed: number;
  untracked: number;
  ahead: number;
  /** True when the branch has an upstream on origin. */
  published: boolean;
  defaultBranch: string;
}
// Commands that the native application menu sends to the focused window.
export const menuCommands = [
  'back',
  'forward',
  'new-project',
  'settings',
  'search',
  'toggle-sidebar',
  'close-tab',
  'add-code-folder',
  'new-task',
  'shortcuts',
  'get-started',
  'session-new',
  'session-terminal',
  'session-changes',
  'go-overview',
  'go-tasks',
  'go-chats',
  'go-docs',
  'go-memory',
  'go-insights',
  'all-sessions',
  'sign-in',
  // The Chat menu sends the commands of the chat action list.
  ...chatCommands,
] as const;
export type MenuCommand = (typeof menuCommands)[number];
export interface MenuAPI {
  onMenuCommand(callback: (command: MenuCommand) => void): () => void;
  /** Shows the application menu. Windows and Linux hide the menu bar with the title bar. */
  showAppMenu?(): Promise<void>;
  /**
   * Sets the state of the open chat for the Chat menu of the menu bar. Null: no chat is open.
   * The focused window sends it.
   */
  setChatMenuState?(state: ChatActionState | null): Promise<void>;
  /** Sets the native light or dark appearance. The window title bar and the page follow it. */
  setAppearance?(mode: 'system' | 'light' | 'dark'): Promise<void>;
  /** Reports full screen changes. macOS hides the window buttons in full screen. */
  onFullScreenChange?(callback: (fullScreen: boolean) => void): () => void;
  /**
   * Shows an OS notification when the window is not focused. A click focuses the window
   * and calls the onNotificationClick listener with `target`. `kind` selects the choice in
   * Settings › General › Notifications that applies. Without it, a title that ends with
   * "finished" is a finished notification, and each other title asks for input.
   */
  notify?(input: {
    title: string;
    body: string;
    target: string;
    kind?: 'finished' | 'needs-input';
  }): Promise<void>;
  onNotificationClick?(callback: (target: string) => void): () => void;
  /** Sets the dock or taskbar badge. 0 clears it. */
  setBadgeCount?(count: number): Promise<void>;
}
export interface MemoryAPI {
  memoryList(groupId: string): Promise<import('../domain/memory').ProjectMemory>;
  /** Memory entries with their source session and revision. */
  memoryEntries(groupId: string): Promise<import('../domain/memory').MemoryEntry[]>;
  /** Marks an entry as wrong. The entry stops being given to agents. The file keeps a record. */
  memoryForget(groupId: string, id: string, revision: string): Promise<void>;
  /**
   * Saves an entry that the user wrote. Without `id` it adds an entry. With `id`, it edits that
   * entry when `expectedRevision` is its current revision, else the result is a conflict.
   */
  memorySave(
    groupId: string,
    entry: { id?: string; expectedRevision?: string; topic: string; content: string },
  ): Promise<import('../domain/memory').MemoryWriteResult>;
  projectResourceRevision?(groupId: string, kind: 'docs' | 'memory'): Promise<string>;
}
export interface API
  extends
    ProjectServicesAPI,
    ParallelDispatchAPI,
    PublishAPI,
    VerdictanAPI,
    UpdatesAPI,
    DiagnosticsAPI,
    DocsAPI,
    MemoryAPI,
    TrackerAPI,
    AgentAPI,
    BrowserAPI,
    TerminalAPI,
    RemoteAPI,
    GitHubAPI,
    ProjectAPI,
    MenuAPI {}

export type SessionHostAPI = Pick<API, SessionHostMethod>;
