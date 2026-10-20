import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DesktopUpdates, desktopReleaseIsNewer } from '../electron/updates/desktop';
const version = '0.1.0-build.100.aaaaaaaaaaaa';
const release = {
  id: 123,
  tag_name: `kalkidan-v${version}`,
  html_url: `https://github.com/verdictan/packages/releases/tag/kalkidan-v${version}`,
  published_at: '2026-10-20T00:00:00Z',
  draft: false,
  prerelease: false,
  assets: [{ name: `Kalkidan-${version}-mac-arm64.dmg`, digest: `sha256:${'a'.repeat(64)}` }],
};
test('desktop discovery selects Kalkidan assets, coalesces reads, retains stale evidence and rejects untrusted metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'desktop-update-'));
  try {
    const bundle = join(root, 'main.cjs');
    await writeFile(bundle, 'fixture');
    let calls = 0,
      offline = false;
    let now = 1000;
    const service = new DesktopUpdates({
      version: '0.1.0',
      bundle,
      journal: join(root, 'discovery.json'),
      platform: 'darwin',
      arch: 'arm64',
      now: () => now,
      feed: async () => {
        calls++;
        if (offline) throw Error('private service output');
        return [{ tag_name: 'v0.3.0' }, release];
      },
    });
    const [a, b] = await Promise.all([service.status(), service.status()]);
    assert.deepEqual(a, b);
    assert.equal(calls, 1);
    assert.equal(a.discovery, 'available');
    assert.equal(a.release?.id, '123');
    assert.equal(a.runningBuild.length, 64);
    await service.status();
    assert.equal(calls, 1);
    offline = true;
    now++;
    const failed = await service.status(true);
    assert.equal(failed.discovery, 'failed');
    assert.equal(failed.stale, true);
    assert.equal(failed.release?.id, '123');
    assert.ok(!JSON.stringify(failed).includes('private service output'));
    const invalid = new DesktopUpdates({
      version: '0.1.0',
      bundle,
      journal: join(root, 'other.json'),
      platform: 'darwin',
      arch: 'arm64',
      feed: async () => [{ ...release, html_url: 'https://untrusted.example/download' }],
    });
    assert.equal((await invalid.status()).discovery, 'failed');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('version comparison uses numeric and build identities without offering downgrades', () => {
  assert.equal(desktopReleaseIsNewer('0.10.0', '0.9.0'), true);
  assert.equal(desktopReleaseIsNewer('0.9.0', '0.10.0'), false);
  assert.equal(desktopReleaseIsNewer(version, version), false);
  assert.equal(desktopReleaseIsNewer('0.1.0-build.99.bbbbbbbbbbbb', version), false);
  assert.equal(desktopReleaseIsNewer('0.1.0-build.100.bbbbbbbbbbbb', version), true);
});
