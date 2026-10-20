import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile, symlink, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  BindingStore,
  assertCompatible,
  type ConversationBinding,
} from '../electron/verdictan/bindings';
import { VerdictanLaunchService } from '../electron/verdictan/launch';
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
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'launch-'));
  const calls: string[] = [];
  const options = { version: agent.version, failRoute: false, failBind: false };
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
            tested_agents: [agent],
          },
        };
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
  const setup: any = {
    inspect: async () => ({
      client,
      account: { organizationId: id, userId: id },
      setup: { selections: { codex: selection } },
    }),
    validate: (_: unknown, _agent: unknown, s: unknown) => s,
  };
  let sessionId = '';
  const runtime: any = {
    start: async (params: any) => {
      calls.push('start');
      sessionId = params.session_id;
    },
    endpoint: () => 'http://127.0.0.1:1234',
    route: async () => {
      calls.push('route');
      if (options.failRoute) throw Error('readiness_failed');
      return { args: ['--managed'], env: { OPENAI_API_KEY: 'vdt_private' } };
    },
    release: async () => {
      calls.push('release');
    },
    status: () => [{ sessionId, runtimeId: id }],
  };
  const service = new VerdictanLaunchService(store, setup, runtime, 'local', undefined, {
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
  });
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
    options,
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
      'capabilities',
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
