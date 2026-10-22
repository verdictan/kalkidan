import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  connectHelper,
  helperDecision,
  helperIdleMs,
  helperSocketPath,
  listenHelper,
  prepareHelperDirectory,
  releaseWaitMs,
} from '../electron/operations/helper-daemon';

async function temporary(t: test.TestContext) {
  // A short folder name keeps the socket path below the limit of the system.
  const root = await mkdtemp(join(tmpdir(), 'kh-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('the helper keeps work without an app with no time limit, and stops when idle', () => {
  const at = (minutes: number) => ({ idleSince: 0, now: minutes * 60_000 });
  const base = { attached: false, busy: 0, releasing: 0 };
  assert.equal(helperIdleMs, 60_000);
  // The runtime credential of a host lives at most 900 seconds.
  assert.equal(releaseWaitMs, 900_000);
  assert.equal(helperDecision({ ...base, attached: true, ...at(500) }), 'keep');
  // A run, a terminal or a PTY continues without an app, for any time.
  assert.equal(helperDecision({ ...base, busy: 1, ...at(60 * 24 * 7) }), 'keep');
  // A runtime that only an app can revoke keeps the helper for the life of its credential.
  assert.equal(helperDecision({ ...base, releasing: 1, ...at(14) }), 'keep');
  assert.equal(helperDecision({ ...base, releasing: 1, ...at(15) }), 'exit');
  // An idle helper waits a short time for a new connection.
  assert.equal(helperDecision({ ...base, ...at(0.5) }), 'keep');
  assert.equal(helperDecision({ ...base, ...at(1) }), 'exit');
  assert.equal(helperDecision({ ...base, ...at(0.5), idle: 1000 }), 'exit');
});

test('each user and version has its own helper socket in a private folder', async (t) => {
  assert.equal(
    helperSocketPath('/home/u', 'a'.repeat(20)),
    `/home/u/.kalkidan/run/helper-${'a'.repeat(20)}.sock`,
  );
  assert.equal(
    helperSocketPath('/home/u', '../x'),
    '/home/u/.kalkidan/run/helper-development.sock',
  );
  const root = await temporary(t);
  const folder = join(root, 'run');
  await prepareHelperDirectory(folder);
  assert.equal((await lstat(folder)).mode & 0o777, 0o700);
  // A folder that other users can open becomes private.
  await chmod(folder, 0o755);
  await prepareHelperDirectory(folder);
  assert.equal((await lstat(folder)).mode & 0o777, 0o700);
  // A link or a file is not a helper folder.
  await symlink(folder, join(root, 'link'));
  await assert.rejects(prepareHelperDirectory(join(root, 'link')), /not a folder/);
  await writeFile(join(root, 'file'), '');
  await assert.rejects(prepareHelperDirectory(join(root, 'file')), /EEXIST|not a folder/);
});

test('one helper listens on a socket, and a socket of a stopped helper is replaced', async (t) => {
  const root = await temporary(t);
  const path = join(root, 'h.sock');
  assert.equal(await connectHelper(path), undefined);
  const first = createServer((socket) => socket.end('first\n'));
  t.after(() => first.close());
  assert.equal(await listenHelper(first, path), true);
  const socket = await connectHelper(path);
  assert.ok(socket);
  socket.destroy();
  // A second helper does not take the socket of a helper that listens.
  const second = createServer();
  assert.equal(await listenHelper(second, path), false);
  assert.equal(second.listening, false);
  // A socket file of a helper that stopped is removed. A new helper then listens.
  await new Promise<void>((done) => first.close(() => done()));
  const stale = join(root, 'stale.sock');
  const old = createServer();
  await listenHelper(old, stale);
  // Close the handle but keep the file, as a stopped process does.
  await new Promise<void>((done) => {
    (old as any)._handle.close(done);
    (old as any)._handle = null;
  });
  const third = createServer();
  t.after(() => third.close());
  assert.equal(await listenHelper(third, stale), true);
  // A different error goes to the caller.
  await mkdir(join(root, 'folder.sock'));
  await assert.rejects(listenHelper(createServer(), join(root, 'missing', 'x.sock')));
  await assert.rejects(connectHelper(join(root, 'folder.sock')));
});
