import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { connectHelper, listenHelper } from '../electron/operations/helper-daemon';

// This test opens real Unix sockets, so it runs in npm test and not in the isolated suite.
async function temporary(t: test.TestContext) {
  // A short folder name keeps the socket path below the limit of the system.
  const root = await mkdtemp(join(tmpdir(), 'kh-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('one helper listens on a socket, and a socket of a stopped helper is replaced', async (t) => {
  const root = await temporary(t);
  const path = join(root, 'h.sock');
  assert.equal(await connectHelper(path), undefined);
  // The peer can close first, so a reset of a connection is not an error of the helper.
  const first = createServer((socket) => socket.on('error', () => {}).end('first\n'));
  t.after(() => first.close());
  assert.equal(await listenHelper(first, path), true);
  const socket = await connectHelper(path);
  assert.ok(socket);
  // The helper answers on the connection.
  assert.equal(
    await new Promise((done) => socket.once('data', (data) => done(String(data)))),
    'first\n',
  );
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
  await assert.rejects(listenHelper(createServer(), join(root, 'missing', 'x.sock')));
  // A folder in the path that is a file is an error on each system.
  await writeFile(join(root, 'file'), '');
  await assert.rejects(connectHelper(join(root, 'file', 'x.sock')), /ENOTDIR/);
});
