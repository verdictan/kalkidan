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
    assert.equal(release.version, '0.6.1');
    // Each host policy approves only its own target. Do not copy a pin to another target.
    assert.deepEqual(
      JSON.parse(selected.manifest).artifacts.map((entry: { target: string }) => entry.target),
      [artifact.target],
    );
    assert.ok(JSON.parse(selected.manifest).revoked_versions.includes('0.4.0'));
  }
  const linux = JSON.parse(runtimePolicyForHost(policy, 'linux', 'x64').manifest).artifacts[0];
  assert.equal(
    linux.executable_sha256,
    'f4784283f864f9f433e2632d023e5b84db0111b8114c32bee38d75187ddb88a5',
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
