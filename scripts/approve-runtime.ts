import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { verifyRuntimeRelease } from '../electron/verdictan/release';
import { runtimePolicyForHost, type RuntimePolicy } from '../electron/verdictan/install';

// The operator supplies an independently reviewed pin. A release discovery is not approval.
async function main() {
  const [manifestPath, pinPath, os, arch, systemVersion, ...flags] = process.argv.slice(2);
  if (
    !manifestPath ||
    !pinPath ||
    !os ||
    !arch ||
    !systemVersion ||
    flags.some((flag) => flag !== '--apply')
  )
    throw Error(
      'Usage: tsx scripts/approve-runtime.ts MANIFEST REVIEWED_PIN OS ARCH OS_VERSION [--apply]',
    );
  const manifest = await readFile(resolve(manifestPath));
  if (manifest.length > 512 * 1024) throw Error('Manifest exceeds its limit.');
  const pinText = await readFile(resolve(pinPath), 'utf8');
  if (pinText.length > 32000) throw Error('Pin exceeds its limit.');
  const pin = JSON.parse(pinText);
  const release = verifyRuntimeRelease(manifest, pin, {
    now: Math.floor(Date.now() / 1000),
    desktopVersion: '0.1.0',
    os,
    arch,
    systemVersion,
  });
  const file = resolve('electron/verdictan/runtime-policy.json');
  const policy = JSON.parse(await readFile(file, 'utf8')) as RuntimePolicy;
  const target = `${os}-${arch}`;
  let previous: RuntimePolicy | undefined;
  try {
    previous = runtimePolicyForHost(policy, os, arch);
  } catch {
    /* A new platform has no previous approval. */
  }
  if (previous && JSON.parse(previous.manifest).sequence > JSON.parse(manifest.toString()).sequence)
    throw Error('Do not replace approval with an older manifest sequence.');
  const origin = new URL(release.artifact.url).origin;
  if (origin !== 'https://github.com') throw Error('Review download origin changes separately.');
  const candidate = {
    manifest: manifest.toString(),
    pin,
    downloadOrigins: previous?.downloadOrigins || [
      'https://github.com',
      'https://release-assets.githubusercontent.com',
    ],
  };
  policy.hostPolicies = { ...policy.hostPolicies, [target]: candidate };
  console.log(
    JSON.stringify(
      {
        target,
        previousVersion: previous?.pin.version,
        approvedVersion: release.version,
        artifactSHA256: release.artifact.sha256,
        expiresAt: JSON.parse(manifest.toString()).expires_at,
        applied: flags.includes('--apply'),
      },
      null,
      2,
    ),
  );
  if (flags.includes('--apply')) await writeFile(file, JSON.stringify(policy, null, 2) + '\n');
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Runtime approval failed.');
  process.exitCode = 1;
});
