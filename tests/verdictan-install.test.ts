import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { create } from 'tar';
import {
  RuntimeInstaller,
  type RuntimeInstallerOptions,
  type RuntimePolicy,
} from '../electron/verdictan/install';
import { downloadRuntime } from '../electron/verdictan/download';
import { extractRuntime } from '../electron/verdictan/archive';
import { sha256 } from '../electron/verdictan/release';
import { releaseFixture } from './helpers/verdictan-fixture';

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
  let archive = await readFile(archiveFile);
  const release = releaseFixture(archive);
  let policy: RuntimePolicy | null = {
    manifest: JSON.stringify(release.manifest),
    pin: release.pin(),
    downloadOrigins: ['https://releases.example.test'],
  };
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
    policy: async () => policy,
    busy: () => busy,
    request: (async () => {
      downloads++;
      return new Response(new Uint8Array(archive));
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
      policy = null;
    },
    async upgrade() {
      for (const name of ['verdictan', 'verdictan-update'])
        await writeFile(join(source, name), 'fixture executable upgraded');
      await create(
        { gzip: true, file: archiveFile, cwd: root, portable: true, mtime: new Date(0) },
        ['verdictan', 'verdictan-update', 'THIRD_PARTY_NOTICES.md'].map(
          (name) => 'verdictan-aarch64-apple-darwin/' + name,
        ),
      );
      archive = await readFile(archiveFile);
      release.manifest.version = '0.2.2';
      release.manifest.sequence++;
      release.manifest.artifacts[0].sha256 = sha256(archive);
      release.manifest.artifacts[0].size = archive.length;
      policy = {
        manifest: JSON.stringify(release.manifest),
        pin: release.pin(),
        downloadOrigins: ['https://releases.example.test'],
      };
      failActivation = true;
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
test('missing release metadata blocks installation without claiming success', async (t) => {
  const f = await fixture(t);
  f.unavailable();
  const result = await f.installer.install();
  assert.equal(result.discovery, 'blocked');
  assert.match(result.error!, /No reviewed/);
  assert.equal(f.downloads(), 0);
  assert.equal(result.installed, undefined);
});
test('downloads reject redirects outside approved origins and mismatched artifact bytes', async (t) => {
  const f = await fixture(t);
  const artifact = f.release.manifest.artifacts[0] as any;
  await assert.rejects(
    downloadRuntime(
      artifact,
      join(f.root, 'download1'),
      ['https://releases.example.test'],
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
      ['https://releases.example.test'],
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
test('a newer release that is not approved is a notice and the approved release stays installable', async (t) => {
  const f = await fixture(t);
  const newer = { version: '9.9.9', releaseId: 'newer', sha256: 'f'.repeat(64) };
  const installer = new RuntimeInstaller({
    ...(f.installer as any).options,
    changed: undefined,
    discover: async () => newer,
  });
  const before = await installer.check(true);
  assert.equal(before.discovery, 'available');
  assert.equal(before.error, undefined);
  assert.match(before.notice!, /9\.9\.9 is available\. It is not approved/);
  assert.equal(before.canInstallApproved, true);
  assert.equal(before.reason, undefined);
  const installed = await installer.install();
  assert.equal(installed.operation?.phase, 'completed');
  assert.equal(installed.canInstallApproved, false);
  assert.match(installed.reason!, /is installed/);
  const after = await installer.check(true);
  assert.equal(after.discovery, 'current');
  assert.ok(after.notice);
});
test('without an approved release, the status gives the reason', async (t) => {
  const f = await fixture(t);
  f.unavailable();
  const result = await f.installer.check(true);
  assert.equal(result.canInstallApproved, false);
  assert.match(result.reason!, /No reviewed/);
});
test('the status reports a running install before its first journal entry and clears it after', async (t) => {
  const f = await fixture(t);
  await f.installer.check();
  // The Settings button calls start(). It returns before the download begins.
  const started = await f.installer.start();
  assert.equal(started.installing, true);
  assert.equal(started.canInstallApproved, false);
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
    request: (async () => new Response('broken', { status: 500 })) as typeof fetch,
  });
  await installer.check();
  const failed = await installer.install();
  assert.equal(failed.operation?.phase, 'failed');
  assert.equal(failed.installing, undefined);
  assert.equal(failed.canInstallApproved, true);
  assert.equal(failed.reason, undefined);
});
