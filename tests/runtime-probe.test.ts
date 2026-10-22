import test from 'node:test';
import assert from 'node:assert/strict';
import { probeRuntime, runtimeVersionOutput } from '../electron/verdictan/runtime-probe';
import { DesktopProtocolError } from '../electron/verdictan/protocol';

const noKeyring = async (): Promise<{ cliVersion: string }> => {
  throw new DesktopProtocolError('desktop.secure_storage_unavailable');
};

test('the version probe works on a Linux host without a keyring and stays strict elsewhere', async () => {
  await probeRuntime('/runtime/verdictan', '0.6.10', {
    capabilities: async () => ({ cliVersion: '0.6.10' }),
    versionOutput: async () => assert.fail('the protocol answer is enough'),
  });
  await assert.rejects(
    probeRuntime('/runtime/verdictan', '0.6.10', {
      capabilities: async () => ({ cliVersion: '0.6.9' }),
    }),
    /does not match the signed release/,
  );
  // A headless Linux server: no Secret Service. The version output is the check.
  const asked: string[] = [];
  await probeRuntime('/runtime/verdictan', '0.6.10', {
    capabilities: noKeyring,
    platform: 'linux',
    versionOutput: async (path) => {
      asked.push(path);
      return '0.6.10';
    },
  });
  assert.deepEqual(asked, ['/runtime/verdictan']);
  await assert.rejects(
    probeRuntime('/runtime/verdictan', '0.6.10', {
      capabilities: noKeyring,
      platform: 'linux',
      versionOutput: async () => '0.6.9',
    }),
    /does not match/,
  );
  // On macOS, a locked keychain is a real problem that the user must fix.
  await assert.rejects(
    probeRuntime('/runtime/verdictan', '0.6.10', {
      capabilities: noKeyring,
      platform: 'darwin',
      versionOutput: async () => '0.6.10',
    }),
    { code: 'desktop.secure_storage_unavailable' },
  );
  // Other failures never use the fallback.
  await assert.rejects(
    probeRuntime('/runtime/verdictan', '0.6.10', {
      capabilities: async () => {
        throw new DesktopProtocolError('desktop.executable_invalid');
      },
      platform: 'linux',
      versionOutput: async () => '0.6.10',
    }),
    { code: 'desktop.executable_invalid' },
  );
});

test('the version output must be exactly one release version', async () => {
  const runner = (stdout: string, error: Error | null = null) =>
    ((file: string, args: string[], options: any, done: Function) => {
      assert.deepEqual(args, ['--version']);
      assert.equal(options.timeout, 15000);
      assert.equal(
        Object.keys(options.env).some((key) => /^VERDICTAN_/i.test(key)),
        false,
      );
      done(error, stdout);
    }) as any;
  process.env.VERDICTAN_API_TOKEN = 'must-not-pass';
  try {
    assert.equal(await runtimeVersionOutput('/v', runner('verdictan 0.6.10\n')), '0.6.10');
    for (const output of ['verdictan 0.6.10-beta\n', 'other 0.6.10\n', '', 'verdictan 0.6\n'])
      await assert.rejects(runtimeVersionOutput('/v', runner(output)), /did not report/);
    await assert.rejects(
      runtimeVersionOutput('/v', runner('verdictan 0.6.10\n', new Error('exit 1'))),
      /did not report/,
    );
  } finally {
    delete process.env.VERDICTAN_API_TOKEN;
  }
});
