export interface GitHubRepository { nameWithOwner: string; description: string | null; isPrivate: boolean; isArchived: boolean }
export interface GitHubOwner { id: string; login: string; kind: 'user' | 'organization' }
export interface GitHubAuthState { status: 'idle' | 'checking' | 'waiting' | 'ready' | 'error'; code?: string; message?: string }
export interface GitHubProject { id: string; title: string; url: string; owner: string; number: number }
export interface GitHubItem { id: string; title: string; body: string; url?: string; repository?: string; number?: number; status?: string; statusId?: string }
export interface GitHubBoard { project: GitHubProject; items: GitHubItem[]; statusField?: { id: string; options: { id: string; name: string }[] } }
export interface ChatOptions { forkFrom?: string; model?: string; taskId?: string }
export interface ModelOption { id: string; name: string }
export type Agent = 'codex' | 'claude';
export interface RemoteHost { id: string; name: string; target: string; status: 'disconnected' | 'checked' | 'connecting' | 'connected' | 'error'; version?: string; node?: string; platform?: string }
export interface RemoteFolders { path: string; parent: string; folders: { name: string; path: string }[] }
export interface ProjectGroup { hostId?: string; id: string; name: string; repoIds: string[]; github?: GitHubProject }
export interface Project { hostId?: string; id: string; name: string; path: string; favorite: boolean; notes: string; addedAt: string }
export interface SessionOrganization { title?: string; notes?: string; collection?: string; pinned?: boolean; archived?: boolean; taskId?: string }
export interface Session { forkFrom?: string; hostId?: string; id: string; agent: Agent; cwd: string; updatedAt: string; title: string; organization?: SessionOrganization; projectId?: string; task?: GitHubItem; initialPrompt?: string }
export interface GitInfo { branch: string; changes: number; worktrees: { path: string; branch: string }[] }
export interface Snapshot { hosts?: RemoteHost[]; projects: Project[]; groups?: ProjectGroup[]; sessions: Session[]; warnings: string[]; platform: string }
export interface ChatMessage { id: string; role: 'user' | 'assistant'; text: string }
export interface Transcript { messages: ChatMessage[]; truncated: boolean }
export interface ToolActivity { id: string; title: string; status: string; detail?: string; diff?: string }
export interface ChatApproval { scope?: 'request' | 'turn'; id: string; title: string; detail: string; status: 'pending' | 'approved' | 'denied' | 'expired' }
export interface ChatRun { tools?: ToolActivity[]; approvals?: ChatApproval[]; diff?: string; id: string; agent: Agent; sessionId: string; status: 'running' | 'completed' | 'stopped' | 'failed'; messages: ChatMessage[]; activity: string; error?: string; errorCode?: 'session_busy'; sessionReady?: boolean }
export interface TerminalRun { id: string; command: string; cwd: string; output: string; status: 'running' | 'completed' | 'failed' | 'stopped'; exitCode?: number | null; truncated: boolean }
export interface RepositoryDiff { unstaged: string; staged: string; untracked: string[]; truncated: boolean }
export interface BrowserSelection { url: string; title: string; selector: string; text: string; tag: string; rect: { x: number; y: number; width: number; height: number }; viewport: { width: number; height: number } }
export interface BrowserProfileData { history: { url: string; title: string; at: string }[]; downloads: { id: string; name: string; path: string; state: string; received: number; total: number }[]; settings: { home: string; rememberHistory: boolean }; credentials: { id: string; origin: string; username: string }[] }
export interface BrowserState { command?: string; zoom?: number; find?: { matches: number; activeMatchOrdinal: number }; pendingURLs?: string[]; url: string; title: string; canGoBack: boolean; canGoForward: boolean; loading: boolean }
export interface BrowserBounds { x: number; y: number; width: number; height: number }
export interface ScheduledTask { id: string; session: Session; prompt: string; dueAt: string; status: 'pending' | 'running' | 'missed' | 'completed' | 'failed' | 'cancelled'; run?: ChatRun; error?: string }
export interface API {
  browserAction(id: string, action: string, value?: unknown): Promise<any>;
  sessionAction(session: Session, action: 'markdown' | 'html' | 'copy-transcript' | 'copy-id' | 'copy-path' | 'window' | 'finder' | 'vscode' | 'cursor'): Promise<string | null>;
  scheduledTasks(): Promise<ScheduledTask[]>;
  scheduleTask(session: Session, prompt: string, dueAt: string): Promise<ScheduledTask>;
  scheduleRun(id: string): Promise<void>;
  scheduleCancel(id: string): Promise<void>;
  ptyOpen(cwd: string, cols: number, rows: number): Promise<{id: string}>;
  ptyRead(id: string, cursor: number): Promise<{id: string; data: string; cursor: number; exited: boolean; truncated?: boolean; error?: string}>;
  ptyWrite(id: string, input: string): Promise<void>;
  ptyResize(id: string, cols: number, rows: number): Promise<void>;
  ptyClose(id: string): Promise<void>;
  browserLayout(id: string, bounds: BrowserBounds | null): Promise<void>;
  browserNavigate(id: string, action: 'back' | 'forward' | 'reload'): Promise<void>;
  browserState(id: string): Promise<BrowserState>;

  remoteHosts(): Promise<RemoteHost[]>;
  remoteAdd(name: string, target: string): Promise<RemoteHost>;
  remoteCheck(id: string): Promise<RemoteHost>;
  remoteInstall(id: string): Promise<RemoteHost>;
  remoteConnect(id: string): Promise<RemoteHost>;
  remoteDisconnect(id: string): Promise<void>;
  remoteCall(hostId: string, method: string, args: unknown[]): Promise<any>;
  remoteFolders(hostId: string, path: string): Promise<RemoteFolders>;
  remoteAddRepository(groupId: string, path: string, clone?: string): Promise<void>;
  terminalStart(cwd: string, command: string): Promise<TerminalRun>;
  terminalStatus(id: string): Promise<TerminalRun>;
  terminalInput(id: string, value: string): Promise<void>;
  terminalStop(id: string): Promise<void>;
  repositoryDiff(cwd: string): Promise<RepositoryDiff>;
  browserOpen(url: string, id?: string): Promise<void>;
  browserSelect(id?: string): Promise<BrowserSelection | null>;
  browserClose(id?: string): Promise<void>;
  githubRepositories(): Promise<GitHubRepository[]>;
  cloneRepository(name: string, groupId?: string): Promise<boolean>;
  models(agent: Agent): Promise<ModelOption[]>;
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
  githubDraft(groupId: string, title: string, body: string): Promise<void>;
  githubAddIssue(groupId: string, url: string): Promise<void>;

  chatCreate(projectId: string, agent: Agent, prompt: string, allowEdits: boolean, options?: ChatOptions): Promise<ChatRun>;
  transcript(agent: Agent, id: string): Promise<Transcript>;
  chatStart(agent: Agent, id: string, prompt: string, allowEdits: boolean, options?: ChatOptions): Promise<ChatRun>;
  chatStatus(runId: string): Promise<ChatRun>;
  chatApprove(runId: string, approvalId: string, allow: boolean): Promise<void>;
  taskWorktree(repoId: string, branch: string): Promise<Project | null>;
  chatStop(runId: string): Promise<void>;
  updateSession(agent: Agent, id: string, changes: SessionOrganization): Promise<void>;
  snapshot(): Promise<Snapshot>;
  add(groupId?: string): Promise<void>;
  createGroup(name: string, githubUrl: string, hostId?: string): Promise<string>;
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
declare global { interface Window { workspace?: API } }
