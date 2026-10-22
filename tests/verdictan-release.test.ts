import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifyRuntimeRelease } from '../electron/verdictan/release';
import {
  parseReleaseSignature,
  releasePublicKey,
  verifySignedFile,
} from '../electron/verdictan/signature';
import { releaseFixture, signBundle, testKeys } from './helpers/verdictan-fixture';

const real = (name: string) => readFile(join('tests/fixtures/verdictan/release-0.6.6', name));

test('a signed manifest must match the published release and keep the checkpoint order', () => {
  const f = releaseFixture();
  const verify = (overrides: object = {}, bytes = f.bytes(), signature = signBundle(bytes)) =>
    verifyRuntimeRelease(bytes, signature, f.discovered(), { ...f.options, ...overrides });
  const accepted = verify();
  assert.equal(accepted.version, '0.2.1');
  assert.equal(accepted.artifact.arch, 'arm64');
  assert.deepEqual(accepted.revoked, []);
  assert.deepEqual(verify({ checkpoint: accepted.checkpoint }), accepted);
  // Kalkidan accepts an out-of-date manifest. The signature and the checkpoint prevent replay.
  assert.equal(verify({ now: f.manifest.expires_at + 30 * 86400 }).version, '0.2.1');
  // A clock that is up to 5 minutes slow accepts the release. More is an error.
  assert.equal(verify({ now: f.manifest.issued_at - 300 }).version, '0.2.1');
  assert.throws(() => verify({ now: f.manifest.issued_at - 301 }), /system clock/);
  assert.throws(() => verify({ os: 'win32' }), /supports/);
  assert.throws(() => verify({ desktopVersion: '0.0.9' }), /Update Kalkidan/);
  assert.throws(
    () => verify({ checkpoint: { sequence: 2, digest: accepted.checkpoint.digest } }),
    /older/,
  );
  assert.throws(() => verify({ checkpoint: { sequence: 1, digest: '0'.repeat(64) } }), /older/);
  const discovered = f.discovered();
  const withDiscovery = (changes: object) =>
    verifyRuntimeRelease(
      f.bytes(),
      signBundle(f.bytes()),
      { ...discovered, ...changes },
      f.options,
    );
  assert.throws(() => withDiscovery({ version: '0.2.2' }), /does not match the published/);
  assert.throws(() => withDiscovery({ sha256: '0'.repeat(64) }), /does not match the published/);
  assert.throws(() => withDiscovery({ size: discovered.size + 1 }), /does not match the published/);
  assert.throws(() => withDiscovery({ size: 0 }), /discovery/);
  f.manifest.revoked_versions = ['0.2.1'];
  assert.throws(() => verify(), /revoked/);
  f.manifest.revoked_versions = ['0.1.0'];
  assert.deepEqual(verify().revoked, ['0.1.0']);
  f.manifest.artifacts[0].url = 'https://github.com/verdictan/packages/releases/download/v9/x';
  assert.throws(() => verify(), /does not match the published/);
  f.manifest.artifacts[0].url = 'http://insecure.test/runtime';
  assert.throws(() => verify(), /HTTPS/);
});

test('the manifest needs a valid signature from the trusted key', () => {
  const f = releaseFixture();
  const bytes = f.bytes();
  const verify = (signature: Buffer, data = bytes) =>
    verifyRuntimeRelease(data, signature, f.discovered(), f.options);
  // The production key does not trust a bundle that names another key.
  assert.throws(
    () =>
      verifyRuntimeRelease(bytes, signBundle(bytes), f.discovered(), {
        ...f.options,
        key: releasePublicKey(),
      }),
    /does not trust/,
  );
  // A bundle that names the trusted key but has a signature from another key fails.
  const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  assert.throws(() => verify(signBundle(bytes, other.privateKey)), /verification failed/);
  // A changed manifest does not match its signature.
  const changed = Buffer.from(JSON.stringify({ ...f.manifest, sequence: 9 }));
  assert.throws(() => verify(signBundle(bytes), changed), /does not match the file/);
  const bundle = JSON.parse(signBundle(bytes).toString());
  const broken = (change: (value: any) => void) => {
    const copy = structuredClone(bundle);
    change(copy);
    return Buffer.from(JSON.stringify(copy));
  };
  for (const change of [
    (b: any) => (b.mediaType = 'application/json'),
    (b: any) => (b.messageSignature.messageDigest.algorithm = 'SHA2_512'),
    (b: any) => (b.messageSignature.messageDigest.digest = 'short'),
    (b: any) => (b.messageSignature.signature = ''),
    (b: any) => delete b.messageSignature,
  ])
    assert.throws(() => verify(broken(change)), /signature is not valid/);
  assert.throws(() => verify(Buffer.from('not json')), /signature is not valid/);
  assert.throws(() => verify(Buffer.alloc(70000, 32)), /signature is not valid/);
});

