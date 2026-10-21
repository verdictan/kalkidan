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

/**
 * Download the signed manifest and the archive signature of a discovered release, and verify
 * them with the Verdictan release key. The archive itself downloads later.
 */
export async function fetchRuntimeRelease(
  discovered: RuntimeDiscovery,
  options: {
    now: number;
    desktopVersion: string;
    os: string;
    arch: string;
    systemVersion: string;
    checkpoint?: ReleaseCheckpoint;
    key?: KeyObject;
    request?: typeof fetch;
  },
): Promise<SignedRuntimeRelease> {
  const target = runtimeTarget(options.os, options.arch);
  if (!target) throw new Error('No runtime release supports this execution host.');
  if (
    typeof discovered?.version !== 'string' ||
    !/^\d{1,8}\.\d{1,8}\.\d{1,8}$/.test(discovered.version) ||
    typeof discovered.sha256 !== 'string' ||
    !/^[a-f0-9]{64}$/.test(discovered.sha256)
  )
    throw new Error('Invalid runtime release from discovery.');
  const key = options.key ?? releasePublicKey();
  const manifestURL = releaseAssetURL(discovered.version, releaseManifestName);
  const archiveURL = releaseAssetURL(discovered.version, runtimeArchiveName(target));
  const signal = AbortSignal.timeout(30000);
  const get = (url: string, limit: number) =>
    downloadReleaseFile(url, releaseDownloadOrigins, limit, signal, options.request);
  const [manifest, manifestSignature, archiveBundle] = await Promise.all([
    get(manifestURL, 262144),
    get(`${manifestURL}.sigstore.json`, 65536),
    get(`${archiveURL}.sigstore.json`, 65536),
  ]);
  const release = verifyRuntimeRelease(manifest, manifestSignature, discovered, {
    now: options.now,
    desktopVersion: options.desktopVersion,
    os: options.os,
    arch: options.arch,
    systemVersion: options.systemVersion,
    checkpoint: options.checkpoint,
    key,
  });
  const archiveSignature = parseReleaseSignature(archiveBundle, key);
  if (Buffer.from(release.artifact.sha256, 'hex').toString('base64') !== archiveSignature.digest)
    throw new Error('Release signature does not match the published archive.');
  return { ...release, archiveSignature };
}
