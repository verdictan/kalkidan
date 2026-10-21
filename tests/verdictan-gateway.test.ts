import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { ManagedGateway } from '../electron/verdictan/gateway';
import {
  parseRuntimeCredentials,
  type RuntimeCredentials,
} from '../electron/verdictan/credentials';

const id = '11111111-1111-4111-8111-111111111111';
const now = Date.parse('2026-10-20T00:00:00Z');
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
const agent = { kind: 'codex' as const, version: '0.163.0-alpha.10.2' };
const correlation = {
  hostId: id,
  projectId: 'project',
  taskId: 'task',
  conversationId: 'conversation',
  runId: 'run',
  turnId: id,
};
function fixture() {
  const child: any = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdio = [child.stdin, child.stdout, child.stderr, new PassThrough()];
  child.exitCode = null;
  child.signalCode = null;
  let killed = 0,
    lost = 0;
  const close = () => {
    if (child.exitCode === null) {
      child.exitCode = 0;
      child.emit('close', 0);
    }
  };
  child.kill = () => {
    killed++;
    close();
  };
  child.stdin.on('finish', close);
  const launches: any[] = [],
    requests: any[] = [];
  let payload: any = {
    schema_version: 1,
    ready: true,
    dispatch_authorized: false,
    runtime_id: id,
    session_id: id,
    credential: 'ready',
    dependencies: 'ready',
    protocol_acceptance: 'verified',
    control_plane: { runtime_id: id, session_id: id, generation: 3, ready: true },
  };
  const gateway = new ManagedGateway({
    executable: '/fixture/verdictan',
    credentials,
    now: () => now,
    launch: ((...args: any[]) => {
      launches.push(args);
      return child;
    }) as any,
    request: (async (url: URL, options: any) => {
      requests.push({ url, options });
      return Response.json(payload);
    }) as any,
    lost: () => lost++,
  });
  let sequence = 0;
  function emit(event: string, data: object, overrides = {}) {
    child.stdout.write(
      JSON.stringify({
        schema_version: 1,
        correlation_id: 'gateway',
        generation_id: id,
        runtime_generation: 3,
        sequence: ++sequence,
        event,
        data,
        ...overrides,
      }) + '\n',
    );
  }
  function listen() {
    emit('gateway.starting', { runtime_id: id, gateway_id: 'gateway' });
    emit('gateway.listening', {
      runtime_id: id,
      session_id: id,
      gateway_id: 'gateway',
      effective_address: 'http://127.0.0.1:43123',
      ready: false,
      reason_code: 'desktop.readiness_required',
    });
  }
  return {
    gateway,
    child,
    launches,
    requests,
    listen,
    emit,
    killed: () => killed,
    lost: () => lost,
    change: (value: any) => {
      payload = value;
    },
    payload,
  };
}
test('protected credential parser rejects stale, overlong, foreign-origin and malformed frames', () => {
  assert.deepEqual(parseRuntimeCredentials(credentials, now), credentials);
  for (const patch of [
    { generation: 0 },
    { runtime_id: 'bad' },
    { runtime_credential: 'secret' },
    { expires_at: '2026-10-20T00:00:00Z' },
    { expires_at: '2026-10-20T00:16:00Z' },
    { api_url: 'http://api.verdictan.com' },
    { api_url: 'https://api.verdictan.com/path' },
    { password: 'secret' },
  ])
    assert.throws(() => parseRuntimeCredentials({ ...credentials, ...patch }, now), /desktop\./);
});
test('gateway uses only fd3 for credentials and checks live authority for every turn', async (t) => {
  const f = fixture();
  t.after(() => f.gateway.stop());
  f.listen();
  const route = await f.gateway.nativeRoute(agent, correlation);
  assert.equal(JSON.stringify(f.launches).includes(credentials.runtime_credential), false);
  assert.deepEqual(f.launches[0][1], ['gateway', 'supervise']);
  assert.equal(route.env.OPENAI_API_KEY, credentials.inference_credential);
  assert.match(route.args.join(' '), /request_max_retries=0,stream_max_retries=0/);
  assert.match(route.args.join(' '), /x-verdictan-desktop-agent-version/);
  assert.match(route.args.join(' '), /x-verdictan-desktop-host-id/);
  assert.match(route.args.join(' '), /x-verdictan-desktop-project-id/);
  // A project-bound runtime rejects requests without the run.
  assert.match(route.args.join(' '), /x-verdictan-desktop-run-id/);
  assert.equal(route.args.join(' ').includes(credentials.inference_credential), false);
  await f.gateway.nativeRoute(agent, correlation);
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[0].url.searchParams.get('agent_version'), agent.version);
  assert.equal(f.requests[0].options.redirect, 'error');
  assert.equal(
    f.requests[0].options.headers.authorization,
    'Bearer ' + credentials.inference_credential,
  );
  const claude = await f.gateway.nativeRoute(
    { kind: 'claude_code', version: '2.1.304' },
    correlation,
  );
  assert.equal(claude.env.CLAUDE_CODE_MAX_RETRIES, '0');
  assert.equal(claude.env.CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK, '1');
  // The API-key routes use the same minimum. No exact version is pinned.
  await f.gateway.nativeRoute({ kind: 'claude_code', version: '2.1.300' }, correlation);
  await f.gateway.nativeRoute({ kind: 'codex', version: '0.160.0' }, correlation);
  await assert.rejects(
    f.gateway.nativeRoute({ kind: 'codex', version: '0.159.0' }, correlation),
    /codex_version_unsupported/,
  );
  await assert.rejects(
    f.gateway.nativeRoute({ kind: 'claude_code', version: '2.1.299' }, correlation),
    /claude_code_version_unsupported/,
  );
  await f.gateway.stop();
  await assert.rejects(f.gateway.readiness(agent), /unavailable/);
});
test('listening never implies readiness: reject unsupported, stale or foreign readiness', async () => {
  for (const patch of [
    { ready: false },
    { dispatch_authorized: true },
    { protocol_acceptance: 'unverified' },
    { runtime_id: 'foreign' },
    { dependencies: 'unavailable' },
    { control_plane: { generation: 2, ready: true } },
  ]) {
    const f = fixture();
    f.listen();
    f.change({ ...f.payload, ...patch });
    await assert.rejects(f.gateway.nativeRoute(agent, correlation), /readiness_failed/);
    await f.gateway.stop();
  }
});
test('stale supervisor generations and non-loopback addresses terminate ownership', async () => {
  for (const mode of ['generation', 'address', 'sequence']) {
    const f = fixture();
    f.emit('gateway.starting', { runtime_id: id, gateway_id: 'gateway' });
    f.emit(
      'gateway.listening',
      {
        runtime_id: id,
        session_id: id,
        gateway_id: 'gateway',
        effective_address: mode === 'address' ? 'http://evil.test:80' : 'http://127.0.0.1:12345',
        ready: false,
        reason_code: 'desktop.readiness_required',
      },
      mode === 'generation'
        ? { generation_id: '22222222-2222-4222-8222-222222222222' }
        : mode === 'sequence'
          ? { sequence: 10 }
          : {},
    );
    await assert.rejects(f.gateway.readiness(agent), /protocol_invalid/);
    assert.equal(f.lost(), 1);
    assert.equal(f.killed(), 1);
    await f.gateway.stop();
  }
});
