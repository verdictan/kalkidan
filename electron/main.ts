import { identityKey } from './verdictan/bindings';
import {
  savedVerdictanRegion,
  saveVerdictanRegion,
  verdictanRegion,
  type VerdictanRegion,
} from './verdictan/region';
import { ProjectServices } from './verdictan/project-services';
import { DesktopProtocolError } from './verdictan/protocol';
import { ParallelDispatch } from './operations/parallel-dispatch';
import { TaskExecutions } from './operations/task-execution';
import { trackerConnection } from '../src/domain/tracker';
import { WorktreeCreation } from './operations/worktree';
import { AgentStarts } from './operations/agent-start';
import { ProjectCreation } from './operations/create-project';
import { PublishOperations, publishEffects } from './operations/publish';
import { DesktopUpdates } from './updates/desktop';
import { createHash } from 'node:crypto';
import { RemoteSnapshotCache } from './remote-snapshot-cache';
import { createVerdictanServices, runtimePolicyReader } from './verdictan/service';
import { spawn } from 'node:child_process';
import { appMenuTemplate } from './app-menu';
import { pathContains } from './platform';
import { githubCliCheck } from './github-cli-check';
import { listDirectory } from './storage/directory-list';
import {
  ProjectLocationCache,
  prepareProjectLocation,
  legacyDocs,
  importLegacyDocs,
} from './storage/project-location';
import { memoryDirectory, readProjectMemory } from './storage/project-memory';
import { resourceRevision } from './storage/resource-revision';
import { ProjectDocs } from './storage/project-docs';
import { dataDirectory } from './storage/data-directory';
import { HistoryImport } from './history-import';
import { isAgent } from '../src/config/agents';
import { createProjectPrompt } from './projects/prompt';
import { sessionHostMethods } from '../src/domain/host';
import { writeJSON } from './storage/atomic-json';
import {
  isAppearanceMode,
  readAppearanceMode,
  saveAppearanceMode,
  withScheme,
} from './storage/appearance';
import { runtimeConfig } from './config/runtime';
import { TrackerRegistry } from './trackers/registry';
import { githubTracker } from './trackers/github';
import { registerTrackerHandlers } from './trackers/ipc';

import { agentInstallations } from './agent-installations';
import { BrowserProfile } from './browser-profile';
import type { MenuCommand, Session } from '../src/types';
import { PtyTerminal } from './pty-terminal';
import { RemoteHosts } from './remote-hosts';
import { CommandTerminal, repositoryDiff } from './conversation-tools';
import { AnnotationBrowser } from './annotation-browser';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  Menu,
  clipboard,
  nativeTheme,
  powerMonitor,
  Notification,
} from 'electron';
import { existsSync } from 'node:fs';
import { readFile, writeFile, stat, realpath } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import * as TOML from '@iarna/toml';
import type { Project, Agent } from '../src/types';
import { exec, launchCommand, parseWorktrees } from './core';
import { executable } from './chat';
import {
  gitCommit,
  gitPullRequest,
  gitSwitchNewBranch,
  removeWorktree,
  workingFiles,
  workingStatus,
  worktreePreview,
} from './git-working';
import { scanRepositories } from './repository-scan';
import { historyWithManaged } from './history';
const history = (codex: string, claude: string, sources?: Map<string, string>) =>
  historyWithManaged(dataRoot, codex, claude, sources);
import { codexTranscript } from './codex-store';
import { ProjectGroups } from './project-groups';
import { SessionLibrary } from './session-library';
import { readTranscript } from './transcript';
import { listRepositories, cloneRepository, repositoryName } from './repositories';
import { GitHubAuth } from './github-auth';
import { GitHubProjects } from './github-projects';
import { modelOptions } from './models';
import type { ChatOptions } from '../src/types';
import { createAgentRuntimes } from './agents/runtime';
app.setName('Kalkidan');
const dataRoot = dataDirectory(
  homedir(),
  () => app.getPath('appData'),
  !app.isPackaged ? process.env.KALKIDAN_TEST_DATA : undefined,
);
app.setPath('userData', dataRoot);
app.setPath('sessionData', dataRoot);
const pty = new PtyTerminal();
const terminal = new CommandTerminal();
const windows = new Set<BrowserWindow>();
const owned = new Map<
  BrowserWindow,
  { kind: 'chat' | 'pty' | 'terminal'; id: string; hostId?: string }[]
