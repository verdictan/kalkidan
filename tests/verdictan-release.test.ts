import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyRuntimeRelease } from '../electron/verdictan/release';
import { releaseFixture } from './helpers/verdictan-fixture';

test('unsigned releases require independent pins, platform compatibility and monotonic metadata', () => {
  const f = releaseFixture();
  const bytes = Buffer.from(JSON.stringify(f.manifest));
  const accepted = verifyRuntimeRelease(bytes, f.pin(), f.options);
  assert.equal(accepted.version, '0.2.1');
  assert.equal(accepted.artifact.arch, 'arm64');
  assert.deepEqual(
    verifyRuntimeRelease(bytes, f.pin(), { ...f.options, checkpoint: accepted.checkpoint }),
    accepted,
  );
  assert.throws(
    () => verifyRuntimeRelease(bytes, { ...f.pin(), manifest_sha256: '0'.repeat(64) }, f.options),
    /checksum/,
  );
  assert.throws(
    () => verifyRuntimeRelease(bytes, { ...f.pin(), artifact_sha256: '0'.repeat(64) }, f.options),
    /artifact/,
  );
  assert.throws(
    () => verifyRuntimeRelease(bytes, { ...f.pin(), revoked_versions: ['0.2.1'] }, f.options),
    /revoked/,
  );
  assert.throws(
    () => verifyRuntimeRelease(bytes, f.pin(), { ...f.options, os: 'win32' }),
    /supports/,
  );
  assert.throws(
    () => verifyRuntimeRelease(bytes, f.pin(), { ...f.options, now: f.manifest.expires_at }),
    /expired/,
  );
  assert.throws(
    () => verifyRuntimeRelease(bytes, f.pin(), { ...f.options, desktopVersion: '0.0.9' }),
    /Update Kalkidan/,
  );
  assert.throws(
    () =>
      verifyRuntimeRelease(bytes, f.pin(), {
        ...f.options,
        checkpoint: { sequence: 2, digest: accepted.checkpoint.digest },
      }),
    /older/,
  );
  f.manifest.sequence = 2;
  f.manifest.artifacts[0].url = 'http://insecure.test/runtime';
  assert.throws(
    () => verifyRuntimeRelease(Buffer.from(JSON.stringify(f.manifest)), f.pin(), f.options),
    /HTTPS/,
  );
});

test('runtime admission requires trusted host OS version and authenticated minimum OS metadata', () => {
  const f = releaseFixture();
  const verify = (systemVersion: string) =>
    verifyRuntimeRelease(Buffer.from(JSON.stringify(f.manifest)), f.pin(), {
      ...f.options,
      systemVersion,
    });
  for (const version of ['', 'unknown', '26.7', '26.7.1-beta', '26.7.0', '25.99.99'])
    assert.throws(() => verify(version), /OS version|requires/);
  for (const version of ['26.7.1', '26.8.0', '27.0.0'])
    assert.equal(verify(version).version, '0.2.1');
  for (const value of ['', 'latest', '26.7', undefined]) {
    (f.manifest.artifacts[0] as any).minimum_os_version = value;
    assert.throws(() => verify('26.7.1'), /artifact/);
  }
});

test('runtime admission validates the optional executable digest format', () => {
  const f = releaseFixture();
  const verify = () =>
    verifyRuntimeRelease(Buffer.from(JSON.stringify(f.manifest)), f.pin(), f.options);
  const artifact = f.manifest.artifacts[0] as any;
  artifact.executable_sha256 = 'a'.repeat(64);
  assert.equal(verify().artifact.executable_sha256, 'a'.repeat(64));
  for (const value of ['', 'A'.repeat(64), 'a'.repeat(63), null, 1]) {
    artifact.executable_sha256 = value;
    assert.throws(verify, /Invalid runtime artifact/);
  }
});
