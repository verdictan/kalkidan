import test from 'node:test';
import assert from 'node:assert/strict';
import {
  configuredVerdictanRegion,
  savedVerdictanRegion,
  saveVerdictanRegion,
  verdictanRegion,
} from '../electron/verdictan/region';
import { createVerdictanServices } from '../electron/verdictan/service';
import { policyId } from '../electron/verdictan/policy-id';
import { VerdictanSetupService } from '../electron/verdictan/setup';

test('regions use fixed regional origins and separate secure profiles', () => {
  assert.deepEqual(verdictanRegion('eu'), {
    apiOrigin: 'https://api.eu.verdictan.com',
    consoleOrigin: 'https://console.eu.verdictan.com',
    profile: 'kalkidan-eu',
  });
  assert.deepEqual(verdictanRegion('us'), {
    apiOrigin: 'https://api.us.verdictan.com',
    consoleOrigin: 'https://console.us.verdictan.com',
    profile: 'kalkidan-us',
  });
  // The global host geo-redirects across hosts. Authenticated use needs a regional choice.
  for (const value of ['global', 'EU', 'https://other.example', '../eu', '', undefined, null])
    assert.throws(() => verdictanRegion(value), /Select the EU or US/);
  assert.equal(configuredVerdictanRegion('eu'), 'eu');
  assert.equal(configuredVerdictanRegion('us'), 'us');
  for (const value of ['global', 'US', '', undefined])
    assert.equal(configuredVerdictanRegion(value), undefined);
});

test('live API policy identifiers parse without weakening UUID account validation', async () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const policy = {
    configuration_id: `cfg_${'a'.repeat(32)}`,
    configuration_version_id: `cfgv_${'b'.repeat(32)}`,
  };
  const data = {
    schema_version: 1,
    org_id: id,
    user_id: id,
    dispatch_allowed: false,
    status: 'selection_required',
    teams: [{ team_id: id }],
    policies: [policy],
    provider_connections: [],
  };
  const client = {
    request: async (operation: string) => ({
      data:
        operation === 'status'
          ? {
              state: 'authenticated',
              expires_at: '2026-10-22T00:00:00Z',
              api_url: 'https://api.eu.verdictan.com',
              organization_id: id,
              user_id: id,
            }
          : data,
    }),
  };
  const service = new VerdictanSetupService(
    async () => client as any,
    null as any,
    'https://api.eu.verdictan.com',
    async () => ({}),
  );
  assert.deepEqual((await service.status()).policies, [policy]);
  assert.equal(policyId(id, 'configuration'), true);
  assert.equal(policyId(policy.configuration_id, 'version'), false);
  assert.equal(policyId(`${policy.configuration_id}/../secret`, 'configuration'), false);
  data.teams[0].team_id = policy.configuration_id;
  await assert.rejects(service.status(), /setup_invalid/);
});

async function temporary(t: { after(fn: () => Promise<void>): void }) {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const root = await mkdtemp(join(tmpdir(), 'region-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}
function environment(t: { after(fn: () => void): void }, value?: string) {
  const previous = process.env.KALKIDAN_VERDICTAN_REGION;
  if (value === undefined) delete process.env.KALKIDAN_VERDICTAN_REGION;
  else process.env.KALKIDAN_VERDICTAN_REGION = value;
  t.after(() => {
    if (previous === undefined) delete process.env.KALKIDAN_VERDICTAN_REGION;
    else process.env.KALKIDAN_VERDICTAN_REGION = previous;
  });
}

test('saved region persists independently of environment and rejects invalid values', async (t) => {
  const root = await temporary(t);
  environment(t, 'us');
  await saveVerdictanRegion(root, 'eu');
  assert.equal(await savedVerdictanRegion(root), 'eu');
  await assert.rejects(saveVerdictanRegion(root, 'https://untrusted.example'));
  await assert.rejects(saveVerdictanRegion(root, 'global'));
  assert.equal(await savedVerdictanRegion(root), 'eu');
  await saveVerdictanRegion(root, 'us');
  assert.equal(await savedVerdictanRegion(root), 'us');
});

test('a saved legacy global region migrates to an unselected region, never to EU or US', async (t) => {
  const { writeFile } = await import('node:fs/promises');
  const { join } = await import('node:path');
  const root = await temporary(t);
  // The environment must not silently replace an explicit earlier choice.
  environment(t, 'eu');
  const file = join(root, 'verdictan-region.json');
  for (const raw of [
    JSON.stringify({ region: 'global' }),
    JSON.stringify({ region: 'https://api.verdictan.com' }),
    JSON.stringify(null),
    '{damaged',
  ]) {
    await writeFile(file, raw);
    assert.equal(await savedVerdictanRegion(root), undefined, raw);
  }
});

test('without a saved file, only an EU or US operator setting selects a region', async (t) => {
  const root = await temporary(t);
  for (const [value, expected] of [
    [undefined, undefined],
    ['global', undefined],
    ['other', undefined],
    ['eu', 'eu'],
    ['us', 'us'],
  ] as const) {
    environment(t, value);
    assert.equal(await savedVerdictanRegion(root), expected, String(value));
  }
});

test('an unselected region starts no account client and fails closed', async (t) => {
  const root = await temporary(t);
  let connected = 0;
  const options = {
    root,
    desktopVersion: '1.2.3',
    hostId: 'local',
    policy: async () => null,
    busy: () => false,
    openBrowser: async () => {
      throw Error('Must not open');
    },
    client: async () => {
      connected++;
      throw Error('Must not connect');
    },
  };
  const services = createVerdictanServices(options);
  t.after(() => services.account.dispose());
  assert.equal(services.region, undefined);
  const checked = await services.account.check();
  assert.equal(checked.phase, 'error');
  assert.equal(checked.error, 'desktop.region_required');
  assert.equal((await services.account.authorize('login')).error, 'desktop.region_required');
  await assert.rejects(services.account.runtimeClient(), /region_required/);
  await assert.rejects(services.setup.status(), /region_required/);
  assert.equal(connected, 0);
  assert.throws(() => createVerdictanServices({ ...options, region: 'global' }), /EU or US/);
  const us = createVerdictanServices({ ...options, region: 'us' });
  t.after(() => us.account.dispose());
  assert.equal(us.region, 'us');
});
