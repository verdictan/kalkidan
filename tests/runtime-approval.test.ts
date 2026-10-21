import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { check, resolveConfig } from 'prettier';
import bundled from '../electron/verdictan/runtime-policy.json';
import type { RuntimePolicy } from '../electron/verdictan/install';
import {
  approveRuntime,
  bundledPolicyPath,
  formatPolicy,
  packagePath,
} from '../scripts/runtime-approval';
import { releaseFixture } from './helpers/verdictan-fixture';

function githubFixture() {
  const f = releaseFixture();
  f.manifest.artifacts[0].url =
    'https://github.com/verdictan/packages/releases/download/v0.2.1/verdictan.tar.gz';
  const bytes = () => Buffer.from(JSON.stringify(f.manifest));
  const host = { os: 'darwin', arch: 'arm64', systemVersion: '26.7.1' };
  const options = { now: f.options.now, desktopVersion: '0.1.0' };
  return { f, bytes, host, options };
}

test('runtime approval adds a host policy with the default download origins', () => {
  const { f, bytes, host, options } = githubFixture();
  const base = { manifest: '{}', pin: f.pin(), downloadOrigins: [] } as RuntimePolicy;
  const { policy, summary } = approveRuntime(
    { ...base, pins: {} },
    bytes(),
    f.pin(),
    host,
    options,
  );
  assert.equal(summary.approvedVersion, '0.2.1');
  assert.equal(summary.previousVersion, undefined);
  assert.equal(summary.expiresAt, f.manifest.expires_at);
  assert.deepEqual(policy.hostPolicies?.['darwin-arm64']?.downloadOrigins, [
    'https://github.com',
    'https://release-assets.githubusercontent.com',
  ]);
});

test('runtime approval rejects a changed manifest that keeps the approved sequence', () => {
  const { f, bytes, host, options } = githubFixture();
  const first = approveRuntime(
    { manifest: '{}', pin: f.pin(), downloadOrigins: [], pins: {} },
    bytes(),
    f.pin(),
    host,
    options,
  ).policy;
  // The same reviewed manifest can be approved again.
  assert.equal(
    approveRuntime(first, bytes(), f.pin(), host, options).summary.previousVersion,
    '0.2.1',
  );
  (f.manifest as any).source_revision = 'changed';
  assert.throws(() => approveRuntime(first, bytes(), f.pin(), host, options), /higher sequence/);
  f.manifest.sequence = 2;
  const second = approveRuntime(first, bytes(), f.pin(), host, options).policy;
  f.manifest.sequence = 1;
  assert.throws(() => approveRuntime(second, bytes(), f.pin(), host, options), /older manifest/);
});

test('runtime approval checks the minimum desktop version of the caller', () => {
  const { f, bytes, host, options } = githubFixture();
  f.manifest.minimum_desktop_version = '0.2.0';
  const policy = { manifest: '{}', pin: f.pin(), downloadOrigins: [], pins: {} };
  assert.throws(() => approveRuntime(policy, bytes(), f.pin(), host, options), /Update Kalkidan/);
  assert.equal(
    approveRuntime(policy, bytes(), f.pin(), host, { ...options, desktopVersion: '0.2.0' }).summary
      .approvedVersion,
    '0.2.1',
  );
});

test('runtime approval writes a policy that passes the repository format check', async () => {
  const text = await formatPolicy(bundled as RuntimePolicy);
  assert.equal(text, await readFile(bundledPolicyPath, 'utf8'));
  const config = (await resolveConfig(bundledPolicyPath)) || {};
  assert.ok(await check(text, { ...config, filepath: bundledPolicyPath }));
  // A plain JSON.stringify result, as the old command wrote, fails the same check.
  assert.equal(
    await check(JSON.stringify(bundled, null, 2) + '\n', {
      ...config,
      filepath: bundledPolicyPath,
    }),
    false,
  );
});

test('runtime approval finds the bundled policy and package from its own location', async () => {
  assert.ok(isAbsolute(bundledPolicyPath) && isAbsolute(packagePath));
  assert.deepEqual(JSON.parse(await readFile(bundledPolicyPath, 'utf8')), bundled);
  assert.equal(JSON.parse(await readFile(packagePath, 'utf8')).name, 'kalkidan');
});

test('the bundled host approvals can be approved again without change', () => {
  const policy = bundled as RuntimePolicy;
  for (const [os, arch, systemVersion] of [
    ['darwin', 'arm64', '26.7.1'],
    ['linux', 'x64', '6.12.0'],
  ]) {
    const selected = policy.hostPolicies![`${os}-${arch}`];
    const manifest = JSON.parse(selected.manifest);
    const { policy: again } = approveRuntime(
      policy,
      Buffer.from(selected.manifest),
      selected.pin,
      { os, arch, systemVersion },
      { now: manifest.issued_at + 1, desktopVersion: '0.1.0' },
    );
    assert.deepEqual(again, policy);
  }
});
