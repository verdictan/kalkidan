import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import {
  releaseAssetURL,
  releaseManifestName,
  runtimeArchiveName,
  sha256,
  type RuntimeDiscovery,
} from '../../electron/verdictan/release';
import { keyHint } from '../../electron/verdictan/signature';

/** A local P-256 key that signs test releases like the Verdictan release key. */
export const testKeys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });

/** A Sigstore bundle (v0.3) with a message signature over the bytes. */
export function signBundle(bytes: Buffer | string, privateKey = testKeys.privateKey) {
  const data = Buffer.from(bytes);
  return Buffer.from(
    JSON.stringify({
      mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
      verificationMaterial: { publicKey: { hint: keyHint(testKeys.publicKey) } },
      messageSignature: {
        messageDigest: {
          algorithm: 'SHA2_256',
          digest: createHash('sha256').update(data).digest('base64'),
        },
        signature: sign('sha256', data, privateKey).toString('base64'),
      },
    }),
  );
}

export function releaseFixture(archive = Buffer.from('archive'), target = 'aarch64-apple-darwin') {
  const now = 1792454400;
  const manifest = {
    schema_version: 1,
    version: '0.2.1',
    sequence: 1,
    issued_at: now - 100,
    expires_at: now + 1000,
    minimum_desktop_version: '0.1.0',
    protocol: { min: 1, max: 1 },
    revoked_versions: [] as string[],
    artifacts: [
      {
        target: 'aarch64-apple-darwin',
        os: 'darwin',
        arch: 'arm64',
        url: releaseAssetURL('0.2.1', runtimeArchiveName('aarch64-apple-darwin')),
        sha256: sha256(archive),
        size: archive.length,
        minimum_os_version: '26.7.1',
        node_included: true,
        required_runtime_dependencies: ['macOS'],
      },
    ],
  };
  const state: { archive: Buffer; manifest: typeof manifest; releaseId: number } = {
    archive,
    manifest,
    releaseId: 1,
  };
  /** The published release that discovery reports for the current manifest. */
  function discovered(): RuntimeDiscovery {
    return {
      version: state.manifest.version,
      releaseId: String(state.releaseId),
      sha256: sha256(state.archive),
      size: state.archive.length,
    };
  }
  const bytes = () => Buffer.from(JSON.stringify(state.manifest));
  /** Change the archive and publish it as a new release. */
  function publish(next: Buffer, version: string) {
    state.archive = next;
    state.releaseId++;
    state.manifest.version = version;
    state.manifest.sequence++;
    const entry = state.manifest.artifacts[0];
    entry.url = releaseAssetURL(version, runtimeArchiveName(entry.target));
    entry.sha256 = sha256(next);
    entry.size = next.length;
  }
  /** A fetch that serves the release files from the canonical GitHub URLs. */
  const request = (async (input: string | URL) => {
    const url = String(input);
    const { version } = state.manifest;
    const manifestURL = releaseAssetURL(version, releaseManifestName);
    const archiveURL = releaseAssetURL(version, runtimeArchiveName(target));
    const files: Record<string, Buffer> = {
      [manifestURL]: bytes(),
      [`${manifestURL}.sigstore.json`]: signBundle(bytes()),
      [archiveURL]: state.archive,
      [`${archiveURL}.sigstore.json`]: signBundle(state.archive),
    };
    if (!Object.hasOwn(files, url)) return new Response('Not found', { status: 404 });
    return new Response(new Uint8Array(files[url]));
  }) as typeof fetch;
  const options = {
    now,
    desktopVersion: '0.1.0',
    os: 'darwin',
    arch: 'arm64',
    systemVersion: '26.7.1',
    key: testKeys.publicKey,
  };
  return { manifest, state, discovered, bytes, publish, request, options };
}
