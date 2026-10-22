import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create } from 'tar';
import { RuntimeInstaller } from '../electron/verdictan/install';
import { releaseNetworkMessages } from '../electron/verdictan/network';
import {
  RuntimeTransferReceiver,
  transferChunkBytes,
  transferIdleMs,
  transferRuntime,
} from '../electron/verdictan/transfer';
import { releaseFixture, signBundle, testKeys } from './helpers/verdictan-fixture';

/** A desktop that can reach GitHub, and an SSH host that cannot. */
async function fixture(t: any) {
  const root = await mkdtemp(join(tmpdir(), 'runtime-transfer-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'verdictan-aarch64-apple-darwin');
  await mkdir(source);
  for (const file of ['verdictan', 'verdictan-update', 'THIRD_PARTY_NOTICES.md'])
    await writeFile(join(source, file), file.endsWith('.md') ? 'Notices' : 'fixture executable');
  const archive = join(root, 'runtime.tar.gz');
  await create(
    { gzip: true, file: archive, cwd: root, portable: true, mtime: new Date(0) },
    ['verdictan', 'verdictan-update', 'THIRD_PARTY_NOTICES.md'].map(
      (name) => 'verdictan-aarch64-apple-darwin/' + name,
    ),
  );
  const release = releaseFixture(await readFile(archive));
  const hostRoot = join(root, 'host', 'runtime', 'verdictan');
  const desktopTemp = join(root, 'desktop-temp');
  await mkdir(desktopTemp);
  let hostRequests = 0;
  const installer = new RuntimeInstaller({
    root: hostRoot,
    hostId: 'build-host',
    desktopVersion: '0.1.0',
    os: 'darwin',
    arch: 'arm64',
    systemVersion: '26.7.1',
    now: () => release.options.now * 1000,
    key: testKeys.publicKey,
    busy: () => false,
    transferable: true,
    // The host has no route to GitHub.
    discover: async () => {
      hostRequests++;
      throw new Error(releaseNetworkMessages.offline);
    },
    request: (async () => {
      hostRequests++;
      throw new Error(releaseNetworkMessages.offline);
    }) as typeof fetch,
    probe: async (path) => {
      assert.match(await readFile(path, 'utf8'), /fixture executable/);
    },
  });
  const receiver = new RuntimeTransferReceiver(hostRoot, () => installer);
  const calls: string[] = [];
  /** The SSH helper side of `runtime-transfer`, with JSON like the real connection. */
  const helper = async (operation: string, args: unknown[]): Promise<any> => {
    calls.push(operation);
    const [a, b, c] = JSON.parse(JSON.stringify(args));
    if (operation === 'begin') return receiver.begin(a, b);
    if (operation === 'chunk') return receiver.chunk(a, b, c);
    if (operation === 'commit') return receiver.commit(a);
    return receiver.abort(a);
  };
  const desktopRequests: string[] = [];
  const progress: { phase: string; bytes: number; totalBytes: number }[] = [];
  const send = (
    call: (operation: any, args: unknown[]) => Promise<any> = helper,
    request: typeof fetch = release.request,
  ) =>
    transferRuntime({
      host: { platform: 'darwin', arch: 'arm64', systemVersion: '26.7.1' },
      desktopVersion: '0.1.0',
      directory: desktopTemp,
      discover: async () => release.discovered(),
      request: (async (url: string, init?: RequestInit) => {
        desktopRequests.push(String(url));
        return request(url, init);
      }) as typeof fetch,
      now: () => release.options.now * 1000,
      key: testKeys.publicKey,
      call,
      progress: (update) => progress.push(update),
    });
  const leftovers = async () => [
    ...(await readdir(hostRoot).catch(() => [] as string[])).filter((name) =>
      /^\.(?:transfer|install)-/.test(name),
    ),
    ...(await readdir(desktopTemp)),
  ];
  return {
    release,
    installer,
    receiver,
    helper,
    send,
    calls,
    leftovers,
    desktopRequests,
    progress,
    hostRequests: () => hostRequests,
  };
}

test('a host without internet gets a verified runtime copy over SSH and verifies it again', async (t) => {
  const f = await fixture(t);
  const checked = await f.installer.check();
  assert.equal(checked.discovery, 'failed');
  assert.equal(checked.error, releaseNetworkMessages.offline);
  assert.equal(checked.canTransfer, true, 'Settings offers the copy');
  const status = await f.send();
  assert.deepEqual(f.calls, ['begin', 'chunk', 'commit']);
  // Settings shows each step, and the bytes of the download and of the copy.
  const size = f.release.discovered().size;
  const phases = f.progress.map((update) => update.phase);
  assert.deepEqual([...new Set(phases)], ['downloading', 'verifying', 'copying', 'installing']);
  assert.ok(f.progress.every((update) => update.totalBytes === size));
  assert.deepEqual(f.progress.at(-2), { phase: 'copying', bytes: size, totalBytes: size });
  assert.ok(f.progress.some((update) => update.phase === 'downloading' && update.bytes === size));
  assert.equal(status.installing, true, 'the host installs after the reply');
  const installed = await f.installer.install();
  assert.equal(installed.installed?.version, '0.2.1');
  assert.equal(installed.operation?.phase, 'completed');
  assert.equal(installed.discovery, 'current');
  assert.equal(installed.error, undefined);
  assert.equal(installed.canTransfer, undefined);
  assert.ok(await f.installer.executable());
  assert.deepEqual(await f.leftovers(), []);
  // The desktop downloaded the signed files and the archive. The host made no other request.
  assert.ok(f.desktopRequests.some((url) => url.endsWith('.tar.gz')));
  assert.ok(f.desktopRequests.some((url) => url.endsWith('.tar.gz.sigstore.json')));
  assert.equal(f.hostRequests(), 1, 'only the first check on the host used the network');
});

test('the copy sends ordered parts, and the host rejects parts out of order', async (t) => {
  const f = await fixture(t);
  const parts: number[] = [];
  await f.send(async (operation, args) => {
    const reply = await f.helper(operation, args);
    if (operation === 'begin') return { ...reply, chunkBytes: 64 };
    if (operation === 'chunk') parts.push(args[1] as number);
    return reply;
  });
  assert.ok(parts.length > 2);
  assert.deepEqual(
    parts,
    parts.map((_, index) => index * 64),
  );
  assert.equal((await f.installer.install()).installed?.version, '0.2.1');

  const g = await fixture(t);
  await assert.rejects(
    g.send(async (operation, args) => {
      if (operation === 'chunk') args = [args[0], 1, args[2]];
      return g.helper(operation, args);
    }),
    /out of order/,
  );
  assert.deepEqual(await g.leftovers(), []);
  // Files that are not strict base64, or a discovery without its fields, are refused.
  for (const files of [{ manifest: 'not base64!' }, null])
    await assert.rejects(g.receiver.begin(g.release.discovered(), files), /Invalid runtime copy/);
  await assert.rejects(g.receiver.begin({ version: '0.2.1' }, {}), /Invalid runtime copy/);
  assert.deepEqual(await g.leftovers(), []);
  await assert.rejects(g.receiver.chunk('missing', 0, 'AA=='), /stopped/);
  await assert.rejects(g.receiver.commit('missing'), /stopped/);
});

test('the host refuses a changed archive, a changed signature, and a desktop that cannot verify', async (t) => {
  const f = await fixture(t);
  // One changed byte on the way. The host checks the digest and the signature again.
  await f.send(async (operation, args) => {
    if (operation === 'chunk') {
      const bytes = Buffer.from(args[2] as string, 'base64');
      bytes[bytes.length - 1] ^= 1;
      args = [args[0], args[1], bytes.toString('base64')];
    }
    return f.helper(operation, args);
  });
  const failed = await f.installer.install();
  assert.equal(failed.operation?.phase, 'failed');
  assert.equal(failed.operation?.error, 'The copied runtime checksum failed.');
  assert.equal(failed.installed, undefined);
  assert.deepEqual(await f.leftovers(), []);

  // A changed manifest signature stops the copy before any data moves.
  const g = await fixture(t);
  await assert.rejects(
    g.send(async (operation, args) => {
      if (operation === 'begin') {
        const files = { ...(args[1] as any) };
        const signature = JSON.parse(Buffer.from(files.manifestSignature, 'base64').toString());
        signature.messageSignature.signature = Buffer.alloc(70, 1).toString('base64');
        files.manifestSignature = Buffer.from(JSON.stringify(signature)).toString('base64');
        args = [args[0], files];
      }
      return g.helper(operation, args);
    }),
    /Release signature/,
  );
  assert.deepEqual(g.calls, ['begin']);
  assert.deepEqual(await g.leftovers(), []);

  // The desktop verifies the download first. A changed download never reaches the host.
  const h = await fixture(t);
  await assert.rejects(
    h.send(h.helper, (async (url: string, init?: RequestInit) => {
      const response = await h.release.request(url, init);
      if (!String(url).endsWith('.tar.gz')) return response;
      const bytes = Buffer.from(await response.arrayBuffer());
      bytes[0] ^= 1;
      return new Response(bytes);
    }) as typeof fetch),
    /checksum/,
  );
  assert.deepEqual(h.calls, []);
  assert.deepEqual(await h.leftovers(), []);
});

test('an incomplete or idle copy stops, and its partial file is deleted', async (t) => {
  const f = await fixture(t);
  // The desktop stops after the first part. Commit refuses the incomplete file.
  let id = '';
  await assert.rejects(
    f.send(async (operation, args) => {
      if (operation === 'begin') {
        const reply = await f.helper(operation, args);
        id = reply.id;
        return { ...reply, chunkBytes: 64 };
      }
      if (operation === 'chunk' && (args[1] as number) > 0) return { received: args[1] };
      return f.helper(operation, args);
    }),
    /incomplete/,
  );
  assert.ok(id);
  assert.deepEqual(await f.leftovers(), []);
  assert.equal(await f.receiver.abort(id), false);

  t.mock.timers.enable({ apis: ['setTimeout'] });
  const files = {
    manifest: f.release.bytes().toString('base64'),
    manifestSignature: '',
    archiveSignature: '',
  };
  files.manifestSignature = signBundle(f.release.bytes()).toString('base64');
  files.archiveSignature = signBundle(f.release.state.archive).toString('base64');
  const begin = await f.receiver.begin(f.release.discovered(), files);
  assert.equal(begin.chunkBytes, transferChunkBytes);
  assert.equal((await f.leftovers()).length, 1);
  // A second copy replaces the first one.
  const second = await f.receiver.begin(f.release.discovered(), files);
  assert.notEqual(second.id, begin.id);
  assert.equal((await f.leftovers()).length, 1);
  t.mock.timers.tick(transferIdleMs);
  await assert.rejects(f.receiver.chunk(second.id, 0, 'AA=='), /stopped/);
  for (let i = 0; i < 20 && (await f.leftovers()).length; i++)
    await new Promise((done) => setImmediate(done));
  assert.deepEqual(await f.leftovers(), []);
});
