import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VerdictanAccountService } from '../electron/verdictan/account';
import { RemoteAccountClient } from '../electron/verdictan/remote-broker';
import { checkHostRuntimes, hostCheckMethod } from '../electron/verdictan/remote-check';
import { keychainHostsMessage, keychainRefusedCode } from '../src/domain/verdictan';
import { managedLaunchError } from '../src/lib/agent-errors';

const apiOrigin = 'https://api.verdictan.com';
const capabilities = {
  cli_version: '0.6.9',
  protocol_min: 1,
  protocol_max: 1,
  capabilities: [],
  managed_execution_ready: false,
  tested_agents: [],
};
const authenticated = {
  state: 'authenticated',
  user_id: 'user',
  organization_id: 'org',
  expires_at: '2026-10-20T01:00:00Z',
  api_url: apiOrigin,
};

/**
 * The account owner of an SSH host. As in the helper, each connection is a proxy to the
 * desktop broker, and a closed proxy gets a new one.
 */
function hostAccount(t: any) {
  const frames: any[] = [];
  const proxies: RemoteAccountClient[] = [];
  const account = new VerdictanAccountService({
    apiOrigin,
    consoleOrigin: 'https://console.verdictan.com',
    connect: async () => {
      const last = proxies.at(-1);
      if (last && !last.isClosed()) return last;
      const proxy = new RemoteAccountClient((frame) => frames.push(frame));
      proxies.push(proxy);
      return proxy;
    },
    openBrowser: async () => {},
    now: () => Date.parse('2026-10-20T00:00:00Z'),
  });
  t.after(() => account.dispose());
  /** The desktop broker answers the newest request of the newest proxy. */
  const answer = (reply: { result?: unknown; error?: string }) =>
    proxies.at(-1)!.receive({ event: 'managed-account-result', id: frames.at(-1).id, ...reply });
  return { account, frames, proxies, answer };
}
async function drain() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

test('Check status starts the runtime of an SSH host again after a keychain refusal', async (t) => {
  const { account, frames, proxies, answer } = hostAccount(t);
  const check = account.check();
  await drain();
  answer({ error: keychainRefusedCode });
  assert.equal((await check).error, keychainRefusedCode);
  assert.equal(proxies[0].isClosed(), true, 'The refused connection stops');
  // A launch on the host does not connect again, so no prompt shows without a user action.
  const sent = frames.length;
  await assert.rejects(account.runtimeClient(), /desktop\.secure_storage_unavailable/);
  assert.equal(frames.length, sent);
  assert.equal(proxies.length, 1);
  // Check status on the desktop calls the helper, which checks the host account again.
  const retry = account.check();
  await drain();
  assert.equal(proxies.length, 2);
  answer({ result: { data: authenticated } });
  await drain();
  answer({ result: { data: capabilities } });
  const status = await retry;
  assert.equal(status.phase, 'authenticated');
  assert.equal(status.error, undefined);
  await account.runtimeClient();
});

test('a new SSH connection clears a keychain refusal of the host', async (t) => {
  const { account, proxies, answer } = hostAccount(t);
  const check = account.check();
  await drain();
  answer({ error: keychainRefusedCode });
  await check;
  await assert.rejects(account.runtimeClient(), /secure_storage_unavailable/);
  // The desktop sends managed-stop when the host connects again. It resets the account.
  account.reset();
  await account.runtimeClient();
  assert.equal(proxies.length, 2);
});

test('Check status checks each connected host and names the hosts that still refuse', async () => {
  const calls: string[] = [];
  const refused = await checkHostRuntimes(
    [
      { id: 'a', name: 'build-box' },
      { id: 'b', name: 'mac-mini' },
      { id: 'c', name: 'old-helper' },
      { id: 'd', name: 'offline' },
    ],
    async (hostId, method) => {
      calls.push(`${hostId}:${method}`);
      if (hostId === 'a') return { phase: 'error', error: keychainRefusedCode };
      if (hostId === 'b') return { phase: 'authenticated' };
      if (hostId === 'c') return null;
      throw new Error('Host is offline.');
    },
  );
  assert.deepEqual(refused, ['build-box']);
  assert.deepEqual(
    calls,
    ['a', 'b', 'c', 'd'].map((id) => `${id}:${hostCheckMethod}`),
  );
  assert.match(keychainHostsMessage(refused), /system keychain on build-box\./);
  assert.match(keychainHostsMessage(refused), /allow access on build-box\. Then select Check/);
});

test('a keychain refusal in a chat on an SSH host names the host and the fix', () => {
  const failure = { message: 'x', code: keychainRefusedCode };
  const remote = managedLaunchError(failure, { computer: 'build-box', hostId: 'host-1' });
  assert.match(remote.message, /system keychain on build-box\./);
  assert.match(remote.message, /Unlock it or allow access on build-box\./);
  assert.match(remote.message, /select Check status in Settings › Accounts, and try again/);
  assert.equal(remote.action?.label, 'Check managed agent status');
  assert.equal(remote.retryFirst, true);
  const local = managedLaunchError(failure, { computer: 'this computer' });
  assert.match(local.message, /on this computer\./);
  assert.match(local.message, /allow access when the system asks/);
});
