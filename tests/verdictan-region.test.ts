import test from 'node:test';
import assert from 'node:assert/strict';
import { verdictanRegion } from '../electron/verdictan/region';
import { policyId } from '../electron/verdictan/policy-id';
import { VerdictanSetupService } from '../electron/verdictan/setup';

test('regions use fixed origins and separate secure profiles', () => {
  assert.deepEqual(verdictanRegion('eu'), {
    apiOrigin: 'https://api.eu.verdictan.com',
    consoleOrigin: 'https://console.eu.verdictan.com',
    profile: 'kalkidan-eu',
  });
  assert.equal(verdictanRegion('global').profile, 'kalkidan');
  for (const value of ['EU', 'https://other.example', '../eu', ''])
    assert.throws(() => verdictanRegion(value), /KALKIDAN_VERDICTAN_REGION/);
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

test('saved region persists independently of environment and rejects invalid values', async (t) => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { savedVerdictanRegion, saveVerdictanRegion } =
    await import('../electron/verdictan/region');
  const root = await mkdtemp(join(tmpdir(), 'region-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await saveVerdictanRegion(root, 'eu');
  assert.equal(await savedVerdictanRegion(root), 'eu');
  await assert.rejects(saveVerdictanRegion(root, 'https://untrusted.example'));
  assert.equal(await savedVerdictanRegion(root), 'eu');
});
