import test from 'node:test';
import assert from 'node:assert/strict';
import bundled from '../electron/verdictan/runtime-policy.json';
import { runtimePolicyForHost, type RuntimePolicy } from '../electron/verdictan/install';
import { verifyRuntimeRelease } from '../electron/verdictan/release';

test('bundled runtime pins select the execution host, including SSH Linux', () => {
  const policy = bundled as RuntimePolicy;
  const manifest = JSON.parse(policy.manifest);
  for (const artifact of manifest.artifacts) {
    const selected = runtimePolicyForHost(policy, artifact.os, artifact.arch);
    const release = verifyRuntimeRelease(Buffer.from(selected.manifest), selected.pin, {
      now: JSON.parse(selected.manifest).issued_at + 1,
      desktopVersion: '0.1.0',
      os: artifact.os,
      arch: artifact.arch,
      systemVersion: artifact.minimum_os_version,
    });
    assert.equal(release.artifact.target, artifact.target);
    assert.equal(release.artifact.sha256, selected.pin.artifact_sha256);
    assert.equal(release.version, '0.6.4');
    // Each host policy approves only its own target. Do not copy a pin to another target.
    assert.deepEqual(
      JSON.parse(selected.manifest).artifacts.map((entry: { target: string }) => entry.target),
      [artifact.target],
    );
    assert.ok(JSON.parse(selected.manifest).revoked_versions.includes('0.4.0'));
  }
  const mac = JSON.parse(runtimePolicyForHost(policy, 'darwin', 'arm64').manifest).artifacts[0];
  assert.equal(
    mac.executable_sha256,
    '8c304dea2d503ecc7a1f8d1331db488ee77d995550fd845980802f5a9740d5b6',
  );
  const linuxManifest = JSON.parse(runtimePolicyForHost(policy, 'linux', 'x64').manifest);
  // The reviewed Linux manifest must have a higher sequence than the 0.6.3 reviewed manifest.
  assert.ok(linuxManifest.sequence > 1792590862000);
  assert.equal(linuxManifest.minimum_desktop_version, '0.1.0');
  assert.deepEqual(linuxManifest.protocol, { min: 1, max: 1 });
  assert.deepEqual(linuxManifest.revoked_versions, ['0.4.0']);
  const linux = linuxManifest.artifacts[0];
  assert.equal(linux.node_included, true);
  assert.equal(linux.redistribution_notice, 'KALKIDAN_REDISTRIBUTION.md');
  assert.equal(
    linux.executable_sha256,
    'cfca795479a55095e0f29f291e3057719ba92aa3a0b7c5ebbead8ce4d5500cc1',
  );
  assert.equal(linux.minimum_os_version, '6.12.0');
  assert.deepEqual(linux.required_runtime_dependencies, [
    'glibc (validated on Enterprise Linux 10.2)',
    'bubblewrap >= 0.10.0',
    'python3',
  ]);
  assert.throws(() => runtimePolicyForHost(policy, 'win32', 'x64'), /No reviewed/);
  assert.throws(() => runtimePolicyForHost(policy, 'linux', 'arm64'), /No reviewed/);
  assert.equal(
    runtimePolicyForHost({ ...policy, pins: undefined, hostPolicies: undefined }, 'darwin', 'arm64')
      .pin,
    policy.pin,
  );
});
