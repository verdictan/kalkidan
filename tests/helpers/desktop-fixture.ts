import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import { backendLoader } from './backend-loader';

export async function desktopFixture(platform = 'linux', failure = '') {
  const calls: any[][] = [],
    windows: any[] = [],
    handlers = new Map<string, Function>();
  const state = {
    directory: true,
    cancel: false,
    running: 0,
    choice: 1,
    openError: '',
    remoteError: '',
    docsError: false,
    source: true,
    transcriptError: '',
    gitError: '',
    branchError: false,
    destroyed: false,
    moveError: false,
    missingPath: '',
    configError: false,
    stopError: false,
  };
  let sequence = 0;
  const record =
    (name: string, result: any = undefined) =>
    (...args: any[]) => {
      calls.push([name, ...args]);
      return typeof result === 'function' ? result(...args) : result;
    };
  const asyncRecord =
    (name: string, result: any = undefined) =>
    async (...args: any[]) =>
      record(name, result)(...args);
  const sessions = [
    { id: 's', agent: 'codex', cwd: '/repo', title: 'Session', updatedAt: '' },
    { id: 'c', agent: 'claude', cwd: '/repo', title: 'Claude', updatedAt: '' },
  ];
  const groups: any[] = [
    {
      id: 'g',
      name: 'Local',
      repoIds: ['r'],
      rootPath: '/project',
      github: { id: 'P', owner: 'test', number: 1 },
    },
    { id: 'remote', name: 'Remote', repoIds: ['rr'], hostId: 'host', rootPath: '/remote-project' },
    { id: 'empty', name: 'Empty', repoIds: [] },
  ];
  const initialProjects = [
    { id: 'r', name: 'Repo', path: '/repo', notes: '', favorite: false },
    { id: 'rr', name: 'Remote repo', path: '/remote', notes: '', favorite: false, hostId: 'host' },
  ];
  let ready!: Promise<unknown>;
  const app = Object.assign(new EventEmitter(), {
    isPackaged: false,
    name: 'Kalkidan',
    setName: record('name'),
    setPath: record('setPath'),
    getPath: () => '/fixture',
    getVersion: () => '0.1.0',
    quit: record('quit'),
    whenReady: () => ({
      then: (fn: Function) => {
        ready = Promise.resolve().then(() => fn());
        return ready;
      },
    }),
    dock: { setIcon: record('icon') },
  });
  const theme = Object.assign(new EventEmitter(), {
    themeSource: 'system',
    shouldUseDarkColors: true,
  });
  class Window extends EventEmitter {
    webContents = Object.assign(new EventEmitter(), {
      mainFrame: {},
      send: record('send'),
      setWindowOpenHandler: (fn: Function) => {
        this.popup = fn;
      },
      focus: record('focus'),
    });
    popup!: Function;
    contentView = { addChildView: record('addView'), removeChildView: record('removeView') };
    constructor(public options: any) {
      super();
      windows.push(this);
    }
    static getFocusedWindow() {
      return windows.at(-1);
    }
    static getAllWindows() {
      return windows.filter((w) => !w.closed);
    }
    loadURL = asyncRecord('loadURL');
    isDestroyed = () => state.destroyed;
    isFullScreen = () => false;
    setBackgroundColor = record('background');
    setTitleBarOverlay = record('overlay');
  }
  class Groups {
    groups = groups;
    load = async () => {
      if (failure === 'groups') throw Error('broken groups');
    };
    setRoot = async (id: string, root: string) => {
      groups.find((g) => g.id === id).rootPath = root;
    };
    move = async (id: string, groupId: string | null) => {
      if (state.moveError) throw Error('cannot save group');
      for (const group of groups) group.repoIds = group.repoIds.filter((r: string) => r !== id);
      if (groupId) groups.find((g) => g.id === groupId)?.repoIds.push(id);
    };
    create = asyncRecord('createGroup', (...args: any[]) => args);
    setColor = asyncRecord('color');
    update = asyncRecord('updateGroup');
    remove = asyncRecord('removeGroup');
    link = asyncRecord('link');
    connect = asyncRecord('connect');
  }
  class Locations {
    get = async (_id: string, root?: string) => {
      if (failure === 'roots') throw Error('bad root');
      return root || '/new-project';
    };
    invalidate = record('invalidate');
  }
  class Docs {
    constructor(_root: string, valid: Function, folder: Function) {
      calls.push(['docsValid', valid('g'), valid('unknown')]);
      void folder('g');
    }
    metadata = asyncRecord('metadata');
    get = asyncRecord('readDoc');
    create = asyncRecord('createDoc');
    save = asyncRecord('saveDoc');
    delete = asyncRecord('deleteDoc');
    trash = asyncRecord('trash');
    restore = asyncRecord('restore');
    search = asyncRecord('search', []);
    taskLinks = asyncRecord('taskLinks', {});
    setTaskLinks = asyncRecord('setTaskLinks');
    list = async () => {
      if (state.docsError) throw Error('docs failed');
      return [];
    };
  }
  class Library {
    load = async () => {
      if (failure === 'library') throw Error('broken library');
    };
    decorate = (s: any[]) => s;
    update = asyncRecord('sessionUpdate');
  }
  class Profile {
    load = asyncRecord('profileLoad');
  }
  class Preview {
    action = record('browserAction');
    layout = record('layout');
    navigate = record('navigate');
    state = record('browserState');
    open = record('browserOpen');
    select = record('select');
    close = record('browserClose');
    closeAll = record('browserCloseAll');
  }
  class Pty {
    open = record('ptyOpen', { id: 'pty' });
    read = record('ptyRead');
    write = record('ptyWrite');
    resize = record('ptyResize');
    close = record('ptyClose');
    closeAll = record('ptyCloseAll');
  }
  class Terminal {
    start = record('terminalStart', { id: 'terminal' });
    status = record('terminalStatus');
    input = record('terminalInput');
    stop = record('terminalStop');
    stopAll = record('terminalStopAll');
  }
  const hosts = [{ id: 'host', name: 'Host', status: 'connected' }];
  class Remote {
    load = asyncRecord('remoteLoad');
    connectSaved = asyncRecord('remoteAutoConnect');
    list = () => hosts;
    busy = () => false;
    add = asyncRecord('remoteAdd');
    check = asyncRecord('remoteCheck');
    install = asyncRecord('remoteInstall');
    connect = asyncRecord('remoteConnect');
    disconnect = record('remoteDisconnect');
    remove = asyncRecord('remoteRemove');
    close = record('remoteClose');
    onRunEnded = record('remoteRunEnded');
    onConnected = record('remoteConnected');
    agentInstallations = asyncRecord('remoteAgentInstallations');
    chooseAgentExecutable = asyncRecord('remoteAgentChoice');
    call = async (host: string, method: string, args: any[]) => {
      calls.push(['remote', host, method, args]);
      if (state.remoteError) throw Error(state.remoteError);
      if (method === 'transcript') return { messages: [] };
      if (method === 'snapshot')
        return { sessions: [{ ...sessions[0], cwd: '/remote' }], warnings: ['warning'] };
      if (method === 'project-prepare') return '/remote-new';
      if (method === 'git') return { branch: 'main', changes: 0, worktrees: [] };
      if (method === 'repository-snapshot') return { sessions: [sessions[0]], git: null };
      if (['validate', 'clone', 'worktree'].includes(method))
        return { path: '/remote/new', name: 'new' };
      if (['chatCreate', 'chatStart', 'ptyOpen', 'terminalStart'].includes(method))
        return { id: method };
      return [];
    };
  }
  class GithubAuth {
    constructor(private open: Function) {}
    start = async () => {
      calls.push(['authStart']);
      await this.open();
    };
    inspect = asyncRecord('authInspect');
    cancel = record('authCancel');
  }
  class Github {
    withWrite = (_project: unknown, action: () => Promise<unknown>) => action();
    withAccount = (action: () => Promise<unknown>) => action();
    invalidateBoards = record('invalidateBoards');
    mutations = { field: asyncRecord('field'), item: asyncRecord('itemAction') };
    writeField = (project: unknown, ...args: unknown[]) =>
      (this.mutations.field as Function)(project, ...args);
    revertMutation = asyncRecord('revertMutation', 'revert-id');
    owners = asyncRecord('owners');
    list = asyncRecord('githubList');
    resolve = asyncRecord('resolve', { id: 'P', owner: 'test', number: 1 });
    create = asyncRecord('githubCreate');
    board = asyncRecord('board');
    setStatus = asyncRecord('setStatus');
    addDraft = asyncRecord('addDraft');
    addIssue = asyncRecord('addIssue');
  }
  const runner = {
    start: asyncRecord('chatStart', { id: 'chat' }),
    status: record('chatStatus'),
    stop: record('chatStop', () => {
      if (state.stopError) throw Error('already released');
    }),
    approve: record('approve'),
    stopAll: record('chatStopAll'),
    dispose: record('dispose'),
    runningCount: () => state.running,
    withCheckoutIdle: async (_path: string, action: () => Promise<unknown>) => action(),
  };
  class Importer {
    constructor(private options: any) {}
    preview = record('historyPreview');
    apply = async (request: any) => {
      calls.push(['historyApply', request]);
      if (request.path) await this.options.add(request.path, request.groupId);
    };
  }
  const stubs: Record<string, unknown> = {
    electron: {
      app,
      BrowserWindow: Window,
      nativeTheme: theme,
      powerMonitor: new EventEmitter(),
      ipcMain: { handle: (name: string, fn: Function) => handlers.set(name, fn) },
      dialog: {
        showErrorBox: record('errorBox'),
        showMessageBoxSync: () => state.choice,
        showMessageBox: async (...args: any[]) => {
          calls.push(['messageBox', args.at(-1)]);
          return { response: state.choice };
        },
        showOpenDialog: async () => ({ canceled: state.cancel, filePaths: ['/added'] }),
        showSaveDialog: async () => ({ canceled: state.cancel, filePath: '/export' }),
      },
      shell: { openExternal: asyncRecord('external'), openPath: async () => state.openError },
      Menu: {
        setApplicationMenu: record('menu'),
        buildFromTemplate: (t: any) => t,
        getApplicationMenu: () => ({ popup: record('menuPopup') }),
      },
      clipboard: { writeText: record('clipboard') },
    },
    'node:fs': { existsSync: () => true },
    'node:fs/promises': {
      readFile: async (path: string) => {
        if (path.endsWith('verdictan-region.json')) return JSON.stringify({ region: 'eu' });
        if (path.endsWith('projects.json')) {
          if (failure === 'projects') return 'bad';
          if (failure === 'invalidProjects') return '{}';
          return JSON.stringify(initialProjects);
        }
        if (state.configError) throw Error('missing config');
        return '[projects."/discovered"]';
      },
      writeFile: asyncRecord('writeFile'),
      rm: asyncRecord('rm'),
      stat: async () => ({ isDirectory: () => state.directory }),
      realpath: async (path: string) => {
        if (state.missingPath === path) throw Error('missing folder');
        return path;
      },
    },
    'node:os': { homedir: () => '/fixture' },
    'node:crypto': {
      randomUUID: () => `id-${++sequence}`,
      createHash: () => {
        const hash = { update: () => hash, digest: () => 'f'.repeat(64) };
        return hash;
      },
    },
    'node:child_process': {
      spawn: () => {
        const child = Object.assign(new EventEmitter(), { unref: record('unref') });
        queueMicrotask(() => child.emit('spawn'));
        return child;
      },
    },
  };
  const stub = (name: string, exports: unknown) =>
    (stubs[resolve('electron', name + '.ts')] = exports);
  stub('verdictan/service', {
    runtimePolicyReader: () => async () => null,
    createVerdictanServices: () => ({
      installer: {
        check: asyncRecord('runtimeCheck'),
        start: asyncRecord('runtimeStart'),
        install: asyncRecord('runtimeInstall'),
        cancel: record('runtimeCancel'),
      },
      managed: { stopAll: asyncRecord('managedStopAll') },
      account: {
        status: record('verdictanStatus'),
        check: asyncRecord('verdictanCheck'),
        authorize: asyncRecord('verdictanAuthorize'),
        cancel: record('verdictanCancel'),
        renew: asyncRecord('verdictanRenew'),
        logout: asyncRecord('verdictanLogout'),
        dispose: record('verdictanDispose'),
        reopenBrowser: asyncRecord('verdictanReopenBrowser'),
        autoRenew: asyncRecord('verdictanAutoRenew'),
      },
      setup: {
        status: asyncRecord('verdictanSetup'),
        select: asyncRecord('verdictanSelect'),
        applyRecommended: asyncRecord('verdictanApplyRecommended'),
      },
      launch: { prepare: asyncRecord('managedPrepare') },
      remoteBroker: { reset: record('brokerReset'), request: asyncRecord('brokerRequest') },
    }),
  });
  stub('storage/data-directory', { dataDirectory: () => '/fixture' });
  stub('storage/appearance', {
    isAppearanceMode: (m: string) => ['system', 'light', 'dark'].includes(m),
    readAppearanceMode: async () => 'system',
    saveAppearanceMode: asyncRecord('appearance'),
    withScheme: (url: string, _dark: boolean, hash = '') => url + hash,
  });
  stub('project-groups', { ProjectGroups: Groups });
  stub('operations/create-project', {
    ProjectCreation: class {
      constructor(
        _root: string,
        private effects: any,
      ) {}
      status = async () => null;
      async run(request: any) {
        const connection = await this.effects.resolve(request);
        const root = await this.effects.prepare(request);
        await this.effects.create(request, root, connection);
        for (const path of request.paths || []) await this.effects.add(request.id, path);
        return request.id;
      }
    },
  });
  stub('storage/project-location', {
    ProjectLocationCache: Locations,
    prepareProjectLocation: asyncRecord('prepare', '/project-new'),
    legacyDocs: async () => [],
    importLegacyDocs: asyncRecord('importDocs'),
  });
  stub('storage/project-docs', { ProjectDocs: Docs });
  stub('storage/resource-revision', { resourceRevision: asyncRecord('revision', 'revision-1') });
  stub('session-library', { SessionLibrary: Library });
  stub('storage/atomic-json', { writeJSON: asyncRecord('writeJSON') });
  stub('storage/project-memory', {
    memoryDirectory: async () => '/project/memory',
    readProjectMemory: async () => ({ pages: [], limited: false }),
  });
  stub('browser-profile', { BrowserProfile: Profile });
  stub('annotation-browser', { AnnotationBrowser: Preview });
  stub('pty-terminal', { PtyTerminal: Pty });
  stub('conversation-tools', { CommandTerminal: Terminal, repositoryDiff: asyncRecord('diff') });
  stub('remote-hosts', { RemoteHosts: Remote });
  stub('github-auth', { GitHubAuth: GithubAuth });
  stub('github-projects', { GitHubProjects: Github });
  stub('operations/worktree', {
    WorktreeCreation: class {
      async run(cwd: string, branch: string, root: string) {
        return `${root}/worktrees/${cwd.split('/').pop()}-${branch}`;
      }
    },
  });
  stub('operations/task-execution', {
    TaskExecutions: class {
      async restore() {}
      suspend() {}
      start(_id: string, _scope: unknown, launch: () => Promise<unknown>) {
        return launch();
      }
      observe(run: unknown) {
        return run;
      }
    },
  });
  stub('operations/agent-start', {
    AgentStarts: class {
      run(_id: string, _identity: unknown, start: () => Promise<unknown>) {
        return start();
      }
    },
  });
  stub('agents/runtime', { createAgentRuntimes: () => runner });
  stub('history-import', { HistoryImport: Importer });
  stub('history', {
    historyWithManaged: async (
      _root: string,
      _c: string,
      _a: string,
      sources?: Map<string, string>,
    ) => {
      if (state.source) {
        sources?.set('codex:s', '/s');
        sources?.set('claude:c', '/c');
      }
      return { sessions, warnings: [] };
    },
  });
  stub('transcript', {
    readTranscript: async () => {
      if (state.transcriptError)
        throw Object.assign(Error('transcript'), { code: state.transcriptError });
      return {
        messages: [
          { role: 'user', text: '<test>' },
          { role: 'assistant', text: 'answer' },
        ],
        truncated: true,
      };
    },
  });
  stub('codex-store', { codexTranscript: async () => ({ messages: [] }) });
  stub('storage/directory-list', { listDirectory: asyncRecord('directory') });
  stub('projects/mention-files', {
    listMentionFiles: asyncRecord('mentionFiles', { files: ['a.ts'], truncated: false }),
    readMentionFile: asyncRecord('mentionFileRead', (cwd: string, path: string) => ({
      path,
      size: 3,
      content: `${cwd}:${path}`,
    })),
  });
  stub('github-cli-check', { githubCliCheck: asyncRecord('cli') });
  stub('agent-installations', {
    agentInstallations: asyncRecord('installs'),
    chooseAgentExecutable: asyncRecord('agentChoice'),
  });
  stub('models', { modelOptions: asyncRecord('models') });
  stub('chat', { executable: asyncRecord('executable') });
  stub('core', {
    exec: async (_cmd: string, args: string[]) => {
      if (state.gitError) throw Object.assign(Error(state.gitError), { stderr: state.gitError });
      if (args.includes('--abbrev-ref') && state.branchError) throw Error('unborn');
      return { stdout: args.includes('-z') ? 'R  new\0old\0 M file\0' : 'main\n' };
    },
    parseWorktrees: () => [{ path: '/tree' }],
    launchCommand: () => 'cd /repo',
  });
  stub('git-working', {
    worktreeFolder: (root: string, repo: string, branch: string) =>
      `${root}/worktrees/${repo}-${branch}`,
    ...Object.fromEntries(
      ['gitCommit', 'gitPullRequest', 'pullRequestStatus', 'removeWorktree', 'workingStatus'].map(
        (n) => [n, asyncRecord(n)],
      ),
    ),
  });
  stub('repositories', {
    repositoryName: (name: string) => name,
    listRepositories: asyncRecord('repositories'),
    cloneRepository: asyncRecord('clone'),
  });
  if (failure === 'remoteMigration') {
    delete groups[1].rootPath;
  }
  if (failure === 'light') theme.shouldUseDarkColors = false;
  if (failure === 'remoteMigration')
    stub('storage/project-location', {
      ProjectLocationCache: Locations,
      legacyDocs: async () => [{ id: 'page', markdown: 'Legacy' }],
      importLegacyDocs: asyncRecord('importDocs'),
    });
  backendLoader(stubs, {
    process: {
      env: {},
      platform,
      argv: ['node', ...(failure === 'dev' ? ['--dev'] : [])],
      on: () => {},
    },
    console,
  })(resolve('electron/main.ts'));
  await ready;
  function invoke(name: string, ...args: any[]) {
    const w = windows[0];
    return Promise.resolve().then(() =>
      handlers.get(name)!({ sender: w.webContents, senderFrame: w.webContents.mainFrame }, ...args),
    );
  }
  return { calls, windows, handlers, state, groups, sessions, app, theme, invoke };
}
