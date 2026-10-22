import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import { backendLoader } from './helpers/backend-loader';

const source = (name: string) => resolve('electron', name + '.ts');
test('remote RPC validates envelopes, dispatches supported operations, reports failures, and shuts down', async () => {
  const input = new EventEmitter(),
    processEvents = new EventEmitter();
  const outputs: any[] = [],
    calls: any[] = [];
  let rootFail = false,
    branchFail = false,
    directory = true,
    transcriptFail = false;
  const record =
    (name: string) =>
    (...args: any[]) => {
      calls.push([name, ...args]);
      return { operation: name };
    };
  class Locations {
    get = async (_id: string, root: string) => root;
    invalidate = record('invalidate');
  }
  class Docs {
    search = record('search');
    metadata = record('metadata');
    get = record('get');
    list = record('list');
    create = record('create');
    save = record('save');
    delete = record('delete');
    trash = record('trash');
    restore = record('restore');
    constructor(_root: string, valid: Function, folder: Function) {
      assert.equal(valid('project'), true);
      assert.equal(valid('other'), false);
      void folder();
    }
  }
  class Pty {
    open = record('ptyOpen');
    read = record('ptyRead');
    write = record('ptyWrite');
    resize = record('ptyResize');
    close = record('ptyClose');
    closeAll = record('ptyCloseAll');
    list = () => [{ id: 'shell', cwd: '/repo' }];
  }
  class Terminal {
    start = record('terminalStart');
    status = record('terminalStatus');
    input = record('terminalInput');
    stop = record('terminalStop');
    stopAll = record('terminalStopAll');
  }
  const sessions = [
    { agent: 'codex', id: 'codex', cwd: '/repo', title: 'Code' },
    { agent: 'claude', id: 'claude', cwd: '/repo/child', title: 'Claude' },
    { agent: 'codex', id: 'outside', cwd: '/other', title: 'Other' },
  ];
  const processStub = Object.assign(processEvents, {
    env: {},
    platform: 'linux',
    arch: 'x64',
    version: 'v24.0.0',
    stdin: {},
    stdout: { write: (text: string) => outputs.push(JSON.parse(text)) },
    exit: record('exit'),
  });
  let stopTimer: Function = () => {};
  backendLoader(
    {
      'node:readline': { createInterface: () => input },
      'node:fs/promises': {
        realpath: async (path: string) => path,
        stat: async () => ({ isDirectory: () => directory }),
      },
      'node:os': { homedir: () => '/fixture' },
      'node:crypto': { randomUUID: () => 'fixed-uuid' },
      [source('storage/project-location')]: {
        ProjectLocationCache: Locations,
        prepareProjectLocation: record('prepare'),
        importLegacyDocs: record('import'),
      },
      [source('storage/project-memory')]: {
        memoryDirectory: record('memoryPath'),
        readProjectMemory: record('memoryList'),
      },
      [source('storage/project-docs')]: { ProjectDocs: Docs },
      [source('storage/resource-revision')]: { resourceRevision: record('revision') },
      [source('pty-terminal')]: { PtyTerminal: Pty },
      [source('operations/worktree')]: {
        WorktreeCreation: class {
          async run(cwd: string, branch: string, root: string) {
            return `${root}/worktrees/${cwd.split('/').pop()}-${branch}`;
          }
        },
      },
      [source('operations/agent-start')]: {
        AgentStarts: class {
          run(_id: string, _identity: unknown, start: () => Promise<unknown>) {
            return start();
          }
        },
      },
      [source('agents/runtime')]: {
        createAgentRuntimes: () => ({
          withCheckoutIdle: async (_path: string, action: () => Promise<unknown>) => action(),
          start: record('chatStart'),
          status: record('chatStatus'),
          running: () => [{ id: 'run-1', agent: 'codex', sessionId: 'codex', create: false }],
          stop: record('chatStop'),
          approve: record('chatApprove'),
          respond: record('chatRespond'),
          dispose: record('dispose'),
        }),
      },
      [source('conversation-tools')]: { CommandTerminal: Terminal, repositoryDiff: record('diff') },
      [source('models')]: { modelOptions: record('models') },
      [source('chat')]: { executable: record('executable') },
      [source('agent-installations')]: {
        agentInstallations: async () => [{ agent: 'claude', status: 'installed' }],
        chooseAgentExecutable: record('chooseAgentExecutable'),
      },
      [source('git-working')]: {
        worktreeFolder: (root: string, repo: string, branch: string) =>
          `${root}/worktrees/${repo}-${branch}`,
        ...Object.fromEntries(
          ['gitCommit', 'gitPullRequest', 'removeWorktree', 'workingStatus'].map((key) => [
            key,
            record(key),
          ]),
        ),
      },
      [source('history')]: {
        historyWithManaged: async (
          _root: string,
          _c: string,
          _a: string,
          sources?: Map<string, string>,
        ) => {
          sources?.set('codex:codex', '/codex.jsonl');
          sources?.set('claude:claude', '/claude.jsonl');
          return { sessions, warnings: [] };
        },
      },
      [source('transcript')]: {
        readTranscript: async () => {
          if (transcriptFail) throw Error('missing');
          return { messages: [] };
        },
      },
      [source('codex-store')]: { codexTranscript: record('codexTranscript') },
      [source('storage/directory-list')]: {
        listDirectory: async () => ({
          path: '/repo',
          parent: '/',
          entries: [
            { name: 'src', path: '/repo/src', kind: 'directory' },
            { name: '.git', path: '/repo/.git', kind: 'directory' },
            { name: 'file', kind: 'file' },
          ],
        }),
      },
      [source('core')]: {
        parseWorktrees: () => [{ path: '/tree' }],
        exec: async (_cmd: string, args: string[]) => {
          if (args.includes('--show-toplevel') && rootFail) throw Error('not git');
          if (args.includes('--abbrev-ref') && branchFail) throw Error('unborn');
          return {
            stdout:
              args.includes('--porcelain') && args.includes('-z')
                ? 'R  new\0old\0 M file\0'
                : 'main\n',
          };
        },
      },
    },
    {
      process: processStub,
      setTimeout: (fn: Function) => {
        stopTimer = fn;
        return { unref() {} };
      },
    },
  )(source('remote-agent'));
  let sequence = 0;
  async function request(method: string, args: unknown[] = []) {
    const id = String(++sequence);
    input.emit('line', JSON.stringify({ id, method, args }));
    // Drain only promises, without sleeps or wall-clock polling.
    for (let i = 0; i < 30 && !outputs.some((row) => row.id === id); i++) await Promise.resolve();
    const row = outputs.find((row) => row.id === id);
    assert.ok(row, method + ' must respond');
    return row;
  }
  input.emit('line', 'bad JSON');
  input.emit('line', '{}');
  input.emit('line', 'x'.repeat(16000001));
  assert.equal(outputs.length, 0);
  assert.equal((await request('hello')).result.protocol, 5);
  assert.match((await request('unsupported')).error, /Unsupported/);
  // The agent check and the chosen program run on the host, with the files of the host.
  assert.deepEqual((await request('agent-installations')).result, [
    { agent: 'claude', status: 'installed' },
  ]);
  await request('agent-executable-choose', ['claude', '/home/u/.local/bin/claude']);
  assert.deepEqual(calls.at(-1), ['chooseAgentExecutable', 'claude', '/home/u/.local/bin/claude']);
  assert.match((await request('validate', [null])).error, /Choose/);
  directory = false;
  assert.match((await request('validate', ['/file'])).error, /Not a directory/);
  directory = true;
  assert.equal((await request('validate', ['~'])).result.path, '/fixture');
  assert.equal((await request('validate', ['~/src'])).result.path, '/fixture/src');
  assert.equal((await request('folders')).result.folders.length, 1);
  assert.ok((await request('directory-list', ['/repo'])).result);
  assert.match((await request('clone', ['invalid', '/repo'])).error, /owner/);
  assert.equal((await request('clone', ['owner/repo', '/clone'])).result.path, '/clone');
  assert.equal((await request('git', ['/repo'])).result.changes, 2);
  branchFail = true;
  assert.equal((await request('git', ['/repo'])).result.branch, 'unborn');
  branchFail = false;
  rootFail = true;
  assert.equal((await request('git', ['/repo'])).result, null);
  rootFail = false;
  assert.equal((await request('repository-snapshot', ['/repo'])).result.sessions.length, 2);
  assert.equal((await request('snapshot')).result.sessions.length, 3);
  for (const op of [
    'search',
    'metadata',
    'read',
    'list',
    'create',
    'save',
    'delete',
    'trash',
    'restore',
  ])
    assert.ok((await request('project-docs', ['project', '/root', op, ['page', 'body']])).result);
  assert.match(
    (await request('project-docs', ['project', '/root', 'bad', []])).error,
    /Unknown document/,
  );
  assert.ok(calls.some((call) => call[0] === 'invalidate'));
  assert.ok((await request('project-resource-revision', ['/root', 'memory'])).result);
  for (const op of ['path', 'list'])
    assert.ok((await request('project-memory', ['project', '/root', op])).result);
  assert.match(
    (await request('project-memory', ['project', '/root', 'bad'])).error,
    /Unknown memory/,
  );
  assert.equal((await request('project-import-docs', ['project', '/root', []])).result, true);
  assert.ok((await request('project-prepare', ['project', '/root'])).result);
  assert.match((await request('worktree', ['/repo', '-bad', '/root'])).error, /Invalid branch/);
  assert.match((await request('worktree', ['/repo', 'feature', null])).error, /location required/);
  assert.match((await request('worktree', ['/repo', 'feature', '/root'])).result.path, /worktrees/);
  for (const op of [
    'ptyOpen',
    'ptyRead',
    'ptyWrite',
    'ptyResize',
    'ptyClose',
    'worktree-remove',
    'working-status',
    'git-commit',
    'git-pull-request',
    'repositoryDiff',
    'terminalStart',
    'terminalStatus',
    'terminalInput',
    'terminalStop',
    'models',
    'chatStatus',
    'chatStop',
    'chatApprove',
    'chatRespond',
  ])
    assert.ok((await request(op, ['/repo', 'arg', 'arg'])).result, op);
  // The helper lists the shells and runs that still work, so that an app attaches again.
  assert.deepEqual((await request('ptyList')).result, [{ id: 'shell', cwd: '/repo' }]);
  assert.deepEqual((await request('chat-runs')).result, [
    { id: 'run-1', agent: 'codex', sessionId: 'codex', create: false },
  ]);
  assert.match((await request('transcript', ['codex', 'missing'])).error, /not found/);
  for (const agent of ['codex', 'claude'])
    assert.deepEqual((await request('transcript', [agent, agent])).result, { messages: [] });
  transcriptFail = true;
  assert.equal(
    (await request('transcript', ['codex', 'codex'])).result.operation,
    'codexTranscript',
  );
  assert.ok(
    (
      await request('chatCreate', [
        '/repo',
        'codex',
        'prompt',
        'mode',
        { forkFrom: 'codex', model: 'model' },
      ])
    ).result,
  );
  assert.ok((await request('chatCreate', ['/repo', 'claude', 'prompt', 'mode'])).result);
  assert.ok((await request('chatStart', ['codex', 'codex', 'prompt', 'mode'])).result);
  input.emit('close');
  processEvents.emit('SIGTERM');
  processEvents.emit('SIGINT');
  stopTimer();
  // The helper stops one time, also when more stop signals arrive.
  assert.equal(calls.filter((call) => call[0] === 'dispose').length, 1);
  assert.equal(calls.at(-1)[0], 'exit');
});
