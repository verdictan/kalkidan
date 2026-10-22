import test from 'node:test';
import assert from 'node:assert/strict';
import { GatewaySupervisor, type GatewayEvent } from '../electron/verdictan/supervisor';
import type { RuntimeCredentials } from '../electron/verdictan/credentials';
import {
  attached,
  fakeSupervisor as fakeProcess,
  generation,
  runtime,
} from './helpers/fake-supervisor';

const agentA = '44444444-4444-4444-8444-444444444444';
const credentials = (gateway = 'gw-agent-a', agent = agentA): RuntimeCredentials => ({
  schema_version: 1,
  correlation_id: 'export',
  runtime_id: runtime,
  runtime_registration_id: runtime,
  session_id: runtime,
  gateway_id: gateway,
  agent_id: agent,
  api_url: 'https://api.eu.verdictan.com',
  expires_at: new Date(Date.now() + 600000).toISOString(),
  runtime_credential: 'vdt_' + 'r'.repeat(20),
  inference_credential: 'vdt_' + 'i'.repeat(20),
  generation: 1,
});

test('the supervisor attaches a gateway with its credential on descriptor 3 only', async () => {
  const fake = fakeProcess((request) =>
    request.operation === 'gateway.attach'
      ? attached(request)
      : request.operation === 'gateway.detach'
        ? [['gateway.stopping', {}, { gateway_id: request.gateway_id }]]
        : request.operation === 'supervisor.shutdown'
          ? [['supervisor.stopping', {}, {}]]
          : [],
  );
  const supervisor = new GatewaySupervisor({
    executable: async () => '/verdictan',
    launch: fake.launch,
  });
  const events: GatewayEvent[] = [];
  const summary = await supervisor.attach(credentials(), (event) => events.push(event));
  assert.equal(summary.effective_address, 'http://127.0.0.1:47011');
  assert.deepEqual(fake.launches, [['gateway', 'supervise', '--multi']]);
  const child = fake.children[0];
  const [request] = child.requests;
  assert.deepEqual(
    { ...request, correlation_id: 'x' },
    {
      schema_version: 1,
      correlation_id: 'x',
      generation_id: generation,
      operation: 'gateway.attach',
      gateway_id: 'gw-agent-a',
      agent_id: agentA,
    },
  );
  // The frame has the correlation of the request. No credential is on stdin.
  assert.equal(child.frames[0].correlation_id, request.correlation_id);
  assert.equal(child.frames[0].runtime_credential, credentials().runtime_credential);
  assert.doesNotMatch(JSON.stringify(child.requests), /vdt_/);
  // An event of the gateway goes to its listener.
  child.send(
    'credential.revoked',
    { runtime_id: runtime, reason: 'host_revoked' },
    {
      gateway_id: 'gw-agent-a',
      runtime_generation: 1,
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(events, [
    {
      event: 'credential.revoked',
      runtimeGeneration: 1,
      data: { runtime_id: runtime, reason: 'host_revoked' },
    },
  ]);
  assert.deepEqual(supervisor.gateways(), ['gw-agent-a']);
  await supervisor.detach('gw-agent-a');
  assert.deepEqual(supervisor.gateways(), []);
  const closed = supervisor.shutdown();
  setImmediate(() => child.emit('close'));
  await closed;
  assert.equal(child.requests.at(-1).operation, 'supervisor.shutdown');
});

test('supervisor errors keep their code, and a busy supervisor gets the request again', async () => {
  let busy = 1;
  const fake = fakeProcess((request) => {
    if (request.agent_id !== agentA)
      return [['error', { code: 'desktop.agent_already_attached', retryable: false }, {}]];
    if (busy-- > 0) return [['error', { code: 'desktop.supervisor_busy', retryable: true }, {}]];
    return attached(request);
  });
  const supervisor = new GatewaySupervisor({
    executable: async () => '/verdictan',
    launch: fake.launch,
  });
  await supervisor.attach(credentials(), () => {});
  assert.equal(fake.children[0].requests.length, 2);
  await assert.rejects(
    supervisor.attach(credentials('gw-b', '55555555-5555-4555-8555-555555555555'), () => {}),
    /agent_already_attached/,
  );
  // A refused attach keeps no listener.
  assert.deepEqual(supervisor.gateways(), ['gw-agent-a']);
});

test('a crash reports the gateways to restore, and a second crash in a minute fails', async () => {
  let now = 0;
  const lost: [string[], boolean][] = [];
  const fake = fakeProcess((request) => attached(request));
  const supervisor = new GatewaySupervisor({
    executable: async () => '/verdictan',
    launch: fake.launch,
    now: () => now,
    lost: (gateways, repeated) => lost.push([gateways, repeated]),
  });
  await supervisor.attach(credentials(), () => {});
  fake.children[0].emit('close');
  assert.deepEqual(lost, [[['gw-agent-a'], false]]);
  // The owner starts it again and attaches each gateway with a new credential.
  await supervisor.attach(credentials(), () => {});
  assert.equal(fake.launches.length, 2);
  now = 30000;
  fake.children[1].emit('close');
  assert.deepEqual(lost[1], [['gw-agent-a'], true]);
  assert.equal(supervisor.failed, true);
  await assert.rejects(supervisor.start(), /gateway_failed/);
  supervisor.reset();
  await supervisor.start();
  assert.equal(fake.launches.length, 3);
});

test('a supervisor that breaks the protocol stops, and a missing runtime does not start', async () => {
  const fake = fakeProcess(() => [['gateway.attached', { gateway_id: 'other' }, {}]]);
  const supervisor = new GatewaySupervisor({
    executable: async () => '/verdictan',
    launch: fake.launch,
  });
  await assert.rejects(
    supervisor.attach(credentials(), () => {}),
    /gateway_protocol_invalid/,
  );
  fake.children[0].stdout.write('not json\n');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fake.children[0].killed, true);
  await assert.rejects(
    new GatewaySupervisor({ executable: async () => null }).start(),
    /runtime_missing/,
  );
});
