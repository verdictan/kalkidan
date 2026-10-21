import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VerdictanSetupService } from '../electron/verdictan/setup';
import { VerdictanLaunchService, SubscriptionRecoveryError } from '../electron/verdictan/launch';
import {
  BindingStore,
  assertCompatible,
  type ConversationBinding,
} from '../electron/verdictan/bindings';
import { ManagedGateway } from '../electron/verdictan/gateway';
import { ManagedRuntimes } from '../electron/verdictan/runtime';
import { RemoteAccountBroker } from '../electron/verdictan/remote-broker';
import { allowedInference } from '../electron/verdictan/inference-guard';
import { DesktopProtocolError, terminalEventsFor } from '../electron/verdictan/protocol';
import {
  parseRuntimeCredentials,
  type RuntimeCredentials,
} from '../electron/verdictan/credentials';
import { readNativeClaudeAccess } from '../electron/verdictan/claude-subscription-auth';
import { RuntimeEvidence } from '../electron/verdictan/evidence';
import {
  claudeSubscriptionRecovery,
  historyCostLabel,
  type VerdictanSelection,
} from '../src/domain/verdictan';

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const claude = { kind: 'claude_code' as const, version: '2.1.304' };
// Copies of the published Verdictan contract fixtures.
const contracts = join(import.meta.dirname, 'fixtures', 'verdictan');
const subscription: VerdictanSelection = {
  teamId: id,
  configurationId: id,
  configurationVersionId: id,
  providerConnectionId: '',
  providerAccessMode: 'claude_subscription',
  model: 'claude-sonnet-4-6',
};
const capabilities = (values: string[], agents = [claude]) => ({
  data: {
    cli_version: '0.6.1',
    protocol_min: 1,
    protocol_max: 1,
    capabilities: values,
    managed_execution_ready: true,
    tested_agents: agents,
  },
});

async function inspect(modes: unknown, runtimeCapabilities: string[]) {
  const calls: string[] = [];
  const client: any = {
    request: async (operation: string) => {
      calls.push(operation);
      if (operation === 'status')
        return {
          data: {
            state: 'authenticated',
            api_url: 'https://api.verdictan.com',
            user_id: id,
            organization_id: id,
            expires_at: '2030-01-01T00:00:00Z',
          },
        };
      if (operation === 'capabilities') return capabilities(runtimeCapabilities);
      return {
        data: {
          schema_version: 1,
          org_id: id,
          user_id: id,
          dispatch_allowed: false,
          status: 'ready',
          teams: [],
          policies: [],
          provider_connections: [],
          ...(modes === undefined ? {} : { provider_access_modes: modes }),
        },
      };
    },
  };
  const service = new VerdictanSetupService(
    async () => client,
    null as any,
    'https://api.verdictan.com',
    async () => ({}),
  );
  return { setup: await service.status(), calls };
}

test('Claude subscription needs both the API mode and the runtime capability', async () => {
  const both = await inspect(
    ['byok', 'codex_subscription', 'claude_subscription'],
    ['provider_access.codex_subscription', 'provider_access.claude_subscription'],
  );
  assert.deepEqual(both.setup.providerAccessModes, [
    'byok',
    'codex_subscription',
    'claude_subscription',
  ]);
  // Old runtime: the API offers the mode, but the CLI does not advertise it.
  const oldRuntime = await inspect(
    ['byok', 'claude_subscription'],
    ['provider_access.codex_subscription'],
  );
  assert.deepEqual(oldRuntime.setup.providerAccessModes, ['byok']);
  // Old API: the runtime capability alone is not enough, and it is not even requested.
  const oldApi = await inspect(['byok'], ['provider_access.claude_subscription']);
  assert.deepEqual(oldApi.setup.providerAccessModes, ['byok']);
  assert.equal(oldApi.calls.includes('capabilities'), false);
  const absent = await inspect(undefined, ['provider_access.claude_subscription']);
  assert.deepEqual(absent.setup.providerAccessModes, ['byok']);
  const unknown = await inspect(['claude_max'], ['provider_access.claude_max']);
  assert.deepEqual(unknown.setup.providerAccessModes, ['byok']);
});

