import type { KeyObject } from 'node:crypto';
import { downloadReleaseFile } from './download';
import {
  releaseAssetURL,
  releaseDownloadOrigins,
  releaseManifestName,
  runtimeArchiveName,
  runtimeTarget,
  verifyRuntimeRelease,
  type ReleaseCheckpoint,
  type RuntimeDiscovery,
  type VerifiedRuntimeRelease,
} from './release';
import { parseReleaseSignature, releasePublicKey, type ReleaseSignature } from './signature';

export interface SignedRuntimeRelease extends VerifiedRuntimeRelease {
  /** The signature of the archive. The installer verifies the archive with it before extraction. */
  archiveSignature: ReleaseSignature;
}

/** The signed release files that prove a runtime archive. Each is small. */
export interface ReleaseFiles {
  manifest: Buffer;
  manifestSignature: Buffer;
  archiveSignature: Buffer;
}
export const releaseFileLimits = {
  manifest: 262144,
  manifestSignature: 65536,
  archiveSignature: 65536,
} as const;

interface ReleaseOptions {
  now: number;
  desktopVersion: string;
  os: string;
  arch: string;
  systemVersion: string;
  checkpoint?: ReleaseCheckpoint;
  key?: KeyObject;
}

function checkDiscovery(discovered: RuntimeDiscovery, options: ReleaseOptions) {
  const target = runtimeTarget(options.os, options.arch);
  if (!target) throw new Error('No runtime release supports this execution host.');
  if (
    typeof discovered?.version !== 'string' ||
    !/^\d{1,8}\.\d{1,8}\.\d{1,8}$/.test(discovered.version) ||
    typeof discovered.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(discovered.sha256)
  )
    throw new Error('Invalid runtime release from discovery.');
  return target;
}

/**
 * Verify the signed manifest and the archive signature of a release with the Verdictan release
 * key. This uses no network. An SSH host verifies the files that the desktop copies to it.
 */
export function verifyReleaseFiles(
  discovered: RuntimeDiscovery,
  files: ReleaseFiles,
  options: ReleaseOptions,
): SignedRuntimeRelease {
  checkDiscovery(discovered, options);
  for (const name of Object.keys(releaseFileLimits) as (keyof ReleaseFiles)[])
    if (!Buffer.isBuffer(files?.[name]) || files[name].length > releaseFileLimits[name])
      throw new Error('Invalid release file.');
  const key = options.key ?? releasePublicKey();
  const release = verifyRuntimeRelease(files.manifest, files.manifestSignature, discovered, {
    now: options.now,
    desktopVersion: options.desktopVersion,
    os: options.os,
    arch: options.arch,
    systemVersion: options.systemVersion,
    checkpoint: options.checkpoint,
    key,
  });
  const archiveSignature = parseReleaseSignature(files.archiveSignature, key);
  if (Buffer.from(release.artifact.sha256, 'hex').toString('base64') !== archiveSignature.digest)
    throw new Error('Release signature does not match the published archive.');
  return { ...release, archiveSignature };
}

/**
 * Download the signed manifest and the archive signature of a discovered release, and verify
 * them with the Verdictan release key. The archive itself downloads later.
 */
export async function fetchRuntimeRelease(
  discovered: RuntimeDiscovery,
  options: ReleaseOptions & { request?: typeof fetch },
): Promise<SignedRuntimeRelease & { files: ReleaseFiles }> {
  const target = checkDiscovery(discovered, options);
  const manifestURL = releaseAssetURL(discovered.version, releaseManifestName);
  const archiveURL = releaseAssetURL(discovered.version, runtimeArchiveName(target));
  const signal = AbortSignal.timeout(30000);
  const get = (url: string, limit: number) =>
    downloadReleaseFile(url, releaseDownloadOrigins, limit, signal, options.request);
  const [manifest, manifestSignature, archiveSignature] = await Promise.all([
    get(manifestURL, releaseFileLimits.manifest),
    get(`${manifestURL}.sigstore.json`, releaseFileLimits.manifestSignature),
    get(`${archiveURL}.sigstore.json`, releaseFileLimits.archiveSignature),
  ]);
  const files = { manifest, manifestSignature, archiveSignature };
  return { ...verifyReleaseFiles(discovered, files, options), files };
}
