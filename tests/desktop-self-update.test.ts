import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  DesktopUpdates,
  githubReleaseOrigin,
  parseChecksums,
  releaseOrigin,
} from '../electron/updates/desktop';
import {
  applyStagedUpdate,
  detectInstallation,
  macApplyScript,
  type DesktopInstallation,
} from '../electron/updates/desktop-install';

const running = '0.1.0-build.100.aaaaaaaaaaaa';
const next = '0.1.0-build.200.bbbbbbbbbbbb';
const tag = `kalkidan-v${next}`;
const download = `${githubReleaseOrigin.download}${tag}/`;
const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');

/** A fake GitHub release feed and download server. */
function server(options: {
  asset: string;
  bytes: Buffer;
  sums?: string;
  digest?: string;
  served?: Buffer;
  redirect?: string;
}) {
  const requests: string[] = [];
  const release = {
    id: 9,
    tag_name: tag,
    html_url: `${githubReleaseOrigin.page}${tag}`,
    published_at: '2026-10-21T00:00:00Z',
    draft: false,
    prerelease: false,
    assets: [
      {
        name: options.asset,
        size: options.bytes.length,
        digest: `sha256:${options.digest || sha(options.bytes)}`,
        browser_download_url: `${download}${options.asset}`,
      },
      {
        name: 'SHA256SUMS.txt',
        size: 100,
        digest: `sha256:${'0'.repeat(64)}`,
        browser_download_url: `${download}SHA256SUMS.txt`,
      },
    ],
  };
  const request = (async (url: string) => {
    requests.push(url);
    const asset = `https://release-assets.githubusercontent.com/${options.asset}`;
    if (url === `${download}SHA256SUMS.txt`)
      return new Response(options.sums ?? `${sha(options.bytes)}  ${options.asset}\n`);
    if (url === `${download}${options.asset}`)
      return new Response(null, {
        status: 302,
        headers: { location: options.redirect || asset },
      });
    if (url === asset) return new Response(new Uint8Array(options.served || options.bytes));
    return new Response('missing', { status: 404 });
  }) as typeof globalThis.fetch;
  return { feed: async () => [release], fetch: request, requests };
}
async function fixture(
  root: string,
  installation: DesktopInstallation,
  serving: ReturnType<typeof server>,
  extra: Partial<ConstructorParameters<typeof DesktopUpdates>[0]> = {},
) {
  await writeFile(join(root, 'main.cjs'), 'bundle');
  return new DesktopUpdates({
    version: running,
    bundle: join(root, 'main.cjs'),
    journal: join(root, 'updates', 'desktop-discovery.json'),
    platform: 'linux',
    arch: 'x64',
    feed: serving.feed,
    fetch: serving.fetch,
    installation: async () => installation,
    ...extra,
  });
}
const appImage = (target: string): DesktopInstallation => ({
  kind: 'appimage',
  selfUpdate: true,
  target,
  asset: 'linux-x64.AppImage',
});