test('runtime admission requires trusted host OS version and authenticated minimum OS metadata', () => {
  const f = releaseFixture();
  const verify = (systemVersion: string) =>
    verifyRuntimeRelease(f.bytes(), signBundle(f.bytes()), f.discovered(), {
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
    verifyRuntimeRelease(f.bytes(), signBundle(f.bytes()), f.discovered(), f.options);
  const artifact = f.manifest.artifacts[0] as any;
  artifact.executable_sha256 = 'a'.repeat(64);
  assert.equal(verify().artifact.executable_sha256, 'a'.repeat(64));
  for (const value of ['', 'A'.repeat(64), 'a'.repeat(63), null, 1]) {
    artifact.executable_sha256 = value;
    assert.throws(verify, /Invalid runtime artifact/);
  }
});

test('on Linux the archive comes from discovery when the manifest lists only macOS', () => {
  const archive = Buffer.from('linux archive');
  const f = releaseFixture(archive, 'x86_64-unknown-linux-gnu');
  const linux = { ...f.options, os: 'linux', arch: 'x64', systemVersion: '6.12.0' };
  const release = verifyRuntimeRelease(f.bytes(), signBundle(f.bytes()), f.discovered(), linux);
  assert.deepEqual(release.artifact, {
    target: 'x86_64-unknown-linux-gnu',
    os: 'linux',
    arch: 'x64',
    url: 'https://github.com/verdictan/packages/releases/download/v0.2.1/verdictan-x86_64-unknown-linux-gnu.tar.gz',
    sha256: f.discovered().sha256,
    size: archive.length,
  });
  assert.throws(
    () =>
      verifyRuntimeRelease(f.bytes(), signBundle(f.bytes()), f.discovered(), {
        ...linux,
        arch: 'arm64',
      }),
    /supports/,
  );
});

test('the published 0.6.6 manifest verifies with the Verdictan release key', async () => {
  const manifest = await real('desktop-release-manifest.v1.json');
  const signature = await real('desktop-release-manifest.v1.json.sigstore.json');
  const issuedAt = JSON.parse(manifest.toString()).issued_at;
  const options = {
    // A month after the release, the manifest is out of date. Kalkidan still accepts it.
    now: issuedAt + 30 * 86400,
    desktopVersion: '0.1.0',
    os: 'darwin',
    arch: 'arm64',
    systemVersion: '26.7.1',
  };
  const mac = {
    version: '0.6.6',
    releaseId: '1',
    sha256: '1206fcdd13e33cdb0746d879492120a7a1870ab9c5d35e6565381e7ca31609d6',
    size: 89352463,
  };
  const release = verifyRuntimeRelease(manifest, signature, mac, options);
  assert.equal(release.version, '0.6.6');
  assert.equal(release.artifact.sha256, mac.sha256);
  assert.deepEqual(release.revoked, ['0.4.0']);
  assert.throws(
    () => verifyRuntimeRelease(manifest, signature, mac, { ...options, key: testKeys.publicKey }),
    /does not trust/,
  );
  const tampered = Buffer.from(manifest.toString().replace('"0.4.0"', '"0.3.0"'));
  assert.throws(() => verifyRuntimeRelease(tampered, signature, mac, options), /does not match/);
  // The Linux archive signature names the GitHub digest of the Linux archive.
  const linuxDigest = '0b9ebd41899962bc3626e4b3d6aba9dc41094c5595b6963a1bf378c8937105ce';
  const linux = verifyRuntimeRelease(
    manifest,
    signature,
    { version: '0.6.6', releaseId: '1', sha256: linuxDigest, size: 98345193 },
    { ...options, os: 'linux', arch: 'x64', systemVersion: '6.12.0' },
  );
  assert.equal(linux.artifact.sha256, linuxDigest);
  const archiveSignature = parseReleaseSignature(
    await real('verdictan-x86_64-unknown-linux-gnu.tar.gz.sigstore.json'),
    releasePublicKey(),
  );
  assert.equal(archiveSignature.digest, Buffer.from(linuxDigest, 'hex').toString('base64'));
});

test('archive signatures verify the file on disk', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'release-signature-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'runtime.tar.gz');
  await writeFile(file, 'archive bytes');
  const signature = parseReleaseSignature(signBundle('archive bytes'), testKeys.publicKey);
  await verifySignedFile(file, signature, testKeys.publicKey);
  await writeFile(file, 'archive bytez');
  await assert.rejects(verifySignedFile(file, signature, testKeys.publicKey), /does not match/);
  const other = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const forged = parseReleaseSignature(
    signBundle('archive bytez', other.privateKey),
    testKeys.publicKey,
  );
  await assert.rejects(verifySignedFile(file, forged, testKeys.publicKey), /verification failed/);
});
