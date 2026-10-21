import test from 'node:test';
import assert from 'node:assert/strict';
import { VerdictanSetupService } from '../electron/verdictan/setup';
import { provisionedPolicy } from '../electron/verdictan/launch';
import { DesktopProtocolError } from '../electron/verdictan/protocol';
import {
  kalkidanDefaultLabel,
  managedLaunchBlock,
  policyLabels,
  policyRecovery,
  usesDefaultPolicy,
  type VerdictanSetup,
} from '../src/domain/verdictan';

const id = '11111111-1111-4111-8111-111111111111';
const origin = 'https://api.eu.verdictan.com';
const fallback = {
  configuration_id: `cfg_${'a'.repeat(32)}`,
  configuration_version_id: `cfgv_${'b'.repeat(32)}`,
};
const other = {
  configuration_id: `cfg_${'c'.repeat(32)}`,
  configuration_version_id: `cfgv_${'d'.repeat(32)}`,
};
const account = {
  state: 'authenticated',
  expires_at: '2026-10-22T00:00:00Z',
  api_url: origin,
  organization_id: id,
  user_id: id,
};
/** A setup.inspected payload for each policy readiness value. */
function inspected(policy: string) {
  const available = policy === 'default_available';
  return {
    schema_version: 1,
    org_id: id,
    user_id: id,
    dispatch_allowed: false,
    status: 'selection_required',
    readiness: { policy },
    teams: [{ team_id: id }],
    policies: available
      ? [
          { ...fallback, default: true },
          { ...other, default: false },
        ]
      : [{ ...other, default: false }],
    provider_connections: [{ provider_connection_id: id, provider: 'openai' }],
    default_configuration: available ? { ...fallback, marker: 'kalkidan_default' } : null,
  };
}
function fixture(options: {
  policy: string;
  capabilities?: string[];
  ensure?: 'created' | 'existing' | string;
}) {
  const calls: string[] = [];
  let policy = options.policy;
  const client = {
    request: async (operation: string) => {
      calls.push(operation);
      if (operation === 'status') return { data: account };
      if (operation === 'capabilities')
        return {
          data: {
            cli_version: '0.6.3',
            protocol_min: 1,
            protocol_max: 1,
            capabilities: options.capabilities ?? ['setup.inspect', 'setup.ensure_default'],
            managed_execution_ready: true,
            tested_agents: [],
          },
        };
      if (operation === 'setup.ensure_default') {
        if (options.ensure?.startsWith('desktop.')) throw new DesktopProtocolError(options.ensure);
        policy = 'default_available';
        return {
          data: {
            schema_version: 1,
            status: options.ensure ?? 'created',
            ...fallback,
            marker: 'kalkidan_default',
            provider_restriction: 'none',
            mandatory_gateway: true,
          },
        };
      }
      return { data: inspected(policy) };
    },
  };
  const service = new VerdictanSetupService(
    async () => client as any,
    null as any,
    origin,
    async () => ({}),
  );
  return { service, calls };
}

test('setup inspection reads the policy readiness, the default and the default flag', async () => {
  const { service, calls } = fixture({ policy: 'default_available' });
  const setup = await service.status();
  assert.equal(setup.policyReadiness, 'default_available');
  assert.deepEqual(setup.defaultPolicy, fallback);
  assert.deepEqual(setup.policies, [{ ...fallback, default: true }, other]);
  // A default that exists needs no creation.
  assert.equal(calls.includes('setup.ensure_default'), false);
  assert.deepEqual(policyLabels(setup.policies), [kalkidanDefaultLabel, 'Policy 1']);
});

test('the first connect of an administrator makes the default once, then inspects again', async () => {
  const { service, calls } = fixture({ policy: 'default_creatable' });
  const setup = await service.status();
  assert.deepEqual(calls, [
    'status',
    'setup.inspect',
    'capabilities',
    'setup.ensure_default',
    'status',
    'setup.inspect',
  ]);
  assert.equal(setup.defaultEnsured, 'created');
  assert.equal(setup.policyReadiness, 'default_available');
  assert.deepEqual(setup.defaultPolicy, fallback);
});

test('a launch inspection and an older runtime never make the default', async () => {
  const launch = fixture({ policy: 'default_creatable' });
  await launch.service.inspect();
  assert.equal(launch.calls.includes('setup.ensure_default'), false);
  const older = fixture({ policy: 'default_creatable', capabilities: ['setup.inspect'] });
  const setup = await older.service.status();
  assert.equal(older.calls.includes('setup.ensure_default'), false);
  assert.equal(setup.policyReadiness, 'default_creatable');
  assert.equal(setup.defaultPolicy, undefined);
});

test('a member without permission gets the administrator recovery, not an error', async () => {
  for (const [code, readiness] of [
    ['desktop.setup_default_configuration_required', 'default_configuration_required'],
    ['desktop.setup_permission_required', 'default_permission_required'],
  ] as const) {
    const { service } = fixture({ policy: 'default_creatable', ensure: code });
    const setup = await service.status();
    assert.equal(setup.policyReadiness, readiness);
    assert.equal(setup.defaultPolicy, undefined);
    assert.match(policyRecovery(setup.policyReadiness)!, /Ask an organization administrator/);
    const block = managedLaunchBlock(new DesktopProtocolError(code));
    assert.equal(block.step, 'agent-setup');
    assert.match(block.message, /organization administrator/);
    assert.doesNotMatch(block.message, /desktop\./);
  }
  for (const readiness of ['default_configuration_required', 'default_permission_required']) {
    const { service, calls } = fixture({ policy: readiness });
    assert.equal((await service.status()).policyReadiness, readiness);
    assert.equal(calls.includes('setup.ensure_default'), false);
  }
  assert.equal(policyRecovery('default_available'), undefined);
  const { service } = fixture({ policy: 'default_creatable', ensure: 'desktop.auth_expired' });
  await assert.rejects(service.status(), /auth_expired/);
});

