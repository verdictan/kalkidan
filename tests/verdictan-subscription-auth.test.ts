import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareSubscriptionAuth } from '../electron/verdictan/subscription-auth';

test('managed subscription login copies only host-local session fields and preserves the native login', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'subscription-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, 'managed'),
    source = join(root, 'auth.json');
  await mkdir(home);
  const original = JSON.stringify({
    tokens: {
      access_token: 'test-access',
      account_id: 'test-account',
      refresh_token: 'test-refresh',
      id_token: 'test-id',
    },
    unrelated: 'private',
  });
  await writeFile(source, original);
  await prepareSubscriptionAuth(home, source);
  const auth = JSON.parse(await readFile(join(home, 'auth.json'), 'utf8'));
  assert.deepEqual(auth, {
    auth_mode: 'chatgpt',
    OPENAI_API_KEY: null,
    tokens: { access_token: 'test-access', account_id: 'test-account', id_token: 'test-id' },
  });
  assert.equal(await readFile(source, 'utf8'), original);
  const link = join(root, 'linked.json');
  await symlink(source, link);
  await assert.rejects(prepareSubscriptionAuth(home, link), {
    code: 'desktop.codex_subscription_login_invalid',
  });
  await writeFile(
    source,
    JSON.stringify({
      OPENAI_API_KEY: 'test-key',
      tokens: { access_token: 'test-access', account_id: 'test-account' },
    }),
  );
  await assert.rejects(prepareSubscriptionAuth(home, source), {
    code: 'desktop.codex_subscription_login_required',
  });
  await writeFile(source, 'x'.repeat(65537));
  await assert.rejects(prepareSubscriptionAuth(home, source), {
    code: 'desktop.codex_subscription_login_invalid',
  });
  await assert.rejects(prepareSubscriptionAuth(home, join(root, 'missing.json')), {
    code: 'desktop.codex_subscription_login_required',
  });
});
