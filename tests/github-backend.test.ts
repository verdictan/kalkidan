import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import { backendLoader } from './helpers/backend-loader';

test('GitHub API failures redact arguments and project resolution validates every response', async () => {
  let accessible = false,
    response: any = { data: {} },
    fail = false;
  const calls: any[] = [];
  const { githubGraphQL, githubExecutable, GitHubProjects } = backendLoader({
    'node:fs/promises': {
      access: async () => {
        if (!accessible) throw Error('missing');
      },
    },
    [resolve('electron/core.ts')]: {
      exec: (...args: any[]) => {
        calls.push(args);
        return Object.assign(
          fail
            ? Promise.reject({ stderr: 'Command failed: SECRET\nDenied' })
            : Promise.resolve({ stdout: JSON.stringify(response) }),
          {
            child: {
              stdin: {
                on() {},
                end(input: string) {
                  calls.at(-1).push(JSON.parse(input));
                },
              },
            },
          },
        );
      },
    },
  })(resolve('electron/github-projects.ts'));
  assert.equal(await githubExecutable(), 'gh');
  accessible = true;
  assert.equal(await githubExecutable(), '/opt/homebrew/bin/gh');
  await githubGraphQL('query', { count: 1, text: 'value', nil: null, missing: undefined });
  assert.ok(calls[0][1].includes('--input'));
  assert.ok(!calls[0][1].some((v: string) => v.includes('value')));
  assert.deepEqual(calls[0][3].variables, { count: 1, text: 'value', nil: null });
  response = { errors: [{ message: 'denied' }] };
  await assert.rejects(githubGraphQL('query', {}), /could not complete/);
  fail = true;
  await assert.rejects(
    githubGraphQL('SECRET', {}),
    (error: any) => !error.message.includes('SECRET') && !error.message.includes('Denied'),
  );
  let data: any = {};
  const github = new GitHubProjects(async () => data);
  const owner = { kind: 'user', login: 'test', id: 'owner' };
  await assert.rejects(github.create(owner, 'title'), /owner not found/);
  data = { user: { id: 'owner' } };
  await assert.rejects(github.create(owner, 'title'), /did not return/);
  data = { user: { projectV2: { id: 'P', title: 'Title', url: 'url', number: 1 } } };
  assert.equal((await github.resolve('https://github.com/users/test/projects/1')).owner, 'test');
  data.user.projectV2.closed = true;
  await assert.rejects(github.resolve('https://github.com/users/test/projects/1'), /closed/);
  data = {};
  await assert.rejects(github.resolve('https://github.com/orgs/test/projects/1'), /not found/);
  await assert.rejects(github.addDraft({ id: 'P' }, '', 'body'), /title/);
  await assert.rejects(
    github.addIssue({ id: 'P' }, 'https://github.com/test/repo/pull/1'),
    /not found/,
  );
});

test('GitHub device login handles generation races, process failures, environment tokens and timeout deterministically', async () => {
  for (const mode of [
    'timeout',
    'spawn-error',
    'spawn-missing',
    'browser-error',
    'declined',
    'ready',
    'env',
    'missing',
    'canceled',
  ]) {
    const child = Object.assign(new EventEmitter(), {
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      stdin: Object.assign(new EventEmitter(), { end() {} }),
      kill() {},
    });
    let timeout!: Function;
    let resolveCheck!: Function;
    const { GitHubAuth } = backendLoader(
      {
        [resolve('electron/core.ts')]: { exec: () => {} },
        [resolve('electron/github-projects.ts')]: { githubExecutable: () => {} },
      },
      {
        process: { env: mode === 'env' ? { GH_TOKEN: 'private' } : {}, platform: 'win32' },
        setTimeout: (fn: Function) => {
          timeout = fn;
          return { unref() {} };
        },
        clearTimeout: () => {},
      },
    )(resolve('electron/github-auth.ts'));
    let checks = 0;
    const auth = new GitHubAuth(
      async () => {
        throw Error('browser failed');
      },
      async () => {
        checks++;
        if (mode === 'ready' && checks > 1) return { stdout: 'Token scopes: project', stderr: '' };
        if (mode === 'canceled')
          return new Promise((resolve) => {
            resolveCheck = resolve;
          });
        if (mode === 'missing') throw Object.assign(Error('missing'), { code: 'ENOENT' });
        throw Object.assign(Error('logged out'), { code: 1 });
      },
      () => child,
      async () => '/gh',
    );
    const start = auth.start();
    if (mode === 'canceled') {
      for (let i = 0; i < 5; i++) await Promise.resolve();
      auth.cancel();
      resolveCheck({ stdout: '', stderr: '' });
      assert.equal((await start).status, 'idle');
      continue;
    }
    const state = await start;
    if (['env', 'missing'].includes(mode)) {
      assert.equal(state.status, mode === 'env' ? 'permission-required' : 'error');
      assert.ok(!state.message.includes('private'));
      continue;
    }
    assert.equal((await auth.inspect()).status, 'waiting');
    if (mode === 'timeout') {
      timeout();
      assert.match(auth.snapshot().message, /timed out/);
    }
    if (mode === 'spawn-error' || mode === 'spawn-missing') {
      child.emit(
        'error',
        Object.assign(Error('failed'), { code: mode === 'spawn-missing' ? 'ENOENT' : 'EIO' }),
      );
      child.emit('close', 1);
      assert.equal(auth.snapshot().status, 'error');
    }
    if (mode === 'browser-error') {
      child.stdout.emit('data', Buffer.from('one-time code: ABCD-1234'));
      await Promise.resolve();
      await Promise.resolve();
      assert.match(auth.snapshot().message, /Open github/);
    }
    if (mode === 'declined' || mode === 'ready') {
      child.emit('close', mode === 'ready' ? 0 : 1);
      if (mode === 'ready') {
        assert.equal(auth.snapshot().status, 'verifying');
        for (let i = 0; i < 5; i++) await Promise.resolve();
      }
      assert.equal(auth.snapshot().status, mode === 'ready' ? 'ready' : 'error');
    }
    child.stdin.emit('error', Error('closed'));
    auth.cancel();
    child.emit('error', Error('stale'));
    child.emit('close', 0);
    child.stdout.emit('data', Buffer.from('one-time code: ABCD-1234'));
    assert.equal(auth.snapshot().status, 'idle');
  }
});