test('Claude subscription selection needs no provider connection and never falls back', () => {
  const service = new VerdictanSetupService(null as any, null as any, 'https://api.verdictan.com');
  const setup: any = {
    teams: [{ team_id: id }],
    policies: [{ configuration_id: id, configuration_version_id: id }],
    // No Anthropic provider configuration is needed for subscription access.
    providerConnections: [],
    providerAccessModes: ['byok', 'claude_subscription'],
  };
  assert.equal(service.validate(setup, 'claude', subscription), subscription);
  for (const [agent, value] of [
    ['codex', subscription],
    ['claude', { ...subscription, providerConnectionId: id }],
    ['claude', { ...subscription, providerAccessMode: 'codex_subscription' }],
    ['claude', { ...subscription, providerAccessMode: 'claude_max' }],
  ] as const)
    assert.throws(() => service.validate(setup, agent, value as any), /setup_selection_required/);
  setup.providerAccessModes = ['byok', 'codex_subscription'];
  assert.throws(() => service.validate(setup, 'claude', subscription), /setup_selection_required/);
});

function binding(cwd: string, patch: Partial<ConversationBinding> = {}): ConversationBinding {
  return {
    schema_version: 1,
    organization_id: id,
    user_id: id,
    region_id: id,
    provider_connection_id: '',
    provider_access_mode: 'claude_subscription',
    installation_id: id,
    host_id: id,
    conversation_id: id,
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    agent_kind: 'claude_code',
    agent_version: claude.version,
    context_format_version: 1,
    configuration_id: id,
    configuration_version_id: id,
    cwd,
    ...patch,
  };
}