test('an invalid default configuration is a setup error; an invalid ensure result is not', async () => {
  const bad = fixture({ policy: 'default_available' });
  const original = bad.service['client'];
  bad.service['client'] = async () => {
    const client = await original();
    return {
      request: async (operation: string) => {
        const event = await client.request(operation as any);
        if (operation === 'setup.inspect')
          (event.data as any).default_configuration = { ...fallback, marker: 'other' };
        return event;
      },
    } as any;
  };
  await assert.rejects(bad.service.status(), /setup_invalid/);
  // An invalid ensure result does not hide the policies that the inspection found.
  const ensure = fixture({ policy: 'default_creatable', ensure: 'unknown' });
  const setup = await ensure.service.status();
  assert.equal(setup.defaultUnavailable, true);
  assert.equal(setup.defaultPolicy, undefined);
  assert.deepEqual(setup.policies, [other]);
});

test('an ensure failure keeps the inspected policies and shows the administrator recovery', async () => {
  for (const code of [
    'desktop.permission_denied',
    'desktop.setup_default_configuration_required',
    'desktop.setup_permission_required',
  ]) {
    const { service, calls } = fixture({ policy: 'default_creatable', ensure: code });
    const setup = await service.status();
    assert.ok(calls.includes('setup.ensure_default'), code);
    // The inspection result stays: the user can choose an existing policy.
    assert.deepEqual(setup.policies, [other], code);
    assert.equal(setup.teams.length, 1, code);
    assert.equal(setup.providerConnections.length, 1, code);
    assert.equal(setup.defaultUnavailable, undefined, code);
    assert.match(policyRecovery(setup.policyReadiness)!, /Ask an organization administrator/, code);
    // An explicit choice of an existing policy is valid without the default.
    const picked = {
      teamId: id,
      configurationId: other.configuration_id,
      configurationVersionId: other.configuration_version_id,
      providerConnectionId: id,
      model: 'gpt-5',
    };
    assert.equal(service.validate(setup, 'codex', picked), picked, code);
  }
  // Another failure, for example a lost connection, keeps the result. Refresh tries again.
  const lost = fixture({ policy: 'default_creatable', ensure: 'desktop.transport_lost' });
  const setup = await lost.service.status();
  assert.equal(setup.defaultUnavailable, true);
  assert.equal(setup.policyReadiness, 'default_creatable');
  assert.deepEqual(setup.policies, [other]);
  await lost.service.status();
  assert.equal(lost.calls.filter((call) => call === 'setup.ensure_default').length, 2);
});

test('a selection without policy IDs needs a readable default; one ID alone is never valid', () => {
  const service = new VerdictanSetupService(null as any, null as any, origin);
  const setup: VerdictanSetup = {
    status: 'ready',
    teams: [{ team_id: id }],
    policies: [{ ...fallback, default: true }, other],
    providerConnections: [{ provider_connection_id: id, provider: 'openai' }],
    defaultPolicy: fallback,
    selections: {},
  };
  const selection = {
    teamId: id,
    configurationId: '',
    configurationVersionId: '',
    providerConnectionId: id,
    model: 'gpt-5',
  };
  assert.equal(usesDefaultPolicy(selection), true);
  assert.equal(service.validate(setup, 'codex', selection), selection);
  const picked = {
    ...selection,
    configurationId: other.configuration_id,
    configurationVersionId: other.configuration_version_id,
  };
  assert.equal(service.validate(setup, 'codex', picked), picked);
  for (const half of [
    { ...selection, configurationId: other.configuration_id },
    { ...selection, configurationVersionId: other.configuration_version_id },
  ])
    assert.throws(() => service.validate(setup, 'codex', half), /setup_selection_required/);
  assert.throws(
    () => service.validate({ ...setup, defaultPolicy: undefined }, 'codex', selection),
    /setup_selection_required/,
  );
});

test('provisioning checks the configuration source of the default and of a picked policy', () => {
  const none = {
    teamId: id,
    configurationId: '',
    configurationVersionId: '',
    providerConnectionId: id,
    model: 'gpt-5',
  };
  const picked = {
    ...none,
    configurationId: other.configuration_id,
    configurationVersionId: other.configuration_version_id,
  };
  const resolved = { ...fallback, configuration_source: 'kalkidan_default' };
  assert.equal(provisionedPolicy(resolved, none, fallback), true);
  // A binding made with the default keeps the version that Verdictan deployed first.
  assert.equal(
    provisionedPolicy(
      { ...resolved, configuration_version_id: `cfgv_${'e'.repeat(32)}` },
      none,
      fallback,
    ),
    true,
  );
  assert.equal(provisionedPolicy({ ...resolved, ...other }, none, fallback), false);
  assert.equal(
    provisionedPolicy({ ...fallback, configuration_source: 'selected' }, none, fallback),
    false,
  );
  assert.equal(provisionedPolicy(resolved, none, undefined), false);
  assert.equal(
    provisionedPolicy({ ...other, configuration_source: 'selected' }, picked, fallback),
    true,
  );
  // Older runtimes do not send the source for a picked policy.
  assert.equal(provisionedPolicy({ ...other }, picked, fallback), true);
  assert.equal(
    provisionedPolicy({ ...other, configuration_source: 'kalkidan_default' }, picked, fallback),
    false,
  );
  assert.equal(provisionedPolicy({ ...fallback }, picked, fallback), false);
});
