import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import {
  RuntimeInstaller,
  runtimePolicyForHost,
  type RuntimePolicy,
} from '../../electron/verdictan/install';
import policy from '../../electron/verdictan/runtime-policy.json';
import { hostSystemVersion } from '../../electron/verdictan/system-version';
import { DesktopProtocol } from '../../electron/verdictan/protocol';
import { parseCapabilities } from '../../electron/verdictan/account';
async function main() {
  const approved = runtimePolicyForHost(policy as RuntimePolicy, process.platform, process.arch);
  const expectedVersion = approved.pin.version;
  const root = await mkdtemp(join(tmpdir(), 'kalkidan-native-install-'));
  try {
    const options = {
      root,
      hostId: 'native-acceptance',
      desktopVersion: '0.1.0',
      os: process.platform,
      arch: process.arch,
      systemVersion: hostSystemVersion(),
      policy: async () =>
        runtimePolicyForHost(policy as RuntimePolicy, process.platform, process.arch),
      busy: () => false,
      probe: async (executable: string, version: string) => {
        const client = new DesktopProtocol(executable, [
          '--desktop-version',
          '0.1.0',
          '--api-url',
          'https://api.verdictan.com',
          '--console-url',
          'https://console.verdictan.com',
          '--profile',
          'kalkidan-install-acceptance',
        ]);
        try {
          assert.equal(
            parseCapabilities((await client.request('capabilities')).data).cliVersion,
            version,
          );
        } finally {
          client.close();
        }
      },
    };
    const installer = new RuntimeInstaller(options);
    await installer.install();
    assert.equal(
      installer.status().operation?.phase,
      'completed',
      JSON.stringify(installer.status()),
    );
    assert.equal(installer.status().installed?.version, expectedVersion);
    const restart = new RuntimeInstaller(options);
    await restart.check(true);
    assert.equal(restart.status().installed?.sha256, installer.status().installed?.sha256);
    const executable = await restart.executable();
    assert.ok(executable);
    await options.probe(executable, expectedVersion);
    console.log(
      JSON.stringify({
        platform: process.platform,
        arch: process.arch,
        version: expectedVersion,
        source: 'public-release',
        cleanInstall: 'passed',
        restart: 'passed',
        capabilities: 'passed',
      }),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
void main().catch((error) => {
  console.error(
    'Native runtime installation acceptance failed:',
    error instanceof Error ? error.message : 'Unknown error',
  );
  process.exitCode = 1;
});
