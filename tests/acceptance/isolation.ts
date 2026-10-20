import { prepareIsolation } from '../../electron/verdictan/isolation';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
const exec = promisify(execFile);
async function main() {
  const [agent, executable] = process.argv.slice(2);
  assert.ok(
    ['codex', 'claude'].includes(agent) && executable,
    'Supply agent and native executable',
  );
  const root = await realpath(await mkdtemp(join(tmpdir(), 'kalkidan-isolation-')));
  const outside = await realpath(await mkdtemp(join(tmpdir(), 'kalkidan-canary-')));
  const home = join(root, 'home'),
    cwd = join(root, 'project');
  await mkdir(home);
  await mkdir(cwd);
  await writeFile(join(outside, 'secret'), 'synthetic-secret');
  let escaped = false;
  const allowed = createServer((_, response) => response.end('gateway-only'));
  const denied = createServer((_, response) => {
    escaped = true;
    response.end('escape');
  });
  await Promise.all(
    [allowed, denied].map(
      (server) => new Promise<void>((done) => server.listen(0, '127.0.0.1', done)),
    ),
  );
  const address = `http://127.0.0.1:${(allowed.address() as any).port}`;
  let isolation: Awaited<ReturnType<typeof prepareIsolation>> | undefined;
  try {
    isolation = await prepareIsolation(
      {
        allowEdits: false,
        session: { cwd, agent } as any,
        executable: { path: executable, env: {} },
        signal: new AbortController().signal,
      } as any,
      home,
      address,
    );
    const prefix = isolation.prefix.slice(0, -1);
    const run = (file: string, args: string[]) =>
      exec(isolation!.executable, [...prefix, file, ...args], {
        cwd,
        env: isolation!.env,
        timeout: 5000,
        maxBuffer: 65536,
      });
    assert.equal(
      (await run('/usr/bin/curl', ['--max-time', '2', '-fsS', address])).stdout,
      'gateway-only',
    );
    await assert.rejects(
      run('/usr/bin/curl', [
        '--max-time',
        '2',
        '-fsS',
        `http://127.0.0.1:${(denied.address() as any).port}`,
      ]),
    );
    await assert.rejects(run('/bin/cat', [join(outside, 'secret')]));
    await assert.rejects(run('/bin/sh', ['-c', 'cat "$1"', 'probe', join(outside, 'secret')]));
    await assert.rejects(
      run('/bin/sh', ['-c', 'printf blocked > "$1"', 'probe', join(cwd, 'write-canary')]),
    );
    if (process.platform === 'linux')
      await assert.rejects(
        run('/usr/bin/python3', ['-c', 'import socket; socket.socket(socket.AF_UNIX)']),
      );
    assert.equal(escaped, false);
    console.log(
      JSON.stringify({
        platform: process.platform,
        arch: process.arch,
        agent,
        version: isolation.version,
        passed: [
          'native-version',
          'gateway-access',
          'other-port-denied',
          'private-file-denied',
          'descendant-denied',
          'read-only-project',
          ...(process.platform === 'linux' ? ['unix-socket-denied'] : []),
        ],
      }),
    );
  } finally {
    await isolation?.close();
    for (const server of [allowed, denied]) {
      server.closeAllConnections();
      server.close();
    }
    await rm(root, { recursive: true, force: true });
    await rm(outside, { recursive: true, force: true });
  }
}
void main().catch((error) => {
  console.error(error.stderr || error.message);
  process.exitCode = 1;
});
