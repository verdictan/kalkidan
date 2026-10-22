import { createHash, type KeyObject } from 'node:crypto';
import type { ComponentRelease } from '../../src/domain/updates';
import { parseReleaseSignature, releasePublicKey, verifySignedBytes } from './signature';

/** The archive fields that the download and the extraction use. */
export interface InstallArtifact {
  target: string;
  os: string;
  arch: string;
  url: string;
  sha256: string;
  size: number;
  /** Optional. When present, the extracted executable must match it. */
  executable_sha256?: string;
}
export interface RuntimeArtifact extends InstallArtifact {
  minimum_os_version: string;
  node_included: true;
  required_runtime_dependencies: string[];
}
export interface ReleaseCheckpoint {
  sequence: number;
  digest: string;
}
/** A published release from discovery. Discovery is not trust. The signature gives trust. */
export interface RuntimeDiscovery extends ComponentRelease {
  /** The archive size in bytes. */
  size: number;
}
export interface VerifiedRuntimeRelease {
  version: string;
  artifact: InstallArtifact;
  checkpoint: ReleaseCheckpoint;
  revoked: string[];
}
export const releaseDownloadOrigins = [
  'https://github.com',
  'https://release-assets.githubusercontent.com',
];
/** User decision: a release can be up to 5 minutes newer than the clock of the computer. */
export const releaseClockSkewSeconds = 300;
export const releaseManifestName = 'desktop-release-manifest.v1.json';
const releaseDownloadBase = 'https://github.com/verdictan/packages/releases/download';
const runtimeTargets: Record<string, string> = {
  'darwin-arm64': 'aarch64-apple-darwin',
  'linux-x64': 'x86_64-unknown-linux-gnu',
};
/** The Verdictan build target for a host, or undefined when Kalkidan has no runtime for it. */
export function runtimeTarget(os: string, arch: string) {
  const key = `${os}-${arch}`;
  return Object.hasOwn(runtimeTargets, key) ? runtimeTargets[key] : undefined;
}
/** The canonical download URL of a release file. */
export function releaseAssetURL(version: string, name: string) {
  return `${releaseDownloadBase}/v${version}/${name}`;
}
export const runtimeArchiveName = (target: string) => `verdictan-${target}.tar.gz`;
export const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const digest = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const version = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{1,8}\.\d{1,8}\.\d{1,8}$/.test(value);
const archiveSize = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 1 && (value as number) <= 512 * 1024 * 1024;
export const desktopVersion = (value: unknown): value is string =>
  typeof value === 'string' &&
  /^\d{1,8}\.\d{1,8}\.\d{1,8}(?:-build\.\d{1,16}\.[a-f0-9]{12})?$/.test(value);
const targets: Record<string, readonly [string, string]> = {
  'x86_64-unknown-linux-gnu': ['linux', 'x64'],
  'aarch64-unknown-linux-gnu': ['linux', 'arm64'],
  'x86_64-apple-darwin': ['darwin', 'x64'],
  'aarch64-apple-darwin': ['darwin', 'arm64'],
  'x86_64-pc-windows-msvc': ['win32', 'x64'],
};
export function releaseURL(value: unknown) {
  if (typeof value !== 'string' || value.length > 2048) throw new Error('Invalid release URL.');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('Release downloads require an HTTPS URL.');
  return url;
}
const olderThan = (current: number[], minimum: number[]) => {
  for (let i = 0; i < 3; i++) {
    if (current[i] < minimum[i]) return true;
    if (current[i] > minimum[i]) return false;
  }
  return false;
};
/**
 * Verify a signed release manifest against the published release from discovery. The expected
 * version, archive URL, and archive digest come from discovery, never from the manifest.
 */
