import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { GitHubAuth, deviceCode } from '../electron/github-auth';
function fixture(status: string | Error) {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    kill: () => {
      killed++;
    },
  });
  let killed = 0,
    opened = 0;
  const calls: string[][] = [];
  let access = status;
  const auth = new GitHubAuth(
    async () => {
      opened++;
    },
    (async () => {
      if (access instanceof Error) throw access;
      return { stdout: access, stderr: '' };
    }) as any,
    ((_bin: string, args: string[]) => {
      calls.push(args);
      return child;
    }) as any,
    async () => 'gh',
  );
  return {
    auth,
    child,
    calls,
    setAccess: (value: string | Error) => {
      access = value;
    },
    opened: () => opened,
    killed: () => killed,
  };
}
test('existing project scope skips OAuth while read-only scope requests refresh', async () => {
  const ready = fixture("Token scopes: 'repo', 'project'");
  assert.equal((await ready.auth.start()).status, 'ready');
  assert.equal(ready.calls.length, 0);
  const refresh = fixture("Token scopes: 'repo', 'read:project'");
  await refresh.auth.start();
  await refresh.auth.start();
  assert.deepEqual(refresh.calls, [['auth', 'refresh', '-h', 'github.com', '-s', 'project']]);
  refresh.child.stderr.write('! First copy your one-time code: ABCD-');
  refresh.child.stderr.write('1234\n');
  assert.equal(refresh.auth.snapshot().code, 'ABCD-1234');
  assert.equal(refresh.opened(), 1);
  refresh.setAccess("Token scopes: 'repo', 'project'");
  refresh.child.emit('close', 0);
  assert.equal(refresh.auth.snapshot().status, 'verifying');
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(refresh.auth.snapshot().status, 'ready');
});
test('signed out login, cancellation and late process exit cannot revive authorization', async () => {
  const f = fixture(new Error('not logged in'));
  await f.auth.start();
  assert.ok(f.calls[0].includes('--web'));
  assert.ok(f.calls[0].includes('project'));
  f.auth.cancel();
  f.child.emit('close', 0);
  assert.equal(f.killed(), 1);
  assert.equal(f.auth.snapshot().status, 'idle');
});
test('missing CLI and rejected device authorization produce safe retryable errors', async () => {
  const missing = fixture(Object.assign(new Error('missing'), { code: 'ENOENT' }));
  assert.match((await missing.auth.start()).message!, /Install GitHub CLI/);
  const f = fixture('Token scopes: repo');
  await f.auth.start();
  f.child.stderr.write('private diagnostic');
  f.child.emit('close', 1);
  assert.equal(f.auth.snapshot().status, 'error');
  assert.ok(!f.auth.snapshot().message!.includes('private'));
  assert.equal(deviceCode('unrelated ABCD-1234'), undefined);
});

test('explicit authorization opens a fresh device flow even when project access exists', async () => {
  const f = fixture("Token scopes: 'repo', 'project'");
  assert.equal((await f.auth.start(true)).status, 'waiting');
  assert.deepEqual(f.calls, [['auth', 'refresh', '-h', 'github.com', '-s', 'project']]);
  f.child.stderr.write('! First copy your one-time code: \u001b[1mABCD-1234\u001b[0m\n');
  assert.equal(f.auth.snapshot().code, 'ABCD-1234');
  assert.equal(f.opened(), 1);
  f.auth.cancel();
});

test('passive permission inspection never starts login and requires Projects write scope', async () => {
  for (const [status, expected] of [
    ["Token scopes: 'repo', 'project'", 'ready'],
    ["Token scopes: 'repo', 'read:project'", 'permission-required'],
    [new Error('Not logged in'), 'signed-out'],
  ] as const) {
    const f = fixture(status);
    assert.equal((await f.auth.inspect()).status, expected);
    assert.equal(f.calls.length, 0);
    assert.equal(f.opened(), 0);
  }
});

test('successful CLI exit rechecks scope and never grants unverified permissions', async () => {
  const f = fixture("Token scopes: 'read:project'");
  const attempt = await f.auth.start();
  assert.ok(attempt.attemptId);
  f.child.emit('close', 0);
  assert.equal(f.auth.snapshot().status, 'verifying');
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(f.auth.snapshot().status, 'permission-required');
  assert.equal(f.auth.snapshot().attemptId, attempt.attemptId);
});

test('a stale or missing IPC attempt ID cannot cancel another observer’s login', async () => {
  const f = fixture(new Error('Not logged in'));
  const first = await f.auth.start();
  assert.equal((await f.auth.start()).attemptId, first.attemptId);
  f.auth.cancel('');
  f.auth.cancel('different-attempt');
  assert.equal(f.killed(), 0);
  assert.equal(f.auth.cancel(first.attemptId).status, 'canceled');
  const next = await f.auth.start();
  assert.notEqual(next.attemptId, first.attemptId);
  f.auth.cancel(first.attemptId);
  assert.equal(f.auth.snapshot().attemptId, next.attemptId);
  assert.equal(f.auth.snapshot().status, 'waiting');
  f.auth.cancel();
});

test('passive checks coalesce; cancellation discards late checks and verification', async () => {
  let resolve!: (value: { stdout: string; stderr: string }) => void;
  let checks = 0;
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    stdin: new PassThrough(),
    kill() {},
  });
  const auth = new GitHubAuth(
    async () => {},
    (async () => {
      checks++;
      return new Promise((done) => {
        resolve = done;
      });
    }) as any,
    (() => child) as any,
    async () => 'gh',
  );
  const first = auth.inspect();
  assert.equal(first, auth.inspect());
  await Promise.resolve();
  assert.equal(checks, 1);
  const start = auth.start();
  auth.cancel();
  resolve({ stdout: 'Token scopes: project', stderr: '' });
  assert.equal((await first).status, 'idle');
  assert.equal((await start).status, 'idle');
  const login = auth.start();
  await Promise.resolve();
  resolve({ stdout: 'Token scopes: read:project', stderr: '' });
  const attempt = await login;
  child.emit('close', 0);
  assert.equal(auth.snapshot().status, 'verifying');
  auth.cancel(attempt.attemptId);
  resolve({ stdout: 'Token scopes: project', stderr: '' });
  await new Promise<void>((done) => setImmediate(done));
  assert.equal(auth.snapshot().status, 'canceled');
});

test('offline, expired, SSO and CLI failures stay distinct and never expose diagnostics', async () => {
  for (const [error, status, reason] of [
    [new Error('HTTP 503 private'), 'error', 'network'],
    [new Error('token expired private'), 'expired', undefined],
    [new Error('SAML SSO private'), 'permission-required', 'sso'],
    [new Error('private error'), 'error', 'verification'],
    [Object.assign(new Error('private'), { code: 'ENOENT' }), 'error', 'missing-cli'],
  ] as const) {
    const f = fixture(error);
    const observed = await f.auth.inspect();
    assert.equal(observed.status, status);
    assert.equal(observed.reason, reason);
    assert.ok(!observed.message?.includes('private'));
    assert.equal(f.calls.length, 0);
    if (reason) {
      assert.equal((await f.auth.start()).reason, reason);
      assert.equal(f.calls.length, 0);
    }
  }
});
