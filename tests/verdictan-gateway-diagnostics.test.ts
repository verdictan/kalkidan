import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { ManagedGateway } from '../electron/verdictan/gateway';
import { GatewaySupervisor } from '../electron/verdictan/supervisor';
import type { RuntimeCredentials } from '../electron/verdictan/credentials';
import { journal } from '../electron/diagnostics/journal';
import { readFileSync } from 'node:fs';

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
const agent = { kind: 'codex' as const, version: '0.162.0-alpha.17.2' };
/**
 * The readiness reply of the Verdictan 0.6.13 gateway for a Codex subscription runtime before
 * Codex read its model catalog through the gateway. Everything else is ready.
 */
const probeRequired = {
  schema_version: 1,
  ready: false,
  dispatch_authorized: false,
  runtime_id: id,
  session_id: id,
  credential: 'ready',
  dependencies: 'ready',
  protocol_acceptance: 'verified',
  control_plane: { runtime_id: id, session_id: id, generation: 3, ready: true },
  provider_authentication: 'probe_required',
  request_authorization: 'required_per_request',
  error: {
    code: 'desktop.provider_probe_required',
    message: 'Refresh the native Codex model catalog to verify provider access.',
  },
};
/** A gateway instance in the supervisor, so that no process starts. */
function shared(mode: RuntimeCredentials['provider_access_mode'], body: unknown, status = 503) {
  return new ManagedGateway({
    executable: '/fixture/verdictan',
    credentials: { ...credentials, ...(mode ? { provider_access_mode: mode } : {}) },
    now: () => now,
    instance: { address: 'http://127.0.0.1:43123', subscribe: () => () => {} },
    request: (async () => Response.json(body, { status })) as any,
  });
}
const gatewayRecords = () => journal.recentCorrelations().filter((r) => r.kind === 'gateway');

test('a Codex subscription runtime starts before Codex proves its subscription', async () => {
  const gateway = shared('codex_subscription', probeRequired);
  await gateway.readiness(agent);
  await gateway.stop();
});

test('the probe code passes only for a Codex subscription runtime that is ready otherwise', async () => {
  for (const [mode, body] of [
    [undefined, probeRequired],
    ['claude_subscription', probeRequired],
    ['codex_subscription', { ...probeRequired, dependencies: 'unavailable' }],
    [
      'codex_subscription',
      { ...probeRequired, control_plane: { ...probeRequired.control_plane, ready: false } },
    ],
    ['codex_subscription', { ...probeRequired, provider_authentication: 'verified' }],
    ['codex_subscription', { ...probeRequired, error: { code: 'desktop.readiness_blocked' } }],
  ] as const) {
    const gateway = shared(mode, body);
    await assert.rejects(gateway.readiness(agent), (error: any) => {
      assert.match(error.code, /^desktop\.readiness_(failed|blocked)$/);
      return true;
    });
    await gateway.stop();
  }
});

test('a failed readiness check keeps its safe reason in the diagnostics', async () => {
  const gateway = shared(undefined, probeRequired);
  await assert.rejects(gateway.readiness(agent), { code: 'desktop.readiness_failed' });
  const [record] = gatewayRecords();
  assert.equal(record.operation, 'gateway.readiness');
  assert.equal(record.outcome, 'desktop.readiness_failed');
  assert.match(record.detail!, /http 503/);
  assert.match(record.detail!, /provider_authentication probe_required/);
  assert.match(record.detail!, /error desktop\.provider_probe_required/);
  // The message text of the gateway never goes into the diagnostics.
  assert.doesNotMatch(record.detail!, /Refresh the native/);
  await gateway.stop();
});

test('a readiness check without a JSON reply keeps the HTTP status or "no reply"', async () => {
  for (const [request, expected] of [
    [async () => new Response('<html>bad gateway</html>', { status: 502 }), /^http 502$/],
    [
      async () => {
        throw new TypeError('fetch failed');
      },
      /^no reply$/,
    ],
  ] as const) {
    const gateway = new ManagedGateway({
      executable: '/fixture/verdictan',
      credentials,
      now: () => now,
      instance: { address: 'http://127.0.0.1:43123', subscribe: () => () => {} },
      request: request as any,
    });
    await assert.rejects(gateway.readiness(agent), { code: 'desktop.readiness_failed' });
    assert.match(gatewayRecords()[0].detail!, expected);
    await gateway.stop();
  }
});

test('a gateway process that stops keeps its redacted stderr in the diagnostics', async () => {
  const child: any = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdio = [child.stdin, child.stdout, child.stderr, new PassThrough()];
  child.exitCode = null;
  child.signalCode = null;
  child.kill = () => {};
  const gateway = new ManagedGateway({
    executable: '/fixture/verdictan',
    credentials,
    now: () => now,
    launch: (() => child) as any,
  });
  child.stderr.write(
    `ERROR gateway start failed: port in use; key ${credentials.inference_credential}; ` +
      'Authorization: Bearer abcdefghijklmnop\n',
  );
  await new Promise((resolve) => setImmediate(resolve));
  child.exitCode = 1;
  child.emit('close', 1);
  await assert.rejects(gateway.readiness(agent), /gateway_stopped/);
  const [record] = gatewayRecords();
  assert.equal(record.operation, 'gateway.process');
  assert.equal(record.outcome, 'desktop.gateway_stopped');
  assert.match(record.detail!, /port in use/);
  assert.doesNotMatch(record.detail!, /vdt_b|abcdefghijklmnop/);
});

test('a supervisor that stops before it is ready keeps its redacted stderr', async () => {
  const child: any = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdio = [child.stdin, child.stdout, child.stderr, new PassThrough()];
  child.kill = () => {};
  const supervisor = new GatewaySupervisor({
    executable: async () => '/fixture/verdictan',
    launch: (() => child) as any,
  });
  const started = supervisor.start();
  await new Promise((resolve) => setImmediate(resolve));
  child.stderr.write('error: unknown option --multi; token=secretvalue123\n');
  await new Promise((resolve) => setImmediate(resolve));
  child.emit('close', 2);
  await assert.rejects(started, { code: 'desktop.supervisor_unavailable' });
  const [record] = gatewayRecords();
  assert.equal(record.operation, 'gateway.supervisor');
  assert.equal(record.outcome, 'desktop.supervisor_unavailable');
  assert.match(record.detail!, /unknown option --multi/);
  assert.doesNotMatch(record.detail!, /secretvalue123/);
});

test('the dev server does not reload for files of other worktrees or coverage runs', () => {
  const config = readFileSync('vite.config.mts', 'utf8');
  assert.match(config, /watch: \{ ignored: \['\*\*\/\.claude\/\*\*', '\*\*\/coverage\/\*\*'\] \}/);
});
