import { sha256, type RuntimePin } from '../../electron/verdictan/release';

export function releaseFixture(archive = Buffer.from('archive')) {
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
        url: 'https://releases.example.test/verdictan.tar.gz',
        sha256: sha256(archive),
        size: archive.length,
        minimum_os_version: '26.7.1',
        node_included: true,
        required_runtime_dependencies: ['macOS'],
      },
    ],
  };
  function pin(): RuntimePin {
    return {
      schema_version: 1,
      version: manifest.version,
      manifest_sha256: sha256(JSON.stringify(manifest)),
      artifact_url: manifest.artifacts[0].url,
      artifact_sha256: manifest.artifacts[0].sha256,
      revoked_versions: [],
    };
  }
  const options = {
    now,
    desktopVersion: '0.1.0',
    os: 'darwin',
    arch: 'arm64',
    systemVersion: '26.7.1',
  };
  return { manifest, pin, options };
}
