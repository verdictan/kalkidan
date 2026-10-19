import { spawn } from 'node:child_process';
import { pathContains } from './platform';
import { githubCliCheck } from './github-cli-check';
import { listDirectory } from './storage/directory-list';
import {
  ProjectLocationCache,
  prepareProjectLocation,
  legacyDocs,
  importLegacyDocs,
} from './storage/project-location';
import { ProjectDocs } from './storage/project-docs';
import { dataDirectory } from './storage/data-directory';
import { HistoryImport } from './history-import';
import { isAgent } from '../src/config/agents';
import { createProjectPrompt } from './projects/prompt';
import { sessionHostMethods } from '../src/domain/host';
import { writeJSON } from './storage/atomic-json';
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
  type MenuItemConstructorOptions,
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
import { history } from './history';
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
  app.getPath('appData'),
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
const chatRunner = createAgentRuntimes();
const githubAuth = new GitHubAuth(() => shell.openExternal('https://github.com/login/device'));
let remote: RemoteHosts;
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
    return Promise.resolve(fn(...args)).then((result) => {
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
        if (windows.has(owner)) owned.get(owner)!.push(resource);
        else stopResource(resource);
      }
      return result;
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
app.whenReady().then(async () => {
  if (!app.isPackaged && existsSync(appIcon)) app.dock?.setIcon(appIcon);
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
  );
  await remote.load();
  handle('remote-hosts', () => remote.list());
  handle('remote-add', (name, target) => remote.add(name, target));
  handle('remote-check', (id) => remote.check(id));
  handle('remote-install', (id) => remote.install(id));
  handle('remote-connect', (id) => remote.connect(id));
  handle('remote-disconnect', (id) => remote.disconnect(id));
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
  handle('remote-call', async (hostId, method, args) => {
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
    if (method === 'chatCreate') args[2] = await projectPrompt(args[0], args[2], args[4], hostId);
    if (method === 'chatStart') {
      const h = await remote.call(hostId, 'snapshot', []);
      const session = h.sessions.find((s: any) => s.id === args[1] && s.agent === args[0]);
      if (!session) throw new Error('Remote session not found');
      args[2] = await projectPrompt(session.cwd, args[2], args[4], hostId);
    }
    return remote.call(hostId, method, args);
  });
  const github = new GitHubProjects();
  const trackers = new TrackerRegistry(
    [
      githubTracker(github, githubAuth, () =>
        shell.openExternal('https://github.com/login/device'),
      ),
    ],
    runtimeConfig().defaultTracker,
  );
  registerTrackerHandlers(handle, trackers, projectGroups);
  handle('github-auth-start', (force) => githubAuth.start(force === true));
  handle('github-auth-status', () => githubAuth.inspect());
  handle('github-auth-cancel', () => githubAuth.cancel());
  handle('github-auth-open', () => shell.openExternal('https://github.com/login/device'));
  // The saved appearance sets the native theme, so the page and the title bar overlay follow it.
  handle('appearance', (mode) => {
    if (mode !== 'system' && mode !== 'light' && mode !== 'dark')
      throw new Error('Invalid appearance');
    nativeTheme.themeSource = mode;
  });
  handle('app-menu', () => {
    const window = BrowserWindow.getFocusedWindow() ?? win;
    if (window) Menu.getApplicationMenu()?.popup({ window, x: 8, y: 48 });
  });
  function linked(id: string) {
    const group = projectGroups.groups.find((g) => g.id === id);
    if (!group?.github) throw new Error('Connect a GitHub project first.');
    return group.github;
  }
  handle('models', (agent) => modelOptions(agent, codexRoot));
  handle('github-link', async (id, url) => {
    if (!projectGroups.groups.some((g) => g.id === id)) throw new Error('Project not found');
    await projectGroups.link(id, url === null ? undefined : await github.resolve(url));
  });
  handle('github-owners', () => github.owners());
  handle('github-projects', (owner) => github.list(owner));
  handle('github-create-project', (owner, title) => github.create(owner, title));
  handle('github-board', (id) => github.board(linked(id)));
  handle('github-status', (id, item, option) => github.setStatus(linked(id), item, option));
  handle('github-draft', (id, title, body) => github.addDraft(linked(id), title, body));
  handle('github-add-issue', (id, url) => github.addIssue(linked(id), url));
  const projectPrompt = createProjectPrompt({
    projects: () => projects,
    groups: () => projectGroups.groups,
    trackers,
  });
  handle('snapshot', async () => {
    const result = await history(codexRoot, claudeRoot);
    const remoteSessions: any[] = [];
    const warnings = [...result.warnings];
    await Promise.all(
      remote
        .list()
        .filter((h) => h.status === 'connected')
        .map(async (host) => {
          try {
            const scan = await remote.call(host.id, 'snapshot', []);
            remoteSessions.push(
              ...scan.sessions.map((session: any) => ({
                ...session,
                id: host.id + '::' + session.id,
                hostId: host.id,
              })),
            );
            warnings.push(...scan.warnings.map((w: string) => host.name + ': ' + w));
          } catch (e: any) {
            warnings.push(host.name + ': ' + e.message);
          }
        }),
    );
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
  handle('chat-create', async (projectId, agent, prompt, allowEdits, options?: ChatOptions) => {
    if (!isAgent(agent)) throw new Error('Invalid agent');
    const p = project(projectId);
    if (p.hostId) throw new Error('Use the remote session connection for this repository.');
    if (!(await stat(p.path)).isDirectory())
      throw new Error('The project folder is no longer available.');
    if (options?.forkFrom) await sessionSource(agent, options.forkFrom);
    return chatRunner.start(
      {
        id: randomUUID(),
        agent,
        cwd: p.path,
        title: 'New session',
        updatedAt: new Date().toISOString(),
      },
      await projectPrompt(p.path, prompt, options),
      allowEdits,
      true,
      options?.model,
      options?.forkFrom,
    );
  });
  handle('chat-start', async (agent, id, prompt, allowEdits, options?: ChatOptions) => {
    const { session } = await sessionSource(agent, id);
    if (!(await stat(session.cwd)).isDirectory())
      throw new Error('The session project folder is no longer available.');
    return chatRunner.start(
      session,
      await projectPrompt(session.cwd, prompt, options),
      allowEdits,
      false,
      options?.model,
    );
  });
  handle('chat-status', (id) => chatRunner.status(id));
  handle('chat-stop', (id) => chatRunner.stop(id));
  handle('chat-approve', (id, approval, allow) => chatRunner.approve(id, approval, allow));
  handle(
    'group-create',
    async (name, url, hostId, provider = trackers.defaultProvider, requestedRoot?: string) => {
      if (typeof url !== 'string' || !url.trim())
        throw new Error('Choose a tracker project first.');
      if (hostId && !remote.list().some((h) => h.id === hostId && h.status === 'connected'))
        throw new Error('Connect the remote host before creating this project.');
      if (typeof name !== 'string' || !name.trim() || name.trim().length > 150)
        throw new Error('Project name must contain 1–150 characters');
      const connection = { provider, project: await trackers.get(provider).resolve(url) };
      const id = randomUUID();
      const root = hostId
        ? await remote.call(hostId, 'project-prepare', [id, requestedRoot])
        : await prepareProjectLocation(id, requestedRoot, join(dataRoot, 'projects'));
      return projectGroups.create(name, connection, hostId, root, id);
    },
  );
  handle('group-color', (id, color) => projectGroups.setColor(id, color));
  handle('group-update', (id, name) => projectGroups.update(id, name));
  handle('group-remove', (id) => {
    if (
      projectGroups.groups
        .find((g) => g.id === id)
        ?.repoIds.some((repoId) => projects.some((p) => p.id === repoId))
    )
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
  async function createWorktree(id: string, branch: string) {
    const p = project(id);
    if (p.hostId) {
      const group = projectGroups.groups.find((g) => g.repoIds.includes(id));
      if (!group) throw new Error('Assign this repository to a project first.');
      return addRemote(
        group.id,
        await remote.call(p.hostId, 'worktree', [p.path, branch, await projectRoot(group.id)]),
      );
    }
    if (!projectGroups.groups.some((g) => g.repoIds.includes(id)))
      throw new Error('Assign this repository to a project before creating a worktree.');
    if (typeof branch !== 'string' || branch.startsWith('-') || branch.length > 200)
      throw new Error('Enter a valid new branch name');
    await git(p.path, ['check-ref-format', '--branch', branch]);
    const owner = projectGroups.groups.find((g) => g.repoIds.includes(id))!;
    const destination = join(
      await projectRoot(owner.id),
      'worktrees',
      basename(p.path) + '-' + branch.replaceAll('/', '-') + '-' + randomUUID().slice(0, 8),
    );
    await git(p.path, ['worktree', 'add', '-b', branch, '--', destination]);
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
  handle('task-worktree', createWorktree);
  // The window chrome follows the light or dark appearance of the system.
  function windowColors() {
    return nativeTheme.shouldUseDarkColors
      ? { chrome: '#22272b', symbol: '#e1e4e7', background: '#101316' }
      : { chrome: '#eef0f2', symbol: '#1f2328', background: '#ffffff' };
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
    const url =
      base +
      (session
        ? '#session=' + encodeURIComponent(JSON.stringify({ agent: session.agent, id: session.id }))
        : '');
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
  const mac = process.platform === 'darwin';
  const separator: MenuItemConstructorOptions = { type: 'separator' };
  const template: MenuItemConstructorOptions[] = [
    ...(mac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              separator,
              { label: 'Settings…', accelerator: 'Cmd+,', click: command('settings') },
              separator,
              { role: 'services' },
              separator,
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              separator,
              { role: 'quit' },
            ],
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Project', accelerator: 'CmdOrCtrl+N', click: command('new-project') },
        // The renderer handles this key at once, so typed text does not reach the focused field.
        {
          label: 'Search',
          accelerator: 'CmdOrCtrl+K',
          registerAccelerator: false,
          click: command('search'),
        },
        separator,
        ...(mac
          ? [{ role: 'close' } satisfies MenuItemConstructorOptions]
          : ([
              { label: 'Settings', accelerator: 'Ctrl+,', click: command('settings') },
              separator,
              { role: 'close' },
              { role: 'quit' },
            ] satisfies MenuItemConstructorOptions[])),
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { label: 'Toggle Sidebar', accelerator: 'CmdOrCtrl+B', click: command('toggle-sidebar') },
        separator,
        ...(app.isPackaged
          ? []
          : ([
              { role: 'reload' },
              { role: 'toggleDevTools' },
              separator,
            ] satisfies MenuItemConstructorOptions[])),
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        separator,
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Go',
      submenu: [
        { label: 'Back', accelerator: 'CmdOrCtrl+[', click: command('back') },
        { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: command('forward') },
      ],
    },
    { role: 'windowMenu' },
    {
      role: 'help',
      submenu: [
        {
          label: 'Kalkidan User Guide',
          click: () =>
            void shell.openExternal(
              'https://github.com/verdictan/kalkidan/blob/main/docs/user-guide.md',
            ),
        },
        {
          label: 'Report an Issue',
          click: () => void shell.openExternal('https://github.com/verdictan/kalkidan/issues'),
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