export function verifyRuntimeRelease(
  bytes: Buffer,
  signature: Buffer,
  discovered: RuntimeDiscovery,
  options: {
    now: number;
    desktopVersion: string;
    os: string;
    arch: string;
    systemVersion: string;
    checkpoint?: ReleaseCheckpoint;
    key?: KeyObject;
  },
): VerifiedRuntimeRelease {
  if (!version(discovered?.version) || !digest(discovered.sha256) || !archiveSize(discovered.size))
    throw new Error('Invalid runtime release from discovery.');
  const target = runtimeTarget(options.os, options.arch);
  if (!target) throw new Error('No runtime release supports this execution host.');
  if (bytes.length > 262144) throw new Error('Invalid release manifest.');
  const key = options.key ?? releasePublicKey();
  verifySignedBytes(bytes, parseReleaseSignature(signature, key), key);
  const manifestDigest = sha256(bytes);
  let manifest: any;
  try {
    manifest = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('Invalid release manifest.');
  }
  if (manifest?.schema_version !== 1 || manifest.version !== discovered.version)
    throw new Error('Release manifest does not match the published release.');
  // Each manifest expires 7 days after it is issued. Kalkidan installs the newest signed
  // release, so the manifest of the newest release is out of date when no release comes for a
  // week. The signature and the checkpoint below prevent the replay of an older release, so
  // Kalkidan does not reject an out-of-date manifest. It rejects a manifest from the future.
  // A small clock difference is accepted (see releaseClockSkewSeconds).
  if (
    !Number.isSafeInteger(options.now) ||
    !Number.isSafeInteger(manifest.sequence) ||
    manifest.sequence < 1 ||
    !Number.isSafeInteger(manifest.issued_at) ||
    !Number.isSafeInteger(manifest.expires_at) ||
    manifest.issued_at < 0 ||
    manifest.expires_at <= manifest.issued_at ||
    manifest.expires_at - manifest.issued_at > 604800
  )
    throw new Error('Release metadata is not valid, or the system clock is incorrect.');
  // A clock that is slightly slow still accepts a new release. More difference is an error.
  if (manifest.issued_at > options.now + releaseClockSkewSeconds)
    throw new Error(
      'The system clock is behind the release time. Set the date and time to update automatically, then try again.',
    );
  const checkpoint = options.checkpoint;
  if (
    checkpoint &&
    (!Number.isSafeInteger(checkpoint.sequence) ||
      checkpoint.sequence < 1 ||
      !digest(checkpoint.digest) ||
      manifest.sequence < checkpoint.sequence ||
      (manifest.sequence === checkpoint.sequence && manifestDigest !== checkpoint.digest))
  )
    throw new Error('Release metadata is older than the installed checkpoint.');
  if (
    !Array.isArray(manifest.revoked_versions) ||
    manifest.revoked_versions.length > 100 ||
    !manifest.revoked_versions.every(version) ||
    manifest.revoked_versions.includes(manifest.version)
  )
    throw new Error('This runtime release has been revoked.');
  if (
    !version(manifest.minimum_desktop_version) ||
    !desktopVersion(options.desktopVersion) ||
    !Number.isSafeInteger(manifest.protocol?.min) ||
    !Number.isSafeInteger(manifest.protocol?.max) ||
    manifest.protocol.min !== 1 ||
    manifest.protocol.max < 1
  )
    throw new Error('The release is incompatible with this desktop protocol.');
  if (
    olderThan(
      options.desktopVersion.split('-')[0].split('.').map(Number),
      manifest.minimum_desktop_version.split('.').map(Number),
    )
  )
    throw new Error('Update Kalkidan before installing this runtime.');
  if (
    !Array.isArray(manifest.artifacts) ||
    !manifest.artifacts.length ||
    manifest.artifacts.length > 5
  )
    throw new Error('Invalid runtime artifact list.');
  const seen = new Set<string>();
  for (const artifact of manifest.artifacts) {
    if (
      !artifact ||
      !Object.hasOwn(targets, artifact.target) ||
      targets[artifact.target][0] !== artifact.os ||
      targets[artifact.target][1] !== artifact.arch ||
      seen.has(artifact.target) ||
      !digest(artifact.sha256) ||
      (artifact.executable_sha256 !== undefined && !digest(artifact.executable_sha256)) ||
      !archiveSize(artifact.size) ||
      artifact.node_included !== true ||
      !version(artifact.minimum_os_version) ||
      !Array.isArray(artifact.required_runtime_dependencies) ||
      artifact.required_runtime_dependencies.length > 20 ||
      !artifact.required_runtime_dependencies.every(
        (v: unknown) => typeof v === 'string' && v.length > 0 && v.length < 256,
      )
    )
      throw new Error('Invalid runtime artifact.');
    releaseURL(artifact.url);
    seen.add(artifact.target);
  }
  const url = releaseAssetURL(discovered.version, runtimeArchiveName(target));
  const listed: RuntimeArtifact | undefined = manifest.artifacts.find(
    (entry: RuntimeArtifact) => entry.os === options.os && entry.arch === options.arch,
  );
  let artifact: InstallArtifact;
  if (listed) {
    if (!version(options.systemVersion)) throw new Error('Cannot verify the host OS version.');
    if (
      olderThan(
        options.systemVersion.split('.').map(Number),
        listed.minimum_os_version.split('.').map(Number),
      )
    )
      throw new Error(`This runtime requires ${options.os} ${listed.minimum_os_version} or later.`);
    if (
      listed.target !== target ||
      listed.url !== url ||
      listed.sha256 !== discovered.sha256 ||
      listed.size !== discovered.size
    )
      throw new Error('Runtime artifact does not match the published release.');
    artifact = structuredClone(listed);
  } else if (options.os === 'linux') {
    // The manifest lists only the macOS archive. For Linux, the signature of the archive is the
    // authority. The installer verifies it after the download and before the extraction.
    artifact = {
      target,
      os: options.os,
      arch: options.arch,
      url,
      sha256: discovered.sha256,
      size: discovered.size,
    };
  } else throw new Error('No runtime release supports this execution host.');
  return {
    version: manifest.version,
    artifact,
    checkpoint: { sequence: manifest.sequence, digest: manifestDigest },
    revoked: [...manifest.revoked_versions],
  };
}
