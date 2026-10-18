import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exec } from '../electron/core';
import { remoteNodeCommand } from '../electron/remote-node';

test('SSH bootstrap discovers Node outside PATH and preserves arguments and RPC stdin', async () => {
  const home = await mkdtemp(join(tmpdir(), "remote node 'home-"));
  try {
    await mkdir(join(home, '.local/bin'), { recursive: true });
    await symlink(process.execPath, join(home, '.local/bin/node'));
    const { stdout } = await exec(
      '/bin/sh',
      [
        '-c',
        'printf hello | ' +
          remoteNodeCommand(
            '-e \'process.stdin.on("data", d => console.log(process.execPath, d.toString()))\'',
          ),
      ],
      { env: { ...process.env, HOME: home, PATH: '/usr/bin:/bin' } },
    );
    assert.match(stdout, /hello/);
    assert.match(stdout, /node/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});
