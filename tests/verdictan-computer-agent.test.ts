import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BindingStore } from '../electron/verdictan/bindings';
import { VerdictanLaunchService } from '../electron/verdictan/launch';
import { VerdictanSetupService } from '../electron/verdictan/setup';
import { RemoteAccountBroker } from '../electron/verdictan/remote-broker';
import { DesktopProtocolError } from '../electron/verdictan/protocol';
import { hostDisplayName } from '../electron/verdictan/host-name';
import {
  computerAgentId,
  computerAgentIssue,
  computerAgentLabel,
  initialSelection,
  managedErrorInfo,
  managedLaunchBlock,
  recommendedSelection,
  withAgent,
  type VerdictanSetup,
} from '../src/domain/verdictan';

const id = '11111111-1111-4111-8111-111111111111';
const team = '22222222-2222-4222-8222-222222222222';
const kalkidanAgent = '33333333-3333-4333-8333-333333333333';
const reviewAgent = '44444444-4444-4444-8444-444444444444';
const goneAgent = '55555555-5555-4555-8555-555555555555';
const origin = 'https://api.eu.verdictan.com';
const version = '0.163.0-alpha.10.2';
const deployed = (agent: string) => ({
  configuration_id: `cfg_${agent[0].repeat(32)}`,
  configuration_version_id: `cfgv_${agent[0].repeat(32)}`,
});
const access = { providerConnectionId: id, model: 'gpt-5' };
const base: VerdictanSetup = {
  status: 'ready',
  defaultPolicy: deployed(kalkidanAgent),
  bootstrap: {
    status: 'bootstrapped',
    agent_id: kalkidanAgent,
    configuration_status: 'available',
    agent_status: 'available',
  },
  teams: [{ team_id: team }],
  policies: [],
  providerConnections: [
    { provider_connection_id: id, provider: 'openai' },
    { provider_connection_id: id, provider: 'anthropic' },
  ],
  agents: [
    { agent_id: kalkidanAgent, team_id: team, ...deployed(kalkidanAgent), default: true },
    { agent_id: reviewAgent, team_id: team, name: 'Review agent', ...deployed(reviewAgent) },
  ],
  selections: {
    codex: { teamId: '', configurationId: '', configurationVersionId: '', ...access },
    claude: { teamId: '', configurationId: '', configurationVersionId: '', ...access },
  },
};

test('a computer uses its own agent, then the earlier shared agent, then the Kalkidan agent', () => {
  assert.equal(computerAgentId(base, 'local'), kalkidanAgent);
  assert.equal(computerAgentLabel(base, 'local'), 'Kalkidan agent');
  const changed = { ...base, computerAgents: { local: reviewAgent } };
  assert.equal(computerAgentId(changed, 'local'), reviewAgent);
  assert.equal(computerAgentLabel(changed, 'local'), 'Review agent');
  // Another computer keeps its own agent.
  assert.equal(computerAgentId(changed, 'host-1'), kalkidanAgent);
  assert.equal(computerAgentId({ ...base, defaultAgentId: reviewAgent }, 'host-1'), reviewAgent);
  assert.equal(computerAgentIssue(changed, 'local'), undefined);
  assert.equal(
    computerAgentIssue({ ...base, computerAgents: { local: goneAgent } }, 'local'),
    'desktop.setup_agent_unavailable',
  );
  // An older runtime sends no agents. Then the team and policy choice applies.
  assert.equal(computerAgentIssue({ ...base, agents: undefined }, 'local'), undefined);
  // The coding agent selection has the model access only.
  const codex = initialSelection(base, 'codex');
  assert.equal(codex.agentId, undefined);
  assert.equal(codex.teamId, '');
  assert.deepEqual(
    recommendedSelection({ ...base, selections: {} }, 'codex', ['gpt-5'])?.providerConnectionId,
    id,
  );
  assert.deepEqual(withAgent(codex, base.agents![1]), {
    ...codex,
    agentId: reviewAgent,
    teamId: team,
    configurationId: '',
    configurationVersionId: '',
  });
});

test('the conflict codes of the older API have clear words', () => {
  for (const code of [
    'desktop.resource_conflict',
    'desktop.scope_mismatch',
    'desktop.agent_unavailable',
  ]) {
    const text = managedErrorInfo(code).message;
    assert.doesNotMatch(text, /could not complete this operation/, code);
    const block = managedLaunchBlock(new DesktopProtocolError(code));
    assert.doesNotMatch(block.message, /desktop\./, code);
  }
  assert.match(managedErrorInfo('desktop.resource_conflict').message, /second agent/);
  assert.match(managedErrorInfo('desktop.scope_mismatch').message, /second project/);
});