>();
const previews = new Map<BrowserWindow, AnnotationBrowser>();
const chatRunner = createAgentRuntimes(async (request) => {
  if (!verdictan) throw new DesktopProtocolError('desktop.runtime_missing');
  request.session.governanceScope = await resolveManagedScope(
    request.session.cwd,
    request.session.organization?.taskId,
  );
  return verdictan.launch.prepare(request);
});
const githubAuth = new GitHubAuth(() => shell.openExternal('https://github.com/login/device'));
let remote: RemoteHosts;
let resolveManagedScope: (
  cwd: string,
  taskId?: string,
  hostId?: string,
) => Promise<Session['governanceScope']> = async () => undefined;
let changingAccount = false;
let accountEpoch = 0;
let stopDispatch = () => {};
let restoreDispatch = () => {};
let lastAccount = '';
function notifyVerdictan() {
  const account = verdictan?.account.status().account;
  const key = JSON.stringify([
    verdictan?.region,
    account?.state,
    account?.organizationId,
    account?.userId,
  ]);
  if (key === lastAccount) return;
  const previousAccount = lastAccount;
  lastAccount = key;
  accountEpoch++;
  if (previousAccount.includes('authenticated')) {
    chatRunner.stopAll();
    verdictan?.remoteBroker.reset();
    void verdictan?.managed.stopAll().catch(() => {});
    for (const host of remote?.list() || [])
      if (host.status === 'connected') remote.disconnect(host.id);
  }
  stopDispatch();
  for (const window of windows)
    if (!window.isDestroyed()) window.webContents.send('verdictan-changed');
  if (account?.state === 'authenticated') restoreDispatch();
}
let verdictan: ReturnType<typeof createVerdictanServices> | undefined;
// The user confirmed that running agents can stop. Do not ask again while the app quits.
let stopAgentsConfirmed = false;
/** Asks before an action stops running agents. Returns true when the action can continue. */
function confirmStopAgents(parent?: BrowserWindow) {
  const count = chatRunner.runningCount();
  if (!count || stopAgentsConfirmed) return true;
  const options = {
    type: 'warning' as const,
    buttons: ['Stop agents and close', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: count === 1 ? 'An agent is still working' : `${count} agents are still working`,
    detail: 'If you close Kalkidan now, the agents stop. Their sessions stay on disk.',
  };
  const choice = parent
    ? dialog.showMessageBoxSync(parent, options)
    : dialog.showMessageBoxSync(options);
  stopAgentsConfirmed = choice === 0;
  return stopAgentsConfirmed;
}
app.on('before-quit', (event) => {
  if (!confirmStopAgents()) {
    event.preventDefault();
    return;
  }
  githubAuth.cancel();
  void verdictan?.managed.stopAll();
  verdictan?.account.dispose();
  chatRunner.dispose();
  terminal.stopAll();
  pty.closeAll();
  previews.forEach((p) => p.closeAll());
  remote?.close();
});
let projects: Project[] = [];
let win: BrowserWindow;
const dev = process.argv.includes('--dev');
const appIcon = join(
  __dirname,
  dev ? '../public/brand/icon-512.png' : '../dist/brand/icon-512.png',
);
const codexRoot = process.env.CODEX_HOME || join(homedir(), '.codex');
const claudeRoot = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
let saves = Promise.resolve();
async function save() {
  const data = structuredClone(projects);
  const task = saves
    .catch(() => {})
    .then(async () => {
      const file = join(app.getPath('userData'), 'projects.json');
      await writeJSON(file, data);
    });
  saves = task;
  await task;
}
function project(id: string) {
  const p = projects.find((p) => p.id === id);
  if (!p) throw new Error('Project not found');
  return p;
}
async function addPath(path: string) {
  const canonical = await realpath(path);
  if (!(await stat(canonical)).isDirectory()) throw new Error('Choose a folder');
  if (projects.some((p) => !p.hostId && p.path === canonical)) return false;
  projects.push({
    id: randomUUID(),
    name: basename(canonical),
    path: canonical,
    notes: '',
    favorite: false,
    addedAt: new Date().toISOString(),
  });
  return true;
}
function handle(channel: string, fn: (...args: any[]) => any) {
  ipcMain.handle(channel, (event, ...args) => {
    const owner = [...windows].find(
      (w) => w.webContents === event.sender && event.senderFrame === w.webContents.mainFrame,
    );
    if (!owner) throw new Error('Untrusted caller');
    if (
      changingAccount &&
      /^(verdictan-|runtime-|chat-|remote-call|dispatch-|task-usage-|project-services-|project-publish-doc)/.test(
        channel,
      )
    )
      throw new Error('Account is changing. Wait for the switch to finish.');

    const replyHost = channel === 'remote-call' ? args[0] : undefined;
    const replyMethod = channel === 'remote-call' ? args[1] : channel;
    const replyRun = channel === 'remote-call' ? args[2]?.[0] : args[0];
    if (
      ['chat-respond', 'chat-approve', 'chatRespond', 'chatApprove'].includes(replyMethod) &&
      !owned
        .get(owner)
        ?.some((r) => r.kind === 'chat' && r.id === replyRun && r.hostId === replyHost)
    )
      throw new Error('This agent request belongs to another window or host.');
    const requestEpoch = accountEpoch;
    return Promise.resolve()
      .then(() => fn(...args))
      .then((result) => {
        if (
          requestEpoch !== accountEpoch &&
          /^(project-services-|project-publish-doc|task-usage-|dispatch-)/.test(channel)
        )
          throw new Error('Account changed. Refresh this view.');
        const remoteMethod = channel === 'remote-call' ? args[1] : '';
        const kind =
          ['chat-create', 'chat-start'].includes(channel) ||
          ['chatCreate', 'chatStart'].includes(remoteMethod)
            ? 'chat'
            : channel === 'pty-open' || remoteMethod === 'ptyOpen'
              ? 'pty'
              : channel === 'terminal-start' || remoteMethod === 'terminalStart'
                ? 'terminal'
                : null;
        if (kind && result?.id) {
          const resource = {
            kind,
            id: result.id,
            hostId: remoteMethod ? args[0] : undefined,
          } as const;
          if (
            [...owned].some(
              ([window, resources]) =>
                window !== owner &&
                resources.some(
                  (value) =>
                    value.kind === resource.kind &&
                    value.id === resource.id &&
                    value.hostId === resource.hostId,
                ),
            )
          )
            throw new Error('This operation belongs to another window.');
          if (windows.has(owner)) {
            if (
              !owned
                .get(owner)!
                .some(
                  (value) =>
                    value.kind === resource.kind &&
                    value.id === resource.id &&
                    value.hostId === resource.hostId,
                )
            )
              owned.get(owner)!.push(resource);
          } else stopResource(resource);
        }
        return result;
      })
      .finally(() => {
        if (
          [
            'tracker-status',
            'tracker-project-action',
            'tracker-resource-change',
            'tracker-relation-change',
            'tracker-content-change',
            'tracker-settings-update',
            'tracker-field',
            'tracker-item-action',
            'tracker-draft',
            'tracker-add-issue',
            'tracker-link',
            'tracker-configure',
            'tracker-auth-start',
            'github-link',
            'github-status',
            'github-draft',
            'github-add-issue',
            'github-auth-start',
          ].includes(channel)
        )
          for (const window of windows)
            if (!window.isDestroyed()) window.webContents.send('tracker-changed');
      });
  });
}
function stopResource(resource: {
  kind: 'chat' | 'pty' | 'terminal';
  id: string;
  hostId?: string;
}) {
  try {
    if (resource.hostId) {
      void remote
        .call(
          resource.hostId,
          resource.kind === 'chat'
            ? 'chatStop'
            : resource.kind === 'pty'
              ? 'ptyClose'
              : 'terminalStop',
          [resource.id],
        )
        .catch(() => {});
    } else if (resource.kind === 'chat') chatRunner.stop(resource.id);
    else if (resource.kind === 'pty') pty.close(resource.id);
    else terminal.stop(resource.id);
  } catch {
    /* Completed resources may already have been released. */
  }
}
async function git(path: string, args: string[]) {
  return (await exec('git', ['-C', path, ...args], { timeout: 15000, maxBuffer: 2 * 1024 * 1024 }))
    .stdout;
}
const appearanceFile = join(dataRoot, 'appearance.json');
app.whenReady().then(async () => {
  powerMonitor.on('resume', () => {
    void remote?.reconcile().catch(() => {});
  });
  const runtimePolicy = runtimePolicyReader(__dirname);
  const makeVerdictan = (region: VerdictanRegion | undefined) =>
    createVerdictanServices({
      region,
      changed: notifyVerdictan,
      root: dataRoot,
      hostId: 'local',
      desktopVersion: app.getVersion(),
      policy: runtimePolicy,
      busy: () => chatRunner.runningCount() > 0,
      openBrowser: (url) => shell.openExternal(url),
    });
  verdictan = makeVerdictan(await savedVerdictanRegion(dataRoot));
  void verdictan.installer
    .check()
    .then(() => verdictan!.account.check())
    .catch(() => {});
  const desktopUpdates = new DesktopUpdates({
    version: app.getVersion(),
    bundle: join(__dirname, 'main.cjs'),
    journal: join(dataRoot, 'updates', 'desktop-discovery.json'),
    platform: process.platform,
    arch: process.arch,
  });
  const approvedHelper = readFile(join(__dirname, 'remote-agent.cjs')).then((bytes) =>
    createHash('sha256').update(bytes).digest('hex'),
  );
  void approvedHelper.catch(() => {});
  void desktopUpdates.status().catch(() => {});
  handle('component-updates', async (force?: boolean) => {
    const [desktop, approved] = await Promise.all([
      desktopUpdates.status(force === true),
      approvedHelper,
    ]);
    return {
      desktop,
      helpers: remote.list().map((host) => ({
        hostId: host.id,
        name: host.name,
        connected: host.status === 'connected',
        installed: host.installedDigest || host.version,
        running: host.status === 'connected' ? host.runningDigest : undefined,
        approved,
        discovery:
          remote.busy(host.id) && host.installedDigest !== approved
            ? 'waiting-for-idle'
            : host.installedDigest
              ? host.installedDigest === approved
                ? 'current'
                : 'available'
              : 'unknown',
      })),
    };
  });
  handle('verdictan-setup', () => verdictan!.setup.status());
  handle('verdictan-select', (agent, selection) => verdictan!.setup.select(agent, selection));
  const accountStatus = () => ({ ...verdictan!.account.status(), region: verdictan!.region });
  handle('verdictan-status', accountStatus);
  handle('verdictan-set-region', async (region: VerdictanRegion) => {
    verdictanRegion(region);
    if (verdictan!.region === region) return accountStatus();
    changingAccount = true;
    accountEpoch++;
    stopDispatch();
    try {
      verdictan!.remoteBroker.reset();
      const hosts = remote.list().filter((host) => host.status === 'connected');
      await Promise.all(hosts.map((host) => remote.call(host.id, 'managed-stop', [])));
      for (const host of hosts) remote.disconnect(host.id);
      chatRunner.stopAll();
      await verdictan!.managed.stopAll();
      await saveVerdictanRegion(dataRoot, region);
      verdictan!.account.dispose();
      verdictan = makeVerdictan(region);
      notifyVerdictan();
      await verdictan.installer.check();
      await verdictan.account.check();
      return accountStatus();
    } finally {
      changingAccount = false;
      if (verdictan?.account.status().account?.state === 'authenticated') restoreDispatch();
    }
  });
  handle('verdictan-check', () => verdictan!.account.check());
  handle('verdictan-authorize', (intent) => verdictan!.account.authorize(intent));
  handle('verdictan-cancel', () => verdictan!.account.cancel());
  handle('verdictan-renew', () => verdictan!.account.renew());
  handle('verdictan-logout', async () => {
    changingAccount = true;
    try {
      stopDispatch();
      accountEpoch++;
      verdictan!.remoteBroker.reset();
      await Promise.allSettled(
        remote
          .list()
          .filter((host) => host.status === 'connected')
          .map((host) => remote.call(host.id, 'managed-stop', [])),
      );
      await verdictan!.managed.stopAll();
      chatRunner.dispose();
      return await verdictan!.account.logout();
    } finally {
      changingAccount = false;
    }
  });
  for (const action of ['status', 'check', 'install', 'cancel'] as const) {
    handle(`runtime-update-${action}`, async (hostId?: string) => {
      if (hostId && hostId !== 'local') {
        if (typeof hostId !== 'string' || !remote.list().some((host) => host.id === hostId))
          throw new Error('Remote host not found.');
        return remote.call(hostId, 'runtime-update', [
          action,
          await runtimePolicy(),
          app.getVersion(),
          hostId,
          verdictan!.region,
        ]);
      }
      if (action === 'status') return verdictan!.installer.check();
      if (action === 'check') return verdictan!.installer.check(true);
      if (action === 'cancel') return verdictan!.installer.cancel();
      return verdictan!.installer.start();
    });
  }
  if (!app.isPackaged && existsSync(appIcon)) app.dock?.setIcon(appIcon);
  // Apply the saved appearance before the first window opens, so it opens in the right colors.
  nativeTheme.themeSource = await readAppearanceMode(appearanceFile);
  const browserProfile = new BrowserProfile();
  await browserProfile.load();
  const projectGroups = new ProjectGroups(join(app.getPath('userData'), 'project-groups.json'));
  try {
    await projectGroups.load();
  } catch (error: any) {
    dialog.showErrorBox('Cannot load project groups', error.message);
    app.quit();
    return;
  }
  const locations = new ProjectLocationCache(join(dataRoot, 'projects'));
  const preparingRoots = new Map<string, Promise<string>>();
  async function projectRoot(id: string): Promise<string> {
    const group = projectGroups.groups.find((g) => g.id === id);
    if (!group) throw new Error('Project not found');
    if (group.hostId && group.rootPath) return group.rootPath;
    if (preparingRoots.has(id)) return preparingRoots.get(id)!;
    const task = (async () => {
      const root = group.hostId
        ? await remote.call(group.hostId, 'project-prepare', [id, group.rootPath])
        : await locations.get(id, group.rootPath);
      if (!group.rootPath) {
        const files = await legacyDocs(join(dataRoot, 'docs', id));
        if (group.hostId) {
          for (const file of files)
            await remote.call(group.hostId, 'project-import-docs', [id, root, [file]]);
        } else await importLegacyDocs(root, files);
        await projectGroups.setRoot(id, root);
      }
      return root;
    })();
    preparingRoots.set(id, task);
    try {
      return await task;
    } finally {
      preparingRoots.delete(id);
    }
  }
  try {
    for (const group of projectGroups.groups.filter((g) => !g.hostId)) await projectRoot(group.id);
  } catch (error: any) {
    dialog.showErrorBox('Cannot prepare project folders', error.message);
    app.quit();
    return;
  }
  const docs = new ProjectDocs(
    join(dataRoot, 'docs'),
    (id) => projectGroups.groups.some((g) => g.id === id),
    async (id) => join(await projectRoot(id), 'docs'),
  );
  for (const operation of [
    'list',
    'metadata',
    'read',
    'create',
    'save',
    'delete',
    'trash',
    'restore',
  ] as const) {
    handle('docs-' + operation, async (id, ...args) => {
      const group = projectGroups.groups.find((g) => g.id === id);
      if (!group) throw new Error('Project not found');
      const result = await (async () => {
        if (group.hostId)
          return remote.call(group.hostId, 'project-docs', [
            id,
            await projectRoot(id),
            operation,
            args,
          ]);
        try {
          switch (operation) {
            case 'metadata':
              return await docs.metadata(id);
            case 'read':
              return await docs.get(id, args[0]);
            case 'list':
              return await docs.list(id);
            case 'create':
              return await docs.create(id, args[0], args[1]);
            case 'save':
              return await docs.save(id, args[0]);
            case 'delete':
              return await docs.delete(id, args[0], args[1]);
            case 'trash':
              return await docs.trash(id);
            case 'restore':
              return await docs.restore(id, args[0]);
          }
        } catch (error) {
          locations.invalidate(id, group.rootPath);
          throw error;
        }
      })();
      if (['create', 'save', 'delete', 'restore'].includes(operation)) {
        for (const window of windows)
          if (!window.isDestroyed())
            window.webContents.send('project-resource-changed', { groupId: id, resource: 'docs' });
      }
      return result;
    });
  }
  const sessionLibrary = new SessionLibrary(join(app.getPath('userData'), 'sessions.json'));
  try {
    await sessionLibrary.load();
  } catch (error: any) {
    dialog.showErrorBox('Cannot load session organization', error.message);
    app.quit();
    return;
  }
  try {
    const data = JSON.parse(await readFile(join(app.getPath('userData'), 'projects.json'), 'utf8'));
    if (
      !Array.isArray(data) ||
      !data.every(
        (p) =>
          typeof p.id === 'string' &&
          typeof p.path === 'string' &&
          typeof p.name === 'string' &&
          typeof p.notes === 'string' &&
          typeof p.favorite === 'boolean',
      )
    )
      throw new Error('Invalid project library');
    projects = data;
  } catch (error: any) {
    if (error.code !== 'ENOENT') {
      dialog.showErrorBox(
        'Cannot load project library',
        'Your project library could not be read. The app will close to avoid overwriting it. ' +
          error.message,
      );
      app.quit();
      return;
    }
  }
  async function toolDirectory(cwd: string) {
    if (typeof cwd !== 'string') throw new Error('Choose a repository first.');
    const canonical = await realpath(cwd);
    if (!projects.some((p) => !p.hostId && pathContains(p.path, canonical)))
      throw new Error('Add this session folder to a project before using repository tools.');
    if (!(await stat(canonical)).isDirectory()) throw new Error('Repository folder unavailable.');
    return canonical;
  }
  handle('pty-open', async (cwd, cols, rows) => pty.open(await toolDirectory(cwd), cols, rows));
  handle('pty-read', (id, cursor) => pty.read(id, cursor));
  handle('pty-write', (id, input) => pty.write(id, input));
  handle('pty-resize', (id, cols, rows) => pty.resize(id, cols, rows));
  handle('pty-close', (id) => pty.close(id));
  ipcMain.handle('browser-action', (event, id, action, value) => {
    const owner = [...windows].find(
      (w) => w.webContents === event.sender && event.senderFrame === w.webContents.mainFrame,
    );
    if (!owner) throw new Error('Untrusted caller');

    return previews.get(owner)!.action(id, action, value);
  });
  ipcMain.handle('browser-layout', (event, id, bounds) => {
    const owner = [...windows].find(
      (w) => w.webContents === event.sender && event.senderFrame === w.webContents.mainFrame,
    );
    if (!owner) throw new Error('Untrusted caller');

    return previews.get(owner)!.layout(id, bounds);
  });
  ipcMain.handle('browser-navigate', (event, id, action) => {
    const owner = [...windows].find(
      (w) => w.webContents === event.sender && event.senderFrame === w.webContents.mainFrame,
    );
    if (!owner) throw new Error('Untrusted caller');

    return previews.get(owner)!.navigate(id, action);
  });
  ipcMain.handle('browser-state', (event, id) => {
    const owner = [...windows].find(
      (w) => w.webContents === event.sender && event.senderFrame === w.webContents.mainFrame,
    );
    if (!owner) throw new Error('Untrusted caller');

    return previews.get(owner)!.state(id);
  });
  handle('terminal-start', async (cwd, command) =>
    terminal.start(await toolDirectory(cwd), command),
  );
  handle('terminal-status', (id) => terminal.status(id));
  handle('terminal-input', (id, value) => terminal.input(id, value));
  handle('terminal-stop', (id) => terminal.stop(id));
  handle('repository-diff', async (cwd) => repositoryDiff(await toolDirectory(cwd)));
  ipcMain.handle('browser-open', (event, url, id) => {
    const owner = [...windows].find(
      (w) => w.webContents === event.sender && event.senderFrame === w.webContents.mainFrame,
    );
    if (!owner) throw new Error('Untrusted caller');

    return previews.get(owner)!.open(url, id);
  });
  ipcMain.handle('browser-select', (event, id) => {
    const owner = [...windows].find(
      (w) => w.webContents === event.sender && event.senderFrame === w.webContents.mainFrame,
    );
    if (!owner) throw new Error('Untrusted caller');

    return previews.get(owner)!.select(id);
  });
  ipcMain.handle('browser-close', (event, id) => {
    const owner = [...windows].find(
      (w) => w.webContents === event.sender && event.senderFrame === w.webContents.mainFrame,
    );
    if (!owner) throw new Error('Untrusted caller');

    return previews.get(owner)!.close(id);
  });
  remote = new RemoteHosts(
    join(app.getPath('userData'), 'remote-hosts.json'),
    join(__dirname, 'remote-agent.cjs'),
    () => {
      for (const window of windows)
        if (!window.isDestroyed()) window.webContents.send('remote-hosts-changed');
    },
    (hostId, groupId, resource) => {
      if (!projectGroups.groups.some((group) => group.id === groupId && group.hostId === hostId))
        return;
      for (const window of windows)
        if (!window.isDestroyed())
          window.webContents.send('project-resource-changed', { groupId, resource });
    },
    (hostId, operation, parameters) =>
      verdictan!.remoteBroker.request(hostId, operation, parameters),
  );
  await remote.load();
  handle('remote-hosts', () => remote.list());
  handle('remote-add', (name, target) => remote.add(name, target));
  handle('remote-check', (id) => remote.check(id));
  handle('remote-install', (id) => remote.install(id));
  handle('remote-connect', (id) => remote.connect(id));
  handle('remote-disconnect', (id) => remote.disconnect(id));
  handle('remote-remove', async (id) => {
    if (projectGroups.groups.some((g) => g.hostId === id) || projects.some((p) => p.hostId === id))
      throw new Error('Move or remove the projects on this host first.');
    await remote.remove(id);
  });
  handle('directory-list', (path, hostId) =>
    hostId ? remote.call(hostId, 'directory-list', [path]) : listDirectory(path),
  );
  handle('remote-folders', (id, path) => remote.call(id, 'folders', [path]));
  async function addRemote(groupId: string, value: { name: string; path: string }) {
    const group = projectGroups.groups.find((g) => g.id === groupId);
    if (!group?.hostId) throw new Error('Choose a remote project.');
    let repo = projects.find((p) => p.hostId === group.hostId && p.path === value.path);
    if (!repo) {
      repo = {
        id: randomUUID(),
        name: value.name,
        path: value.path,
        hostId: group.hostId,
        notes: '',
        favorite: false,
        addedAt: new Date().toISOString(),
      };
      projects.push(repo);
      await save();
    }
    await projectGroups.move(repo.id, groupId);
    return repo;
  }
  handle('remote-add-repository', async (groupId, path, clone) => {
    const group = projectGroups.groups.find((g) => g.id === groupId);
    if (!group?.hostId) throw new Error('Choose a remote project.');
    return addRemote(
      groupId,
      await remote.call(
        group.hostId,
        clone ? 'clone' : 'validate',
        clone
          ? [
              clone,
              join(await projectRoot(groupId), 'repos', repositoryName(clone).replace('/', '--')),
            ]
          : [path],
      ),
    );
  });
  const remoteMethods = new Set<string>(sessionHostMethods);
  async function remoteHostCall(hostId: string, method: string, args: any[]) {
    if (!remoteMethods.has(method) || !Array.isArray(args))
      throw new Error('Unsupported remote operation');
    if (['ptyOpen', 'chatCreate', 'terminalStart', 'repositoryDiff'].includes(method)) {
      const path = args[0];
      if (
        typeof path !== 'string' ||
        !projects.some((p) => p.hostId === hostId && pathContains(p.path, path))
      )
        throw new Error('Add this remote folder to the project first.');
    }
    if (method === 'chatCreate' || method === 'chatStart')
      await remote.call(hostId, 'runtime-update', [
        'status',
        await runtimePolicy(),
        app.getVersion(),
        hostId,
        verdictan!.region,
      ]);
    let taskCwd: string | undefined;
    if (method === 'chatCreate') {
      taskCwd = args[0];
      args[5] = await memoryContext(args[0], args[2], hostId);
      args[2] = await projectPrompt(args[0], args[2], args[4], hostId);
    }
    if (method === 'chatStart') {
      const h = await remote.call(hostId, 'snapshot', []);
      const session = h.sessions.find((s: any) => s.id === args[1] && s.agent === args[0]);
      if (!session) throw new Error('Remote session not found');
      taskCwd = session.cwd;
      args[5] = await memoryContext(session.cwd, args[2], hostId);
      args[2] = await projectPrompt(session.cwd, args[2], args[4], hostId);
    }
    if (taskCwd) args[6] = await resolveManagedScope(taskCwd, args[4]?.taskId, hostId);
    if (taskCwd)
      return startAgentTask(taskCwd, hostId, args[4], () => remote.call(hostId, method, args));
    const result = await remote.call(hostId, method, args);
    return method === 'chatStatus' ? taskExecutions.observe(result, hostId) : result;
  }
  handle('remote-call', remoteHostCall);
  const github = new GitHubProjects(
    undefined,
    undefined,
    join(dataRoot, 'operations', 'github-writes'),
  );
  const trackers = new TrackerRegistry(
    [
      githubTracker(github, githubAuth, () =>
        shell.openExternal('https://github.com/login/device'),
      ),
    ],
    runtimeConfig().defaultTracker,
  );
  resolveManagedScope = async (cwd, taskId, hostId) => {
    const repo = projects
      .filter((p) => p.hostId === hostId && pathContains(p.path, cwd))
      .sort((a, b) => b.path.length - a.path.length)[0];
    const group =
      repo && projectGroups.groups.find((g) => g.repoIds.includes(repo.id) && g.hostId === hostId);
    const connection = group && trackerConnection(group);
    if (!connection) return undefined;
    const linked = trackers.linked(connection);
    const board = await linked.provider.board(linked.project);
    if (taskId && !board.items.some((item) => item.id === taskId))
      throw Error('Task is not available in this project.');
    return { projectId: board.project.id, ...(taskId ? { taskId } : {}) };
  };
  const taskExecutions = new TaskExecutions(join(dataRoot, 'operations', 'task-execution'), {
    status: async (runId, hostId) =>
      hostId ? remote.call(hostId, 'chatStatus', [runId]) : chatRunner.status(runId),
    identity: async () => {
      if (changingAccount) throw Error('Account is changing.');
      return (await verdictan!.setup.inspect()).key;
    },
    inspect: async (scope) => {
      const group = projectGroups.groups.find(
        (group) => group.id === scope.groupId && group.hostId === scope.hostId,
      );
      const connection = trackerConnection(group);
      if (!connection) throw new Error('The task project is no longer connected.');
      const { provider, project } = trackers.linked(connection);
      const board = await provider.board(project, true);
      const item = board.items.find((item) => item.id === scope.taskId);
      if (!item) throw new Error('The task was removed or archived. Refresh the project.');
      const target = connection.statusMapping?.progress;
      return {
        projectId: project.id,
        fieldId: board.statusField?.id,
        sourceStatus: item.statusId,
        targetStatus:
          target && board.statusField?.options.some((option) => option.id === target)
            ? target
            : undefined,
      };
    },
    write: async (scope, evidence) => {
      const connection = trackerConnection(
        projectGroups.groups.find(
          (group) => group.id === scope.groupId && group.hostId === scope.hostId,
        ),
      );
      if (
        !connection ||
        connection.project.id !== evidence.projectId ||
        connection.statusMapping?.progress !== evidence.targetStatus
      )
        throw new Error('The task workflow changed.');
      const { provider, project } = trackers.linked(connection);
      if (!provider.field || !evidence.fieldId || !evidence.targetStatus)
        throw new Error('Configure the project workflow first.');
      await provider.field(project, scope.taskId, evidence.fieldId, {
        singleSelectOptionId: evidence.targetStatus,
      });
    },
  });
  handle('task-usage-history', (groupId, taskId) => {
    const group = projectGroups.groups.find((group) => group.id === groupId);
    if (!group) throw Error('Project is unavailable.');
    return taskExecutions.history({ groupId, taskId, hostId: group.hostId });
  });
  function startAgentTask(
    cwd: string,
    hostId: string | undefined,
    options: ChatOptions | undefined,
    launch: () => Promise<import('../src/types').ChatRun>,
  ) {
    if (!options?.taskId) return launch();
    const repo = projects
      .filter((repo) => repo.hostId === hostId && pathContains(repo.path, cwd))
      .sort((a, b) => b.path.length - a.path.length)[0];
    const group = projectGroups.groups.find(
      (group) => group.hostId === hostId && repo && group.repoIds.includes(repo.id),
    );
    if (!group) throw new Error('The task checkout is not in this project.');
    return taskExecutions.start(
      options.operationId || randomUUID(),
      { groupId: group.id, taskId: options.taskId, hostId },
      launch,
    );
  }
  registerTrackerHandlers(handle, trackers, projectGroups);
  handle('github-auth-start', (force) => {
    github.invalidateBoards();
    return githubAuth.start(force === true);
  });
  handle('github-auth-status', () => githubAuth.inspect());
  handle('github-auth-cancel', (attemptId) => {
    github.invalidateBoards();
    return githubAuth.cancel(typeof attemptId === 'string' ? attemptId : '');
  });
  handle('github-auth-open', () => shell.openExternal('https://github.com/login/device'));
  // The saved appearance sets the native theme, so the page and the title bar overlay follow it.
  // The choice is also saved for the next start.
  handle('appearance', async (mode) => {
    if (!isAppearanceMode(mode)) throw new Error('Invalid appearance');
    if (nativeTheme.themeSource === mode) return;
    nativeTheme.themeSource = mode;
    await saveAppearanceMode(appearanceFile, mode);
  });
  handle('app-menu', () => {
    const window = BrowserWindow.getFocusedWindow() ?? win;
    if (window) Menu.getApplicationMenu()?.popup({ window, x: 8, y: 48 });
  });
  const githubProvider = trackers.get('github');
  function linked(id: string) {
    const connection = trackerConnection(projectGroups.groups.find((g) => g.id === id));
    if (!connection || connection.provider !== 'github')
      throw new Error('Connect a GitHub project first.');
    return connection.project;
  }
  handle('models', (agent) => modelOptions(agent, codexRoot));
  handle('github-link', async (id, url) => {
    if (!projectGroups.groups.some((g) => g.id === id)) throw new Error('Project not found');
    if (url === null) await projectGroups.link(id, undefined);
    else
      await projectGroups.connect(id, {
        provider: 'github',
        project: await githubProvider.resolve(url),
      });
  });
  handle('github-owners', () => githubProvider.owners());
  handle('github-projects', (owner) => githubProvider.projects(owner));
  handle('github-create-project', (owner, title) => githubProvider.createProject(owner, title));
  handle('github-board', (id) => githubProvider.board(linked(id)));
  handle('github-status', (id, item, option) => githubProvider.setStatus(linked(id), item, option));
  handle('github-draft', (id, title, body) => githubProvider.createItem(linked(id), title, body));
  handle('github-add-issue', (id, url) => githubProvider.importItem(linked(id), url));
  handle('memory-list', async (id) => {
    const group = projectGroups.groups.find((g) => g.id === id);
    if (!group) throw new Error('Project not found.');
    const root = await projectRoot(id);
    return group.hostId
      ? remote.call(group.hostId, 'project-memory', [id, root, 'list'])
      : readProjectMemory(root);
  });
  handle('project-resource-revision', async (id, kind) => {
    const group = projectGroups.groups.find((g) => g.id === id);
    if (!group) throw new Error('Project not found.');
    if (!['docs', 'memory'].includes(kind)) throw new Error('Invalid project resource.');
    const root = await projectRoot(id);
    return group.hostId
      ? remote.call(group.hostId, 'project-resource-revision', [root, kind])
      : resourceRevision(root, kind);
  });
  async function memoryContext(cwd: string, prompt: string, hostId?: string) {
    const repo = projects
      .filter((p) => p.hostId === hostId && pathContains(p.path, cwd))
      .sort((a, b) => b.path.length - a.path.length)[0];
    const group = projectGroups.groups.find(
      (g) => repo && g.hostId === hostId && g.repoIds.includes(repo.id),
    );
    if (!group) return undefined;
    return {
      root: await projectRoot(group.id),
      groupId: group.id,
      prompt,
      changed: hostId
        ? undefined
        : () => {
            for (const window of windows)
              if (!window.isDestroyed())
                window.webContents.send('project-resource-changed', {
                  groupId: group.id,
                  resource: 'memory',
                });
          },
    };
  }
  const projectPrompt = createProjectPrompt({
    memoryPath: async (group) => {
      const root = await projectRoot(group.id);
      return group.hostId
        ? remote.call(group.hostId, 'project-memory', [group.id, root, 'path'])
        : memoryDirectory(root);
    },
    projects: () => projects,
    groups: () => projectGroups.groups,
    trackers,
    searchDocs: async (group, query) =>
      group.hostId
        ? remote.call(group.hostId, 'project-docs', [
            group.id,
            await projectRoot(group.id),
            'search',
            [query],
          ])
        : docs.search(group.id, query),
  });
  const remoteSnapshots = new RemoteSnapshotCache<{ sessions: any[]; warnings: string[] }>(() => {
    for (const window of windows)
      if (!window.isDestroyed()) window.webContents.send('remote-hosts-changed');
  });
  handle('snapshot', async () => {
    const result = await history(codexRoot, claudeRoot);
    const remoteSessions: any[] = [];
    const warnings = [...result.warnings];
    const connected = remote.list().filter((host) => host.status === 'connected');
    remoteSnapshots.retain(new Set(connected.map((host) => host.id)));
    for (const host of connected) {
      const cached = remoteSnapshots.read(host.id, () => remote.call(host.id, 'snapshot', []));
      if (cached.value) {
        remoteSessions.push(
          ...cached.value.sessions.map((session: any) => ({
            ...session,
            id: host.id + '::' + session.id,
            hostId: host.id,
          })),
        );
        warnings.push(...cached.value.warnings.map((warning) => host.name + ': ' + warning));
      }
      if (cached.error) warnings.push(host.name + ': ' + cached.error);
    }
    return {
      projects,
      hosts: remote.list(),
      groups: projectGroups.groups,
      ...result,
      warnings,
      sessions: sessionLibrary
        .decorate([...result.sessions, ...remoteSessions])
        .filter((s) => !s.organization?.importHidden),
      platform: process.platform,
    };
  });
  handle('session-update', async (agent, id, changes) => {
    if (typeof id === 'string' && id.includes('::')) {
      const [hostId, providerId] = id.split('::');
      const scan = await remote.call(hostId, 'snapshot', []);
      if (!scan.sessions.some((s: any) => s.id === providerId && s.agent === agent))
        throw new Error('Remote session not found');
      await sessionLibrary.update(agent, id, changes);
      return;
    }
    const { sessions } = await history(codexRoot, claudeRoot);
    if (!sessions.some((s) => s.agent === agent && s.id === id))
      throw new Error('Session not found. Refresh history and try again.');
    await sessionLibrary.update(agent, id, changes);
  });
  async function sessionSource(agent: Agent, id: string) {
    if (!isAgent(agent) || typeof id !== 'string') throw new Error('Invalid session');
    const sources = new Map<string, string>();
    const result = await history(codexRoot, claudeRoot, sources);
    const session = result.sessions.find((s) => s.agent === agent && s.id === id);
    const path = sources.get(`${agent}:${id}`);
    if (!session || (!path && agent !== 'codex'))
      throw new Error('Session not found in local history. Refresh and try again.');
    return { session, path };
  }
  handle('transcript', async (agent, id) => {
    const { path } = await sessionSource(agent, id);
    if (agent === 'codex') {
      if (path) {
        try {
          return await readTranscript(path, agent);
        } catch (error: any) {
          if (error.code !== 'ENOENT') throw error;
        }
      }
      return codexTranscript(codexRoot, id);
    }
    return readTranscript(path!, agent);
  });
  const agentStarts = new AgentStarts(join(dataRoot, 'operations', 'agent-start'), (id) =>
    chatRunner.status(id),
  );
  async function createChat(
    projectId: string,
    agent: Agent,
    prompt: string,
    allowEdits: boolean,
    options?: ChatOptions,
  ) {
    if (!isAgent(agent)) throw new Error('Invalid agent');
    const p = project(projectId);
    if (p.hostId) throw new Error('Use the remote session connection for this repository.');
    if (!(await stat(p.path)).isDirectory())
      throw new Error('The project folder is no longer available.');
    if (options?.forkFrom) await sessionSource(agent, options.forkFrom);
    return startAgentTask(p.path, undefined, options, () =>
      agentStarts.run(
        options?.operationId,
        [projectId, agent, prompt, allowEdits, options],
        async () =>
          chatRunner.start(
            {
              id: randomUUID(),
              agent,
              cwd: p.path,
              title: 'New session',
              organization: options?.taskId ? { taskId: options.taskId } : undefined,
              updatedAt: new Date().toISOString(),
            },
            await projectPrompt(p.path, prompt, options),
            allowEdits,
            true,
            options?.model,
            options?.forkFrom,
            await memoryContext(p.path, prompt),
          ),
      ),
    );
  }
  handle('chat-create', createChat);
  handle('chat-start', async (agent, id, prompt, allowEdits, options?: ChatOptions) => {
    const { session } = await sessionSource(agent, id);
    if (!(await stat(session.cwd)).isDirectory())
      throw new Error('The session project folder is no longer available.');
    return startAgentTask(session.cwd, undefined, options, () =>
      agentStarts.run(options?.operationId, [agent, id, prompt, allowEdits, options], async () =>
        chatRunner.start(
          session,
          await projectPrompt(session.cwd, prompt, options),
          allowEdits,
          false,
          options?.model,
          undefined,
          await memoryContext(session.cwd, prompt),
        ),
      ),
    );
  });
  handle('chat-status', (id) => taskExecutions.observe(chatRunner.status(id)));
  handle('chat-stop', (id) => chatRunner.stop(id));
  handle('chat-approve', (id, approval, allow) => chatRunner.approve(id, approval, allow));
  handle('chat-respond', (id, request, answers) => chatRunner.respond(id, request, answers));
  const projectCreation = new ProjectCreation(join(dataRoot, 'operations', 'create-project'), {
    exists: (id) => projectGroups.groups.some((group) => group.id === id),
    resolve: async (request) => {
      if (
        request.hostId &&
        !remote.list().some((host) => host.id === request.hostId && host.status === 'connected')
      )
        throw new Error('Connect the remote host before creating this project.');
      return request.reference
        ? {
            provider: request.provider,
            project: await trackers.get(request.provider).resolve(request.reference),
          }
        : null;
    },
    prepare: (request) =>
      request.hostId
        ? remote.call(request.hostId, 'project-prepare', [request.id, request.root])
        : prepareProjectLocation(request.id, request.root, join(dataRoot, 'projects')),
    create: async (request, root, connection) => {
      await projectGroups.create(
        request.name,
        connection as Parameters<typeof projectGroups.create>[1],
        request.hostId,
        root,
        request.id,
      );
    },
    add: async (id, path) => {
      await addRepositories(id, [path]);
    },
  });
  handle('group-create-status', (id) => projectCreation.status(id));
  handle(
    'group-create',
    (
      name,
      reference = '',
      hostId,
      provider = trackers.defaultProvider,
      root?: string,
      operationId = randomUUID(),
      paths?: string[],
    ) => {
      if (reference !== null && typeof reference !== 'string')
        throw new Error('Choose a tracker project first.');
      if (typeof name !== 'string' || !name.trim() || name.length > 150)
        throw new Error('Project name must contain 1–150 characters.');
      return projectCreation.run({
        id: operationId,
        name,
        reference: reference || '',
        provider,
        ...(hostId ? { hostId } : {}),
        ...(root ? { root } : {}),
        ...(paths ? { paths } : {}),
      });
    },
  );
  handle('group-color', (id, color) => projectGroups.setColor(id, color));
  handle('group-update', (id, name) => projectGroups.update(id, name));
  handle('group-remove', async (id, withRepositories?: boolean) => {
    const group = projectGroups.groups.find((g) => g.id === id);
    if (!group) throw new Error('Project not found');
    const repoIds = new Set(group.repoIds);
    if (withRepositories === true) {
      // Remove only the library entries. The folders and files on disk stay.
      if (projects.some((p) => repoIds.has(p.id))) {
        projects = projects.filter((p) => !repoIds.has(p.id));
        await save();
      }
    } else if (projects.some((p) => repoIds.has(p.id)))
      throw new Error('Move this project’s repositories to another project before removing it.');
    return projectGroups.remove(id);
  });
  handle('repo-move', (id, groupId) => {
    if (!groupId) throw new Error('Choose a project for this repository.');
    const repo = project(id);
    const target = projectGroups.groups.find((g) => g.id === groupId);
    if (repo.hostId !== target?.hostId)
      throw new Error('Repositories must stay on their execution host.');
    return projectGroups.move(id, groupId);
  });
  handle('add', async (groupId?: string) => {
    if (!projectGroups.groups.some((g) => g.id === groupId))
      throw new Error('Choose a project before adding repositories.');
    if (projectGroups.groups.find((g) => g.id === groupId)?.hostId)
      throw new Error('Use the remote folder picker for this project.');
    const r = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'multiSelections'],
      buttonLabel: 'Add repositories',
    });
    if (!r.canceled) {
      for (const path of r.filePaths) {
        await addPath(path);
        await save();
        if (groupId) {
          const canonical = await realpath(path);
          await projectGroups.move(
            projects.find((p) => !p.hostId && p.path === canonical)!.id,
            groupId,
          );
        }
      }
    }
  });
  handle('choose-folder', async (title?: string, buttonLabel?: string) => {
    const text = (value: unknown) =>
      typeof value === 'string' && value.trim() ? value.trim().slice(0, 200) : undefined;
    const parent = BrowserWindow.getFocusedWindow() ?? win;
    const options = {
      title: text(title),
      buttonLabel: text(buttonLabel),
      properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[],
    };
    const result = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options);
    return result.canceled || !result.filePaths[0] ? null : result.filePaths[0];
  });
  handle('scan-repositories', async (path: string, hostId?: string) => {
    if (typeof path !== 'string' || !path) throw new Error('Choose a folder.');
    let scan;
    if (hostId) {
      if (!remote.list().some((h) => h.id === hostId)) throw new Error('Remote host not found');
      try {
        scan = await remote.call(hostId, 'scan-repositories', [path]);
      } catch (error: any) {
        if (error?.message === 'Unsupported remote operation')
          throw new Error('Reinstall the Kalkidan agent on this host to use this action.');
        throw error;
      }
    } else
      scan = await scanRepositories(
        path === '~' ? homedir() : path.startsWith('~/') ? join(homedir(), path.slice(2)) : path,
      );
    const library = new Set(
      projects.filter((p) => (p.hostId || '') === (hostId || '')).map((p) => p.path),
    );
    return {
      root: scan.root,
      rootIsRepository: scan.rootIsRepository,
      repositories: scan.repositories.map((repo: { path: string }) => ({
        ...repo,
        added: library.has(repo.path),
      })),
      truncated: scan.truncated,
    };
  });
  async function addRepositories(groupId: string, paths: string[]) {
    const group = projectGroups.groups.find((g) => g.id === groupId);
    if (!group) throw new Error('Choose a project before adding repositories.');
    if (!Array.isArray(paths) || paths.length > 500 || paths.some((p) => typeof p !== 'string'))
      throw new Error('Choose the folders to add.');
    const assigned = new Set(projectGroups.groups.flatMap((g) => g.repoIds));
    const moving: string[] = [];
    let firstError: Error | undefined;
    for (const path of new Set(paths)) {
      try {
        const value = group.hostId
          ? await remote.call(group.hostId, 'validate', [path])
          : { path: await realpath(path), name: '' };
        const existing = projects.find(
          (p) => (p.hostId || '') === (group.hostId || '') && p.path === value.path,
        );
        // A folder that is already in a project stays where it is.
        if (existing) {
          if (!assigned.has(existing.id)) moving.push(existing.id);
          continue;
        }
        if (group.hostId) {
          const repo: Project = {
            id: randomUUID(),
            name: value.name,
            path: value.path,
            hostId: group.hostId,
            notes: '',
            favorite: false,
            addedAt: new Date().toISOString(),
          };
          projects.push(repo);
          moving.push(repo.id);
        } else if (await addPath(value.path))
          moving.push(projects.find((p) => !p.hostId && p.path === value.path)!.id);
      } catch (error: any) {
        firstError ??= error instanceof Error ? error : new Error(String(error));
      }
    }
    if (!moving.length && firstError) throw firstError;
    await save();
    if (moving.length) await projectGroups.moveMany(moving, groupId);
    return { added: moving.length };
  }
  handle('add-repositories', addRepositories);
  handle('github-repositories', () => listRepositories());
  handle('repository-clone', async (name: string, groupId?: string) => {
    repositoryName(name);
    if (!projectGroups.groups.some((g) => g.id === groupId))
      throw new Error('Choose a project before adding repositories.');
    if (projectGroups.groups.find((g) => g.id === groupId)?.hostId)
      throw new Error('Choose a destination on the remote host.');
    const destination = join(await projectRoot(groupId!), 'repos', name.replace('/', '--'));
    await cloneRepository(name, destination);
    await addPath(destination);
    await save();
    if (groupId) {
      const canonical = await realpath(destination);
      try {
        await projectGroups.move(
          projects.find((p) => !p.hostId && p.path === canonical)!.id,
          groupId,
        );
      } catch {
        throw new Error(
          'Repository cloned and added to the library, but its project could not be saved. Assign it using Edit repository.',
        );
      }
    }
    return true;
  });
  handle('github-cli-check', githubCliCheck);
  handle('agent-installations', agentInstallations);
  const historyImporter = new HistoryImport({
    scan: () => history(codexRoot, claudeRoot),
    sources: { codex: codexRoot, claude: claudeRoot },
    projects: () => projects,
    groups: () => projectGroups.groups,
    library: sessionLibrary,
    add: async (path, groupId) => {
      await addPath(path);
      await save();
      const repo = projects.find((p) => !p.hostId && p.path === path)!;
      if (!projectGroups.groups.some((g) => g.repoIds.includes(repo.id)))
        await projectGroups.move(repo.id, groupId);
    },
  });
  handle('history-preview', () => historyImporter.preview());
  handle('history-import', (request) => historyImporter.apply(request));
  handle('discover', async (groupId: string) => {
    if (!projectGroups.groups.some((g) => g.id === groupId))
      throw new Error('Choose a project before discovering repositories.');
    const targetGroup = projectGroups.groups.find((g) => g.id === groupId)!;
    if (targetGroup.hostId) {
      const scan = await remote.call(targetGroup.hostId, 'snapshot', []);
      let added = 0;
      for (const cwd of new Set<string>(scan.sessions.map((s: any) => s.cwd))) {
        try {
          const value = await remote.call(targetGroup.hostId, 'validate', [cwd]);
          if (!projects.some((p) => p.hostId === targetGroup.hostId && p.path === value.path)) {
            await addRemote(groupId, value);
            added++;
          }
        } catch {}
      }
      return { added };
    }
    const { sessions } = await history(codexRoot, claudeRoot);
    const paths = new Set(sessions.map((s) => s.cwd));
    try {
      const config = TOML.parse(await readFile(join(codexRoot, 'config.toml'), 'utf8'));
      for (const path of Object.keys(config.projects || {})) paths.add(path);
    } catch {
      /* History remains available without a config. */
    }
    let added = 0;
    for (const path of paths) {
      let canonical: string;
      try {
        canonical = await realpath(path);
        if (await addPath(canonical)) added++;
      } catch {
        continue; /* Ignore missing historical folders. */
      }
      const repo = projects.find((p) => !p.hostId && p.path === canonical)!;
      // Preserve existing assignments; recover older unassigned library entries.
      if (!projectGroups.groups.some((g) => g.repoIds.includes(repo.id))) {
        await save();
        await projectGroups.move(repo.id, groupId);
      }
    }
    await save();
    return { added };
  });
  handle('update', async (id, changes) => {
    const p = project(id);
    if (typeof changes.name === 'string') {
      if (!changes.name.trim() || changes.name.length > 150)
        throw new Error('Name must contain 1–150 characters');
      p.name = changes.name.trim();
    }
    if (typeof changes.notes === 'string') {
      if (changes.notes.length > 20000) throw new Error('Notes are too long');
      p.notes = changes.notes;
    }
    if (typeof changes.favorite === 'boolean') p.favorite = changes.favorite;
    await save();
  });
  handle('remove', async (id) => {
    project(id);
    await projectGroups.move(id, null);
    projects = projects.filter((p) => p.id !== id);
    await save();
  });
  async function repositoryGit(id: string) {
    const p = project(id);
    if (p.hostId) return remote.call(p.hostId, 'git', [p.path]);
    await stat(p.path);
    try {
      await git(p.path, ['rev-parse', '--show-toplevel']);
    } catch (error: any) {
      if (error.stderr?.includes('not a git repository')) return null;
      throw error;
    }
    const [branch, status, trees] = await Promise.all([
      git(p.path, ['rev-parse', '--abbrev-ref', 'HEAD']).catch(() => 'unborn'),
      git(p.path, ['status', '--porcelain', '-z']),
      git(p.path, ['worktree', 'list', '--porcelain']),
    ]);
    const entries = status.split('\0');
    let changes = 0;
    for (let i = 0; i < entries.length; i++) {
      if (entries[i]) {
        changes++;
        if (/^[RC]|^.[RC]/.test(entries[i])) i++;
      }
    }
    return { branch: branch.trim(), changes, worktrees: parseWorktrees(trees) };
  }
  handle('git', repositoryGit);
  const repositoryRequests = new Map<string, Promise<any>>();
  handle('repository-snapshot', (id: string) => {
    if (repositoryRequests.has(id)) return repositoryRequests.get(id);
    const task = (async () => {
      const repo = project(id);
      if (repo.hostId) {
        const value = await remote.call(repo.hostId, 'repository-snapshot', [repo.path]);
        return {
          ...value,
          sessions: sessionLibrary
            .decorate(
              value.sessions.map((s: Session) => ({
                ...s,
                id: repo.hostId + '::' + s.id,
                hostId: repo.hostId,
              })),
            )
            .filter((s: Session) => !s.organization?.importHidden),
        };
      }
      const [info, scan] = await Promise.all([repositoryGit(id), history(codexRoot, claudeRoot)]);
      const roots = [
        repo.path,
        ...(info?.worktrees.map((tree: { path: string }) => tree.path) || []),
      ];
      return {
        git: info,
        warnings: scan.warnings,
        sessions: sessionLibrary
          .decorate(scan.sessions.filter((s) => roots.some((root) => pathContains(root, s.cwd))))
          .filter((s) => !s.organization?.importHidden),
      };
    })();
    repositoryRequests.set(id, task);
    const clean = () => {
      if (repositoryRequests.get(id) === task) repositoryRequests.delete(id);
    };
    task.then(clean, clean);
    return task;
  });
  handle('reveal', async (id) => {
    if (project(id).hostId)
      throw new Error('Remote files stay on the host. Use repository tools to inspect them.');
    const result = await shell.openPath(project(id).path);
    if (result) throw new Error(result);
  });
  handle('launch', async (id: string, agent: 'terminal') => {
    if (agent !== 'terminal') throw new Error('Agent sessions must be opened inside Kalkidan.');
    const p = project(id);
    if (p.hostId) throw new Error('Use the in-app Terminal for remote repositories.');
    await stat(p.path);
    if (process.platform !== 'darwin') {
      const binary = process.platform === 'win32' ? 'powershell.exe' : 'x-terminal-emulator';
      const child = spawn(binary, process.platform === 'win32' ? ['-NoExit'] : [], {
        cwd: p.path,
        detached: true,
        stdio: 'ignore',
      });
      await new Promise<void>((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
      child.unref();
      return;
    }
    const command = launchCommand(p.path, agent);
    await exec(
      '/usr/bin/osascript',
      [
        '-e',
        `tell application "Terminal"\nactivate\ndo script ${JSON.stringify(command)}\nend tell`,
      ],
      { timeout: 15000 },
    );
  });
  const worktreeCreation = new WorktreeCreation(join(dataRoot, 'operations', 'worktree'), git);
  async function createWorktree(id: string, branch: string, operationId?: string) {
    const p = project(id);
    if (p.hostId) {
      const group = projectGroups.groups.find((g) => g.repoIds.includes(id));
      if (!group) throw new Error('Assign this repository to a project first.');
      return addRemote(
        group.id,
        await remote.call(p.hostId, 'worktree', [
          p.path,
          branch,
          await projectRoot(group.id),
          operationId,
        ]),
      );
    }
    if (!projectGroups.groups.some((g) => g.repoIds.includes(id)))
      throw new Error('Assign this repository to a project before creating a worktree.');
    if (typeof branch !== 'string' || branch.startsWith('-') || branch.length > 200)
      throw new Error('Enter a valid new branch name');
    await git(p.path, ['check-ref-format', '--branch', branch]);
    const owner = projectGroups.groups.find((g) => g.repoIds.includes(id))!;
    const destination = await worktreeCreation.run(
      p.path,
      branch,
      await projectRoot(owner.id),
      operationId,
    );
    await addPath(destination);
    await save();
    const canonicalWorktree = await realpath(destination);
    const group = projectGroups.groups.find((g) => g.repoIds.includes(id));
    if (group) {
      const canonical = await realpath(destination);
      await projectGroups.move(
        projects.find((repo) => !repo.hostId && repo.path === canonical)!.id,
        group.id,
      );
    }
    return project(projects.find((repo) => !repo.hostId && repo.path === canonicalWorktree)!.id);
  }
  handle('worktree', async (id, branch) => !!(await createWorktree(id, branch)));
  /** Runs a Git operation on the execution host of the repository. */
  async function hostGit<T>(id: string, method: string, args: unknown[], local: () => Promise<T>) {
    const p = project(id);
    if (!p.hostId) return local();
    try {
      return (await remote.call(p.hostId, method, [p.path, ...args])) as T;
    } catch (error: any) {
      if (error?.message === 'Unsupported remote operation')
        throw new Error('Reinstall the Kalkidan agent on this host to use this action.');
      throw error;
    }
  }
  handle('worktree-remove', async (id, force) => {
    const p = project(id);
    const folderExists = p.hostId || existsSync(p.path);
    // A missing folder has nothing to remove. Remove only the repository entry.
    if (folderExists)
      await hostGit(id, 'worktree-remove', [force === true], () =>
        chatRunner.withCheckoutIdle(p.path, () => removeWorktree(p.path, force === true)),
      );
    await projectGroups.move(id, null);
    projects = projects.filter((repo) => repo.id !== id);
    await save();
  });
  handle('working-status', (id) =>
    hostGit(id, 'working-status', [], () => workingStatus(project(id).path)),
  );
  const publishOperations = new PublishOperations(
    join(dataRoot, 'operations', 'publish'),
    publishEffects(() => executable('gh')),
  );
  handle('git-publish', (id, request) =>
    hostGit(id, 'git-publish', [request], () =>
      chatRunner.withCheckoutIdle(project(id).path, () =>
        publishOperations.run(project(id).path, request),
      ),
    ),
  );
  handle('git-publish-status', (id, operationId) =>
    hostGit(id, 'git-publish-status', [operationId], () =>
      publishOperations.status(project(id).path, operationId),
    ),
  );
  handle('git-commit', (id, message, files?: string[]) =>
    hostGit(id, 'git-commit', [message, files], () => gitCommit(project(id).path, message, files)),
  );
  handle('working-files', (id) =>
    hostGit(id, 'working-files', [], () => workingFiles(project(id).path)),
  );
  handle('git-switch-new-branch', (id, branch) =>
    hostGit(id, 'git-switch-new-branch', [branch], () =>
      gitSwitchNewBranch(project(id).path, branch),
    ),
  );
  handle('worktree-preview', async (id, branch) => {
    const owner = projectGroups.groups.find((g) => g.repoIds.includes(id));
    if (!owner) throw new Error('Assign this repository to a project before creating a worktree.');
    const root = await projectRoot(owner.id);
    return hostGit(id, 'worktree-preview', [branch, root], () =>
      worktreePreview(project(id).path, branch, root, existsSync),
    );
  });
  handle('git-pull-request', (id, title, body) =>
    hostGit(id, 'git-pull-request', [title, body], () =>
      gitPullRequest(project(id).path, title, body, () => executable('gh')),
    ),
  );
  handle('task-worktree', createWorktree);
  const projectServices = new ProjectServices(
    join(dataRoot, 'operations', 'project-services'),
    async (groupId) => {
      const group = projectGroups.groups.find((group) => group.id === groupId);
      if (!group) throw Error('Project is unavailable.');
      const connection = trackerConnection(group);
      if (!connection) throw Error('Connect this project to GitHub.');
      const linked = trackers.linked(connection);
      const board = await linked.provider.board(linked.project);
      const { client, account } = await verdictan!.setup.inspect();
      return {
        client,
        accountKey: identityKey(account.apiUrl, account.organizationId!, account.userId!),
        organizationId: account.organizationId!,
        actorId: account.userId!,
        projectId: board.project.id,
      };
    },
  );
  handle('project-services-status', (id) => projectServices.status(id));
  handle('project-services-request', (id, request) => {
    if (request?.operation === 'context.publish')
      throw Error('Select a project document to publish verified source content.');
    if (
      request?.operation === 'admin.template.apply' &&
      (chatRunner.runningCount() > 0 || remote.list().some((host) => host.status === 'connected'))
    )
      throw Error(
        'Stop active local work and disconnect remote hosts before applying an installation template.',
      );
    return projectServices.request(id, request);
  });
  handle(
    'project-publish-doc',
    async (groupId, docId, docRevision, operationId, expectedRevision) => {
      const group = projectGroups.groups.find((group) => group.id === groupId);
      if (!group) throw Error('Project is unavailable.');
      const doc = group.hostId
        ? await remote.call(group.hostId, 'project-docs', [
            groupId,
            await projectRoot(groupId),
            'read',
            [docId],
          ])
        : await docs.get(groupId, docId);
      if (doc.revision !== docRevision)
        throw Error('Document changed. Review the current page before publishing.');
      return projectServices.request(groupId, {
        operation: 'context.publish',
        fields: {
          operation_id: operationId,
          expected_revision: expectedRevision,
          source: { kind: 'project-doc', id: doc.id, revision: doc.revision, title: doc.title },
          content: doc.markdown,
        },
      });
    },
  );
  const dispatch = new ParallelDispatch(join(dataRoot, 'operations', 'parallel-dispatch'), {
    identity: async () => {
      if (changingAccount) throw Error('Account is changing.');
      return (await verdictan!.setup.inspect()).key;
    },
    inspect: async (request, task) => {
      const group = projectGroups.groups.find((g) => g.id === request.groupId);
      if (!group || !group.repoIds.includes(task.repositoryId))
        throw Error('Select a repository in this project.');
      const repo = project(task.repositoryId);
      if (repo.hostId !== group.hostId) throw Error('Repository host differs from the project.');
      const scan = repo.hostId
        ? await remote.call(repo.hostId, 'snapshot', [])
        : await history(codexRoot, claudeRoot);
      const sessions = sessionLibrary.decorate(
        scan.sessions.map((session: Session) =>
          repo.hostId
            ? { ...session, id: `${repo.hostId}::${session.id}`, hostId: repo.hostId }
            : session,
        ),
      );
      if (
        sessions.some(
          (session: Session) =>
            session.organization?.taskId === task.taskId && !session.organization?.archived,
        )
      )
        throw Error(
          'This task already has a linked session. Review or archive that session before dispatch.',
        );
      const connection = trackerConnection(group);
      if (!connection) throw Error('Connect this project to GitHub.');
      const { provider, project: reference } = trackers.linked(connection);
      const board = await provider.board(reference, true);
      const item = board.items.find((i) => i.id === task.taskId);
      if (
        !item ||
        item.kind !== 'Issue' ||
        !item.body.trim() ||
        !item.repository ||
        !provider.content ||
        !provider.relations
      )
        throw Error('Task requires an accessible issue, repository, and description.');
      const content = await provider.content(reference, task.taskId);
      const relations = await provider.relations(reference, task.taskId);
      if (content.state !== 'OPEN' || relations.blockedBy.some((i) => i.state !== 'CLOSED'))
        throw Error('Resolve task blockers before dispatch.');
      const remotes = repo.hostId
        ? await remote.call(repo.hostId, 'git-remote-url', [repo.path])
        : await git(repo.path, ['remote', 'get-url', 'origin']);
      const repository = String(remotes)
        .trim()
        .replace(/^git@github.com:/, '')
        .replace(/^https:\/\/github.com\//, '')
        .replace(/\.git$/, '');
      if (repository.toLowerCase() !== item.repository.toLowerCase())
        throw Error('Repository origin does not match the task.');
      const prompt = `Implement GitHub task: ${item.title}\n\n${item.body}\n\nVerify the changes. Do not publish or merge without a separate request.`;
      return {
        title: item.title,
        prompt,
        revision: createHash('sha256')
          .update(
            JSON.stringify([item.id, item.title, item.body, item.repository, relations.revision]),
          )
          .digest('hex'),
      };
    },
    checkout: async (id, branch, operation) => (await createWorktree(id, branch, operation)).id,
    launch: async (request, row) => {
      const repo = project(row.checkoutId!);
      const options = { operationId: row.operationId, taskId: row.taskId };
      const run = repo.hostId
        ? await remoteHostCall(repo.hostId, 'chatCreate', [
            repo.path,
            request.agent,
            row.prompt,
            true,
            options,
          ])
        : await createChat(repo.id, request.agent, row.prompt, true, options);
      const id = repo.hostId ? `${repo.hostId}::${run.sessionId}` : run.sessionId;
      await sessionLibrary
        .update(request.agent, id, { taskId: row.taskId, title: row.title })
        .catch(() => {});
      return run;
    },
    reconcile: async (_request, row) => {
      if (!row.checkoutId) return { canRelease: true };
      const repo = project(row.checkoutId);
      if (repo.hostId)
        return remote.call(repo.hostId, 'dispatch-recover', [repo.path, row.operationId]);
      const run = await agentStarts.inspect(row.operationId);
      let canRelease = false;
      if (run?.status !== 'running')
        await chatRunner.withCheckoutIdle(repo.path, async () => {
          canRelease = true;
        });
      return { run, canRelease };
    },
    status: (request, row) => {
      const repo = project(row.checkoutId!);
      return repo.hostId
        ? remoteHostCall(repo.hostId, 'chatStatus', [row.runId])
        : taskExecutions.observe(chatRunner.status(row.runId!));
    },
    stop: async (request, row) => {
      const repo = project(row.checkoutId!);
      return repo.hostId
        ? remoteHostCall(repo.hostId, 'chatStop', [row.runId])
        : chatRunner.stop(row.runId!);
    },
  });
  handle('dispatch-reconcile', (id, taskId, release) => dispatch.reconcile(id, taskId, release));
  stopDispatch = () => {
    dispatch.suspend();
    taskExecutions.suspend();
  };
  restoreDispatch = () => {
    void dispatch.restore().catch(() => {});
    void taskExecutions.restore().catch(() => {});
  };
  restoreDispatch();
  handle('dispatch-prepare', (request) => dispatch.prepare(request));
  handle('dispatch-start', (id) => dispatch.start(id));
  handle('dispatch-status', (id) => dispatch.status(id));
  handle('dispatch-cancel', (id) => dispatch.cancel(id));
  app.on('before-quit', () => {
    dispatch.close();
    taskExecutions.suspend();
  });

  // The window chrome follows the light or dark appearance of the system.
  // The title bar overlay (chrome) uses --navigation from src/styles/theme.css.
  function windowColors() {
    return nativeTheme.shouldUseDarkColors
      ? { chrome: '#15191c', symbol: '#e1e4e7', background: '#101316' }
      : { chrome: '#f6f8fa', symbol: '#1f2328', background: '#fbfbfc' };
  }
  function titleBarOverlay() {
    const colors = windowColors();
    return { color: colors.chrome, symbolColor: colors.symbol, height: 48 };
  }
  nativeTheme.on('updated', () => {
    for (const window of windows) {
      if (window.isDestroyed()) continue;
      window.setBackgroundColor(windowColors().background);
      if (process.platform !== 'darwin') window.setTitleBarOverlay(titleBarOverlay());
    }
  });
  // Electron can release a notification that has no reference, and then a click does nothing.
  const notifications = new Set<Notification>();
  ipcMain.handle(
    'notify',
    (event, input: { title?: unknown; body?: unknown; target?: unknown }) => {
      const owner = [...windows].find(
        (w) => w.webContents === event.sender && event.senderFrame === w.webContents.mainFrame,
      );
      if (!owner) throw new Error('Untrusted caller');

      if (
        typeof input?.title !== 'string' ||
        typeof input.body !== 'string' ||
        typeof input.target !== 'string'
      )
        throw new Error('Invalid notification');
      // The user can already see the window. Show nothing.
      if (BrowserWindow.getFocusedWindow() || !Notification.isSupported()) return;
      const notification = new Notification({
        title: input.title.slice(0, 200),
        body: input.body.slice(0, 1000),
      });
      const target = input.target.slice(0, 2000);
      notifications.add(notification);
      const release = () => notifications.delete(notification);
      notification.on('click', () => {
        release();
        if (owner.isDestroyed()) return;
        if (owner.isMinimized()) owner.restore();
        owner.show();
        owner.focus();
        owner.webContents.send('notification-click', target);
      });
      notification.on('close', release);
      notification.on('failed', release);
      notification.show();
    },
  );
  handle('badge-count', (count: number) => {
    const value = Number.isInteger(count) ? Math.min(Math.max(count, 0), 9999) : 0;
    // macOS shows the count on the Dock icon. Some Linux desktops (Unity) show it too.
    // Windows has no count badge, so it shows nothing there.
    if (process.platform !== 'win32') app.setBadgeCount(value);
  });
  function openExternalLink(value: string) {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return;
    }
    if (['http:', 'https:', 'mailto:'].includes(url.protocol)) void shell.openExternal(url.href);
  }
  function createWindow(session?: Session) {
    stopAgentsConfirmed = false;
    const window = new BrowserWindow({
      width: 1360,
      height: 900,
      minWidth: 980,
      minHeight: 680,
      title: 'Kalkidan',
      icon: appIcon,
      backgroundColor: windowColors().background,
      ...(process.platform === 'darwin'
        ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 22, y: 17 } }
        : { titleBarStyle: 'hidden', titleBarOverlay: titleBarOverlay() }),
      webPreferences: {
        preload: join(__dirname, 'preload.cjs'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    win = window;
    windows.add(window);
    owned.set(window, []);
    previews.set(window, new AnnotationBrowser(() => window, browserProfile));
    const base = dev
      ? 'http://127.0.0.1:5173'
      : pathToFileURL(join(__dirname, '../dist/index.html')).href;
    const url = withScheme(
      base,
      nativeTheme.shouldUseDarkColors,
      session
        ? '#session=' + encodeURIComponent(JSON.stringify({ agent: session.agent, id: session.id }))
        : '',
    );
    // The app never opens its own windows from links. Web and mail links open in the
    // default application of the system.
    window.webContents.setWindowOpenHandler(({ url }) => {
      openExternalLink(url);
      return { action: 'deny' };
    });
    window.webContents.on('will-navigate', (event, target) => {
      event.preventDefault();
      // Navigation inside the app stays blocked and does not open a browser.
      if (!target.startsWith(base)) openExternalLink(target);
    });
    // Agents stop when the last window closes. Ask first.
    window.on('close', (event) => {
      if (windows.size === 1 && !confirmStopAgents(window)) event.preventDefault();
    });
    // macOS hides the window buttons in full screen, so the title bar can use that space.
    window.on('enter-full-screen', () => window.webContents.send('full-screen', true));
    window.on('leave-full-screen', () => window.webContents.send('full-screen', false));
    // A reload or a window that opens in full screen must also know the current state.
    window.webContents.on('did-finish-load', () =>
      window.webContents.send('full-screen', window.isFullScreen()),
    );
    window.on('closed', () => {
      owned.get(window)?.forEach(stopResource);
      owned.delete(window);
      previews.get(window)?.closeAll();
      previews.delete(window);
      windows.delete(window);
      if (windows.size) win = [...windows][0];
      else {
        chatRunner.stopAll();
        githubAuth.cancel();
        terminal.stopAll();
        pty.closeAll();
        remote?.close();
      }
    });
    void window.loadURL(url);
  }
  async function resolveSession(value: Session): Promise<Session> {
    if (value.hostId) {
      const scan = await remote.call(value.hostId, 'snapshot', []);
      const id = value.id.replace(value.hostId + '::', '');
      const found = scan.sessions.find((s: Session) => s.agent === value.agent && s.id === id);
      if (!found) throw new Error('Remote session not found');
      return { ...found, hostId: value.hostId, id: value.id };
    }
    return (await sessionSource(value.agent, value.id)).session;
  }
  async function transcriptFor(session: Session) {
    if (session.hostId)
      return remote.call(session.hostId, 'transcript', [
        session.agent,
        session.id.replace(session.hostId + '::', ''),
      ]);
    const { path } = await sessionSource(session.agent, session.id);
    if (path) return readTranscript(path, session.agent);
    return codexTranscript(codexRoot, session.id);
  }
  handle('session-action', async (value: Session, action: string) => {
    const session = await resolveSession(value);
    session.title = value.organization?.title || value.title || session.title;
    if (action === 'window') {
      createWindow(session);
      return 'Opened in a new window';
    }
    if (action === 'copy-id' || action === 'copy-path') {
      clipboard.writeText(action === 'copy-id' ? session.id : session.cwd);
      return 'Copied';
    }
    if (['finder', 'vscode', 'cursor'].includes(action)) {
      if (session.hostId) throw new Error('Use the in-app SSH tools for remote folders.');
      if (action === 'finder') {
        const error = await shell.openPath(session.cwd);
        if (error) throw new Error(error);
      } else if (process.platform !== 'darwin') {
        await shell.openExternal(
          `${action === 'vscode' ? 'vscode' : 'cursor'}://file/${session.cwd.replaceAll('\\', '/')}`,
        );
      } else
        await exec(
          'open',
          ['-a', action === 'vscode' ? 'Visual Studio Code' : 'Cursor', session.cwd],
          { timeout: 10000 },
        );
      return 'Opened';
    }
    if (!['markdown', 'html', 'copy-transcript'].includes(action))
      throw new Error('Unknown session action');
    const transcript = await transcriptFor(session);
    const text =
      '# ' +
      session.title +
      '\n\n' +
      (transcript.truncated
        ? '> Earlier messages were omitted by the transcript reader.\n\n'
        : '') +
      transcript.messages
        .map(
          (m: any) =>
            '## ' +
            (m.role === 'user' ? 'You' : session.agent === 'codex' ? 'Codex' : 'Claude Code') +
            '\n\n' +
            m.text,
        )
        .join('\n\n');
    if (action === 'copy-transcript') {
      clipboard.writeText(text);
      return 'Session copied';
    }
    const htmlEscape = (v: string) =>
      v.replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
      );
    const content =
      action === 'markdown'
        ? text
        : '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>' +
          htmlEscape(session.title) +
          '</title><style>body{font:16px/1.7 system-ui;max-width:860px;margin:48px auto;padding:0 24px}pre{font:inherit;white-space:pre-wrap;overflow-wrap:anywhere}</style><body><pre>' +
          htmlEscape(text) +
          '</pre></body></html>';
    const extension = action === 'markdown' ? 'md' : 'html';
    const result = await dialog.showSaveDialog(win, {
      title: 'Export session',
      defaultPath:
        (session.title.replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 90) || 'session') + '.' + extension,
      filters: [{ name: action === 'markdown' ? 'Markdown' : 'HTML', extensions: [extension] }],
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, content, { mode: 0o600 });
    return 'Session exported';
  });
  // Menu commands go to the renderer of the focused window.
  const command = (name: MenuCommand) => () => {
    const focused = BrowserWindow.getFocusedWindow() ?? win;
    if (focused && !focused.isDestroyed()) focused.webContents.send('menu-command', name);
  };
  const template = appMenuTemplate({
    mac: process.platform === 'darwin',
    packaged: app.isPackaged,
    appName: app.name,
    command,
    openExternal: (url) => void shell.openExternal(url),
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  createWindow();
  void remote.connectSaved();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
