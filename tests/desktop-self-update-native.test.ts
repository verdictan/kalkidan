import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { macApplyScript } from '../electron/updates/desktop-install';
import { fixture, next, running, server } from './helpers/desktop-updates';

// These tests start real processes, so the offline backend suite does not run this file.

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
