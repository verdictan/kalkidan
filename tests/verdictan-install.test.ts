import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create } from 'tar';
import { generateKeyPairSync } from 'node:crypto';
import { RuntimeInstaller, type RuntimeInstallerOptions } from '../electron/verdictan/install';
import { downloadRuntime } from '../electron/verdictan/download';
import { extractRuntime } from '../electron/verdictan/archive';
import { releaseDownloadOrigins } from '../electron/verdictan/release';
import { releaseFixture, signBundle, testKeys } from './helpers/verdictan-fixture';

async function fixture(t: any) {
  const root = await mkdtemp(join(tmpdir(), 'runtime-install-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'verdictan-aarch64-apple-darwin');
  await mkdir(source);
  for (const file of ['verdictan', 'verdictan-update', 'THIRD_PARTY_NOTICES.md'])
    await writeFile(
      join(source, file),
      file === 'THIRD_PARTY_NOTICES.md' ? 'Notices' : 'fixture executable',
    );
  const archiveFile = join(root, 'runtime.tar.gz');
  await create(
    { gzip: true, file: archiveFile, cwd: root, portable: true, mtime: new Date(0) },
    ['verdictan', 'verdictan-update', 'THIRD_PARTY_NOTICES.md'].map(
      (name) => 'verdictan-aarch64-apple-darwin/' + name,
    ),
  );
  const release = releaseFixture(await readFile(archiveFile));
  let available = true;
  let serve: typeof fetch = release.request;
  let busy = false;
  let failActivation = false;
  let downloads = 0;
  const phases: string[] = [];
  const options: RuntimeInstallerOptions = {
    root: join(root, 'managed'),
    hostId: 'local',
    desktopVersion: '0.1.0',
    os: 'darwin',
    arch: 'arm64',
    systemVersion: '26.7.1',
    now: () => release.options.now * 1000,
    discover: async () => (available ? release.discovered() : undefined),
    key: testKeys.publicKey,
    busy: () => busy,
    request: ((url: string, init?: RequestInit) => {
      if (String(url).endsWith('.tar.gz')) downloads++;
      return serve(url, init);
    }) as typeof fetch,
    probe: async (path, version) => {
      assert.ok((await readFile(path, 'utf8')).includes('fixture executable'));
      if (failActivation && version === '0.2.2' && path.includes('/versions/'))
        throw new Error('Runtime validation failed.');
    },
    changed: () => {
      const phase = installer.status().operation?.phase;
      if (phase) phases.push(phase);
    },
  };
  const installer = new RuntimeInstaller(options);
  return {
    root,
    source,
    archiveFile,
    installer,
    release,
    phases,
    restart: () => new RuntimeInstaller({ ...options, changed: undefined }),
    downloads: () => downloads,
    busy: (value: boolean) => {
      busy = value;
    },
    unavailable: () => {
      available = false;
    },
    /** Replace the release files that the fake GitHub serves. */
    serve: (request: (url: string) => Response | undefined) => {
      serve = (async (url: string, init?: RequestInit) =>
        request(String(url)) ?? release.request(url, init)) as typeof fetch;
    },
    /** Publish version 0.2.2. By default, its activation fails. */
    async upgrade(fail = true) {
      for (const name of ['verdictan', 'verdictan-update'])
        await writeFile(join(source, name), 'fixture executable upgraded');
      await create(
        { gzip: true, file: archiveFile, cwd: root, portable: true, mtime: new Date(0) },
        ['verdictan', 'verdictan-update', 'THIRD_PARTY_NOTICES.md'].map(
          (name) => 'verdictan-aarch64-apple-darwin/' + name,
        ),
      );
      release.publish(await readFile(archiveFile), '0.2.2');
      failActivation = fail;
    },
  };
}
test('runtime installs verified files, journals progress, reuses the installation, and detects tampering', async (t) => {
  const f = await fixture(t);
  assert.equal((await f.installer.check()).discovery, 'available');
  const installing = f.installer.install();
  assert.equal(f.installer.install(), installing);
  const status = await installing;
  assert.equal(status.operation?.phase, 'completed', JSON.stringify(status));
  assert.equal(status.installed?.version, '0.2.1');
  assert.equal(status.discovery, 'current');
  assert.ok(f.phases.includes('verifying'));
  const path = await f.installer.executable();
  assert.ok(path);
  await f.installer.install();
  assert.equal(f.downloads(), 1);
  assert.ok(
    (await readdir(join(f.root, 'managed'))).every((name) => !name.startsWith('.install-')),
  );
  await writeFile(path!, 'tampered');
  await assert.rejects(f.installer.executable(), /checksum/);
});
test('updates stage during active work and activate later without another download', async (t) => {
  const f = await fixture(t);
  f.busy(true);
  const staged = await f.installer.install();
  assert.equal(staged.operation?.phase, 'waiting-for-idle');
  assert.equal(staged.installed, undefined);
  assert.equal(await f.installer.executable(), null);
  f.busy(false);
  const installed = await f.installer.install();
  assert.equal(installed.operation?.phase, 'completed');
  assert.equal(installed.operation?.id, staged.operation?.id);
  assert.deepEqual(installed.history, []);
  assert.equal(f.downloads(), 1);
});
test('restart reconciles uncertain activation without a second download or operation', async (t) => {
  const f = await fixture(t);
  await f.installer.install();
  const path = join(f.root, 'managed', 'installation.json');
  const journal = JSON.parse(await readFile(path, 'utf8'));
  journal.operation.phase = 'validating';
  journal.staged = journal.active;
  journal.active.release.secret = 'must not cross IPC';
  journal.operation.extra = 'must not cross IPC';
  await writeFile(path, JSON.stringify(journal));
  const restarted = f.restart();
  const checked = await restarted.check();
  assert.equal(checked.operation?.phase, 'unknown-outcome');
  assert.ok(!JSON.stringify(checked).includes('must not cross IPC'));
  const result = await restarted.install();
  assert.equal(result.operation?.phase, 'completed');
  assert.equal(result.operation?.id, journal.operation.id);
  assert.equal(f.downloads(), 1);
  assert.equal(JSON.parse(await readFile(path, 'utf8')).staged, undefined);
});
test('restart completes rollback if activation failed before the previous pointer was restored', async (t) => {
  const f = await fixture(t);
  await f.installer.install();
  await f.upgrade();
  await f.installer.install();
  const path = join(f.root, 'managed', 'installation.json');
  const journal = JSON.parse(await readFile(path, 'utf8'));
  journal.operation.phase = 'rolling-back';
  delete journal.active;
  await writeFile(path, JSON.stringify(journal));
  const restarted = f.restart();
  assert.equal((await restarted.check()).operation?.phase, 'unknown-outcome');
  const result = await restarted.install();
  assert.equal(result.operation?.phase, 'rolled-back');
  assert.equal(result.installed?.version, '0.2.1');
  assert.equal(result.operation?.id, journal.operation.id);
  assert.equal(f.downloads(), 2);
});
test('restart rejects a damaged or cross-host operation journal', async (t) => {
  const f = await fixture(t);
  await f.installer.install();
  const path = join(f.root, 'managed', 'installation.json');
  const journal = JSON.parse(await readFile(path, 'utf8'));
  journal.operation.hostId = 'another-host';
  await writeFile(path, JSON.stringify(journal));
  const result = await f.restart().check();
  assert.equal(result.discovery, 'blocked');
  assert.match(result.error!, /Invalid runtime operation/);
  assert.equal(result.installed, undefined);
});
test('failed activation restores the previous verified runtime and keeps the failure in history', async (t) => {
  const f = await fixture(t);
  await f.installer.install();
  const previous = await f.installer.executable();
  await f.upgrade();
  const result = await f.installer.install();
  assert.equal(result.operation?.phase, 'rolled-back', JSON.stringify(result));
  assert.equal(result.installed?.version, '0.2.1');
  assert.equal(await f.installer.executable(), previous);
  assert.equal(result.history.length, 1);
  assert.ok(f.phases.includes('rolling-back'));
});
test('a missing release blocks installation without claiming success', async (t) => {
  const f = await fixture(t);
  f.unavailable();
  const result = await f.installer.install();
  assert.equal(result.discovery, 'failed');
  assert.match(result.error!, /No runtime release supports/);
  assert.equal(f.downloads(), 0);
  assert.equal(result.installed, undefined);
});
test('a manifest without a valid signature blocks the install before the download', async (t) => {
  const f = await fixture(t);
  const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  f.serve((url) =>
    url.endsWith('desktop-release-manifest.v1.json.sigstore.json')
      ? new Response(new Uint8Array(signBundle(f.release.bytes(), other.privateKey)))
      : undefined,
  );
  const checked = await f.installer.check(true);
  assert.equal(checked.discovery, 'blocked');
  assert.match(checked.error!, /signature verification failed/);
  assert.equal(checked.canInstall, false);
  const result = await f.installer.install();
  assert.equal(result.installed, undefined);
  assert.equal(f.downloads(), 0);
});
test('an archive without a valid signature is not extracted or installed', async (t) => {
  const f = await fixture(t);
  const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  f.serve((url) =>
    url.endsWith('.tar.gz.sigstore.json')
      ? new Response(new Uint8Array(signBundle(f.release.state.archive, other.privateKey)))
      : undefined,
  );
  const result = await f.installer.install();
  assert.equal(result.operation?.phase, 'failed');
  assert.match(result.operation!.error!, /signature verification failed/);
  assert.equal(result.installed, undefined);
  assert.equal(await f.installer.executable(), null);
  f.serve((url) =>
    url.endsWith('.tar.gz.sigstore.json')
      ? new Response(new Uint8Array(signBundle('other archive')))
      : undefined,
  );
  const checked = await f.installer.check(true);
  assert.equal(checked.discovery, 'blocked');
  assert.match(checked.error!, /does not match the published archive/);
});
test('an older signed release does not replace the installed checkpoint', async (t) => {
  const f = await fixture(t);
  await f.installer.install();
  const older = f.release.discovered();
  const manifest = f.release.bytes();
  const archive = f.release.state.archive;
  await f.upgrade(false);
  assert.equal((await f.installer.install()).installed?.version, '0.2.2');
  // Discovery reports the older release again, for example after a replay.
  const replay = new RuntimeInstaller({
    ...((f.installer as any).options as RuntimeInstallerOptions),
    changed: undefined,
    discover: async () => older,
    request: (async (input: string) => {
      const url = String(input);
      if (url.endsWith('/v0.2.1/desktop-release-manifest.v1.json'))
        return new Response(new Uint8Array(manifest));
      if (url.endsWith('/v0.2.1/desktop-release-manifest.v1.json.sigstore.json'))
        return new Response(new Uint8Array(signBundle(manifest)));
      if (url.endsWith('/v0.2.1/verdictan-aarch64-apple-darwin.tar.gz.sigstore.json'))
        return new Response(new Uint8Array(signBundle(archive)));
      return new Response('Not found', { status: 404 });
    }) as typeof fetch,
  });
  const checked = await replay.check(true);
  assert.equal(checked.discovery, 'blocked');
  assert.match(checked.error!, /older than the installed checkpoint/);
  assert.equal(checked.installed?.version, '0.2.2');
});
test('downloads reject redirects outside approved origins and mismatched artifact bytes', async (t) => {
  const f = await fixture(t);
  const artifact = f.release.manifest.artifacts[0] as any;
  await assert.rejects(
    downloadRuntime(
      artifact,
      join(f.root, 'download1'),
      releaseDownloadOrigins,
      new AbortController().signal,
      () => {},
      (async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'http://elsewhere.test/file' },
        })) as typeof fetch,
    ),
    /unapproved/,
  );
  await assert.rejects(
    downloadRuntime(
      artifact,
      join(f.root, 'download2'),
      releaseDownloadOrigins,
      new AbortController().signal,
      () => {},
      (async () => new Response('bad bytes')) as typeof fetch,
    ),
    /checksum/,
  );
});
test('runtime archive rejects unexpected paths instead of extracting additional files', async (t) => {
  const f = await fixture(t);
  const output = join(f.root, 'output');
  await mkdir(output);
  await writeFile(join(f.source, 'unexpected'), 'unexpected');
  const archive = join(f.root, 'unexpected.tar.gz');
  await create({ gzip: true, file: archive, cwd: f.root }, [
    'verdictan-aarch64-apple-darwin/unexpected',
  ]);
  await assert.rejects(
    extractRuntime(archive, output, f.release.manifest.artifacts[0] as any),
    /unexpected/,
  );
  assert.deepEqual(await readdir(output), []);
});
test('a newer signed release installs automatically when no managed run is busy', async (t) => {
  const f = await fixture(t);
  await f.installer.install();
  await f.upgrade(false);
  f.busy(true);
  const checked = await f.installer.check(true);
  assert.equal(checked.latest?.version, '0.2.2');
  // The check starts the update. During active work, the update waits.
  const waiting = await f.installer.install();
  assert.equal(waiting.operation?.phase, 'waiting-for-idle');
  assert.equal(waiting.installed?.version, '0.2.1');
  f.busy(false);
  // A status read starts the activation when the managed runs stop.
  f.installer.check();
  const updated = await f.installer.install();
  assert.equal(updated.operation?.phase, 'completed', JSON.stringify(updated));
  assert.equal(updated.installed?.version, '0.2.2');
  assert.equal(updated.canInstall, false);
  assert.match(updated.reason!, /0\.2\.2 is installed/);
  assert.equal(f.downloads(), 2);
});
test('a failed automatic update does not start again for the same release', async (t) => {
  const f = await fixture(t);
  await f.installer.install();
  await f.upgrade();
  await f.installer.check(true);
  const failed = await f.installer.install();
  assert.equal(failed.operation?.phase, 'rolled-back');
  assert.equal(failed.installed?.version, '0.2.1');
  assert.equal(failed.canInstall, true);
  await f.installer.check(true);
  assert.equal(f.installer.status().installing, undefined);
  assert.equal(f.downloads(), 2);
});
test('without a known release, the status gives the reason', async (t) => {
  const f = await fixture(t);
  f.unavailable();
  const result = await f.installer.check(true);
  assert.equal(result.canInstall, false);
  assert.match(result.reason!, /No runtime release supports/);
});
test('the status reports a running install before its first journal entry and clears it after', async (t) => {
  const f = await fixture(t);
  await f.installer.check();
  // The Settings button calls start(). It returns before the download begins.
  const started = await f.installer.start();
  assert.equal(started.installing, true);
  assert.equal(started.canInstall, false);
  assert.match(started.reason!, /in progress/);
  // A poll during the install sees the flag, so the window keeps reading the status.
  assert.equal(f.installer.status().installing, true);
  const done = await f.installer.install();
  assert.equal(done.operation?.phase, 'completed');
  assert.equal(done.installing, undefined);
  assert.equal(done.installed?.version, '0.2.1');
  assert.equal(f.installer.status().installing, undefined);
  assert.match(f.installer.status().reason!, /is installed/);
});
test('a failed install returns a final status that can install again', async (t) => {
  const f = await fixture(t);
  const options = (f.installer as any).options as RuntimeInstallerOptions;
  const installer = new RuntimeInstaller({
    ...options,
    changed: undefined,
    request: (async (url: string, init?: RequestInit) =>
      String(url).endsWith('.tar.gz')
        ? new Response('broken', { status: 500 })
        : f.release.request(url, init)) as typeof fetch,
  });
  await installer.check();
  const failed = await installer.install();
  assert.equal(failed.operation?.phase, 'failed');
  assert.equal(failed.installing, undefined);
  assert.equal(failed.canInstall, true);
  assert.equal(failed.reason, undefined);
});
test('a Linux host installs the signed archive that discovery reports', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'runtime-install-linux-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const target = 'verdictan-x86_64-unknown-linux-gnu';
  await mkdir(join(root, target));
  const files = ['verdictan', 'verdictan-update', 'THIRD_PARTY_NOTICES.md'];
  for (const file of files) await writeFile(join(root, target, file), 'fixture executable');
  const archiveFile = join(root, 'runtime.tar.gz');
  await create(
    { gzip: true, file: archiveFile, cwd: root, portable: true, mtime: new Date(0) },
    files.map((name) => `${target}/${name}`),
  );
  const release = releaseFixture(await readFile(archiveFile), 'x86_64-unknown-linux-gnu');
  const probed: string[] = [];
  const installer = new RuntimeInstaller({
    root: join(root, 'managed'),
    hostId: 'remote-linux',
    desktopVersion: '0.1.0',
    os: 'linux',
    arch: 'x64',
    systemVersion: '6.12.0',
    now: () => release.options.now * 1000,
    discover: async () => release.discovered(),
    key: testKeys.publicKey,
    busy: () => false,
    request: release.request,
    probe: async (_path, version) => {
      probed.push(version);
    },
  });
  const result = await installer.install();
  assert.equal(result.operation?.phase, 'completed', JSON.stringify(result));
  assert.equal(result.installed?.version, '0.2.1');
  assert.equal(result.installed?.sha256, release.discovered().sha256);
  assert.ok(probed.includes('0.2.1'));
  assert.ok(await installer.executable());
});
