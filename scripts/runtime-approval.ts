import { fileURLToPath } from 'node:url';
import { format, resolveConfig } from 'prettier';
import { verifyRuntimeRelease, type RuntimePin } from '../electron/verdictan/release';
import { runtimePolicyForHost, type RuntimePolicy } from '../electron/verdictan/install';

/** The bundled policy is found from this file, not from the current directory. */
export const bundledPolicyPath = fileURLToPath(
  new URL('../electron/verdictan/runtime-policy.json', import.meta.url),
);
export const packagePath = fileURLToPath(new URL('../package.json', import.meta.url));

export interface ApprovalHost {
  os: string;
  arch: string;
  systemVersion: string;
}

/** Validate a reviewed manifest and pin, and return the policy with the new host approval. */
export function approveRuntime(
  policy: RuntimePolicy,
  manifest: Buffer,
  pin: RuntimePin,
  host: ApprovalHost,
  options: { now: number; desktopVersion: string },
) {
  if (manifest.length > 512 * 1024) throw Error('Manifest exceeds its limit.');
  const release = verifyRuntimeRelease(manifest, pin, {
    now: options.now,
    desktopVersion: options.desktopVersion,
    ...host,
  });
  const target = `${host.os}-${host.arch}`;
  let previous: RuntimePolicy | undefined;
  try {
    previous = runtimePolicyForHost(policy, host.os, host.arch);
  } catch {
    /* A new platform has no previous approval. */
  }
  const sequence = JSON.parse(manifest.toString()).sequence;
  if (previous) {
    const previousSequence = JSON.parse(previous.manifest).sequence;
    if (previousSequence > sequence)
      throw Error('Do not replace approval with an older manifest sequence.');
    // Installers keep the digest of each sequence. A changed manifest with the same sequence
    // fails their checkpoint check.
    if (previousSequence === sequence && previous.manifest !== manifest.toString())
      throw Error('A changed manifest must have a higher sequence.');
  }
  const origin = new URL(release.artifact.url).origin;
  if (origin !== 'https://github.com') throw Error('Review download origin changes separately.');
  const candidate: RuntimePolicy = {
    manifest: manifest.toString(),
    pin,
    downloadOrigins: previous?.downloadOrigins || [
      'https://github.com',
      'https://release-assets.githubusercontent.com',
    ],
  };
  return {
    policy: { ...policy, hostPolicies: { ...policy.hostPolicies, [target]: candidate } },
    summary: {
      target,
      previousVersion: previous?.pin.version,
      approvedVersion: release.version,
      artifactSHA256: release.artifact.sha256,
      expiresAt: release.expiresAt,
    },
  };
}

/** Write the policy in the repository style, so that the format check passes after approval. */
export async function formatPolicy(policy: RuntimePolicy) {
  const config = (await resolveConfig(bundledPolicyPath)) || {};
  return format(JSON.stringify(policy), { ...config, filepath: bundledPolicyPath });
}
