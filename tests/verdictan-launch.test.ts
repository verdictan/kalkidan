import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, symlink, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BindingStore,
  ResumeIncompatibleError,
  assertCompatible,
  type ConversationBinding,
} from '../electron/verdictan/bindings';
import { VerdictanLaunchService } from '../electron/verdictan/launch';
import { DesktopProtocolError } from '../electron/verdictan/protocol';
import { VerdictanSetupService } from '../electron/verdictan/setup';
import { sandboxProfile, assertIsolationPlatform } from '../electron/verdictan/isolation';
const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const selection = {
  teamId: id,
  configurationId: id,
  configurationVersionId: id,
  providerConnectionId: id,
  model: 'model',
};
const agent = { kind: 'codex' as const, version: '0.163.0-alpha.10.2' };
function binding(cwd: string): ConversationBinding {
  return {
    schema_version: 1,
    organization_id: id,
    user_id: id,
    region_id: id,
    provider_connection_id: id,
    installation_id: id,
    host_id: id,
    conversation_id: id,
    provider: 'openai',
    model: 'model',
    agent_kind: 'codex',
    agent_version: agent.version,
    context_format_version: 1,
    configuration_id: id,
    configuration_version_id: id,
    cwd,
  };
}
test('bindings persist private identities and reject silent account, host, model, policy or context changes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'binding-'));
  try {
    const store = new BindingStore(root);
    const identity = await store.identities('local');
    assert.deepEqual(await new BindingStore(root).identities('local'), identity);
    assert.notEqual((await store.identities('remote')).hostId, identity.hostId);
    const b = binding(root);
    await store.save('codex', 'native', b);
    assert.deepEqual(await store.read('codex', 'native'), b);
    assert.equal(await store.read('claude_code', 'native'), null);
    for (const change of [
      { organization_id: other },
      { host_id: other },
      { model: 'other' },
      { configuration_version_id: other },
      { agent_version: '1.0.0' },
      { cwd: '/elsewhere' },
    ])
      await assert.rejects(
        store.save('codex', 'native', { ...b, ...change }),
        /resume_incompatible/,
      );
    assertCompatible(b, { ...b, conversation_id: other }, true);
    assert.throws(
      () => assertCompatible(b, { ...b, conversation_id: other }),
      /resume_incompatible/,
    );
    const home = await store.home(b);
    assert.equal((await stat(home)).mode & 0o777, 0o700);
    await store.select('account', 'codex', selection);
    assert.deepEqual(await store.selections('account'), { codex: selection });
    assert.deepEqual(await store.selections('other-account'), {});
    assert.equal((await stat(join(root, 'verdictan-bindings.json'))).mode & 0o777, 0o600);
    assert.doesNotMatch(
      await readFile(join(root, 'verdictan-bindings.json'), 'utf8'),
      /credential|token/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test('resume errors carry field names and guidance, never binding values', () => {
  const b = binding('/work/project');
  const error = (() => {
    try {
      assertCompatible(b, { ...b, agent_version: '0.164.0', cwd: '/secret/other' });
    } catch (caught) {
      return caught;
    }
  })();
  assert.ok(error instanceof ResumeIncompatibleError);
  assert.equal(error.code, 'desktop.resume_incompatible');
  assert.deepEqual(error.decision.mismatched_fields, ['agent_version', 'cwd']);
  assert.equal(error.decision.guidance, 'explicit_context_transfer');
  assert.doesNotMatch(JSON.stringify(error.decision), /secret/);
  // A saved binding from a newer context format gives the changed field, not a parse error.
  assert.throws(
    () => assertCompatible({ ...b, context_format_version: 2 }, b),
    (caught: any) =>
      caught.code === 'desktop.resume_incompatible' &&
      caught.decision.mismatched_fields.join() === 'context_format_version',
  );
  // A saved project scope cannot change on resume.
  assert.throws(
    () => assertCompatible({ ...b, project_id: 'project-1' }, { ...b, project_id: 'project-2' }),
    /resume_incompatible/,
  );
  // The requested binding must still be a valid current binding.
  assert.throws(
    () => assertCompatible(b, { ...b, context_format_version: 2 }),
    /resume_binding_invalid/,
  );
  assert.throws(
    () => assertCompatible({ ...b, organization_id: 'x' }, b),
    (caught: any) =>
      caught.code === 'desktop.resume_binding_invalid' &&
      caught.decision.guidance === 'new_authorized_session',
  );
  assert.equal(assertCompatible(b, { ...b }).status, 'compatible');
});
test('managed homes and binding files cannot follow symlinks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'binding-'));
  try {
    const outside = join(root, 'outside');
    await mkdir(outside);
    await symlink(outside, join(root, 'managed-agent-homes'));
    await assert.rejects(new BindingStore(root).home(binding(root)), /agent_home_invalid/);
    await symlink(join(root, 'missing'), join(root, 'verdictan-bindings.json'));
    await assert.rejects(new BindingStore(root).read('codex', 'native'), /binding_store_invalid/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
async function fixture(
  overrides: {
    selection?: typeof selection & { agentId?: string };
    defaultPolicy?: { configuration_id: string; configuration_version_id: string };
    resources?: Record<string, unknown>;
    /** The Codex login check. It returns a login or throws. */
    codexLogin?: () => Promise<{ accessToken: string; accountId: string }>;
    /** The catalog check of a Codex subscription runtime. */
    catalog?: () => Promise<void>;
  } = {},
) {
  const root = await mkdtemp(join(tmpdir(), 'launch-'));
  const starts: any[] = [];
  const calls: string[] = [];
  const provisions: any[] = [];
  const routes: any[] = [];
  const options = {
    version: agent.version,
    installed: agent.version as string | undefined,
    failRoute: false,
    failBind: false,
  };
  const versionReads: { kind: string; path: string }[] = [];
  const store = new BindingStore(root);
  const client: any = {
    request: async (operation: string, params: any) => {
      calls.push(operation);
      if (operation === 'capabilities')
        return {
          data: {
            cli_version: '0.3.0',
            protocol_min: 1,
            protocol_max: 1,
            capabilities: [],
            managed_execution_ready: false,
            // Information only. Kalkidan does not gate on Verdictan's tested versions.
            tested_agents: [{ kind: 'codex', version: '0.150.0' }],
          },
        };
      provisions.push(params.parameters);
      return {
        data: {
          ...params.parameters,
          status: 'created',
          agent_id: id,
          gateway_id: 'gateway',
          region_id: id,
          ...overrides.resources,
        },
      };
    },
  };
  const setup: any = {
    inspect: async () => ({
      client,
      account: { organizationId: id, userId: id },
      setup: {
        selections: {
          codex: overrides.selection ?? selection,
          claude: overrides.selection ?? selection,
        },
        defaultPolicy: overrides.defaultPolicy,
      },
    }),
    validate: (_: unknown, _agent: unknown, s: unknown) => s,
    validateSaved: (_: unknown, _agent: unknown, s: unknown) => s,
  };
  let sessionId = '';
  const runtime: any = {
    start: async (params: any, _agent: unknown, _stop: unknown, checks: unknown) => {
      calls.push('start');
      starts.push({ params, checks });
      sessionId = params.session_id;
    },
    verifyCodexCatalog: async (_: string, _turn: unknown, login: unknown) => {
      calls.push('catalog');
      starts.push({ login });
      await overrides.catalog?.();
    },
    endpoint: () => 'http://127.0.0.1:1234',
    route: async (_: string, correlation: unknown) => {
      routes.push(correlation);
      calls.push('route');
      if (options.failRoute) throw Error('readiness_failed');
      return { args: ['--managed'], env: { OPENAI_API_KEY: 'vdt_private' } };
    },
    release: async () => {
      calls.push('release');
    },
    status: () => [{ sessionId, runtimeId: id }],
  };
  const service = new VerdictanLaunchService(
    store,
    setup,
    runtime,
    'local',
    undefined,
    {
      assertPlatform: () => {},
      prepare: async () => ({
        executable: '/sandbox',
        prefix: ['/agent'],
        env: { HOME: '/private' },
        version: options.version,
        close: async () => {
          calls.push('close');
        },
      }),
    },
    undefined,
    Date.now,
    async (kind, executable) => {
      calls.push('version');
      versionReads.push({ kind, path: executable.path });
      return options.installed;
    },
    {
      codex: async () => {
        calls.push('codex-login');
        return overrides.codexLogin
          ? overrides.codexLogin()
          : { accessToken: 'chatgpt-access', accountId: 'account' };
      },
      claude: async () => {
        calls.push('claude-login');
      },
    },
  );
  const request: any = {
    session: { id: 'new', cwd: root, agent: 'codex' },
    runId: 'turn',
    create: true,
    internal: false,
    executable: { path: '/agent', env: { OPENAI_API_KEY: 'inherited' } },
    signal: new AbortController().signal,
    stop: async () => {},
  };
  return {
    root,
    calls,
    provisions,
    routes,
    options,
    versionReads,
    starts,
    store,
    service,
    request,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}
test('managed launch freezes native bindings, forces routed credentials and releases once', async () => {
  const f = await fixture();
  try {
    const launch = await f.service.prepare(f.request);
    assert.equal(launch.model, 'model');
    assert.equal(launch.env.OPENAI_API_KEY, 'vdt_private');
    assert.equal(launch.executable, '/sandbox');
    assert.equal(launch.redact('stderr vdt_private'), 'stderr [private credential]');
    await launch.bindNativeSession('native-id');
    assert.ok(await f.store.read('codex', 'native-id'));
    await Promise.all([launch.finish(), launch.finish()]);
    assert.deepEqual(f.calls, [
      'version',
      'resources.provision',
      'start',
      'route',
      'release',
      'close',
    ]);
    const resumed = await f.service.prepare({
      ...f.request,
      create: false,
      session: { ...f.request.session, id: 'native-id' },
    });
    await resumed.finish();
    await assert.rejects(
      f.service.prepare({
        ...f.request,
        create: false,
        model: 'changed',
        session: { ...f.request.session, id: 'native-id' },
      }),
      /resume_incompatible/,
    );
  } finally {
    await f.cleanup();
  }
});
test('legacy resumes, unsupported binaries, canceled starts and preflight failures never return a launch', async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      f.service.prepare({ ...f.request, create: false }),
      /resume_binding_required/,
    );
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(f.service.prepare({ ...f.request, signal: controller.signal }), /aborted/);
    f.options.version = '9.9.9';
    await assert.rejects(f.service.prepare(f.request), /agent_version_unsupported/);
    assert.ok(f.calls.includes('release'));
    assert.ok(f.calls.includes('close'));
    f.options.version = agent.version;
    f.options.failRoute = true;
    await assert.rejects(
      f.service.prepare({ ...f.request, session: { ...f.request.session, id: 'next' } }),
      /readiness_failed/,
    );
    assert.equal(f.calls.filter((c) => c === 'release').length, 2);
  } finally {
    await f.cleanup();
  }
});
test('sandbox limits the process tree to the gateway and project and rejects unsupported platforms', () => {
  const profile = sandboxProfile(
    '/Users/u/repo',
    '/Users/u/.kalkidan/private',
    '/private/tmp/run',
    ['/opt/agent'],
    [1234, 1234, 3456],
    '/Users/u',
  );
  assert.match(profile, /\(deny network\*\)/);
  assert.match(profile, /\(deny mach-lookup\)/);
  assert.equal(profile.match(/localhost:1234/g)?.length, 1);
  assert.doesNotMatch(profile, /remote ip "\*"/);
  assert.throws(
    () => sandboxProfile('/Users/u', '/h', '/t', ['/agent'], [1234], '/Users/u'),
    /isolation_scope_invalid/,
  );
  assert.throws(
    () => sandboxProfile('/r', '/h', '/t', ['/agent'], [0], '/Users/u'),
    /isolation_scope_invalid/,
  );
  assert.throws(() => assertIsolationPlatform('freebsd'), /process_isolation_unavailable/);
});
test('setup selections must use authorized IDs and the native provider', () => {
  const service = new VerdictanSetupService(null as any, null as any, 'https://api.verdictan.com');
  const setup: any = {
    teams: [{ team_id: id }],
    policies: [{ configuration_id: id, configuration_version_id: id }],
    providerConnections: [{ provider_connection_id: id, provider: 'openai' }],
  };
  assert.equal(service.validate(setup, 'codex', selection), selection);
  for (const s of [
    undefined,
    { ...selection, teamId: other },
    { ...selection, model: 'bad\nvalue' },
    { ...selection, configurationVersionId: other },
  ])
    assert.throws(() => service.validate(setup, 'codex', s as any), /setup_selection_required/);
  assert.throws(() => service.validate(setup, 'claude', selection), /setup_selection_required/);
});

test('subscription selections require runtime capability and never fall back to another agent or API billing', () => {
  const service = new VerdictanSetupService(null as any, null as any, 'https://api.verdictan.com');
  const setup: any = {
    teams: [{ team_id: id }],
    policies: [{ configuration_id: id, configuration_version_id: id }],
    providerConnections: [],
    providerAccessModes: ['byok', 'codex_subscription'],
  };
  const subscription = {
    ...selection,
    providerConnectionId: '',
    providerAccessMode: 'codex_subscription' as const,
  };
  assert.equal(service.validate(setup, 'codex', subscription), subscription);
  assert.throws(() => service.validate(setup, 'claude', subscription), /setup_selection_required/);
  assert.throws(
    () => service.validate(setup, 'codex', { ...subscription, providerConnectionId: id }),
    /setup_selection_required/,
  );
  assert.throws(
    () =>
      service.validate(setup, 'claude', {
        ...subscription,
        providerAccessMode: 'claude_subscription',
      } as any),
    /setup_selection_required/,
  );
  setup.providerAccessModes = ['byok'];
  assert.throws(() => service.validate(setup, 'codex', subscription), /setup_selection_required/);
});

test('a launch without a picked policy provisions the default and binds the resolved version', async () => {
  const fallback = {
    configuration_id: `cfg_${'a'.repeat(32)}`,
    configuration_version_id: `cfgv_${'b'.repeat(32)}`,
  };
  const deployed = `cfgv_${'c'.repeat(32)}`;
  const f = await fixture({
    selection: { ...selection, configurationId: '', configurationVersionId: '' },
    defaultPolicy: fallback,
    resources: {
      configuration_id: fallback.configuration_id,
      configuration_version_id: deployed,
      configuration_source: 'kalkidan_default',
    },
  });
  try {
    const launch = await f.service.prepare(f.request);
    // Neither policy field goes to Verdictan, so it uses the default.
    assert.equal('configuration_id' in f.provisions[0], false);
    assert.equal('configuration_version_id' in f.provisions[0], false);
    await launch.bindNativeSession('native-default');
    const saved = await f.store.read('codex', 'native-default');
    assert.equal(saved?.configuration_id, fallback.configuration_id);
    assert.equal(saved?.configuration_version_id, deployed);
    // The run goes to the gateway, so that a project-bound runtime accepts the requests.
    assert.equal(f.routes[0].runId, 'turn');
    await launch.finish();
  } finally {
    await f.cleanup();
  }
});

test('a provision that does not use the requested policy is a binding mismatch', async () => {
  const picked = await fixture({ resources: { configuration_source: 'kalkidan_default' } });
  try {
    await assert.rejects(picked.service.prepare(picked.request), /resource_binding_mismatch/);
    assert.deepEqual(picked.provisions[0].configuration_id, id);
    assert.equal(picked.calls.includes('start'), false);
  } finally {
    await picked.cleanup();
  }
  const fallback = await fixture({
    selection: { ...selection, configurationId: '', configurationVersionId: '' },
    defaultPolicy: { configuration_id: id, configuration_version_id: id },
    resources: { configuration_id: id, configuration_version_id: id },
  });
  try {
    await assert.rejects(fallback.service.prepare(fallback.request), /resource_binding_mismatch/);
  } finally {
    await fallback.cleanup();
  }
});

test('a launch with a chosen agent provisions with agent_id and binds its deployed policy', async () => {
  const deployed = {
    configuration_id: `cfg_${'d'.repeat(32)}`,
    configuration_version_id: `cfgv_${'e'.repeat(32)}`,
  };
  const chosen = { ...selection, configurationId: '', configurationVersionId: '', agentId: id };
  const f = await fixture({
    selection: chosen,
    resources: {
      ...deployed,
      configuration_source: 'agent_deployment',
      agent_source: 'selected_agent',
    },
  });
  try {
    const launch = await f.service.prepare(f.request);
    // The agent and its team only. The deployed policy of the agent applies.
    assert.equal(f.provisions[0].agent_id, id);
    assert.equal(f.provisions[0].team_id, id);
    assert.equal('configuration_id' in f.provisions[0], false);
    assert.equal('configuration_version_id' in f.provisions[0], false);
    await launch.bindNativeSession('native-agent');
    const saved = await f.store.read('codex', 'native-agent');
    assert.equal(saved?.configuration_id, deployed.configuration_id);
    assert.equal(saved?.configuration_version_id, deployed.configuration_version_id);
    await launch.finish();
  } finally {
    await f.cleanup();
  }
  // A provision that did not attach the host to the chosen agent never starts.
  const host = await fixture({
    selection: chosen,
    resources: { ...deployed, configuration_source: 'kalkidan_default', agent_source: 'host' },
  });
  try {
    await assert.rejects(host.service.prepare(host.request), /resource_binding_mismatch/);
    assert.equal(host.calls.includes('start'), false);
  } finally {
    await host.cleanup();
  }
});

test('each managed launch path checks the installed agent version against the minimum', async () => {
  const f = await fixture();
  try {
    // A new chat, then resume, then fork. Each one reads the installed version first.
    const first = await f.service.prepare(f.request);
    await first.bindNativeSession('native-id');
    await first.finish();
    const resumed = await f.service.prepare({
      ...f.request,
      create: false,
      session: { ...f.request.session, id: 'native-id' },
    });
    await resumed.finish();
    const forked = await f.service.prepare({
      ...f.request,
      forkFrom: 'native-id',
      session: { ...f.request.session, id: 'fork' },
    });
    await forked.finish();
    assert.equal(f.versionReads.length, 3);
    assert.ok(f.versionReads.every((read) => read.kind === 'codex' && read.path === '/agent'));
    // Kalkidan binds the installed version, not a version from Verdictan's tested list.
    assert.equal((await f.store.read('codex', 'native-id'))!.agent_version, agent.version);
    for (const [installed, code] of [
      ['0.159.9', 'desktop.codex_version_unsupported'],
      ['0.150.0', 'desktop.codex_version_unsupported'],
      ['0.159.0-alpha.99', 'desktop.codex_version_unsupported'],
      [undefined, 'desktop.codex_version_unknown'],
    ] as const) {
      f.options.installed = installed;
      const before = f.calls.length;
      for (const request of [
        f.request,
        { ...f.request, create: false, session: { ...f.request.session, id: 'native-id' } },
        { ...f.request, forkFrom: 'native-id', session: { ...f.request.session, id: 'fork-2' } },
      ])
        await assert.rejects(f.service.prepare(request), (error: any) => {
          assert.equal(error.code, code);
          assert.match(error.message, /Kalkidan needs Codex 0\.160\.0 or later\. Update Codex/);
          return true;
        });
      // Refused before any provision or runtime start.
      assert.deepEqual(new Set(f.calls.slice(before)), new Set(['version']));
    }
    // The minimum itself, a prerelease of the minimum, and newer versions pass.
    for (const installed of ['0.160.0', '0.160.0-alpha.1', '0.163.0-alpha.10.2', '1.0.0']) {
      f.options.installed = installed;
      f.options.version = installed;
      const launch = await f.service.prepare({
        ...f.request,
        session: { ...f.request.session, id: 'new-' + installed },
      });
      await launch.finish();
    }
  } finally {
    await f.cleanup();
  }
});

test('Claude Code launches need Claude Code 2.1.300 or later', async () => {
  const f = await fixture();
  const claude = { ...f.request, session: { ...f.request.session, agent: 'claude' } };
  try {
    f.options.installed = '2.1.296';
    await assert.rejects(f.service.prepare(claude), (error: any) => {
      assert.equal(error.code, 'desktop.claude_code_version_unsupported');
      assert.match(
        error.message,
        /^Kalkidan needs Claude Code 2\.1\.300 or later\. Update Claude Code, then try again\./,
      );
      return true;
    });
    assert.equal(f.versionReads.at(-1)!.kind, 'claude_code');
    f.options.installed = undefined;
    await assert.rejects(f.service.prepare(claude), /claude_code_version_unknown/);
    assert.equal(f.provisions.length, 0);
    for (const installed of ['2.1.300', '2.1.304', '2.1.306', '2.2.0']) {
      f.options.installed = installed;
      f.options.version = installed;
      const launch = await f.service.prepare({
        ...claude,
        session: { ...claude.session, id: 'claude-' + installed },
      });
      await launch.finish();
      assert.equal(
        (await f.store.read('claude_code', 'claude-' + installed))!.agent_version,
        installed,
      );
    }
    // The isolated agent must print the version that the check accepted.
    f.options.installed = '2.1.306';
    f.options.version = '2.1.296';
    await assert.rejects(
      f.service.prepare({ ...claude, session: { ...claude.session, id: 'changed' } }),
      /agent_version_unsupported/,
    );
  } finally {
    await f.cleanup();
  }
});

const codexSubscription = {
  ...selection,
  providerConnectionId: '',
  providerAccessMode: 'codex_subscription' as const,
};

test('a Codex subscription launch checks the Codex login before Verdictan provisions anything', async () => {
  const f = await fixture({
    selection: codexSubscription,
    codexLogin: async () => {
      throw new DesktopProtocolError('desktop.codex_subscription_login_required');
    },
  });
  try {
    await assert.rejects(f.service.prepare(f.request), {
      code: 'desktop.codex_subscription_login_required',
    });
    assert.equal(f.calls.includes('resources.provision'), false);
    assert.equal(f.calls.includes('start'), false);
  } finally {
    await f.cleanup();
  }
});

test('a Codex subscription launch checks the model catalog before Codex starts', async () => {
  const f = await fixture({ selection: codexSubscription });
  try {
    const launch = await f.service.prepare(f.request);
    const order = f.calls.filter((call) =>
      ['codex-login', 'resources.provision', 'start', 'catalog', 'route'].includes(call),
    );
    assert.deepEqual(order, ['codex-login', 'resources.provision', 'start', 'catalog', 'route']);
    // The gateway accepts the pending native proof only after this check passed.
    assert.deepEqual(f.starts[0].checks, { agentLoginChecked: true });
    assert.deepEqual(f.starts[1].login, { accessToken: 'chatgpt-access', accountId: 'account' });
    // The managed Codex home gets the same login.
    const home = await f.store.home((await f.store.read('codex', 'new'))!);
    const auth = JSON.parse(await readFile(join(home, 'auth.json'), 'utf8'));
    assert.equal(auth.tokens.access_token, 'chatgpt-access');
    await launch.finish();
  } finally {
    await f.cleanup();
  }
});

test('a failed catalog check stops the launch with its reason and releases the runtime', async () => {
  const f = await fixture({
    selection: codexSubscription,
    catalog: async () => {
      throw new DesktopProtocolError('desktop.codex_subscription_catalog_unavailable');
    },
  });
  try {
    await assert.rejects(f.service.prepare(f.request), {
      code: 'desktop.codex_subscription_catalog_unavailable',
    });
    assert.equal(f.calls.includes('route'), false);
    assert.equal(f.calls.includes('release'), true);
  } finally {
    await f.cleanup();
  }
});

test('an API key launch needs no agent login check', async () => {
  const f = await fixture();
  try {
    const launch = await f.service.prepare(f.request);
    assert.equal(f.calls.includes('codex-login'), false);
    assert.equal(f.calls.includes('catalog'), false);
    assert.deepEqual(f.starts[0].checks, { agentLoginChecked: false });
    await launch.finish();
  } finally {
    await f.cleanup();
  }
});
