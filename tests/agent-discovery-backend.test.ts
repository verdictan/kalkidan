import test from 'node:test';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { backendLoader } from './helpers/backend-loader';
import { AgentRuntimes } from '../electron/agents/runtime';
import { createProjectPrompt } from '../electron/projects/prompt';

test('executable discovery honors overrides, sanitizes environment and resolves each platform without shell execution', async () => {
  for (const platform of ['linux', 'darwin', 'win32']) {
    let configured: string | undefined = '/configured',
      allowed = '/configured',
      shellError = false,
      directoryError = false,
      shim = 'bad';
    const accesses: string[] = [];
    const { executable } = backendLoader(
      {
        'node:fs/promises': {
          access: async (path: string) => {
            accesses.push(path);
            if (path !== allowed && !path.endsWith('entry.js')) throw Error('missing');
          },
          readdir: async () => {
            if (directoryError) throw Error('missing');
            return ['openai.chatgpt-2', 'other', 'openai.chatgpt-1'];
          },
          readFile: async () => shim,
        },
        'node:os': { homedir: () => '/home' },
        [resolve('electron/config/runtime.ts')]: {
          runtimeConfig: () => ({ agentExecutable: { codex: configured, claude: configured } }),
        },
        [resolve('electron/platform.ts')]: { executableCandidates: () => ['/candidate'] },
        [resolve('electron/core.ts')]: {
          exec: async () => {
            if (shellError) throw Error('shell unavailable');
            return { stdout: 'banner\n__CG_PATH__/shell/path\n/shell/codex\n' };
          },
        },
      },
      {
        process: {
          platform,
          arch: 'arm64',
          execPath: '/node',
          env: {
            ELECTRON_RUN_AS_NODE: '1',
            CLAUDECODE: '1',
            SHELL: '/bin/test',
            APPDATA: '/appdata',
          },
        },
      },
    )(resolve('electron/chat.ts'));
    assert.equal((await executable('codex')).path, '/configured');
    assert.equal((await executable('codex')).env.CLAUDECODE, undefined);
    configured = undefined;
    allowed = platform === 'win32' ? '/candidate' : '/shell/codex';
    assert.equal((await executable('codex')).path, allowed);
    shellError = true;
    allowed = '/usr/local/bin/claude';
    assert.equal((await executable('claude')).path, allowed);
    allowed = 'none';
    directoryError = true;
    await assert.rejects(executable('codex'), /Codex CLI/);
    await assert.rejects(executable('gh'), /GitHub CLI/);
    await assert.rejects(executable('claude'), /Claude Code CLI/);
    if (platform === 'win32') {
      allowed = '/appdata/npm/codex.cmd';
      await assert.rejects(executable('codex'), /not found/);
      shim = '"%dp0%/entry.js"';
      const found = await executable('codex');
      assert.equal(found.path, '/node');
      assert.deepEqual(found.args, ['/appdata/npm/entry.js']);
      assert.equal(found.env.ELECTRON_RUN_AS_NODE, '1');
    }
    assert.ok(accesses.length > 0);
  }
});

test('runtime routing removes evicted runs and disposes shared adapters once', async () => {
  let id = 0,
    stopped = 0,
    disposed = 0,
    old = false;
  const runtime: any = {
    start: async () => ({ id: String(++id) }),
    status: (value: string) => {
      if (old && value === '1') throw Error('evicted');
      return { id: value };
    },
    stop: () => {},
    approve: () => {},
    stopAll: () => stopped++,
    dispose: () => disposed++,
    runningCount: () => 2,
  };
  const router = new AgentRuntimes([
    { id: 'codex', runtime },
    { id: 'claude', runtime },
  ]);
  await router.start({ agent: 'codex' } as any, 'prompt', true);
  old = true;
  await router.start({ agent: 'claude' } as any, 'prompt', true);
  assert.throws(() => router.status('1'), /no longer/);
  assert.equal(router.runningCount(), 2);
  router.stopAll();
  router.dispose();
  assert.equal(stopped, 1);
  assert.equal(disposed, 1);
  assert.throws(() => router.status('2'), /no longer/);
  delete runtime.runningCount;
  assert.equal(new AgentRuntimes([{ id: 'codex', runtime }]).runningCount(), 0);
  const { createAgentRuntimes } = backendLoader({
    [resolve('electron/interactive-chat.ts')]: {
      InteractiveChatRunner: class {
        dispose() {}
        runningCount() {
          return 0;
        }
      },
    },
  })(resolve('electron/agents/runtime.ts'));
  const defaults = createAgentRuntimes(async () => {
    throw new Error('Managed launch required');
  });
  assert.equal(defaults.runningCount(), 0);
  defaults.dispose();
});

test('project prompts enforce linked task membership, input bounds, and task-body budgets', async () => {
  let items: any[] = [{ id: 'task', body: 'x'.repeat(25000) }];
  const prompt = createProjectPrompt({
    projects: () =>
      [
        { id: 'r', path: '/repo', name: 'Repo' },
        { id: 'child', path: '/repo/child', name: 'Child' },
      ] as any,
    groups: () => [{ id: 'g', name: 'Group', repoIds: ['r', 'child'] }] as any,
    trackers: {
      linked: () => ({ provider: { board: async () => ({ items }) }, project: {} }),
    } as any,
  });
  for (const invalid of ['', ' '.repeat(4), 'x'.repeat(100001), null])
    await assert.rejects(prompt('/repo', invalid as any), /Enter a message/);
  await assert.rejects(prompt('/other', 'task', { taskId: 'task' }), /no longer linked/);
  const result = await prompt('/repo/child', 'task', { taskId: 'task' });
  assert.match(result, /"repository":"Child"/);
  assert.ok(!result.includes('x'.repeat(20001)));
  items = [];
  await assert.rejects(prompt('/repo', 'task', { taskId: 'task' }), /removed or archived/);
});

test('worktree removal reserves the checkout against new runs and rejects active or unknown ownership', async () => {
  let busy = true,
    starts = 0;
  const runtime: any = {
    checkoutBusy: () => busy,
    start: async () => {
      starts++;
      return { id: 'r' };
    },
    status: () => ({}),
  };
  const router = new AgentRuntimes([{ id: 'codex', runtime }]);
  await assert.rejects(
    router.withCheckoutIdle('/repo', async () => {}),
    /Stop the agents/,
  );
  busy = false;
  let finish!: () => void;
  const removing = router.withCheckoutIdle(
    '/repo',
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  await assert.rejects(
    router.start({ id: 's', agent: 'codex', cwd: '/repo/sub' } as any, 'task', true),
    /operation in progress/,
  );
  await assert.rejects(
    router.withCheckoutIdle('/repo/sub', async () => {}),
    /already in progress/,
  );
  await router.start({ id: 's', agent: 'codex', cwd: '/repo-other' } as any, 'task', true);
  finish();
  await removing;
  await router.start({ id: 's', agent: 'codex', cwd: '/repo' } as any, 'task', true);
  assert.equal(starts, 2);
  await assert.rejects(
    router.withCheckoutIdle('/repo', async () => {
      throw Error('dirty worktree');
    }),
    /dirty/,
  );
  await router.withCheckoutIdle('/repo', async () => {});
  delete runtime.checkoutBusy;
  await assert.rejects(
    router.withCheckoutIdle('/repo', async () => {}),
    /Stop the agents/,
  );
});
