import test from 'node:test';
import { runtimeSetupNotice } from '../src/domain/compatibility';
import assert from 'node:assert/strict';
import { VerdictanSetupService } from '../electron/verdictan/setup';
import { provisionedPolicy } from '../electron/verdictan/launch';
import { DesktopProtocolError } from '../electron/verdictan/protocol';
import {
  agentConfigurationLabel,
  agentLabels,
  computerAgentIssue,
  defaultRemoved,
  managedLaunchBlock,
  managedOnlyNotice,
  sameSelection,
  selectionIssue,
  usesAgentChoice,
  type VerdictanSelection,
  type VerdictanSetup,
} from '../src/domain/verdictan';
import { managedSteps } from '../src/lib/verdictan-labels';

const id = '11111111-1111-4111-8111-111111111111';
const team2 = '22222222-2222-4222-8222-222222222222';
const kalkidanAgent = '33333333-3333-4333-8333-333333333333';
const otherAgent = '44444444-4444-4444-8444-444444444444';
const origin = 'https://api.eu.verdictan.com';
const fallback = {
  configuration_id: `cfg_${'a'.repeat(32)}`,
  configuration_version_id: `cfgv_${'b'.repeat(32)}`,
};
const strict = {
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
const record = (overrides: Record<string, unknown> = {}) => ({
  status: 'bootstrapped',
  bootstrapped_at: '2026-10-21T10:00:00Z',
  ...fallback,
  configuration_status: 'available',
  agent_id: kalkidanAgent,
  agent_status: 'available',
  team_id: id,
  ...overrides,
});
const agentEntries = [
  // The service can send the default agent second. Kalkidan shows it first.
  {
    agent_id: otherAgent,
    team_id: team2,
    name: 'Release bot',
    ...strict,
    configuration_name: 'Strict',
    version_name: '2.0.0',
    default: false,
  },
  {
    agent_id: kalkidanAgent,
    team_id: id,
    ...fallback,
    configuration_name: 'Kalkidan default',
    version_name: '1.1.0',
    default: true,
  },
];
type Bootstrap = 'bootstrapped' | 'bootstrap_available' | 'bootstrap_requires_admin' | 'unknown';
/** A setup.inspected payload of CLI 0.6.6 (`setup.inspected` schema). */
function inspected(state: {
  bootstrap?: Bootstrap;
  policy: string;
  record?: Record<string, unknown> | null;
  agents?: unknown[];
}) {
  const available = state.policy === 'default_available';
  return {
    schema_version: 1,
    org_id: id,
    user_id: id,
    status: 'selection_required',
    recovery_action: 'select_authorized_resources',
    dispatch_allowed: false,
    readiness: {
      policy: state.policy,
      ...(state.bootstrap ? { bootstrap: state.bootstrap } : {}),
    },
    candidates: [],
    discovery_limit: 50,
    teams: [{ team_id: id }, { team_id: team2, name: 'Platform' }],
    policies: available ? [{ ...fallback, default: true }, strict] : [strict],
    provider_connections: [{ provider_connection_id: id, provider: 'openai' }],
    default_configuration: available ? { ...fallback, marker: 'kalkidan_default' } : null,
    ...(state.record !== undefined ? { bootstrap: state.record } : {}),
    ...(state.agents ? { agents: state.agents } : {}),
  };
}
const bootstrapped = {
  schema_version: 1,
  status: 'bootstrapped',
  ...fallback,
  agent_id: kalkidanAgent,
  name: 'Kalkidan default',
  version_name: '1.1.0',
  agent_name: 'Kalkidan',
  default_upgraded: false,
  bootstrap: record(),
  marker: 'kalkidan_default',
  provider_restriction: 'none',
  mandatory_gateway: true,
};
function fixture(options: {
  bootstrap?: Bootstrap;
  policy?: string;
  capabilities?: string[];
  /** A code that `setup.bootstrap` fails with, or a result to return. */
  result?: string | Record<string, unknown>;
  selections?: VerdictanSetup['selections'];
}) {
  const calls: { operation: string; parameters?: unknown }[] = [];
  let state = {
    bootstrap: options.bootstrap,
    policy: options.policy ?? 'default_creatable',
    record: options.bootstrap ? (null as Record<string, unknown> | null) : undefined,
    agents: options.bootstrap ? ([] as unknown[]) : undefined,
  };
  const client = {
    request: async (operation: string, parameters?: unknown) => {
      calls.push({ operation, ...(parameters ? { parameters } : {}) });
      if (operation === 'status') return { data: account };
      if (operation === 'capabilities')
        return {
          data: {
            cli_version: '0.6.6',
            protocol_min: 1,
            protocol_max: 1,
            capabilities: options.capabilities ?? [
              'setup.inspect',
              'setup.bootstrap',
              'setup.ensure_default',
            ],
            managed_execution_ready: true,
            tested_agents: [],
          },
        };
      if (operation === 'setup.bootstrap') {
        if (typeof options.result === 'string') throw new DesktopProtocolError(options.result);
        state = {
          bootstrap: 'bootstrapped',
          policy: 'default_available',
          record: record(),
          agents: agentEntries,
        };
        return { data: options.result ?? bootstrapped };
      }
      if (operation === 'setup.ensure_default') {
        state = { ...state, policy: 'default_available' };
        return {
          data: {
            schema_version: 1,
            status: 'created',
            ...fallback,
            marker: 'kalkidan_default',
            provider_restriction: 'none',
            mandatory_gateway: true,
          },
        };
      }
      return { data: inspected(state) };
    },
  };
  const service = new VerdictanSetupService(
    async () => client as any,
    null as any,
    origin,
    async () => options.selections ?? {},
  );
  const operations = () => calls.map((call) => call.operation);
  return { service, calls, operations };
}

test('the first connect of an administrator bootstraps once, then inspects again', async () => {
  const f = fixture({ bootstrap: 'bootstrap_available' });
  const setup = await f.service.status();
  assert.deepEqual(f.operations(), [
    'status',
    'setup.inspect',
    'capabilities',
    'setup.bootstrap',
    'status',
    'setup.inspect',
  ]);
  // Without a saved team, Verdictan selects the team of the agent.
  assert.equal(f.calls[3].parameters, undefined);
  assert.equal(setup.bootstrapped, 'bootstrapped');
  assert.equal(setup.bootstrapReadiness, 'bootstrapped');
  assert.deepEqual(setup.bootstrap, {
    status: 'bootstrapped',
    agent_id: kalkidanAgent,
    configuration_status: 'available',
    agent_status: 'available',
  });
  assert.equal(setup.agents?.[0].agent_id, kalkidanAgent);
  assert.equal(setup.agents?.[0].default, true);
  // The next check finds the record. It never sends a setup operation again.
  const again = await f.service.status();
  assert.equal(f.operations().filter((op) => op === 'setup.bootstrap').length, 1);
  assert.equal(f.operations().includes('setup.ensure_default'), false);
  // The result stays for this app session, so a later Settings view still shows it.
  assert.equal(again.bootstrapped, 'bootstrapped');
  assert.deepEqual(f.operations().slice(6), ['status', 'setup.inspect']);
});

test('the bootstrap sends the team of a saved selection', async () => {
  const selection: VerdictanSelection = {
    teamId: team2,
    configurationId: '',
    configurationVersionId: '',
    providerConnectionId: id,
    model: 'gpt-5',
  };
  const f = fixture({ bootstrap: 'bootstrap_available', selections: { claude: selection } });
  await f.service.status();
  assert.deepEqual(f.calls[3], {
    operation: 'setup.bootstrap',
    parameters: { parameters: { team_id: team2 } },
  });
  // A team that the user is not in is never sent.
  const stale = fixture({
    bootstrap: 'bootstrap_available',
    selections: { claude: { ...selection, teamId: '55555555-5555-4555-8555-555555555555' } },
  });
  await stale.service.status();
  assert.equal(stale.calls[3].parameters, undefined);
});

test('concurrent checks share one bootstrap', async () => {
  const f = fixture({ bootstrap: 'bootstrap_available' });
  await Promise.all([f.service.status(), f.service.status(), f.service.status()]);
  assert.equal(f.operations().filter((op) => op === 'setup.bootstrap').length, 1);
});

test('launch inspections and other readiness values never send a setup operation', async () => {
  const launch = fixture({ bootstrap: 'bootstrap_available' });
  await launch.service.inspect();
  assert.deepEqual(launch.operations(), ['status', 'setup.inspect']);
  for (const bootstrap of ['bootstrapped', 'bootstrap_requires_admin', 'unknown'] as const) {
    for (const policy of ['default_available', 'default_creatable']) {
      const f = fixture({ bootstrap, policy });
      await f.service.status();
      assert.equal(f.operations().includes('setup.bootstrap'), false, `${bootstrap} ${policy}`);
      assert.equal(
        f.operations().includes('setup.ensure_default'),
        false,
        `${bootstrap} ${policy}`,
      );
    }
  }
});

test('an older runtime without setup.bootstrap falls back to setup.ensure_default', async () => {
  const older = fixture({
    bootstrap: 'bootstrap_available',
    capabilities: ['setup.inspect', 'setup.ensure_default'],
  });
  const setup = await older.service.status();
  assert.deepEqual(older.operations(), [
    'status',
    'setup.inspect',
    'capabilities',
    'setup.ensure_default',
    'status',
    'setup.inspect',
  ]);
  assert.equal(setup.defaultEnsured, 'created');
  // An older API reports no bootstrap. The policy readiness still selects the fallback.
  const api = fixture({ capabilities: ['setup.inspect', 'setup.ensure_default'] });
  await api.service.status();
  assert.ok(api.operations().includes('setup.ensure_default'));
  // A runtime with setup.bootstrap never uses setup.ensure_default.
  const current = fixture({});
  await current.service.status();
  assert.equal(current.operations().includes('setup.ensure_default'), false);
  assert.equal(current.operations().includes('setup.bootstrap'), false);
  // A runtime with neither operation only inspects.
  const oldest = fixture({ bootstrap: 'bootstrap_available', capabilities: ['setup.inspect'] });
  const result = await oldest.service.status();
  assert.deepEqual(oldest.operations(), ['status', 'setup.inspect', 'capabilities']);
  assert.equal(result.bootstrapReadiness, 'bootstrap_available');
  // It cannot run the setup, so Settings names the oldest runtime that can.
  assert.equal(result.bootstrapIssue, 'runtime_too_old');
  assert.match(runtimeSetupNotice, /needs runtime 0\.6\.6 or later/);
  // A setup that needs nothing more does not show the notice.
  const ready = fixture({ policy: 'default_available', capabilities: ['setup.inspect'] });
  assert.equal((await ready.service.status()).bootstrapIssue, undefined);
});

test('a member gets the administrator recovery; other bootstrap failures keep the inspection', async () => {
  const member = fixture({
    bootstrap: 'bootstrap_available',
    result: 'desktop.setup_bootstrap_required',
  });
  const setup = await member.service.status();
  assert.equal(setup.bootstrapReadiness, 'bootstrap_requires_admin');
  assert.equal(setup.bootstrapIssue, undefined);
  assert.equal(setup.teams.length, 2);
  const team = fixture({ bootstrap: 'bootstrap_available', result: 'desktop.setup_team_required' });
  assert.equal((await team.service.status()).bootstrapIssue, 'team_required');
  const lost = fixture({ bootstrap: 'bootstrap_available', result: 'desktop.transport_lost' });
  const failed = await lost.service.status();
  assert.equal(failed.bootstrapIssue, 'failed');
  assert.deepEqual(failed.policies, [strict]);
  // Refresh tries again, because the service still reports bootstrap_available.
  await lost.service.status();
  assert.equal(lost.operations().filter((op) => op === 'setup.bootstrap').length, 2);
  const invalid = fixture({
    bootstrap: 'bootstrap_available',
    result: { ...bootstrapped, marker: 'other' },
  });
  assert.equal((await invalid.service.status()).bootstrapIssue, 'failed');
  const expired = fixture({ bootstrap: 'bootstrap_available', result: 'desktop.auth_expired' });
  await assert.rejects(expired.service.status(), /auth_expired/);
  const block = managedLaunchBlock(new DesktopProtocolError('desktop.setup_bootstrap_required'));
  assert.equal(block.step, 'agent-setup');
  assert.match(block.message, /Ask an organization administrator to finish Kalkidan setup/);
});

test('inspection reads agents with names, keeps the default first, and drops unusable entries', async () => {
  const f = fixture({ bootstrap: 'bootstrapped', policy: 'default_available' });
  const original = f.service['client'];
  f.service['client'] = async () => {
    const client = await original();
    return {
      request: async (operation: string) => {
        const event = await client.request(operation as any);
        if (operation === 'setup.inspect')
          Object.assign(event.data, {
            bootstrap: record(),
            agents: [
              ...agentEntries,
              { ...agentEntries[0], agent_id: 'agt_not_a_uuid' },
              { ...agentEntries[0], agent_id: kalkidanAgent },
              { ...agentEntries[0], agent_id: id, name: id, configuration_id: 'bad id' },
              { ...agentEntries[0], agent_id: team2, name: team2, configuration_name: id },
            ],
          });
        return event;
      },
    } as any;
  };
  const setup = await f.service.status();
  assert.deepEqual(
    setup.agents!.map((agent) => agent.agent_id),
    [kalkidanAgent, otherAgent, team2],
  );
  assert.equal(usesAgentChoice(setup), true);
  // Names only. An ID-only name is left out, so the label is generic.
  assert.deepEqual(agentLabels(setup.agents!), ['Kalkidan agent', 'Release bot', 'Agent 1']);
  assert.deepEqual(setup.agents!.map(agentConfigurationLabel), [
    'Kalkidan default · 1.1.0',
    'Strict · 2.0.0',
    'Version 2.0.0',
  ]);
  assert.deepEqual(agentLabels([{ ...setup.agents![1], name: undefined }]), ['Agent 1']);
  // More than 50 agents is not a valid setup.
  f.service['client'] = async () => {
    const client = await original();
    return {
      request: async (operation: string) => {
        const event = await client.request(operation as any);
        if (operation === 'setup.inspect')
          event.data.agents = Array.from({ length: 51 }, () => agentEntries[0]);
        return event;
      },
    } as any;
  };
  await assert.rejects(f.service.status(), /setup_invalid/);
});

const base: VerdictanSetup = {
  status: 'selection_required',
  policyReadiness: 'default_available',
  bootstrapReadiness: 'bootstrapped',
  bootstrap: {
    status: 'bootstrapped',
    agent_id: kalkidanAgent,
    configuration_status: 'available',
    agent_status: 'available',
  },
  defaultPolicy: fallback,
  teams: [{ team_id: id }, { team_id: team2 }],
  policies: [{ ...fallback, default: true }, strict],
  providerConnections: [{ provider_connection_id: id, provider: 'openai' }],
  agents: [
    {
      agent_id: kalkidanAgent,
      team_id: id,
      ...fallback,
      default: true,
    },
    { agent_id: otherAgent, team_id: team2, name: 'Release bot', ...strict },
  ],
  selections: {},
};
const chosen: VerdictanSelection = {
  teamId: id,
  agentId: kalkidanAgent,
  configurationId: '',
  configurationVersionId: '',
  providerConnectionId: id,
  model: 'gpt-5',
};

test('an agent choice needs a listed agent, its team, and no policy IDs', () => {
  const service = new VerdictanSetupService(null as any, null as any, origin);
  assert.equal(service.validate(base, 'codex', chosen), chosen);
  const other = { ...chosen, agentId: otherAgent, teamId: team2 };
  assert.equal(service.validate(base, 'codex', other), other);
  for (const bad of [
    { ...chosen, teamId: team2 },
    { ...chosen, configurationId: strict.configuration_id },
    { ...chosen, configurationVersionId: strict.configuration_version_id },
  ])
    assert.throws(() => service.validate(base, 'codex', bad), /setup_selection_required/);
  assert.throws(
    () =>
      service.validate(base, 'codex', {
        ...chosen,
        agentId: '55555555-5555-4555-8555-555555555555',
      }),
    /setup_agent_unavailable/,
  );
  // An older runtime sends no agents. A saved agent then needs a new choice.
  assert.throws(
    () => service.validate({ ...base, agents: undefined }, 'codex', chosen),
    /setup_agent_unavailable/,
  );
  // With the agents, a launch always has an agent. The team and policy choice is gone.
  const picked = {
    ...chosen,
    agentId: undefined,
    configurationId: strict.configuration_id,
    configurationVersionId: strict.configuration_version_id,
  };
  assert.throws(() => service.validate(base, 'codex', picked), /setup_selection_required/);
  // A saved selection has the model access only. The agent belongs to the computer.
  const saved = { ...chosen, agentId: undefined, teamId: '' };
  assert.equal(service.validateSaved(base, 'codex', saved), saved);
  assert.throws(() => service.validateSaved(base, 'codex', chosen), /setup_selection_required/);
  assert.throws(
    () => service.validateSaved(base, 'codex', { ...saved, model: '../bad' }),
    /setup_selection_required/,
  );
});

test('a removed default needs another agent and never falls back to the default', () => {
  const service = new VerdictanSetupService(null as any, null as any, origin);
  const removedAgent: VerdictanSetup = {
    ...base,
    bootstrap: { ...base.bootstrap!, agent_status: 'deleted' },
    agents: [base.agents![1]],
  };
  const removedConfiguration: VerdictanSetup = {
    ...base,
    policyReadiness: 'default_removed',
    defaultPolicy: undefined,
    bootstrap: { ...base.bootstrap!, configuration_status: 'deleted' },
    policies: [strict],
    agents: [base.agents![1]],
  };
  const noDefault = { ...chosen, agentId: undefined };
  for (const setup of [removedAgent, removedConfiguration]) {
    assert.equal(defaultRemoved(setup), true);
    assert.equal(selectionIssue(setup, chosen), 'desktop.setup_default_removed');
    // A saved selection has no agent. The computer has no agent until the user chooses one.
    assert.equal(selectionIssue(setup, noDefault), undefined);
    assert.equal(computerAgentIssue(setup, 'local'), 'desktop.setup_default_removed');
    assert.equal(
      computerAgentIssue({ ...setup, computerAgents: { local: otherAgent } }, 'local'),
      undefined,
    );
    assert.throws(() => service.validate(setup, 'codex', chosen), /setup_default_removed/);
    assert.throws(() => service.validate(setup, 'codex', noDefault), /setup_selection_required/);
    const other = { ...chosen, agentId: otherAgent, teamId: team2 };
    assert.equal(selectionIssue(setup, other), undefined);
    assert.equal(service.validate(setup, 'codex', other), other);
    // The step for the saved choice is not done until the user chooses another agent.
    const steps = managedSteps(
      { phase: 'authenticated', executionReady: false },
      { ...setup, selections: { codex: chosen, claude: other } },
    );
    // Both coding agents use the agent of this computer, which needs a new choice.
    assert.equal(steps.codex, false);
    assert.equal(steps.claude, false);
  }
  assert.equal(defaultRemoved({ ...base, policyReadiness: 'default_removed' }), true);
  assert.equal(defaultRemoved(base), false);
  assert.equal(defaultRemoved(undefined), false);
  // The launch error links to the setup step and starts with the managed-only notice.
  for (const code of [
    'desktop.setup_default_removed',
    'desktop.setup_agent_unavailable',
    'desktop.setup_resource_unavailable',
  ]) {
    const block = managedLaunchBlock(new DesktopProtocolError(code));
    assert.equal(block.step, 'agent-setup', code);
    assert.ok(block.message.startsWith(managedOnlyNotice), code);
    assert.match(block.message, /Choose another agent|Change the agent/, code);
    assert.doesNotMatch(block.message, /desktop\./, code);
  }
  assert.match(
    managedLaunchBlock(new DesktopProtocolError('desktop.setup_default_removed')).message,
    /An administrator removed the default Kalkidan setup/,
  );
});

test('a deleted default reads as removed from the inspection', async () => {
  const f = fixture({ bootstrap: 'bootstrapped', policy: 'default_removed' });
  const original = f.service['client'];
  f.service['client'] = async () => {
    const client = await original();
    return {
      request: async (operation: string) => {
        const event = await client.request(operation as any);
        if (operation === 'setup.inspect')
          Object.assign(event.data, {
            bootstrap: record({ configuration_status: 'deleted', agent_status: 'deleted' }),
            agents: [agentEntries[0]],
          });
        return event;
      },
    } as any;
  };
  const setup = await f.service.status();
  assert.equal(setup.policyReadiness, 'default_removed');
  assert.equal(setup.bootstrap?.configuration_status, 'deleted');
  assert.equal(setup.defaultPolicy, undefined);
  assert.equal(defaultRemoved(setup), true);
  assert.deepEqual(
    setup.agents!.map((agent) => agent.agent_id),
    [otherAgent],
  );
  // Kalkidan never asks Verdictan to make the default again.
  assert.equal(f.operations().includes('setup.bootstrap'), false);
  assert.equal(f.operations().includes('setup.ensure_default'), false);
});

test('provisioning checks the agent source of a chosen agent and of the Kalkidan agent', () => {
  const attached = {
    agent_id: otherAgent,
    ...strict,
    configuration_source: 'agent_deployment',
    agent_source: 'selected_agent',
  };
  const other = { ...chosen, agentId: otherAgent, teamId: team2 };
  assert.equal(provisionedPolicy(attached, other, fallback), true);
  // The agent's deployed policy applies, also after an administrator deploys a new version.
  assert.equal(
    provisionedPolicy(
      { ...attached, configuration_version_id: `cfgv_${'e'.repeat(32)}` },
      other,
      fallback,
    ),
    true,
  );
  for (const change of [
    { agent_id: kalkidanAgent },
    { agent_source: 'host' },
    { agent_source: undefined },
    { configuration_source: 'selected' },
    { configuration_id: 'bad' },
  ])
    assert.equal(provisionedPolicy({ ...attached, ...change }, other, fallback), false);
  // No agent and no policy IDs: the Kalkidan agent with its deployed policy.
  const none = { ...chosen, agentId: undefined };
  const kalkidan = {
    agent_id: kalkidanAgent,
    ...strict,
    configuration_source: 'kalkidan_default',
    agent_source: 'kalkidan_default_agent',
  };
  assert.equal(provisionedPolicy(kalkidan, none, fallback, kalkidanAgent), true);
  assert.equal(provisionedPolicy(kalkidan, none, fallback, otherAgent), false);
  assert.equal(provisionedPolicy(kalkidan, none, undefined, kalkidanAgent), false);
  // A host agent with the default keeps the default configuration.
  assert.equal(
    provisionedPolicy(
      { ...fallback, configuration_source: 'kalkidan_default', agent_source: 'host' },
      none,
      fallback,
    ),
    true,
  );
  assert.equal(
    provisionedPolicy(
      { ...strict, configuration_source: 'kalkidan_default', agent_source: 'host' },
      none,
      fallback,
    ),
    false,
  );
  // A picked policy never comes back attached to an agent.
  const picked = {
    ...none,
    configurationId: strict.configuration_id,
    configurationVersionId: strict.configuration_version_id,
  };
  assert.equal(
    provisionedPolicy(
      { ...strict, configuration_source: 'selected', agent_source: 'host' },
      picked,
      fallback,
    ),
    true,
  );
  assert.equal(
    provisionedPolicy(
      { ...strict, configuration_source: 'selected', agent_source: 'selected_agent' },
      picked,
      fallback,
    ),
    false,
  );
});

test('a saved selection in another shape is the same setup', () => {
  const subscription: VerdictanSelection = {
    ...chosen,
    agentId: undefined,
    teamId: '',
    providerConnectionId: '',
    providerAccessMode: 'codex_subscription',
    model: 'gpt-6-astra',
  };
  // The same values, also with a missing value for an empty one.
  assert.equal(sameSelection(base, subscription, { ...subscription }), true);
  const { providerConnectionId: _, ...missing } = subscription;
  assert.equal(sameSelection(base, missing as VerdictanSelection, subscription), true);
  // No mode is the organization connection.
  assert.equal(sameSelection(base, chosen, { ...chosen, providerAccessMode: 'byok' }), true);
  // With the agent choice, the agent, the team and the policy belong to the computer.
  const older = { ...subscription, agentId: kalkidanAgent, teamId: id };
  assert.equal(sameSelection(base, older, subscription), true);
  // A real change is not the same.
  assert.equal(sameSelection(base, undefined, subscription), false);
  assert.equal(sameSelection(base, subscription, { ...subscription, model: 'gpt-5' }), false);
  assert.equal(
    sameSelection(base, subscription, { ...subscription, providerAccessMode: 'byok' }),
    false,
  );
  // Without the agent choice, the team and the policy count.
  const plain = { ...base, agents: undefined };
  assert.equal(sameSelection(plain, subscription, { ...subscription }), true);
  assert.equal(sameSelection(plain, { ...subscription, teamId: team2 }, subscription), false);
  assert.equal(
    sameSelection(
      plain,
      {
        ...subscription,
        configurationId: strict.configuration_id,
        configurationVersionId: strict.configuration_version_id,
      },
      subscription,
    ),
    false,
  );
});

test('a plain setup read never starts the bootstrap, and it keeps the result of the last check', async () => {
  const member = fixture({ bootstrap: 'bootstrap_available', result: 'desktop.permission_denied' });
  // Settings opens: no bootstrap.
  assert.equal((await member.service.current()).bootstrapReadiness, 'bootstrap_available');
  assert.equal(member.operations().includes('setup.bootstrap'), false);
  // The run after sign-in found that an administrator must connect Kalkidan.
  await member.service.status();
  const before = member.operations().length;
  const read = await member.service.current();
  assert.equal(read.bootstrapReadiness, 'bootstrap_requires_admin');
  assert.equal(member.operations().slice(before).includes('setup.bootstrap'), false);

  const failed = fixture({ bootstrap: 'bootstrap_available', result: 'desktop.setup_conflict' });
  await failed.service.status();
  const value = await failed.service.current();
  assert.equal(value.bootstrapIssue, 'failed');
  assert.equal(value.setupCode, 'desktop.setup_conflict');
});

test('the setup read shows the gateway of this computer for the same account only', async () => {
  const f = fixture({ bootstrap: 'bootstrapped', policy: 'default_available' });
  const { key } = await f.service.inspect();
  f.service.keepGateway(key, { status: 'created' });
  assert.deepEqual((await f.service.current()).computerGateway, { status: 'created' });
  f.service.keepGateway('another-account', { status: 'failed', code: 'desktop.x' });
  assert.equal((await f.service.current()).computerGateway, undefined);
});
