import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { build } from 'esbuild';
import { RemoteHosts, sshTarget } from '../electron/remote-hosts';
import { sessionRepo } from '../src/lib/session-repository';

test('SSH targets cannot inject flags or shell commands', () => {
  assert.equal(sshTarget('developer@dev.example.com'), 'developer@dev.example.com');
  assert.equal(sshTarget('dev-alias'), 'dev-alias');
  for (const value of [
    '-oProxyCommand=anything',
    '-x@host',
    'host; rm -rf /',
    'user@host\ncommand',
    '$(echo bad)',
    'host with spaces',
  ])
    assert.throws(() => sshTarget(value));
});
test('identical paths on separate hosts do not mix repository sessions', () => {
  const local: any = { id: 'local', path: '/work/repo' };
  const remote: any = { id: 'remote', path: '/work/repo', hostId: 'ssh' };
  assert.equal(
    sessionRepo({ cwd: '/work/repo', hostId: 'ssh' } as any, [local, remote])?.id,
    'remote',
  );
  assert.equal(sessionRepo({ cwd: '/work/repo' } as any, [remote, local])?.id, 'local');
});
test('host setup installs the bundled agent and routes RPC through an SSH transport', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kalkidan-ssh-test-'));
  const oldPath = process.env.PATH;
  const oldHome = process.env.HOME;
  const bundle = join(root, 'agent.cjs');
  const hosts = new RemoteHosts(join(root, 'hosts.json'), bundle);
  try {
    await build({
      entryPoints: [resolve('electron/remote-agent.ts')],
      bundle: true,
      platform: 'node',
      outfile: bundle,
    });
    const bin = join(root, 'bin');
    await mkdir(bin);
    await mkdir(join(root, 'repo'));
    // A transport fixture, not a real SSH host. It executes only this test's remote commands.
    await writeFile(
      join(bin, 'ssh'),
      '#!/bin/sh\nfor arg do command="$arg"; done\nexec /bin/sh -c "$command"\n',
    );
    await chmod(join(bin, 'ssh'), 0o755);
    process.env.PATH = bin + ':' + oldPath;
    process.env.HOME = root;
    await hosts.load();
    const host = await hosts.add('Test host', 'test-host');
    assert.equal((await hosts.check(host.id)).status, 'checked');
    assert.equal((await hosts.install(host.id)).status, 'connected');
    assert.equal(
      (await hosts.call(host.id, 'validate', [join(root, 'repo')])).path,
      await import('node:fs/promises').then((fs) => fs.realpath(join(root, 'repo'))),
    );
    const run = await hosts.call(host.id, 'terminalStart', [
      join(root, 'repo'),
      'printf remote-output',
    ]);
    let state = run;
    for (let i = 0; i < 100 && state.status === 'running'; i++) {
      await new Promise((r) => setTimeout(r, 20));
      state = await hosts.call(host.id, 'terminalStatus', [run.id]);
    }
    assert.equal(state.output, 'remote-output');
    assert.equal(state.status, 'completed');
    const pty = await hosts.call(host.id, 'ptyOpen', [join(root, 'repo'), 80, 24]);
    await hosts.call(host.id, 'ptyWrite', [pty.id, "printf 'ssh-%s\\n' pty-ready\r"]);
    let ptyOutput = '';
    for (let i = 0; i < 100; i++) {
      ptyOutput = (await hosts.call(host.id, 'ptyRead', [pty.id, 0])).data;
      if (ptyOutput.includes('ssh-pty-ready')) break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.match(ptyOutput, /ssh-pty-ready/);
    await hosts.call(host.id, 'ptyClose', [pty.id]);
    const restored = new RemoteHosts(join(root, 'hosts.json'), bundle);
    await restored.load();
    assert.equal(restored.list()[0].status, 'disconnected');
    hosts.disconnect(host.id);
    await assert.rejects(hosts.call(host.id, 'hello', []), /offline/);
    assert.equal((await hosts.connect(host.id)).status, 'connected');
  } finally {
    hosts.close();
    process.env.PATH = oldPath;
    if (oldHome === undefined) delete process.env.HOME;
    else process.env.HOME = oldHome;
    await rm(root, { recursive: true, force: true });
  }
});

test('a removed host leaves the saved host list', async () => {
  const root = await mkdtemp(join(tmpdir(), 'remote-remove-'));
  try {
    const file = join(root, 'hosts.json');
    const hosts = new RemoteHosts(file, join(root, 'agent.cjs'));
    const kept = await hosts.add('Build', 'build-host');
    const removed = await hosts.add('Old', 'old-host');
    await hosts.remove(removed.id);
    await assert.rejects(hosts.remove(removed.id), /Remote host not found/);
    const restored = new RemoteHosts(file, join(root, 'agent.cjs'));
    await restored.load();
    assert.deepEqual(
      restored.list().map((h) => h.id),
      [kept.id],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
