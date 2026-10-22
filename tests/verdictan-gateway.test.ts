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
  const revocations: unknown[] = [];
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
  let status = 200;
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
      return Response.json(payload, { status });
    }) as any,
    lost: (revocation) => {
      lost++;
      revocations.push(revocation);
    },
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
    revocations,
    change: (value: any, code = 200) => {
      payload = value;
      status = code;
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
    // 15 minutes of life plus 5 minutes of clock difference is the longest that is accepted.
    { expires_at: '2026-10-20T00:20:01Z' },
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
  // Kalkidan sets the disk limit of the durable event queue for each gateway.
  assert.equal(f.launches[0][2].env.VERDICTAN_EVENT_WAL_MAX_BYTES, '200000000');
  assert.equal(f.launches[0][2].env.VERDICTAN_EVENT_WAL_FULL_POLICY, 'drop_oldest_non_usage');
  assert.equal(f.launches[0][2].env.VERDICTAN_EVENT_WAL_MAX_AGE_SECONDS, '2592000');
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
test('readiness relays only known safe gateway codes and never the gateway text', async () => {
  for (const [body, code, expected] of [
    [
      { error: { code: 'desktop.readiness_blocked', message: 'db down at 10.0.0.1' } },
      503,
      'desktop.readiness_blocked',
    ],
    [
      { error: { code: 'desktop.event_authority_unavailable' } },
      504,
      'desktop.event_authority_unavailable',
    ],
    [
      { ready: false, error: { code: 'desktop.evidence_unavailable' } },
      200,
      'desktop.evidence_unavailable',
    ],
    [
      { error: { code: 'desktop.secure_storage_unavailable' } },
      503,
      'desktop.secure_storage_unavailable',
    ],
    // The durable event queue of the gateway is full.
    [{ error: { code: 'desktop.event_buffer_full' } }, 503, 'desktop.event_buffer_full'],
    [{ error: { code: 'desktop.unknown_gateway_code' } }, 503, 'desktop.readiness_failed'],
    [{ error: { code: 'not a code' } }, 500, 'desktop.readiness_failed'],
    [{ error: 'raw text' }, 500, 'desktop.readiness_failed'],
    // A Claude subscription code needs a Claude subscription runtime.
    [
      { error: { code: 'desktop.claude_subscription_login_required' } },
      503,
      'desktop.readiness_failed',
    ],
  ] as const) {
    const f = fixture();
    f.listen();
    f.change(body, code);
    await assert.rejects(f.gateway.readiness(agent), (error: any) => {
      assert.equal(error.code, expected);
      assert.doesNotMatch(error.message, /10\.0\.0\.1|db down|raw text/);
      return true;
    });
    await f.gateway.stop();
  }
  // A reply that is not JSON fails closed.
  const f = fixture();
  f.listen();
  f.change('not json', 503);
  await assert.rejects(f.gateway.readiness(agent), /readiness_failed/);
  await f.gateway.stop();
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

test('a revoked runtime stops the gateway at once and reports the reason', async () => {
  const f = fixture();
  f.listen();
  await f.gateway.readiness(agent);
  f.emit('credential.revoked', { runtime_id: id, reason: 'session_revoked' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.lost(), 1);
  assert.deepEqual(f.revocations, ['session_revoked']);
  assert.equal(f.killed(), 1);
  await assert.rejects(f.gateway.readiness(agent), /gateway_unavailable/);
  // The gateway keeps no secret after the revocation.
  const kept = (f.gateway as any).credentials;
  assert.equal(kept.runtime_credential, '');
  assert.equal(kept.inference_credential, '');
  await f.gateway.stop();
});
test('a revocation event for another runtime or with an unknown reason is a protocol error', async () => {
  for (const data of [
    { runtime_id: '22222222-2222-4222-8222-222222222222', reason: 'host_revoked' },
    { runtime_id: id, reason: 'unknown' },
  ]) {
    const f = fixture();
    f.listen();
    f.emit('credential.revoked', data);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(f.lost(), 1);
    assert.deepEqual(f.revocations, [undefined]);
    await f.gateway.stop();
  }
});
