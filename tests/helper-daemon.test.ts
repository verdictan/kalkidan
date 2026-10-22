import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  helperDecision,
  helperIdleMs,
  helperSocketPath,
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
