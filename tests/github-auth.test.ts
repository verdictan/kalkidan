import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { GitHubAuth, deviceCode } from '../electron/github-auth';
function fixture(status: string | Error) {
  const child = Object.assign(new EventEmitter(), { stdout: new PassThrough(), stderr: new PassThrough(), stdin: new PassThrough(), kill: () => { killed++; } });
  let killed = 0, opened = 0; const calls: string[][] = [];
  const auth = new GitHubAuth(async () => { opened++; }, (async () => { if (status instanceof Error) throw status; return { stdout: status, stderr: '' }; }) as any, ((_bin: string, args: string[]) => { calls.push(args); return child; }) as any, async () => 'gh');
  return { auth, child, calls, opened: () => opened, killed: () => killed };
}
test('existing project scope skips OAuth while read-only scope requests refresh', async () => {
  const ready = fixture("Token scopes: 'repo', 'project'");
  assert.equal((await ready.auth.start()).status, 'ready'); assert.equal(ready.calls.length, 0);
  const refresh = fixture("Token scopes: 'repo', 'read:project'");
  await refresh.auth.start(); await refresh.auth.start();
  assert.deepEqual(refresh.calls, [['auth', 'refresh', '-h', 'github.com', '-s', 'project']]);
  refresh.child.stderr.write('! First copy your one-time code: ABCD-');
  refresh.child.stderr.write('1234\n');
  assert.equal(refresh.auth.snapshot().code, 'ABCD-1234'); assert.equal(refresh.opened(), 1);
  refresh.child.emit('close', 0); assert.equal(refresh.auth.snapshot().status, 'ready');
});
test('signed out login, cancellation and late process exit cannot revive authorization', async () => {
  const f = fixture(new Error('not logged in')); await f.auth.start();
  assert.ok(f.calls[0].includes('--web')); assert.ok(f.calls[0].includes('project'));
  f.auth.cancel(); f.child.emit('close', 0);
  assert.equal(f.killed(), 1); assert.equal(f.auth.snapshot().status, 'idle');
});
test('missing CLI and rejected device authorization produce safe retryable errors', async () => {
  const missing = fixture(Object.assign(new Error('missing'), { code: 'ENOENT' }));
  assert.match((await missing.auth.start()).message!, /Install GitHub CLI/);
  const f = fixture('Token scopes: repo'); await f.auth.start();
  f.child.stderr.write('private diagnostic'); f.child.emit('close', 1);
  assert.equal(f.auth.snapshot().status, 'error'); assert.ok(!f.auth.snapshot().message!.includes('private'));
  assert.equal(deviceCode('unrelated ABCD-1234'), undefined);
});

test('explicit authorization opens a fresh device flow even when project access exists', async () => {
  const f = fixture("Token scopes: 'repo', 'project'");
  assert.equal((await f.auth.start(true)).status, 'waiting');
  assert.deepEqual(f.calls, [['auth', 'refresh', '-h', 'github.com', '-s', 'project']]);
  f.child.stderr.write('! First copy your one-time code: \u001b[1mABCD-1234\u001b[0m\n');
  assert.equal(f.auth.snapshot().code, 'ABCD-1234'); assert.equal(f.opened(), 1);
  f.auth.cancel();
});
