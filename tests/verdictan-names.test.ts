import test from 'node:test';
import assert from 'node:assert/strict';
import { VerdictanSetupService } from '../electron/verdictan/setup';
import { accountNames } from '../electron/verdictan/account';
import {
  accountLabel,
  connectionLabels,
  isOpaqueId,
  policyLabels,
  serviceName,
  teamLabels,
} from '../src/domain/verdictan';

const team = '11111111-1111-4111-8111-111111111111';
const team2 = '22222222-2222-4222-8222-222222222222';
const cfg = `cfg_${'a'.repeat(32)}`;
const cfgv = `cfgv_${'b'.repeat(32)}`;
const cfgv2 = `cfgv_${'c'.repeat(32)}`;
const account = {
  state: 'authenticated' as const,
  apiUrl: 'https://api.verdictan.com',
  organizationId: team,
  userId: team2,
};

async function inspect(setup: Record<string, unknown>) {
  const client: any = {
    request: async (operation: string) => {
      if (operation === 'status')
        return {
          data: {
            state: 'authenticated',
            api_url: 'https://api.verdictan.com',
            user_id: team2,
            organization_id: team,
            expires_at: '2030-01-01T00:00:00Z',
          },
        };
      return {
        data: {
          schema_version: 1,
          org_id: team,
          user_id: team2,
          dispatch_allowed: false,
          status: 'ready',
          teams: [],
          policies: [],
          provider_connections: [],
          ...setup,
        },
      };
    },
  };
  return new VerdictanSetupService(
    async () => client,
    null as any,
    'https://api.verdictan.com',
    async () => ({}),
  ).status();
}

test('internal identifiers are never accepted as display names', () => {
  for (const value of [
    team,
    cfg,
    cfgv,
    'gw_01HZX3K9Q7ABCDEF',
    'vdt_secretvalue123',
    'a'.repeat(40),
  ])
    assert.equal(isOpaqueId(value), true, value);
  for (const value of ['Platform team', 'Default policy', 'data_science', 'Acme Corp', 'Q4 2026'])
    assert.equal(isOpaqueId(value), false, value);
  assert.equal(serviceName(undefined, '', cfg, '  Platform\u0007 team  '), 'Platform team');
  assert.equal(serviceName('x'.repeat(121)), undefined);
});

test('setup labels use service names and fall back to numbered generic labels', () => {
  assert.deepEqual(teamLabels([{ team_id: team }]), ['Default team']);
  assert.deepEqual(teamLabels([{ team_id: team }, { team_id: team2 }]), ['Team 1', 'Team 2']);
  assert.deepEqual(teamLabels([{ team_id: team, name: 'Platform' }, { team_id: team2 }]), [
    'Platform',
    'Team 1',
  ]);
  assert.deepEqual(policyLabels([{ configuration_id: cfg, configuration_version_id: cfgv }]), [
    'Policy',
  ]);
  assert.deepEqual(
    policyLabels([
      { configuration_id: cfg, configuration_version_id: cfgv },
      { configuration_id: cfg, configuration_version_id: cfgv2 },
    ]),
    ['Policy 1', 'Policy 2'],
  );
  assert.deepEqual(
    policyLabels([
      {
        configuration_id: cfg,
        configuration_version_id: cfgv,
        name: 'Default',
        version_name: 'v1',
      },
      { configuration_id: cfg, configuration_version_id: cfgv2, name: 'Default' },
      { configuration_id: cfg, configuration_version_id: cfg, name: 'Default' },
    ]),
    ['Default · v1', 'Default (1)', 'Default (2)'],
  );
  assert.deepEqual(
    connectionLabels([
      { provider_connection_id: team, provider: 'openai' },
      { provider_connection_id: team2, provider: 'anthropic' },
      { provider_connection_id: cfg, provider: 'anthropic', name: 'Claude team key' },
    ]),
    ['OpenAI connection', 'Anthropic connection 1', 'Claude team key'],
  );
  for (const label of [
    ...teamLabels([{ team_id: team, name: team }]),
    ...policyLabels([{ configuration_id: cfg, configuration_version_id: cfgv, name: cfgv }]),
  ])
    assert.equal(isOpaqueId(label), false, label);
});

test('setup inspection keeps IDs as values and passes optional names', async () => {
  const setup = await inspect({
    teams: [
      { team_id: team, name: 'Platform' },
      { team_id: team2, display_name: team2 },
    ],
    policies: [
      { configuration_id: cfg, configuration_version_id: cfgv, display_name: 'Default policy' },
      { configuration_id: cfg, configuration_version_id: cfgv2 },
    ],
    provider_connections: [{ provider_connection_id: team, provider: 'anthropic', name: 'Key' }],
  });
  assert.deepEqual(setup.teams, [{ team_id: team, name: 'Platform' }, { team_id: team2 }]);
  assert.deepEqual(setup.policies, [
    { configuration_id: cfg, configuration_version_id: cfgv, name: 'Default policy' },
    { configuration_id: cfg, configuration_version_id: cfgv2 },
  ]);
  assert.deepEqual(setup.providerConnections, [
    { provider_connection_id: team, provider: 'anthropic', name: 'Key' },
  ]);
  // The current broker sends IDs only. The labels stay generic.
  const bare = await inspect({
    teams: [{ team_id: team }],
    policies: [{ configuration_id: cfg, configuration_version_id: cfgv }],
  });
  assert.deepEqual(teamLabels(bare.teams), ['Default team']);
  assert.deepEqual(policyLabels(bare.policies), ['Policy']);
});

test('account names come only from a matching account inspection', async () => {
  const reply = (data: Record<string, unknown>) => ({
    request: async (operation: string) => {
      assert.equal(operation, 'account.inspect');
      return { data };
    },
  });
  const match = { organization_id: team, user_id: team2 };
  assert.deepEqual(
    await accountNames(reply({ ...match, organization_name: 'Acme Corp' }) as any, account),
    { organizationName: 'Acme Corp' },
  );
  assert.deepEqual(
    await accountNames(reply({ ...match, organization_name: team }) as any, account),
    {},
  );
  assert.deepEqual(
    await accountNames(reply({ organization_id: team2, user_id: team2 }) as any, account),
    {},
  );
  const failing: any = {
    request: async () => {
      throw new Error('desktop.operation_failed');
    },
  };
  assert.deepEqual(await accountNames(failing, account), {});
  assert.equal(accountLabel({ organizationName: 'Acme Corp' }), 'Acme Corp');
  assert.equal(accountLabel({}), 'Your account');
  assert.equal(accountLabel({ organizationName: team }), 'Your account');
});
