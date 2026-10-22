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
  unattendedRunLimitMs,
} from '../electron/operations/helper-daemon';

async function temporary(t: test.TestContext) {
  // A short folder name keeps the socket path below the limit of the system.
  const root = await mkdtemp(join(tmpdir(), 'kh-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('the helper keeps runs without an app until the limit, then stops them and itself', () => {
  const at = (minutes: number) => ({ detachedAt: 0, now: minutes * 60_000 });
  const base = { attached: false, running: 0, releasing: 0 };
  // The proposed default limit is 2 hours.
  assert.equal(unattendedRunLimitMs, 7_200_000);
  assert.equal(helperIdleMs, 60_000);
  assert.equal(helperDecision({ ...base, attached: true, running: 1, ...at(500) }), 'keep');
  assert.equal(helperDecision({ ...base, running: 1, ...at(119) }), 'keep');
  assert.equal(helperDecision({ ...base, running: 1, ...at(120) }), 'expire');
  assert.equal(helperDecision({ ...base, running: 1, ...at(2), limit: 60_000 }), 'expire');
  // A runtime release waits for the app, but not after the limit.
  assert.equal(helperDecision({ ...base, releasing: 1, ...at(30) }), 'keep');
  assert.equal(helperDecision({ ...base, releasing: 1, ...at(120) }), 'exit');
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