test('the conversation binding keeps the Claude subscription mode and provider immutable', async () => {
  const root = await mkdtemp(join(tmpdir(), 'claude-binding-'));
  try {
    const store = new BindingStore(root);
    const b = binding(root);
    await store.save('claude_code', 'native', b);
    assert.deepEqual(await store.read('claude_code', 'native'), b);
    const { provider_access_mode: _mode, ...byokFields } = b;
    for (const change of [
      { ...byokFields, provider_connection_id: id },
      { ...b, provider: 'openai' },
      { ...b, provider_access_mode: 'codex_subscription' as const },
    ])
      await assert.rejects(
        store.save('claude_code', 'native', change as ConversationBinding),
        /resume_(incompatible|binding_invalid)/,
      );
    assert.throws(
      () => assertCompatible({ ...byokFields, provider_connection_id: id }, b),
      /resume_incompatible/,
    );
    for (const invalid of [
      { provider_connection_id: id },
      { provider: 'openai' },
      { agent_kind: 'codex' as const },
    ])
      await assert.rejects(store.save('claude_code', 'x', binding(root, invalid)), /invalid/);
    assert.match(await store.home(b), /claude-subscription$/);
    assert.match(await store.home({ ...byokFields, provider_connection_id: id }), /claude$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('provisioning uses runtime.provisioned only for Claude subscription', () => {
  const params = (mode?: string) => ({ parameters: { provider_access_mode: mode } as any });
  assert.deepEqual(terminalEventsFor('runtime.provision', params('claude_subscription')), [
    'runtime.provisioned',
  ]);
  for (const mode of [undefined, 'byok', 'codex_subscription'])
    assert.deepEqual(terminalEventsFor('runtime.provision', params(mode)), [
      'runtime.provisioning_result',
    ]);
});

async function runtimeStart(mode: string | undefined, event: any) {
  const calls: string[] = [];
  const owner = new ManagedRuntimes({
    apiOrigin: 'https://api.verdictan.com',
    client: async () =>
      ({
        async request(operation: string) {
          calls.push(operation);
          if (operation === 'capabilities') return capabilities([]);
          return event;
        },
        async exportRuntime() {
          calls.push('export');
          return {
            runtime_id: id,
            session_id: id,
            agent_id: id,
            gateway_id: 'gateway',
            api_url: 'https://api.verdictan.com',
            generation: 1,
            ...(mode ? { provider_access_mode: mode } : {}),
          };
        },
      }) as any,
    executable: async () => '/fixture/verdictan',
    gateway: () => ({ readiness: async () => {}, stop: async () => {} }) as any,
  });
  await owner.start(
    {
      installation_id: id,
      host_id: id,
      session_id: id,
      agent_id: id,
      gateway_id: 'gateway',
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      ...(mode ? { provider_access_mode: mode as any } : { provider_connection_id: id }),
    },
    claude,
    async () => {},
  );
  return { owner, calls };
}

test('runtime start accepts the published provisioned fixture and rejects mixed results', async () => {
  const provisioned = JSON.parse(
    await readFile(join(contracts, 'claude-subscription.provisioned.json'), 'utf8'),
  );
  provisioned.data.runtime_id = id;
  const ok = await runtimeStart('claude_subscription', provisioned);
  assert.deepEqual(ok.owner.status(), [{ sessionId: id, runtimeId: id, phase: 'ready' }]);
  for (const [mode, patch] of [
    ['claude_subscription', { event: 'runtime.provisioning_result' }],
    ['claude_subscription', { data: { ...provisioned.data, provider_connection_id: id } }],
    ['claude_subscription', { data: { ...provisioned.data, provider_access_mode: 'byok' } }],
    [undefined, {}],
  ] as const) {
    await assert.rejects(
      runtimeStart(mode, { ...provisioned, ...patch }),
      /runtime_binding_mismatch/,
    );
  }
});

test('the SSH broker forwards the Claude subscription mode and rejects a connection', async () => {
  const calls: any[] = [];
  const client = {
    request: async (operation: string, parameters: any) => {
      calls.push({ operation, parameters });
      return { data: { agent_id: id, gateway_id: 'gateway', runtime_id: id } };
    },
  };
  const broker = new RemoteAccountBroker(
    {
      inspect: async () => ({
        client,
        key: 'account',
        account: { state: 'authenticated' },
        setup: { selections: { claude: subscription } },
      }),
      validate: () => {},
    } as any,
    { identities: async () => ({ installationId: id, hostId: id }) } as any,
  );
  await broker.request('host', 'resources.provision', {
    parameters: {
      installation_id: id,
      host_id: id,
      team_id: id,
      configuration_id: id,
      configuration_version_id: id,
    },
  });
  const runtime = {
    installation_id: id,
    host_id: id,
    session_id: other,
    agent_id: id,
    gateway_id: 'gateway',
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    provider_access_mode: 'claude_subscription' as const,
  };
  await assert.rejects(
    broker.request('host', 'runtime.provision', {
      parameters: { ...runtime, provider_connection_id: id },
    }),
    /scope_mismatch/,
  );
  await assert.rejects(
    broker.request('host', 'runtime.provision', {
      parameters: { ...runtime, provider_connection_id: '' } as any,
    }),
    /scope_mismatch/,
  );
  await broker.request('host', 'runtime.provision', { parameters: runtime });
  const sent = calls.at(-1).parameters.parameters;
  assert.equal(sent.provider_access_mode, 'claude_subscription');
  assert.equal(sent.provider, 'anthropic');
  assert.equal(Object.hasOwn(sent, 'provider_connection_id'), false);
});

const credentials: RuntimeCredentials = {
  schema_version: 1,
  correlation_id: 'export',
  runtime_id: id,
  runtime_registration_id: id,
  session_id: id,
  agent_id: id,
  gateway_id: 'gateway',
  api_url: 'https://api.verdictan.com',
  expires_at: '2026-10-20T00:10:00Z',
  generation: 3,
  runtime_credential: 'vdt_' + 'a'.repeat(20),
  inference_credential: 'vdt_' + 'b'.repeat(20),
};
function gateway(mode: RuntimeCredentials['provider_access_mode'], readiness: any = {}) {
  const child: any = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdio = [child.stdin, child.stdout, child.stderr, new PassThrough()];
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => {
    if (child.exitCode === null) {
      child.exitCode = 0;
      child.emit('close', 0);
    }
  };
  child.stdin.on('finish', child.kill);
  const owned = new ManagedGateway({
    executable: '/fixture/verdictan',
    credentials: { ...credentials, ...(mode ? { provider_access_mode: mode } : {}) },
    now: () => Date.parse('2026-10-20T00:00:00Z'),
    launch: (() => child) as any,
    request: (async () =>
      Response.json({
        schema_version: 1,
        ready: true,
        dispatch_authorized: false,
        runtime_id: id,
        session_id: id,
        credential: 'ready',
        dependencies: 'ready',
        protocol_acceptance: 'verified',
        control_plane: {
          runtime_id: id,
          session_id: id,
          generation: 3,
          ready: true,
          billing: {
            payer: 'user_claude_subscription',
            provider_access_mode: 'claude_subscription',
            provider_connection_id: null,
            currency: null,
          },
        },
        ...readiness,
      })) as any,
  });
  let sequence = 0;
  const emit = (event: string, data: object) =>
    child.stdout.write(
      JSON.stringify({
        schema_version: 1,
        correlation_id: 'gateway',
        generation_id: id,
        runtime_generation: 3,
        sequence: ++sequence,
        event,
        data,
      }) + '\n',
    );
  emit('gateway.starting', { runtime_id: id, gateway_id: 'gateway' });
  emit('gateway.listening', {
    runtime_id: id,
    session_id: id,
    gateway_id: 'gateway',
    effective_address: 'http://127.0.0.1:43123',
    ready: false,
    reason_code: 'desktop.readiness_required',
  });
  return owned;
}
const correlation = {
  hostId: id,
  projectId: 'project',
  taskId: 'task',
  conversationId: 'conversation',
  turnId: id,
};

test('Claude subscription route uses native login plus a separate gateway key header', async () => {
  const owned = gateway('claude_subscription');
  try {
    const route = await owned.nativeRoute(claude, correlation);
    assert.equal(route.env.ANTHROPIC_BASE_URL, 'http://127.0.0.1:43123');
    for (const name of ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN', 'CLAUDE_CODE_OAUTH_TOKEN'])
      assert.equal(Object.hasOwn(route.env, name), false);
    assert.deepEqual(
      {
        DISABLE_AUTOUPDATER: route.env.DISABLE_AUTOUPDATER,
        CLAUDE_CODE_MAX_RETRIES: route.env.CLAUDE_CODE_MAX_RETRIES,
        CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK:
          route.env.CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK,
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC:
          route.env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC,
      },
      {
        DISABLE_AUTOUPDATER: '1',
        CLAUDE_CODE_MAX_RETRIES: '0',
        CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK: '1',
        CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
      },
    );
    const headers = route.env.ANTHROPIC_CUSTOM_HEADERS!.split('\n');
    assert.equal(headers[0], `X-Gateway-Key: ${credentials.inference_credential}`);
    for (const name of ['host-id', 'project-id', 'task-id', 'turn-id', 'agent-version'])
      assert.ok(headers.some((h) => h.startsWith(`x-verdictan-desktop-${name}: `)));
    assert.deepEqual(route.args, ['--setting-sources', '', '--strict-mcp-config']);
    assert.equal(route.args.includes('--bare'), false);
    assert.equal(JSON.stringify(route.args).includes('vdt_'), false);
    await assert.rejects(
      owned.nativeRoute({ ...claude, version: '2.1.305' }, correlation),
      /agent_version_unsupported/,
    );
    await assert.rejects(
      owned.nativeRoute({ kind: 'codex', version: '0.163.0-alpha.10.2' }, correlation),
      /subscription_agent_required/,
    );
  } finally {
    await owned.stop();
  }
});

test('a Codex subscription runtime cannot build a Claude API-key route', async () => {
  const owned = gateway('codex_subscription');
  try {
    await assert.rejects(owned.nativeRoute(claude, correlation), /subscription_agent_required/);
  } finally {
    await owned.stop();
  }
});

test('Claude subscription readiness rejects organization billing and relays safe errors', async () => {
  for (const [patch, expected] of [
    [
      {
        control_plane: {
          runtime_id: id,
          session_id: id,
          generation: 3,
          ready: true,
          billing: { payer: 'organization_provider_connection', currency: 'USD' },
        },
      },
      /desktop\.readiness_failed/,
    ],
    [
      { ready: false, error: { code: 'desktop.claude_subscription_login_required' } },
      /desktop\.claude_subscription_login_required/,
    ],
    [{ ready: false, error: { code: 'desktop.unknown_code' } }, /desktop\.readiness_failed/],
  ] as const) {
    const owned = gateway('claude_subscription', patch);
    await assert.rejects(owned.readiness(claude), expected);
    await owned.stop();
  }
  // BYOK keeps the generic readiness failure.
  const byok = gateway(undefined, {
    ready: false,
    error: { code: 'desktop.claude_subscription_login_required' },
  });
  await assert.rejects(byok.readiness(claude), /desktop\.readiness_failed/);
  await byok.stop();
});

test('protected export frames accept the Claude subscription mode only as a known value', () => {
  const now = Date.parse('2026-10-20T00:00:00Z');
  assert.equal(
    parseRuntimeCredentials({ ...credentials, provider_access_mode: 'claude_subscription' }, now)
      .provider_access_mode,
    'claude_subscription',
  );
  assert.throws(
    () =>
      parseRuntimeCredentials({ ...credentials, provider_access_mode: 'claude_max' } as any, now),
    /invalid_runtime_credential/,
  );
});

test('the inference guard allows only Messages for Claude subscription', () => {
  assert.equal(allowedInference('claude_subscription', 'POST', '/v1/messages'), true);
  assert.equal(allowedInference('claude_subscription', 'POST', '/v1/messages?beta=true'), true);
  for (const [method, url] of [
    ['POST', '/v1/messages/count_tokens'],
    ['POST', '/v1/messages?beta=false'],
    ['POST', '/v1/messages?beta=true&x=1'],
    ['GET', '/v1/models'],
    ['GET', '/v1/messages'],
    ['POST', '/v1/responses'],
    ['POST', '/backend-api/codex/responses'],
  ])
    assert.equal(allowedInference('claude_subscription', method, url), false, url);
  // Existing modes keep their routes.
  assert.equal(allowedInference('byok', 'POST', '/v1/responses'), true);
  assert.equal(allowedInference('codex_subscription', 'GET', '/backend-api/codex/models'), true);
  assert.equal(allowedInference('codex_subscription', 'POST', '/v1/messages'), false);
});

const token = 'sk-ant-oat01-' + 'c'.repeat(40);
function store(patch: object = {}, expires = Date.now() + 3600000) {
  return Buffer.from(
    JSON.stringify({
      claudeAiOauth: {
        accessToken: token,
        refreshToken: 'refresh-must-not-leave',
        expiresAt: expires,
        scopes: ['user:inference', 'user:profile'],
        ...patch,
      },
    }),
  );
}

test('host-local Claude login gives only a short-lived access token and fails closed', async () => {
  const mac = {
    platform: 'darwin',
    arch: 'arm64',
    environment: {},
    account: 'user',
    home: '/Users/user',
  };
  let buffer = store();
  const access = await readNativeClaudeAccess({ ...mac, readMacSecret: async () => buffer });
  assert.equal(access.token, token);
  assert.deepEqual(Object.keys(access).sort(), ['expiresAt', 'token']);
  assert.ok(
    buffer.every((byte) => byte === 0),
    'the raw store bytes are cleared',
  );
  for (const [options, code] of [
    [{ ...mac, arch: 'x64' }, 'claude_subscription_unsupported'],
    [{ ...mac, platform: 'win32' }, 'claude_subscription_unsupported'],
    [{ ...mac, platform: 'linux', arch: 'arm64' }, 'claude_subscription_unsupported'],
    [
      { ...mac, environment: { CLAUDE_CONFIG_DIR: '/x' } },
      'claude_subscription_native_profile_unsupported',
    ],
    [
      { ...mac, environment: { CLAUDE_SECURESTORAGE_CONFIG_DIR: '/x' } },
      'claude_subscription_native_profile_unsupported',
    ],
    [
      { ...mac, readMacSecret: async () => store({}, Date.now() + 1000) },
      'claude_subscription_login_required',
    ],
    [
      { ...mac, readMacSecret: async () => store({ scopes: ['user:inference'] }) },
      'claude_subscription_login_required',
    ],
    [
      { ...mac, readMacSecret: async () => store({ accessToken: 'bad token' }) },
      'claude_subscription_login_required',
    ],
    [
      { ...mac, readMacSecret: async () => Promise.reject(Error('locked')) },
      'claude_subscription_login_required',
    ],
  ] as const)
    await assert.rejects(readNativeClaudeAccess(options as any), new RegExp(`desktop\\.${code}`));
});

test('Linux host-local login requires a private, owner-only native credential file', async () => {
  const home = await mkdtemp(join(tmpdir(), 'claude-home-'));
  try {
    const linux = { platform: 'linux', arch: 'x64', environment: {}, account: 'user', home };
    await mkdir(join(home, '.claude'), { mode: 0o700 });
    const file = join(home, '.claude', '.credentials.json');
    await writeFile(file, store(), { mode: 0o600 });
    assert.equal((await readNativeClaudeAccess(linux)).token, token);
    await chmod(file, 0o644);
    await assert.rejects(readNativeClaudeAccess(linux), /login_required/);
    await chmod(file, 0o600);
    await chmod(join(home, '.claude'), 0o777);
    await assert.rejects(readNativeClaudeAccess(linux), /login_required/);
  } finally {
    await rm(home, { recursive: true, force: true });
  }
});

async function launchFixture(options: { previous?: 'byok'; access?: () => Promise<any> } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'claude-launch-'));
  const calls: { operation: string; parameters?: any }[] = [];
  const store = new BindingStore(root);
  const client: any = {
    request: async (operation: string, params: any) => {
      calls.push({ operation, parameters: params });
      if (operation === 'capabilities')
        return capabilities(['provider_access.claude_subscription']);
      return {
        data: {
          ...params.parameters,
          status: 'created',
          agent_id: id,
          gateway_id: 'gateway',
          region_id: id,
        },
      };
    },
  };
  let stopped = 0;
  let sessionId = '';
  const runtime: any = {
    start: async (params: any) => {
      calls.push({ operation: 'start', parameters: params });
      sessionId = params.session_id;
    },
    endpoint: () => 'http://127.0.0.1:1234',
    route: async () => ({
      args: ['--setting-sources', '', '--strict-mcp-config'],
      env: {
        ANTHROPIC_BASE_URL: 'http://127.0.0.1:1234',
        ANTHROPIC_CUSTOM_HEADERS: `X-Gateway-Key: vdt_${'k'.repeat(20)}\nx-verdictan-desktop-turn-id: turn`,
        // A stray value must never reach the subscription child.
        ANTHROPIC_API_KEY: 'vdt_stray',
      },
    }),
    release: async () => {},
    status: () => [{ sessionId, runtimeId: id }],
  };
  const now = Date.parse('2026-10-20T00:00:00Z');
  const service = new VerdictanLaunchService(
    store,
    {
      inspect: async () => ({
        client,
        account: { organizationId: id, userId: id },
        setup: { selections: { claude: subscription } },
      }),
      validate: (_: unknown, _agent: unknown, s: unknown) => s,
    } as any,
    runtime,
    'local',
    undefined,
    {
      assertPlatform: () => {},
      prepare: async () => ({
        executable: '/sandbox',
        prefix: ['/claude'],
        env: { HOME: '/private', CLAUDE_CONFIG_DIR: '/private' },
        version: claude.version,
        close: async () => {},
      }),
    },
    options.access || (async () => ({ token, expiresAt: now + 30000 + 80 })),
    () => now,
  );
  if (options.previous)
    await store.save('claude_code', 'old', {
      ...binding(root),
      provider_access_mode: undefined,
      provider_connection_id: id,
    });
  const request: any = {
    session: { id: 'new', cwd: root, agent: 'claude' },
    runId: 'turn',
    create: true,
    internal: false,
    executable: { path: '/claude' },
    signal: new AbortController().signal,
    stop: async () => {
      stopped++;
    },
  };
  return {
    service,
    request,
    calls,
    store,
    stopped: () => stopped,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

test('managed Claude launch provisions subscription access and hands off the token in env only', async () => {
  const f = await launchFixture();
  try {
    const launch = await f.service.prepare(f.request);
    const start = f.calls.find((c) => c.operation === 'start')!.parameters;
    assert.equal(start.provider, 'anthropic');
    assert.equal(start.provider_access_mode, 'claude_subscription');
    assert.equal(Object.hasOwn(start, 'provider_connection_id'), false);
    assert.equal(launch.env.CLAUDE_CODE_OAUTH_TOKEN, token);
    assert.equal(launch.env.ANTHROPIC_API_KEY, undefined);
    assert.equal(launch.env.ANTHROPIC_AUTH_TOKEN, undefined);
    assert.match(launch.env.ANTHROPIC_CUSTOM_HEADERS!, /^X-Gateway-Key: vdt_/);
    assert.deepEqual(launch.args, [
      '--setting-sources',
      '',
      '--strict-mcp-config',
      '--mcp-config',
      '{"mcpServers":{}}',
    ]);
    const argv = JSON.stringify([...launch.prefix, ...launch.args]);
    assert.equal(argv.includes(token), false);
    assert.equal(argv.includes('vdt_'), false);
    assert.equal(argv.includes('--bare'), false);
    assert.equal(
      launch.redact(`a ${token} b vdt_${'k'.repeat(20)}`),
      'a [private credential] b [private credential]',
    );
    const saved = await f.store.read('claude_code', 'new');
    assert.equal(saved?.provider_access_mode, 'claude_subscription');
    assert.equal(JSON.stringify(saved).includes(token), false);
    launch.launched?.();
    assert.equal(launch.env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
    // The owned child stops before the native token expires. No prompt is sent again.
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(f.stopped(), 1);
    await launch.finish();
  } finally {
    await f.cleanup();
  }
});

test('Claude launch errors map to recovery actions and resume cannot change the mode', async () => {
  const missing = await launchFixture({
    access: async () => {
      throw new DesktopProtocolError('desktop.claude_subscription_login_required');
    },
  });
  try {
    await assert.rejects(missing.service.prepare(missing.request), (error: any) => {
      assert.ok(error instanceof SubscriptionRecoveryError);
      assert.equal(error.code, 'desktop.claude_subscription_login_required');
      assert.equal(error.recoveryAction, 'sign_in_native_claude_on_execution_host');
      assert.match(error.message, /Sign in to Claude Code on the machine where work runs/);
      return true;
    });
  } finally {
    await missing.cleanup();
  }
  const expiring = await launchFixture({ access: async () => ({ token, expiresAt: 0 }) });
  try {
    await assert.rejects(expiring.service.prepare(expiring.request), /Run \/login/);
  } finally {
    await expiring.cleanup();
  }
  const resumed = await launchFixture({ previous: 'byok' });
  try {
    await assert.rejects(
      resumed.service.prepare({
        ...resumed.request,
        create: false,
        session: { ...resumed.request.session, id: 'old' },
      }),
      (error: any) => error.recoveryAction === 'reauthorize_new_session',
    );
    assert.equal(
      resumed.calls.some((c) => c.operation === 'start'),
      false,
    );
  } finally {
    await resumed.cleanup();
  }
});

test('every published Claude subscription error has a recovery action', async () => {
  const fixture = JSON.parse(
    await readFile(join(contracts, 'claude-subscription.errors.json'), 'utf8'),
  );
  assert.equal(fixture.errors.length, 8);
  for (const error of fixture.errors) {
    const recovery = claudeSubscriptionRecovery(error.data.code);
    assert.equal(recovery?.action, error.data.recovery_action, error.data.code);
    assert.equal(recovery!.message.includes('vdt_'), false);
  }
  for (const [code, action] of [
    ['desktop.claude_subscription_unsupported', 'update_runtime'],
    ['desktop.claude_subscription_login_required', 'sign_in_native_claude_on_execution_host'],
    ['desktop.subscription_account_mismatch', 'reauthorize_new_session'],
    ['desktop.readiness_required', 'inspect_runtime'],
    ['desktop.subscription_target_required', 'open_authorized_setup'],
  ])
    assert.equal(claudeSubscriptionRecovery(code)?.action, action);
  assert.equal(claudeSubscriptionRecovery('desktop.unknown'), null);
  assert.equal(claudeSubscriptionRecovery(undefined), null);
});

test('subscription usage keeps null costs and never shows a zero provider charge', async () => {
  const evidence = new RuntimeEvidence(
    id,
    id,
    async () => ({
      schema_version: 1,
      runtime_id: id,
      session_id: id,
      authority: 'verdictan-control-plane',
      consistency: 'repeatable-read-page',
      absence_means: 'unknown_or_not_ingested',
      replay_executes_requests: false,
      has_more: false,
      requests: [
        {
          request_id: 'subscription',
          review: null,
          review_authority: 'account_broker',
          usage: {
            state: 'settled',
            actual_cost: '0',
            currency: null,
            total_tokens: '42',
            credential_origin: 'claude_subscription',
            provider_charge: 'not_reported',
          },
        },
        {
          request_id: 'no-currency',
          review: null,
          review_authority: 'account_broker',
          usage: { state: 'settled', actual_cost: '0', provider_charge: 'not_reported' },
        },
      ],
    }),
    () => {},
  );
  await evidence.reconcile();
  const [paid, unknown] = evidence.status().requests;
  assert.deepEqual(paid, {
    id: 'subscription',
    policy: null,
    usage: 'settled',
    audit: null,
    actualCost: null,
    currency: null,
    tokens: '42',
    billing: 'subscription',
  });
  assert.equal(unknown.actualCost, null);
  assert.equal(
    historyCostLabel({
      usage: { measured_cost: 0, currency: null, payer: 'user_claude_subscription' },
    }),
    'Paid by your subscription. Provider charge is not known.',
  );
  assert.equal(historyCostLabel({ usage: { measured_cost: 0, currency: null } }), 'Unknown');
  assert.equal(historyCostLabel({ actual_cost: 0, currency: null }), 'Unknown');
  assert.equal(historyCostLabel({ usage: { measured_cost: '0.12', currency: 'USD' } }), '0.12 USD');
  assert.equal(historyCostLabel({ actual_cost: 1.5, currency: 'EUR' }), '1.5 EUR');
});
