import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VerdictanAccounts, accountProfile } from '../electron/verdictan/accounts';

async function fixture(t: any) {
  const root = await mkdtemp(join(tmpdir(), 'kalkidan-accounts-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('existing regional sign-in keeps its profile; new accounts get distinct profiles', async (t) => {
  const root = await fixture(t);
  const accounts = await VerdictanAccounts.open(root, 'eu');
  assert.equal(accountProfile(accounts.active()), 'kalkidan-eu');
  const first = accounts.active();
  const second = await accounts.add();
  assert.equal(accounts.active().id, first.id);
  assert.equal(accountProfile(second), undefined);
  await accounts.select(second.id);
  await accounts.setRegion('eu');
  assert.notEqual(accountProfile(accounts.active()), accountProfile(first));
  const secondProfile = accountProfile(accounts.active());
  await accounts.select(first.id);
  assert.equal(accountProfile(accounts.active()), 'kalkidan-eu');
  await accounts.select(second.id);
  const reopened = await VerdictanAccounts.open(root, 'us');
  assert.equal(reopened.active().id, second.id);
  assert.equal(accountProfile(reopened.active()), secondProfile);
});

test('only display labels persist, and updates preserve other accounts', async (t) => {
  const root = await fixture(t);
  const accounts = await VerdictanAccounts.open(root, 'eu');
  const first = accounts.active().id;
  const second = await accounts.add();
  await Promise.all([
    accounts.remember(first, {
      state: 'authenticated',
      apiUrl: 'https://api.eu.verdictan.com',
      userName: 'Dana',
      organizationName: 'Acme',
      userId: 'private-id',
      token: 'secret',
    } as any),
    accounts.select(second.id),
  ]);
  assert.equal(accounts.active().id, second.id);
  assert.equal(accounts.get(first).userName, 'Dana');
  assert.equal(accounts.get(second.id).userName, undefined);
  await accounts.remember(first, { state: 'signed-out', apiUrl: '' });
  assert.equal(accounts.get(first).userName, 'Dana');
  const raw = await readFile(join(root, 'verdictan-accounts.json'), 'utf8');
  assert.ok(!raw.includes('secret') && !raw.includes('private-id'));
  assert.throws(() => accounts.get('../account'));
  await assert.rejects(accounts.select('unknown'));
  assert.equal(accounts.active().id, second.id);
});

test('legacy region change preserves the other saved regional account', async (t) => {
  const accounts = await VerdictanAccounts.open(await fixture(t), 'eu');
  await accounts.setRegion('us');
  assert.equal(accountProfile(accounts.active()), 'kalkidan-us');
  await accounts.select('legacy-eu');
  assert.equal(accountProfile(accounts.active()), 'kalkidan-eu');
  await assert.rejects(accounts.setRegion('global' as any));
  assert.throws(() => accountProfile({ id: '../profile', region: 'eu' }));
  assert.throws(() => accountProfile({ id: 'legacy-us', region: 'eu' }));
});

test('a corrupt index is reported instead of overwriting saved accounts', async (t) => {
  const root = await fixture(t);
  await writeFile(join(root, 'verdictan-accounts.json'), '{broken');
  await assert.rejects(VerdictanAccounts.open(root, 'eu'));
  assert.equal(await readFile(join(root, 'verdictan-accounts.json'), 'utf8'), '{broken');
});
