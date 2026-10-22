import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { subscriptionLogin } from '../electron/agent-installations';
import { checkNativeClaudeLogin } from '../electron/verdictan/claude-subscription-auth';
import { readCodexSubscriptionLogin } from '../electron/verdictan/subscription-auth';
import { DesktopProtocolError } from '../electron/verdictan/protocol';
import { managedLaunchError } from '../src/lib/agent-errors';
import { managedLaunchBlock } from '../src/domain/verdictan';

const mac = { platform: 'darwin', arch: 'arm64', account: 'user', environment: {} };

test('the Claude login check on macOS reads only whether the Keychain item exists', async () => {
  const accounts: string[] = [];
  await checkNativeClaudeLogin({
    ...mac,
    macItemExists: async (account) => {
      accounts.push(account);
      return true;
    },
  });
  assert.deepEqual(accounts, ['user']);
  await assert.rejects(checkNativeClaudeLogin({ ...mac, macItemExists: async () => false }), {
    code: 'desktop.claude_subscription_login_required',
  });
  await assert.rejects(
    checkNativeClaudeLogin({
      ...mac,
      environment: { CLAUDE_CONFIG_DIR: '/custom' },
      macItemExists: async () => true,
    }),
    { code: 'desktop.claude_subscription_native_profile_unsupported' },
  );
  await assert.rejects(
    checkNativeClaudeLogin({ ...mac, arch: 'x64', macItemExists: async () => true }),
    { code: 'desktop.claude_subscription_unsupported' },
  );
});

test('the Claude login check on Linux reads the login file and keeps no token', async () => {
  const now = Date.parse('2026-10-20T00:00:00Z');
  const login = JSON.stringify({
    claudeAiOauth: {
      accessToken: 'synthetic-access-token',
      expiresAt: now + 3600000,
      scopes: ['user:inference', 'user:profile'],
    },
  });
  assert.equal(
    await checkNativeClaudeLogin({
      platform: 'linux',
      arch: 'x64',
      account: 'user',
      home: '/home/user',
      environment: {},
      now: () => now,
      readLinuxSecret: async () => Buffer.from(login),
    }),
    undefined,
  );
  await assert.rejects(
    checkNativeClaudeLogin({
      platform: 'linux',
      arch: 'x64',
      account: 'user',
      home: '/home/user',
      environment: {},
      now: () => now,
      readLinuxSecret: async () => Buffer.from('{}'),
    }),
    { code: 'desktop.claude_subscription_login_required' },
  );
});

test('the Codex login check accepts only a ChatGPT login', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'codex-login-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'auth.json');
  await writeFile(file, JSON.stringify({ tokens: { access_token: 'a', account_id: 'b' } }));
  assert.deepEqual(await readCodexSubscriptionLogin(file), { accessToken: 'a', accountId: 'b' });
  await writeFile(file, JSON.stringify({ OPENAI_API_KEY: 'key' }));
  await assert.rejects(readCodexSubscriptionLogin(file), {
    code: 'desktop.codex_subscription_login_required',
  });
  await writeFile(file, 'not json');
  await assert.rejects(readCodexSubscriptionLogin(file), {
    code: 'desktop.codex_subscription_login_invalid',
  });
});

test('the agent list says signed in, signed out, or nothing when Kalkidan cannot tell', async () => {
  const fails = (code: string) => async () => {
    throw new DesktopProtocolError(code);
  };
  const ok = async () => undefined;
  assert.equal(await subscriptionLogin('codex', { codex: ok, claude: ok }), 'signed-in');
  assert.equal(
    await subscriptionLogin('codex', {
      codex: fails('desktop.codex_subscription_login_required'),
      claude: ok,
    }),
    'signed-out',
  );
  assert.equal(
    await subscriptionLogin('claude_code', {
      codex: ok,
      claude: fails('desktop.claude_subscription_login_required'),
    }),
    'signed-out',
  );
  assert.equal(
    await subscriptionLogin('claude_code', {
      codex: ok,
      claude: fails('desktop.secure_storage_unavailable'),
    }),
    undefined,
  );
  assert.equal(
    await subscriptionLogin('codex', {
      codex: fails('desktop.codex_subscription_login_invalid'),
      claude: ok,
    }),
    // The launch refuses this login too, so Settings › Computers must not show Ready.
    'signed-out',
  );
});

test('a chat that cannot start for the agent sign-in says why and links to the agent row', () => {
  const login = managedLaunchError(
    { message: 'x', code: 'desktop.codex_subscription_login_required' },
    { agent: 'codex' },
  );
  assert.match(login.message, /codex login/);
  assert.equal(login.action?.label, 'Sign in to the agent');
  assert.equal(login.action?.anchor, 'agent-program-local-codex');
  const catalog = managedLaunchError({
    message: 'x',
    code: 'desktop.codex_subscription_catalog_unavailable',
  });
  assert.match(catalog.message, /cannot reach its models/);
  assert.equal(catalog.retryFirst, true);
  assert.equal(
    managedLaunchBlock(new Error('[desktop.codex_subscription_login_invalid]')).step,
    'agent-sign-in',
  );
});