test('the updater downloads, verifies, stages, and installs only after explicit actions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-self-update-'));
  try {
    const target = join(root, 'Kalkidan.AppImage');
    await writeFile(target, 'old image');
    const bytes = Buffer.from('#!/bin/sh\necho new image\n'.repeat(50000));
    const asset = `Kalkidan-${next}-linux-x64.AppImage`;
    const serving = server({ asset, bytes });
    const calls: string[] = [];
    const service = await fixture(root, appImage(target), serving, {
      quit: () => calls.push('quit'),
      relaunch: (path) => calls.push(`relaunch:${path}`),
    });
    const status = await service.status(true);
    assert.equal(status.discovery, 'available');
    assert.equal(status.install.selfUpdate, true);
    assert.equal(status.release?.asset, asset);
    // Discovery alone never downloads.
    assert.deepEqual(serving.requests, []);
    await assert.rejects(service.restart(), /Download and verify/);
    const started = await service.download();
    assert.equal(started.update?.phase, 'downloading');
    const staged = await service.settled();
    assert.equal(staged.update?.phase, 'staged');
    assert.equal(staged.update?.receivedBytes, bytes.length);
    // The checksum list is read before the installer.
    assert.equal(serving.requests[0], `${download}SHA256SUMS.txt`);
    // Staging never restarts the app or replaces the installed file.
    assert.deepEqual(calls, []);
    assert.equal(await readFile(target, 'utf8'), 'old image');
    const restarted = await service.restart();
    assert.equal(restarted.update?.phase, 'restarting');
    assert.deepEqual(calls, [`relaunch:${target}`, 'quit']);
    assert.equal(sha(await readFile(target)), sha(bytes));
    // The new version starts: the staged download is removed.
    const after = await fixture(root, appImage(target), serving, { version: next });
    assert.equal((await after.status()).update, undefined);
    await assert.rejects(access(join(root, 'updates', 'desktop')));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the updater rejects checksum, digest, size, and origin mismatches', async () => {
  const bytes = Buffer.from('installer bytes');
  const asset = `Kalkidan-${next}-linux-x64.AppImage`;
  const cases: [string, Parameters<typeof server>[0], RegExp][] = [
    ['sums', { asset, bytes, sums: `${'1'.repeat(64)}  ${asset}\n` }, /checksums do not match/],
    ['missing', { asset, bytes, sums: `${sha(bytes)}  other\n` }, /checksums do not match/],
    ['invalid', { asset, bytes, sums: 'not a checksum list' }, /not valid/],
    [
      'tampered',
      { asset, bytes, served: Buffer.from('installer bytez') },
      /does not match the published SHA-256/,
    ],
    ['short', { asset, bytes, served: Buffer.from('short') }, /not complete/],
    ['long', { asset, bytes, served: Buffer.concat([bytes, bytes]) }, /larger than/],
    [
      'origin',
      { asset, bytes, redirect: 'https://untrusted.example/installer' },
      /left the trusted release server/,
    ],
  ];
  for (const [name, options, message] of cases) {
    const root = await mkdtemp(join(tmpdir(), `desktop-reject-${name}-`));
    try {
      const target = join(root, 'Kalkidan.AppImage');
      await writeFile(target, 'old');
      const service = await fixture(root, appImage(target), server(options));
      await service.status(true);
      await service.download();
      const result = await service.settled();
      assert.equal(result.update?.phase, 'failed', name);
      assert.match(result.update?.error || '', message, name);
      // A rejected download leaves nothing staged and keeps the installed file.
      await assert.rejects(access(join(root, 'updates', 'desktop')), name);
      assert.equal(await readFile(target, 'utf8'), 'old');
      await assert.rejects(service.restart(), /Download and verify/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
});

test('a staged file that changes is not installed, and downloads can be canceled', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-staged-'));
  try {
    const target = join(root, 'Kalkidan.AppImage');
    await writeFile(target, 'old');
    const bytes = Buffer.alloc(4 * 1024 * 1024, 1);
    const asset = `Kalkidan-${next}-linux-x64.AppImage`;
    let applied = 0;
    const service = await fixture(root, appImage(target), server({ asset, bytes }), {
      apply: async () => {
        applied++;
      },
    });
    await service.status(true);
    await service.download();
    assert.equal((await service.settled()).update?.phase, 'staged');
    await writeFile(join(root, 'updates', 'desktop', asset), 'changed');
    const result = await service.restart();
    assert.equal(result.update?.phase, 'failed');
    assert.match(result.update?.error || '', /changed/);
    assert.equal(applied, 0);
    await service.download();
    const canceled = await service.cancel();
    assert.ok(['canceled', 'staged'].includes(canceled.update!.phase));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('an install kind that cannot update itself keeps the release page and never downloads', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-manual-'));
  try {
    const bytes = Buffer.from('deb');
    const asset = `Kalkidan-${next}-linux-x64.deb`;
    const serving = server({ asset, bytes });
    const service = await fixture(
      root,
      {
        kind: 'deb',
        selfUpdate: false,
        reason: 'Kalkidan was installed from a DEB package.',
        asset: 'linux-x64.deb',
      },
      serving,
    );
    const status = await service.status(true);
    assert.equal(status.discovery, 'available');
    assert.equal(status.install.selfUpdate, false);
    assert.match(status.install.reason!, /DEB/);
    assert.equal(status.release?.url, `${githubReleaseOrigin.page}${tag}`);
    await assert.rejects(service.download(), /DEB package/);
    assert.deepEqual(serving.requests, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a failed macOS replacement shows the result after the next start', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-result-'));
  try {
    const folder = join(root, 'updates', 'desktop');
    await mkdir(folder, { recursive: true });
    await writeFile(
      join(folder, 'staged.json'),
      JSON.stringify({
        version: next,
        name: 'x.zip',
        sha256: 'a'.repeat(64),
        kind: 'mac-app',
        staged: folder,
      }),
    );
    await writeFile(join(folder, 'result.txt'), 'failed\n');
    const service = await fixture(
      root,
      { kind: 'mac-app', selfUpdate: true, target: root },
      server({ asset: 'x', bytes: Buffer.from('x') }),
    );
    const status = await service.status();
    assert.equal(status.update?.phase, 'failed');
    assert.match(status.update?.error || '', /previous version still runs/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('checksum lists, release origins, and install kinds are strict', async () => {
  assert.deepEqual(
    [...parseChecksums(`${'a'.repeat(64)}  Kalkidan-1.zip\n${'b'.repeat(64)} *Kalkidan-2.exe\r\n`)],
    [
      ['Kalkidan-1.zip', 'a'.repeat(64)],
      ['Kalkidan-2.exe', 'b'.repeat(64)],
    ],
  );
  assert.throws(() => parseChecksums(`${'a'.repeat(64)}  ../evil\n`));
  assert.throws(() => parseChecksums(`${'a'.repeat(64)}  x\n${'b'.repeat(64)}  x\n`));
  assert.equal(releaseOrigin(undefined), githubReleaseOrigin);
  assert.equal(releaseOrigin('https://example.com/feed'), githubReleaseOrigin);
  assert.equal(releaseOrigin('http://evil.example/feed'), githubReleaseOrigin);
  assert.deepEqual(releaseOrigin('http://127.0.0.1:9000/feed/').origins, ['http://127.0.0.1:9000']);

  const root = await mkdtemp(join(tmpdir(), 'desktop-install-'));
  try {
    const base = { arch: 'x64', packaged: true, env: {} };
    assert.equal(
      (await detectInstallation({ ...base, platform: 'darwin', execPath: '/x', packaged: false }))
        .kind,
      'development',
    );
    const app = join(root, 'Kalkidan.app');
    await mkdir(join(app, 'Contents', 'MacOS'), { recursive: true });
    const mac = await detectInstallation({
      ...base,
      platform: 'darwin',
      execPath: join(app, 'Contents', 'MacOS', 'Kalkidan'),
    });
    assert.deepEqual(
      [mac.kind, mac.selfUpdate, mac.target, mac.asset],
      ['mac-app', true, app, 'mac-x64.zip'],
    );
    const translocated = await detectInstallation({
      ...base,
      platform: 'darwin',
      execPath: '/private/var/folders/x/AppTranslocation/1/d/Kalkidan.app/Contents/MacOS/Kalkidan',
    });
    assert.equal(translocated.selfUpdate, false);
    assert.match(translocated.reason!, /Applications folder/);
    const windows = join(root, 'win');
    await mkdir(windows);
    const portable = await detectInstallation({
      ...base,
      platform: 'win32',
      execPath: join(windows, 'Kalkidan.exe'),
    });
    assert.equal(portable.kind, 'portable');
    assert.equal(portable.selfUpdate, false);
    await writeFile(join(windows, 'Uninstall Kalkidan.exe'), '');
    const installer = await detectInstallation({
      ...base,
      platform: 'win32',
      execPath: join(windows, 'Kalkidan.exe'),
    });
    assert.deepEqual([installer.kind, installer.selfUpdate], ['windows-installer', true]);
    const image = join(root, 'Kalkidan.AppImage');
    await writeFile(image, '');
    const appimage = await detectInstallation({
      ...base,
      platform: 'linux',
      execPath: '/tmp/.mount/kalkidan',
      env: { APPIMAGE: image },
    });
    assert.deepEqual([appimage.kind, appimage.selfUpdate], ['appimage', true]);
    const deb = await detectInstallation({
      ...base,
      platform: 'linux',
      execPath: '/opt/Kalkidan/kalkidan',
    });
    assert.deepEqual([deb.kind, deb.selfUpdate], ['deb', false]);
    const arm = await detectInstallation({
      ...base,
      arch: 'arm64',
      platform: 'linux',
      execPath: '/x',
    });
    assert.equal(arm.selfUpdate, false);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the Windows installer runs silently and the app quits', async () => {
  const calls: unknown[] = [];
  await applyStagedUpdate({
    installation: { kind: 'windows-installer', selfUpdate: true, target: 'C:\\Kalkidan' },
    staged: 'C:\\stage\\setup.exe',
    result: join(tmpdir(), `result-${process.pid}.txt`),
    pid: 1,
    execPath: 'C:\\Kalkidan\\Kalkidan.exe',
    quit: () => calls.push('quit'),
    relaunch: () => calls.push('relaunch'),
    run: ((command: string, args: string[]) => {
      calls.push([command, args]);
      return { unref() {} };
    }) as any,
  });
  assert.deepEqual(calls, [['C:\\stage\\setup.exe', ['--updated', '/S', '--force-run']], 'quit']);
});

test('the macOS script swaps the bundle after the app stops and keeps it on failure', async (t) => {
  if (process.platform === 'win32') return t.skip('POSIX shell script');
  const root = await mkdtemp(join(tmpdir(), 'desktop-mac-script-'));
  try {
    const script = join(root, 'apply.sh');
    await writeFile(script, macApplyScript);
    const bundle = async (path: string, text: string) => {
      await mkdir(join(path, 'Contents', 'MacOS'), { recursive: true });
      const executable = join(path, 'Contents', 'MacOS', 'Kalkidan');
      await writeFile(executable, `#!/bin/sh\necho ${text} > "${join(root, 'launched')}"\n`);
      await chmod(executable, 0o755);
    };
    const target = join(root, 'Kalkidan.app');
    const staged = join(root, 'stage', 'Kalkidan.app');
    await bundle(target, 'old');
    await bundle(staged, 'new');
    // A process that stops at once stands in for the quitting app.
    const app = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 300)']);
    const result = join(root, 'result.txt');
    // Run the script without blocking, so that this process collects the stopped child.
    await promisify(execFile)('/bin/sh', [
      script,
      String(app.pid),
      staged,
      target,
      result,
      'Kalkidan',
    ]);
    for (let i = 0; i < 100; i++) {
      if (
        await access(join(root, 'launched')).then(
          () => true,
          () => false,
        )
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal((await readFile(result, 'utf8')).trim(), 'installed');
    assert.equal((await readFile(join(root, 'launched'), 'utf8')).trim(), 'new');
    await assert.rejects(access(join(root, '.Kalkidan.app.previous')));
    // A missing staged bundle keeps the installed bundle and opens it again.
    await rm(join(root, 'launched'));
    await promisify(execFile)('/bin/sh', [
      script,
      '999999',
      join(root, 'missing.app'),
      target,
      result,
      'Kalkidan',
    ]);
    for (let i = 0; i < 100; i++) {
      if (
        await access(join(root, 'launched')).then(
          () => true,
          () => false,
        )
      )
        break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal((await readFile(result, 'utf8')).trim(), 'failed');
    assert.equal((await readFile(join(root, 'launched'), 'utf8')).trim(), 'new');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('macOS staging accepts only the expected Kalkidan bundle and version', async (t) => {
  if (process.platform !== 'darwin') return t.skip('Needs ditto and plutil');
  const root = await mkdtemp(join(tmpdir(), 'desktop-mac-stage-'));
  try {
    const run = promisify(execFile);
    const archive = async (id: string, version: string) => {
      const folder = await mkdtemp(join(root, 'bundle-'));
      const app = join(folder, 'Kalkidan.app');
      await mkdir(join(app, 'Contents', 'MacOS'), { recursive: true });
      await writeFile(join(app, 'Contents', 'MacOS', 'Kalkidan'), '#!/bin/sh\n', { mode: 0o755 });
      const plist = join(app, 'Contents', 'Info.plist');
      await run('/usr/bin/plutil', ['-create', 'xml1', plist]);
      for (const [key, value] of [
        ['CFBundleIdentifier', id],
        ['CFBundleShortVersionString', version],
        ['CFBundleExecutable', 'Kalkidan'],
      ])
        await run('/usr/bin/plutil', ['-insert', key, '-string', value, plist]);
      const zip = join(folder, 'app.zip');
      await run('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, zip]);
      return readFile(zip);
    };
    const asset = `Kalkidan-${next}-mac-arm64.zip`;
    const cases: [Buffer, string][] = [
      [await archive('dev.kalkidan.desktop', next), 'staged'],
      [await archive('dev.kalkidan.desktop', running), 'failed'],
      [await archive('com.example.other', next), 'failed'],
    ];
    for (const [bytes, phase] of cases) {
      const home = await mkdtemp(join(root, 'home-'));
      const target = join(home, 'Kalkidan.app');
      const service = await fixture(
        home,
        { kind: 'mac-app', selfUpdate: true, target, asset: 'mac-arm64.zip' },
        server({ asset, bytes }),
        { platform: 'darwin', arch: 'arm64' },
      );
      await service.status(true);
      await service.download();
      const result = await service.settled();
      assert.equal(result.update?.phase, phase, String(result.update?.error));
      if (phase === 'staged')
        await access(join(home, 'updates', 'desktop', 'app', 'Kalkidan.app', 'Contents'));
      else assert.match(result.update?.error || '', /not valid/);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
