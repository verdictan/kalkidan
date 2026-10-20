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
      now: manifest.issued_at + 1,
      desktopVersion: '0.1.0',
      os: artifact.os,
      arch: artifact.arch,
      systemVersion: artifact.minimum_os_version,
    });
    assert.equal(release.artifact.target, artifact.target);
    assert.equal(release.artifact.sha256, selected.pin.artifact_sha256);
    assert.equal(release.version, '0.3.0');
  }
  assert.throws(() => runtimePolicyForHost(policy, 'win32', 'x64'), /No reviewed/);
  assert.throws(() => runtimePolicyForHost(policy, 'linux', 'arm64'), /No reviewed/);
  assert.equal(
    runtimePolicyForHost({ ...policy, pins: undefined }, 'darwin', 'arm64').pin,
    policy.pin,
  );
});
