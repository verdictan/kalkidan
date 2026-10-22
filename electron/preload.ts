import { contextBridge, ipcRenderer } from 'electron';
import type { API, MenuCommand } from '../src/types';
import { menuCommands } from '../src/api/contracts';
const api: API = {
  verdictanSetRegion: (region) => ipcRenderer.invoke('verdictan-set-region', region),
  onVerdictanChanged: (listener) => {
    const notify = () => listener();
    ipcRenderer.on('verdictan-changed', notify);
    return () => ipcRenderer.removeListener('verdictan-changed', notify);
  },
  dispatchReconcile: (...args) => ipcRenderer.invoke('dispatch-reconcile', ...args),
  dispatchPrepare: (request) => ipcRenderer.invoke('dispatch-prepare', request),
  dispatchStart: (id) => ipcRenderer.invoke('dispatch-start', id),
  dispatchStatus: (id) => ipcRenderer.invoke('dispatch-status', id),
  dispatchCancel: (id) => ipcRenderer.invoke('dispatch-cancel', id),
  taskUsageHistory: (groupId, taskId) => ipcRenderer.invoke('task-usage-history', groupId, taskId),
  managedHistory: (target) => ipcRenderer.invoke('managed-history', target),
  projectUsage: (groupId, chats, options) =>
    ipcRenderer.invoke('project-usage', groupId, chats, options),
  projectPublishDoc: (...args) => ipcRenderer.invoke('project-publish-doc', ...args),
  projectServicesStatus: (id) => ipcRenderer.invoke('project-services-status', id),
  projectServicesRequest: (id, request) =>
    ipcRenderer.invoke('project-services-request', id, request),
  verdictanSetup: () => ipcRenderer.invoke('verdictan-setup'),
  verdictanSelect: (agent, selection) => ipcRenderer.invoke('verdictan-select', agent, selection),
  verdictanStatus: () => ipcRenderer.invoke('verdictan-status'),
  verdictanCheck: () => ipcRenderer.invoke('verdictan-check'),
  verdictanAuthorize: (intent) => ipcRenderer.invoke('verdictan-authorize', intent),
  verdictanCancel: () => ipcRenderer.invoke('verdictan-cancel'),
  verdictanRenew: () => ipcRenderer.invoke('verdictan-renew'),
  verdictanLogout: () => ipcRenderer.invoke('verdictan-logout'),
  verdictanReopenBrowser: () => ipcRenderer.invoke('verdictan-reopen-browser'),
  verdictanOpenConsole: () => ipcRenderer.invoke('verdictan-open-console'),
  verdictanApplyRecommended: () => ipcRenderer.invoke('verdictan-apply-recommended'),
  verdictanReviewInspect: (id, region) =>
    ipcRenderer.invoke('verdictan-review-inspect', id, region),
  verdictanReviewOpen: (id, region) => ipcRenderer.invoke('verdictan-review-open', id, region),
  verdictanReviewDecide: (id, region, decision, reason, revision) =>
    ipcRenderer.invoke('verdictan-review-decide', id, region, decision, reason, revision),
  firstRunState: () => ipcRenderer.invoke('first-run-state'),
  setWelcomeDone: () => ipcRenderer.invoke('set-welcome-done'),
  notificationPreferences: () => ipcRenderer.invoke('notification-preferences'),
  setNotificationPreferences: (value) => ipcRenderer.invoke('set-notification-preferences', value),
  appVersion: () => ipcRenderer.invoke('app-version'),
  helperUpdates: () => ipcRenderer.invoke('helper-updates'),
  runtimeUpdateStatus: (hostId) => ipcRenderer.invoke('runtime-update-status', hostId),
  runtimeUpdateCheck: (hostId) => ipcRenderer.invoke('runtime-update-check', hostId),
  runtimeUpdateInstall: (hostId) => ipcRenderer.invoke('runtime-update-install', hostId),
  runtimeUpdateCancel: (hostId) => ipcRenderer.invoke('runtime-update-cancel', hostId),
  memoryList: (group) => ipcRenderer.invoke('memory-list', group),
  projectResourceRevision: (group, kind) =>
    ipcRenderer.invoke('project-resource-revision', group, kind),
  docsMetadata: (group) => ipcRenderer.invoke('docs-metadata', group),
  docsRead: (group, id) => ipcRenderer.invoke('docs-read', group, id),
  docsList: (...args) => ipcRenderer.invoke('docs-list', ...args),
  docsCreate: (...args) => ipcRenderer.invoke('docs-create', ...args),
  docsSave: (...args) => ipcRenderer.invoke('docs-save', ...args),
  docsDelete: (...args) => ipcRenderer.invoke('docs-delete', ...args),
  docsTrash: (group) => ipcRenderer.invoke('docs-trash', group),
  docsRestore: (...args) => ipcRenderer.invoke('docs-restore', ...args),
  docsSearch: (group, query, limit) => ipcRenderer.invoke('docs-search', group, query, limit),
  taskDocLinks: (group) => ipcRenderer.invoke('docs-task-links', group),
  setTaskDocLinks: (group, itemId, docIds) =>
    ipcRenderer.invoke('docs-set-task-links', group, itemId, docIds),
  memoryEntries: (group) => ipcRenderer.invoke('memory-entries', group),
  memoryForget: (group, id, revision) => ipcRenderer.invoke('memory-forget', group, id, revision),
  memorySave: (group, entry) => ipcRenderer.invoke('memory-save', group, entry),
  pullRequestStatus: (id, url) => ipcRenderer.invoke('pull-request-status', id, url),
  trackerProjectAction: (...args) => ipcRenderer.invoke('tracker-project-action', ...args),
  trackerContent: (...args) => ipcRenderer.invoke('tracker-content', ...args),
  trackerContentChange: (...args) => ipcRenderer.invoke('tracker-content-change', ...args),
  trackerRelations: (...args) => ipcRenderer.invoke('tracker-relations', ...args),
  trackerRelationChange: (...args) => ipcRenderer.invoke('tracker-relation-change', ...args),
  trackerSavedView: (...args) => ipcRenderer.invoke('tracker-saved-view', ...args),
  trackerResources: (...args) => ipcRenderer.invoke('tracker-resources', ...args),
  trackerResourceChange: (...args) => ipcRenderer.invoke('tracker-resource-change', ...args),
  trackerSettings: (...args) => ipcRenderer.invoke('tracker-settings', ...args),
  trackerSettingsUpdate: (...args) => ipcRenderer.invoke('tracker-settings-update', ...args),
  trackerPortfolio: (...args) => ipcRenderer.invoke('tracker-portfolio', ...args),
  trackerDocsPlan: (...args) => ipcRenderer.invoke('tracker-docs-plan', ...args),
  trackerMutationHistory: (...args) => ipcRenderer.invoke('tracker-mutation-history', ...args),
  trackerMutationRevert: (group, mutationId) =>
    ipcRenderer.invoke('tracker-mutation-revert', group, mutationId),
  trackerBatch: (...args) => ipcRenderer.invoke('tracker-batch', ...args),
  trackerField: (...args) => ipcRenderer.invoke('tracker-field', ...args),
  trackerItemAction: (...args) => ipcRenderer.invoke('tracker-item-action', ...args),
  trackerProviders: (...args) => ipcRenderer.invoke('tracker-providers', ...args),
  trackerAuthStart: (...args) => ipcRenderer.invoke('tracker-auth-start', ...args),
  trackerAuthStatus: (...args) => ipcRenderer.invoke('tracker-auth-status', ...args),
  trackerAuthCancel: (...args) => ipcRenderer.invoke('tracker-auth-cancel', ...args),
  trackerAuthOpen: (...args) => ipcRenderer.invoke('tracker-auth-open', ...args),
  trackerOwners: (...args) => ipcRenderer.invoke('tracker-owners', ...args),
  trackerProjects: (...args) => ipcRenderer.invoke('tracker-projects', ...args),
  trackerCreateProject: (...args) => ipcRenderer.invoke('tracker-create-project', ...args),
  trackerLink: (...args) => ipcRenderer.invoke('tracker-link', ...args),
  trackerUnlink: (groupId) => ipcRenderer.invoke('tracker-unlink', groupId),
  trackerBoard: (...args) => ipcRenderer.invoke('tracker-board', ...args),
  trackerStatus: (...args) => ipcRenderer.invoke('tracker-status', ...args),
  trackerDraft: (...args) => ipcRenderer.invoke('tracker-draft', ...args),
  trackerAddIssue: (...args) => ipcRenderer.invoke('tracker-add-issue', ...args),
  trackerConfigure: (...args) => ipcRenderer.invoke('tracker-configure', ...args),

  githubCliCheck: () => ipcRenderer.invoke('github-cli-check'),
  agentInstallations: (hostId) => ipcRenderer.invoke('agent-installations', hostId),
  chooseAgentExecutable: (agent, path, hostId) =>
    ipcRenderer.invoke('agent-executable-choose', agent, path, hostId),
  browserAction: (id, action, value) => ipcRenderer.invoke('browser-action', id, action, value),
  sessionAction: (session, action) => ipcRenderer.invoke('session-action', session, action),
  remoteHosts: () => ipcRenderer.invoke('remote-hosts'),
  remoteAdd: (name, target) => ipcRenderer.invoke('remote-add', name, target),
  remoteCheck: (id) => ipcRenderer.invoke('remote-check', id),
  remoteInstall: (id) => ipcRenderer.invoke('remote-install', id),
  remoteConnect: (id) => ipcRenderer.invoke('remote-connect', id),
  remoteDisconnect: (id) => ipcRenderer.invoke('remote-disconnect', id),
  remoteRemove: (id) => ipcRenderer.invoke('remote-remove', id),
  remoteCall: ((id, method, args) =>
    ipcRenderer.invoke('remote-call', id, method, args)) as API['remoteCall'],
  directoryList: (path, hostId) => ipcRenderer.invoke('directory-list', path, hostId),
  mentionFiles: (cwd, hostId) => ipcRenderer.invoke('mention-files', cwd, hostId),
  remoteFolders: (id, path) => ipcRenderer.invoke('remote-folders', id, path),
  remoteAddRepository: (id, path, clone) =>
    ipcRenderer.invoke('remote-add-repository', id, path, clone),
  ptyOpen: (cwd, cols, rows) => ipcRenderer.invoke('pty-open', cwd, cols, rows),
  ptyRead: (id, cursor) => ipcRenderer.invoke('pty-read', id, cursor),
  ptyWrite: (id, input) => ipcRenderer.invoke('pty-write', id, input),
  ptyResize: (id, cols, rows) => ipcRenderer.invoke('pty-resize', id, cols, rows),
  ptyClose: (id) => ipcRenderer.invoke('pty-close', id),
  browserLayout: (id, bounds) => ipcRenderer.invoke('browser-layout', id, bounds),
  browserNavigate: (id, action) => ipcRenderer.invoke('browser-navigate', id, action),
  browserState: (id) => ipcRenderer.invoke('browser-state', id),
  terminalStart: (cwd, command) => ipcRenderer.invoke('terminal-start', cwd, command),
  terminalStatus: (id) => ipcRenderer.invoke('terminal-status', id),
  terminalInput: (id, value) => ipcRenderer.invoke('terminal-input', id, value),
  terminalStop: (id) => ipcRenderer.invoke('terminal-stop', id),
  repositoryDiff: (cwd) => ipcRenderer.invoke('repository-diff', cwd),
  browserOpen: (url, id) => ipcRenderer.invoke('browser-open', url, id),
  browserSelect: (id) => ipcRenderer.invoke('browser-select', id),
  browserClose: (id) => ipcRenderer.invoke('browser-close', id),
  githubRepositories: () => ipcRenderer.invoke('github-repositories'),
  cloneRepository: (name, groupId) => ipcRenderer.invoke('repository-clone', name, groupId),
  models: (agent) => ipcRenderer.invoke('models', agent),
  githubAuthStart: (force) => ipcRenderer.invoke('github-auth-start', force),
  githubAuthStatus: () => ipcRenderer.invoke('github-auth-status'),
  githubAuthCancel: (attemptId) => ipcRenderer.invoke('github-auth-cancel', attemptId),
  githubAuthOpen: () => ipcRenderer.invoke('github-auth-open'),
  githubOwners: () => ipcRenderer.invoke('github-owners'),
  githubProjects: (owner) => ipcRenderer.invoke('github-projects', owner),
  githubCreateProject: (owner, title) => ipcRenderer.invoke('github-create-project', owner, title),
  githubLink: (id, url) => ipcRenderer.invoke('github-link', id, url),
  githubBoard: (id) => ipcRenderer.invoke('github-board', id),
  githubStatus: (id, item, option) => ipcRenderer.invoke('github-status', id, item, option),
  githubDraft: (id, title, body) => ipcRenderer.invoke('github-draft', id, title, body),
  githubAddIssue: (id, url) => ipcRenderer.invoke('github-add-issue', id, url),

  createGroup: (name, url, hostId, provider, rootPath, operationId, paths) =>
    ipcRenderer.invoke('group-create', name, url, hostId, provider, rootPath, operationId, paths),
  setGroupColor: (id, color) => ipcRenderer.invoke('group-color', id, color),
  updateGroup: (id, name) => ipcRenderer.invoke('group-update', id, name),
  removeGroup: (id, withRepositories) => ipcRenderer.invoke('group-remove', id, withRepositories),
  moveRepo: (repoId, groupId) => ipcRenderer.invoke('repo-move', repoId, groupId),
  chatCreate: (projectId, agent, prompt, allowEdits, options) =>
    ipcRenderer.invoke('chat-create', projectId, agent, prompt, allowEdits, options),
  transcript: (agent, id) => ipcRenderer.invoke('transcript', agent, id),
  chatStart: (agent, id, prompt, allowEdits, options) =>
    ipcRenderer.invoke('chat-start', agent, id, prompt, allowEdits, options),
  chatStatus: (id) => ipcRenderer.invoke('chat-status', id),
  chatApprove: (id, approval, allow) => ipcRenderer.invoke('chat-approve', id, approval, allow),
  chatRespond: (id, request, answers) => ipcRenderer.invoke('chat-respond', id, request, answers),
  taskWorktree: (id, branch, operationId) =>
    ipcRenderer.invoke('task-worktree', id, branch, operationId),
  chatStop: (id) => ipcRenderer.invoke('chat-stop', id),
  updateSession: (agent, id, changes) => ipcRenderer.invoke('session-update', agent, id, changes),
  repositorySnapshot: (id) => ipcRenderer.invoke('repository-snapshot', id),
  snapshot: () => ipcRenderer.invoke('snapshot'),
  add: (groupId) => ipcRenderer.invoke('add', groupId),
  historyPreview: () => ipcRenderer.invoke('history-preview'),
  historyImport: (request) => ipcRenderer.invoke('history-import', request),
  discover: (groupId) => ipcRenderer.invoke('discover', groupId),
  chooseFolder: (title, buttonLabel) => ipcRenderer.invoke('choose-folder', title, buttonLabel),
  scanRepositories: (path, hostId) => ipcRenderer.invoke('scan-repositories', path, hostId),
  addRepositories: (groupId, paths) => ipcRenderer.invoke('add-repositories', groupId, paths),
  worktreePreview: (id, branch) => ipcRenderer.invoke('worktree-preview', id, branch),
  gitSwitchNewBranch: (id, branch) => ipcRenderer.invoke('git-switch-new-branch', id, branch),
  workingFiles: (id) => ipcRenderer.invoke('working-files', id),
  update: (id, changes) => ipcRenderer.invoke('update', id, changes),
  remove: (id) => ipcRenderer.invoke('remove', id),
  git: (id) => ipcRenderer.invoke('git', id),
  launch: (id, agent) => ipcRenderer.invoke('launch', id, agent),
  reveal: (id) => ipcRenderer.invoke('reveal', id),
  worktree: (id, branch) => ipcRenderer.invoke('worktree', id, branch),
  worktreeRemove: (id, force) => ipcRenderer.invoke('worktree-remove', id, force),
  workingStatus: (id) => ipcRenderer.invoke('working-status', id),
  gitPublish: (...args) => ipcRenderer.invoke('git-publish', ...args),
  gitPublishStatus: (...args) => ipcRenderer.invoke('git-publish-status', ...args),
  gitCommit: (id, message, files) => ipcRenderer.invoke('git-commit', id, message, files),
  gitPullRequest: (id, title, body) => ipcRenderer.invoke('git-pull-request', id, title, body),
  showAppMenu: () => ipcRenderer.invoke('app-menu'),
  setChatMenuState: (state) => ipcRenderer.invoke('chat-menu-state', state),
  setAppearance: (mode) => ipcRenderer.invoke('appearance', mode),
  notify: (input) => ipcRenderer.invoke('notify', input),
  setBadgeCount: (count) => ipcRenderer.invoke('badge-count', count),
  onNotificationClick: (callback) => {
    const listener = (_event: unknown, target: unknown) => {
      if (typeof target === 'string') callback(target);
    };
    ipcRenderer.on('notification-click', listener);
    return () => {
      ipcRenderer.removeListener('notification-click', listener);
    };
  },
  onRemoteHostsChange: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('remote-hosts-changed', listener);
    return () => ipcRenderer.removeListener('remote-hosts-changed', listener);
  },
  onTrackerChange: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('tracker-changed', listener);
    return () => ipcRenderer.removeListener('tracker-changed', listener);
  },
  onProjectResourceChange: (callback) => {
    const listener = (_event: unknown, value: { groupId: string; resource: 'docs' | 'memory' }) => {
      if (value && typeof value.groupId === 'string' && ['docs', 'memory'].includes(value.resource))
        callback(value);
    };
    ipcRenderer.on('project-resource-changed', listener);
    return () => ipcRenderer.removeListener('project-resource-changed', listener);
  },
  onMenuCommand: (callback) => {
    const listener = (_event: unknown, command: unknown) => {
      if (typeof command === 'string' && (menuCommands as readonly string[]).includes(command))
        callback(command as MenuCommand);
    };
    ipcRenderer.on('menu-command', listener);
    return () => {
      ipcRenderer.removeListener('menu-command', listener);
    };
  },
  onFullScreenChange: (callback) => {
    const listener = (_event: unknown, fullScreen: unknown) => callback(fullScreen === true);
    ipcRenderer.on('full-screen', listener);
    return () => {
      ipcRenderer.removeListener('full-screen', listener);
    };
  },
};
// Electron adds "Error invoking remote method 'x': Error: " to each handler error. That text is
// for developers. Remove it once here, so no view shows it to the user.
const ipcPrefix = /^Error invoking remote method '[^']*': (?:\w*Error: )?/;
function plainError(error: unknown) {
  if (!(error instanceof Error) || !ipcPrefix.test(error.message)) return error;
  return new Error(error.message.replace(ipcPrefix, ''));
}
const exposed = Object.fromEntries(
  Object.entries(api).map(([name, value]) => [
    name,
    typeof value !== 'function' || name.startsWith('on')
      ? value
      : (...args: unknown[]) => {
          const result = (value as (...args: unknown[]) => unknown)(...args);
          return result instanceof Promise
            ? result.catch((error: unknown) => {
                throw plainError(error);
              })
            : result;
        },
  ]),
) as unknown as API;
contextBridge.exposeInMainWorld('workspace', exposed);
