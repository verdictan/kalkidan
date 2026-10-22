import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { backendLoader } from './helpers/backend-loader';

const source = (name: string) => resolve('electron', name + '.ts');
test('CLI checks cover installation, invocation and authentication without leaking diagnostics', async () => {
  let phase = 'ready';
  const calls: unknown[][] = [];
  const load = backendLoader({
    [source('chat')]: {
      executable: async (name: string) => {
        if (phase === 'missing' || name === 'claude') throw Error('missing');
        return { path: '/fixture/' + name, env: {} };
      },
      agentPrograms: async (name: string) => {
        if (name === 'claude') throw Error('missing');
        const program = { path: '/fixture/' + name, env: {} };
        return { selected: program, source: 'automatic', candidates: [program] };
      },
    },
    [source('core')]: {
      exec: async (...args: unknown[]) => {
        calls.push(args);
        if (phase === 'error' || (phase === 'signed-out' && (args[1] as string[])[0] === 'auth'))
          throw Object.assign(Error('SECRET'), { code: phase === 'signed-out' ? 1 : 2 });
        if ((args[1] as string[])[0] === 'api') return { stdout: 'octo-cat\n' };
        return { stdout: '' };
      },
    },
  });
  const { githubCliCheck } = load(source('github-cli-check'));
  for (phase of ['missing', 'error', 'signed-out', 'ready']) {
    const result = await githubCliCheck();
    assert.equal(result.status, phase);
    assert.ok(!JSON.stringify(result).includes('SECRET'));
  }
  assert.deepEqual(calls.at(-2)?.[1], ['auth', 'status', '--hostname', 'github.com']);
  assert.deepEqual(calls.at(-1)?.[1], ['api', 'user', '--jq', '.login']);
  // The login is read once and kept for a time.
  const count = calls.length;
  assert.equal((await githubCliCheck()).login, 'octo-cat');
  assert.equal(calls.length, count + 2, 'The second check reads no login');
  const installs = await load(source('agent-installations')).agentInstallations();
  assert.deepEqual(
    installs.map((x: any) => x.status),
    ['installed', 'missing'],
  );
});

test('model discovery validates agents, filters private models and recovers from corrupt caches', async () => {
  let contents = '{}';
  const { modelOptions } = backendLoader({
    'node:fs/promises': { readFile: async () => contents },
  })(source('models'));
  await assert.rejects(modelOptions('invalid', '/fixture'), /Invalid agent/);
  assert.equal((await modelOptions('claude', '/fixture')).length, 3);
  assert.deepEqual(await modelOptions('codex', '/fixture'), []);
  contents = JSON.stringify({
    models: [
      { visibility: 'list', slug: 'one', display_name: 'One' },
      { visibility: 'list', slug: 'two' },
      { visibility: 'hidden', slug: 'hidden' },
      { visibility: 'list' },
    ],
  });
  assert.deepEqual(await modelOptions('codex', '/fixture'), [
    { id: 'one', name: 'One' },
    { id: 'two', name: 'two' },
  ]);
  contents = 'broken';
  assert.deepEqual(await modelOptions('codex', '/fixture'), []);
});

test('GitHub tracker delegates valid operations and rejects malformed owner/project references', async () => {
  const calls: [string, unknown[]][] = [];
  const capture =
    (name: string) =>
    (...args: unknown[]) => {
      calls.push([name, args]);
      return Promise.resolve(name);
    };
  const projects = Object.fromEntries(
    [
      'owners',
      'list',
      'resolve',
      'create',
      'board',
      'setStatus',
      'addDraft',
      'addIssue',
      'invalidateBoards',
    ].map((n) => [n, capture(n)]),
  );
  projects.withWrite = (_project: any, action: any) => action();
  projects.withAccount = (action: any) => action();
  const auth = Object.fromEntries(['start', 'inspect', 'cancel'].map((n) => [n, capture(n)]));
  const { githubTracker } = backendLoader()(source('trackers/github'));
  const provider = githubTracker(projects, auth, capture('open'));
  await provider.authorize();
  await provider.authorize(true);
  await provider.authStatus();
  await provider.cancelAuth();
  await provider.openAuth();
  await provider.owners();
  const owner = { kind: 'user', login: 'fixture' },
    project = { owner: 'fixture', number: 1 };
  await provider.projects(owner);
  await provider.resolve('url');
  await provider.createProject(owner, 'title');
  await provider.board(project);
  await provider.setStatus(project, 'item', 'done');
  await provider.createItem(project, 'title', 'body');
  await provider.importItem(project, 'url');
  assert.deepEqual(calls[0], ['invalidateBoards', []]);
  assert.deepEqual(calls[1], ['start', [false]]);
  assert.equal(calls.filter(([name]) => name === 'invalidateBoards').length, 3);
  assert.deepEqual(calls.at(-1), ['addIssue', [project, 'url']]);
  for (const invalid of [null, {}, { kind: 'other' }])
    assert.throws(() => provider.projects(invalid), /Invalid GitHub owner/);
  for (const invalid of [{}, { owner: 'fixture', number: 1.5 }])
    assert.throws(() => provider.board(invalid), /Invalid GitHub project/);
});

test('preload exposes only explicit IPC functions and removes event subscriptions', async () => {
  let api: any;
  const calls: [string, unknown[]][] = [];
  const listeners = new Map<string, Function>();
  backendLoader({
    electron: {
      contextBridge: {
        exposeInMainWorld: (name: string, value: any) => {
          assert.equal(name, 'workspace');
          api = value;
        },
      },
      ipcRenderer: {
        invoke: (channel: string, ...args: unknown[]) => {
          calls.push([channel, args]);
          return Promise.resolve('reply');
        },
        on: (channel: string, fn: Function) => listeners.set(channel, fn),
        removeListener: (channel: string, fn: Function) => {
          assert.equal(listeners.get(channel), fn);
          listeners.delete(channel);
        },
      },
    },
  })(source('preload'));
  assert.equal(typeof api.memoryList, 'function');
  for (const [name, fn] of Object.entries(api)) {
    if (name.startsWith('on')) continue;
    assert.equal(await (fn as Function)('one', 'two', 'three', 'four', 'five'), 'reply', name);
  }
  assert.ok(calls.some(([channel, args]) => channel === 'memory-list' && args[0] === 'one'));
  assert.ok(calls.some(([channel]) => channel === 'docs-read'));
  for (const [name, fn] of Object.entries(api)) {
    if (!name.startsWith('on')) continue;
    let count = 0;
    const remove = (fn as Function)(() => count++);
    for (const listener of listeners.values()) {
      listener({}, 'new-session');
      listener({}, true);
      listener({}, { command: 'bad' });
    }
    remove();
    assert.equal(listeners.size, 0);
  }
});