test('the first read moves the earlier agents: a shared agent stays, older chats keep theirs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'computer-agent-'));
  const file = join(root, 'verdictan-bindings.json');
  const pick = (agentId: string) => ({
    teamId: team,
    configurationId: '',
    configurationVersionId: '',
    ...access,
    agentId,
  });
  const store = (codex: string, claude: string) =>
    JSON.stringify({
      schema: 1,
      installationId: id,
      hosts: {},
      selections: { account: { codex: pick(codex), claude: pick(claude) } },
      bindings: {},
    });
  try {
    await writeFile(file, store(reviewAgent, reviewAgent), { mode: 0o600 });
    const same = new BindingStore(root);
    assert.deepEqual(await same.agents('account'), {
      computers: {},
      default: reviewAgent,
      legacy: { codex: reviewAgent, claude: reviewAgent },
    });
    // The selections keep the model access only.
    assert.equal((await same.selections('account')).codex?.agentId, undefined);
    assert.equal((await same.selections('account')).codex?.model, 'gpt-5');

    await writeFile(file, store(kalkidanAgent, reviewAgent), { mode: 0o600 });
    const different = new BindingStore(root);
    assert.deepEqual(await different.agents('account'), {
      computers: {},
      legacy: { codex: kalkidanAgent, claude: reviewAgent },
    });
    await different.setComputerAgent('account', 'host-1', reviewAgent);
    assert.deepEqual((await different.agents('account')).computers, { 'host-1': reviewAgent });
    // A later save of a coding agent does not move the agents again.
    await different.select('account', 'codex', { ...pick(''), agentId: undefined });
    assert.deepEqual((await different.agents('account')).legacy, {
      codex: kalkidanAgent,
      claude: reviewAgent,
    });
    await different.forgetHost('host-1');
    assert.deepEqual((await different.agents('account')).computers, {});
    // A new account starts with the Kalkidan agent.
    assert.deepEqual(await different.agents('new'), { computers: {}, legacy: {} });
    assert.doesNotMatch(await readFile(file, 'utf8'), /credential|token/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('the setup saves an agent for a computer only when the user can use it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'computer-agent-'));
  try {
    const store = new BindingStore(root);
    const service = new VerdictanSetupService(null as any, store, origin);
    service.inspect = async () => ({ setup: base, key: 'account' }) as any;
    service.status = async () => base;
    await service.setComputerAgent('local', reviewAgent);
    assert.deepEqual((await store.agents('account')).computers, { local: reviewAgent });
    await assert.rejects(service.setComputerAgent('local', goneAgent), /setup_agent_unavailable/);
    await assert.rejects(service.setComputerAgent('../x', reviewAgent), /invalid_request/);
    // A saved coding agent selection never has an agent.
    await assert.rejects(
      service.select('codex', { ...base.selections.codex!, agentId: reviewAgent }),
      /setup_selection_required/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

async function fixture(choices: Partial<VerdictanSetup> = {}, hostKey = 'local') {
  const root = await mkdtemp(join(tmpdir(), 'computer-agent-launch-'));
  const store = new BindingStore(root);
  const provisions: any[] = [];
  const starts: any[] = [];
  const state = { setup: { ...base, ...choices } as VerdictanSetup, refuse: [] as string[] };
  const client: any = {
    request: async (_: string, params: any) => {
      provisions.push(params.parameters);
      const agent = params.parameters.agent_id;
      if (state.refuse.includes(agent)) throw new DesktopProtocolError('desktop.agent_unavailable');
      return {
        data: {
          ...params.parameters,
          status: 'created',
          agent_id: agent,
          gateway_id: `kalkidan-${agent.slice(0, 8)}`,
          region_id: id,
          agent_source: 'selected_agent',
          configuration_source: 'agent_deployment',
          ...deployed(agent),
        },
      };
    },
  };
  const real = new VerdictanSetupService(null as any, store, origin);
  const setup: any = {
    inspect: async () => ({
      client,
      account: { organizationId: id, userId: id },
      setup: state.setup,
    }),
    validate: real.validate.bind(real),
    validateSaved: real.validateSaved.bind(real),
  };
  let sessionId = '';
  const runtime: any = {
    start: async (params: any) => {
      starts.push(params);
      sessionId = params.session_id;
    },
    endpoint: () => 'http://127.0.0.1:1234',
    route: async () => ({ args: [], env: {} }),
    release: async () => {},
    status: () => [{ sessionId, runtimeId: id }],
  };
  const service = new VerdictanLaunchService(
    store,
    setup,
    runtime,
    hostKey,
    undefined,
    {
      assertPlatform: () => {},
      prepare: async () => ({
        executable: '/sandbox',
        prefix: [],
        env: {},
        version,
        close: async () => {},
      }),
    },
    undefined,
    Date.now,
    async () => version,
  );
  const request = (sessionId: string, create = true): any => ({
    session: {
      id: sessionId,
      cwd: root,
      agent: 'codex',
      governanceScope: { projectId: 'project-1' },
    },
    runId: 'turn',
    create,
    internal: false,
    executable: { path: '/agent', env: {} },
    signal: new AbortController().signal,
    stop: async () => {},
  });
  const run = async (sessionId: string, create = true) => {
    const launch = await service.prepare(request(sessionId, create));
    await launch.bindNativeSession(sessionId);
    await launch.finish();
  };
  return {
    root,
    service,
    store,
    state,
    provisions,
    starts,
    run,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test('a chat keeps its agent after the computer changes its agent', async () => {
  const f = await fixture();
  try {
    await f.run('first');
    const first = await f.store.read('codex', 'first');
    assert.equal(first?.agent_id, kalkidanAgent);
    assert.equal(first?.gateway_id, `kalkidan-${kalkidanAgent.slice(0, 8)}`);
    // A gateway serves every project, so the provision has no project.
    assert.equal('project_id' in f.provisions[0], false);
    assert.equal(f.starts[0].project_id, 'project-1');

    f.state.setup = { ...f.state.setup, computerAgents: { local: reviewAgent } };
    await f.run('second');
    assert.equal((await f.store.read('codex', 'second'))?.agent_id, reviewAgent);
    assert.equal(f.provisions[1].agent_id, reviewAgent);
    // The first chat resumes on its own agent and its own gateway.
    await f.run('first', false);
    assert.equal(f.provisions[2].agent_id, kalkidanAgent);
    assert.equal(f.starts[2].gateway_id, first?.gateway_id);
    // Two agents run side by side on one computer.
    assert.notEqual(f.starts[1].gateway_id, f.starts[2].gateway_id);

    // A chat whose agent is gone cannot resume. A new chat still starts.
    f.state.setup = { ...f.state.setup, agents: [base.agents![1]] };
    await assert.rejects(f.run('first', false), /agent_unavailable/);
    await f.run('third');
  } finally {
    await f.cleanup();
  }
});

test('a chat from an older version keeps the agent of its coding agent', async () => {
  // The chat started when Codex used the Review agent. Now the computer has the Kalkidan agent.
  const f = await fixture({ computerAgents: { local: reviewAgent } });
  try {
    await f.run('old');
    f.state.setup = { ...f.state.setup, computerAgents: {}, legacyAgents: { codex: reviewAgent } };
    // The binding of an older version has no agent.
    const {
      agent_id: _agent,
      gateway_id: _gateway,
      ...old
    } = (await f.store.read('codex', 'old'))!;
    const file = join(f.root, 'verdictan-bindings.json');
    const saved = JSON.parse(await readFile(file, 'utf8'));
    for (const key of Object.keys(saved.bindings)) saved.bindings[key] = old;
    await writeFile(file, JSON.stringify(saved));
    f.provisions.length = 0;
    await f.run('old', false);
    assert.equal(f.provisions[0].agent_id, reviewAgent);
    assert.equal((await f.store.read('codex', 'old'))?.agent_id, reviewAgent);
  } finally {
    await f.cleanup();
  }
});

test('an SSH host uses its own agent from the desktop', async () => {
  const f = await fixture({ computerAgents: { 'host-1': reviewAgent } }, 'host-1');
  try {
    await f.run('remote');
    assert.equal(f.provisions[0].agent_id, reviewAgent);
  } finally {
    await f.cleanup();
  }
  // A computer whose agent is not available stops new chats with a clear code.
  const gone = await fixture({ computerAgents: { local: goneAgent } });
  try {
    await assert.rejects(gone.run('new'), /setup_agent_unavailable/);
  } finally {
    await gone.cleanup();
  }
});

test('the SSH broker sends the agent of the host and accepts the agent of any chat', async () => {
  const calls: { operation: string; parameters: any }[] = [];
  const setup = {
    ...base,
    computerAgents: { 'host-1': reviewAgent, other: kalkidanAgent },
    legacyAgents: { codex: kalkidanAgent },
  };
  const client = {
    request: async (operation: string, parameters: any) => {
      calls.push({ operation, parameters });
      return {
        data: { agent_id: parameters.parameters.agent_id, gateway_id: 'gateway', runtime_id: id },
      };
    },
  };
  const real = new VerdictanSetupService(null as any, null as any, origin);
  const broker = new RemoteAccountBroker(
    {
      inspect: async () => ({ client, key: 'account', account: {}, setup }),
      validate: real.validate.bind(real),
      validateSaved: real.validateSaved.bind(real),
    } as any,
    { identities: async () => ({ installationId: id, hostId: id }) } as any,
  );
  assert.deepEqual(await broker.request('host-1', 'setup.selection'), {
    selections: base.selections,
    computerAgents: { 'host-1': reviewAgent },
    legacyAgents: { codex: kalkidanAgent },
  });
  const provision = (agent: string) =>
    broker.request('host-1', 'resources.provision', {
      parameters: {
        installation_id: id,
        host_id: id,
        team_id: team,
        agent_id: agent,
        project_id: 'project-1',
      } as any,
    });
  // The current agent of the host, and the older agent of a chat on the host.
  await provision(reviewAgent);
  await provision(kalkidanAgent);
  assert.equal('project_id' in calls[0].parameters.parameters, false);
  await assert.rejects(provision(goneAgent), /broker_scope_mismatch/);
  // A runtime of any project can use the gateway of the agent.
  await broker.request('host-1', 'runtime.provision', {
    parameters: {
      installation_id: id,
      host_id: id,
      session_id: team,
      agent_id: kalkidanAgent,
      gateway_id: 'gateway',
      project_id: 'project-2',
      provider: 'openai',
      provider_connection_id: id,
      model: 'gpt-5',
    },
  });
  assert.equal(calls.at(-1)?.operation, 'runtime.provision');
});

test('Verdictan refuses the agent: a new chat changes the computer agent, a chat forks', async () => {
  const f = await fixture();
  try {
    await f.run('first');
    f.state.refuse = [kalkidanAgent];
    await assert.rejects(f.run('second'), /setup_agent_unavailable/);
    await assert.rejects(f.run('first', false), /\[desktop\.agent_unavailable\]/);
  } finally {
    await f.cleanup();
  }
});

test('the computer name goes to Verdictan only when the runtime accepts it', async () => {
  assert.equal(hostDisplayName('  MacBook\u0000 Pro\n '), 'MacBook Pro');
  assert.equal(hostDisplayName('\u0007'), undefined);
  assert.equal(hostDisplayName(42), undefined);
  assert.equal(hostDisplayName('x'.repeat(200))?.length, 120);
  const f = await fixture();
  try {
    await f.run('unnamed');
    assert.equal('host_name' in f.provisions[0], false);
    f.service.hostName = () => 'MacBook Pro';
    await f.run('named');
    assert.equal(f.provisions[1].host_name, 'MacBook Pro');
  } finally {
    await f.cleanup();
  }
  // The desktop adds the name of an SSH host. The host cannot choose it.
  const calls: any[] = [];
  const broker = new RemoteAccountBroker(
    {
      inspect: async () => ({
        client: {
          request: async (_: string, parameters: any) => {
            calls.push(parameters.parameters);
            return { data: { agent_id: reviewAgent, gateway_id: 'gateway' } };
          },
        },
        key: 'account',
        account: {},
        setup: base,
      }),
    } as any,
    { identities: async () => ({ installationId: id, hostId: id }) } as any,
    (host) => (host === 'host-1' ? 'devbox' : undefined),
  );
  await broker.request('host-1', 'resources.provision', {
    parameters: {
      installation_id: id,
      host_id: id,
      team_id: team,
      agent_id: reviewAgent,
      host_name: 'chosen by the host',
    } as any,
  });
  assert.equal(calls[0].host_name, 'devbox');
});
