import { createHash } from 'node:crypto';

export interface RuntimeArtifact {
  target: string;
  os: string;
  arch: string;
  url: string;
  sha256: string;
  size: number;
  minimum_os_version: string;
  node_included: true;
  required_runtime_dependencies: string[];
  /** Optional in older manifests. When present, the extracted executable must match it. */
  executable_sha256?: string;
}
export interface RuntimePin {
  schema_version: 1;
  version: string;
  manifest_sha256: string;
  artifact_url: string;
  artifact_sha256: string;
  revoked_versions: string[];
}
export interface ReleaseCheckpoint {
  sequence: number;
  digest: string;
}
export interface VerifiedRuntimeRelease {
  version: string;
  artifact: RuntimeArtifact;
  checkpoint: ReleaseCheckpoint;
  expiresAt: number;
}
export const sha256 = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const digest = (value: unknown): value is string =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const version = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{1,8}\.\d{1,8}\.\d{1,8}$/.test(value);
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
    throw new Error('Release downloads require an approved HTTPS URL.');
  return url;
}
/** The pin is bundled/reviewed metadata, never values taken from a downloaded manifest. */
export function verifyRuntimeRelease(
  bytes: Buffer,
  pin: RuntimePin,
  options: {
    now: number;
    desktopVersion: string;
    os: string;
    arch: string;
    systemVersion: string;
    checkpoint?: ReleaseCheckpoint;
  },
): VerifiedRuntimeRelease {
  if (
    bytes.length > 262144 ||
    pin?.schema_version !== 1 ||
    !version(pin.version) ||
    !digest(pin.manifest_sha256) ||
    !digest(pin.artifact_sha256) ||
    !Array.isArray(pin.revoked_versions) ||
    !pin.revoked_versions.every(version)
  )
    throw new Error('Invalid reviewed release metadata.');
  releaseURL(pin.artifact_url);
  const manifestDigest = sha256(bytes);
  if (manifestDigest !== pin.manifest_sha256) throw new Error('Release manifest checksum failed.');
  const manifest = JSON.parse(bytes.toString('utf8'));
  if (manifest?.schema_version !== 1 || manifest.version !== pin.version)
    throw new Error('Release version does not match reviewed metadata.');
  if (
    !Number.isSafeInteger(options.now) ||
    !Number.isSafeInteger(manifest.sequence) ||
    manifest.sequence < 1 ||
    !Number.isSafeInteger(manifest.issued_at) ||
    !Number.isSafeInteger(manifest.expires_at) ||
    manifest.issued_at < 0 ||
    manifest.issued_at > options.now ||
    manifest.expires_at <= options.now ||
    manifest.expires_at <= manifest.issued_at ||
    manifest.expires_at - manifest.issued_at > 604800
  )
    throw new Error('Release metadata expired or the system clock is incorrect.');
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
    !manifest.revoked_versions.every(version) ||
    [...manifest.revoked_versions, ...pin.revoked_versions].includes(pin.version)
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
  const current = options.desktopVersion.split('-')[0].split('.').map(Number);
  const minimum = manifest.minimum_desktop_version.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (current[i] < minimum[i]) throw new Error('Update Kalkidan before installing this runtime.');
    if (current[i] > minimum[i]) break;
  }
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
      !Number.isSafeInteger(artifact.size) ||
      artifact.size < 1 ||
      artifact.size > 512 * 1024 * 1024 ||
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
  const artifact = manifest.artifacts.find(
    (entry: RuntimeArtifact) => entry.os === options.os && entry.arch === options.arch,
  );
  if (!artifact) throw new Error('No runtime release supports this execution host.');
  if (!version(options.systemVersion)) throw new Error('Cannot verify the host OS version.');
  const host = options.systemVersion.split('.').map(Number);
  const required = artifact.minimum_os_version.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (host[i] < required[i])
      throw new Error(
        `This runtime requires ${options.os} ${artifact.minimum_os_version} or later.`,
      );
    if (host[i] > required[i]) break;
  }
  if (artifact.url !== pin.artifact_url || artifact.sha256 !== pin.artifact_sha256)
    throw new Error('Runtime artifact does not match reviewed metadata.');
  return {
    version: pin.version,
    artifact: structuredClone(artifact),
    checkpoint: { sequence: manifest.sequence, digest: manifestDigest },
    expiresAt: manifest.expires_at,
  };
}
