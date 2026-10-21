import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { RuntimePolicy } from '../electron/verdictan/install';
import { approveRuntime, bundledPolicyPath, formatPolicy, packagePath } from './runtime-approval';

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
  const pinText = await readFile(resolve(pinPath), 'utf8');
  if (pinText.length > 32000) throw Error('Pin exceeds its limit.');
  const policy = JSON.parse(await readFile(bundledPolicyPath, 'utf8')) as RuntimePolicy;
  const { version: desktopVersion } = JSON.parse(await readFile(packagePath, 'utf8'));
  const approval = approveRuntime(
    policy,
    manifest,
    JSON.parse(pinText),
    { os, arch, systemVersion },
    { now: Math.floor(Date.now() / 1000), desktopVersion },
  );
  console.log(JSON.stringify({ ...approval.summary, applied: flags.includes('--apply') }, null, 2));
  if (flags.includes('--apply'))
    await writeFile(bundledPolicyPath, await formatPolicy(approval.policy));
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Runtime approval failed.');
  process.exitCode = 1;
});
