import test from 'node:test';
import assert from 'node:assert/strict';
import { GatewaySupervisor, type GatewayEvent } from '../electron/verdictan/supervisor';
import type { RuntimeCredentials } from '../electron/verdictan/credentials';
import { fakeSupervisor, generation, supervisorReplies } from './helpers/fake-supervisor';

const agentA = '44444444-4444-4444-8444-444444444444';
const runtimeA = '66666666-6666-4666-8666-666666666666';
const runtimeB = '77777777-7777-4777-8777-777777777777';
const credentials = (runtime = runtimeA, gateway = 'gw-agent-a'): RuntimeCredentials => ({
  schema_version: 1,
  correlation_id: 'export',
  runtime_id: runtime,
  runtime_registration_id: runtime,
  session_id: runtime,
  gateway_id: gateway,
  agent_id: agentA,
  api_url: 'https://api.eu.verdictan.com',
  expires_at: new Date(Date.now() + 600000).toISOString(),
  runtime_credential: 'vdt_' + 'r'.repeat(20),
  inference_credential: 'vdt_' + 'i'.repeat(20),
  generation: 1,
});
const supervisor = (fake: ReturnType<typeof fakeSupervisor>, extra = {}) =>
  new GatewaySupervisor({ executable: async () => '/verdictan', launch: fake.launch, ...extra });

test('a gateway opens without a credential, and each runtime attaches with its own', async () => {
  const fake = fakeSupervisor(supervisorReplies());
  const owner = supervisor(fake);
  const gatewayEvents: GatewayEvent[] = [];
  const runtimeEvents: GatewayEvent[] = [];
  const gateway = await owner.attachGateway('gw-agent-a', agentA, (event) =>
    gatewayEvents.push(event),
  );
  assert.equal(gateway.effective_address, 'http://127.0.0.1:47011');
  assert.deepEqual(fake.launches, [['gateway', 'supervise', '--multi']]);
  const child = fake.children[0];
  // The gateway attach has no credential frame.
  assert.equal(child.frames.length, 0);
  const a = await owner.attachRuntime(credentials(), (event) => runtimeEvents.push(event));
  await owner.attachRuntime(credentials(runtimeB), () => {});
  assert.equal(a.effective_address, 'http://127.0.0.1:47011');
  const [, attachA] = child.requests;
  assert.deepEqual(
    { ...attachA, correlation_id: 'x' },
    {
      schema_version: 1,
      correlation_id: 'x',
      generation_id: generation,
      operation: 'runtime.attach',
      gateway_id: 'gw-agent-a',
      runtime_id: runtimeA,
    },
  );
  // Each frame has the correlation of its request. No credential is on stdin.
  assert.equal(child.frames[0].correlation_id, attachA.correlation_id);
  assert.equal(child.frames.length, 2);
  assert.doesNotMatch(JSON.stringify(child.requests), /vdt_/);
  // A runtime event goes to the listener of that runtime only.
  child.send(
    'credential.revoked',
    { runtime_id: runtimeA, reason: 'runtime_revoked' },
    { gateway_id: 'gw-agent-a', runtime_id: runtimeA, runtime_generation: 1 },
  );
  child.send('gateway.stopped', { reason: 'failed' }, { gateway_id: 'gw-agent-a' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(
    runtimeEvents.map((e) => e.event),
    ['credential.revoked'],
  );
  assert.deepEqual(
    gatewayEvents.map((e) => e.event),
    ['gateway.stopped'],
  );
  // The renewal is in place, with a new frame.
  await owner.renew({ ...credentials(), generation: 2 });
  assert.equal(child.requests.at(-1).operation, 'credential.renew');
  assert.equal(child.frames.at(-1).generation, 2);
  assert.deepEqual(owner.gateways(), ['gw-agent-a']);
  await owner.detachRuntime('gw-agent-a', runtimeB);
  assert.deepEqual(child.requests.at(-1), {
    ...child.requests.at(-1),
    operation: 'runtime.detach',
    runtime_id: runtimeB,
  });
  await owner.detachGateway('gw-agent-a');
  assert.deepEqual(owner.gateways(), []);
  await owner.shutdown();
  assert.equal(child.requests.at(-1).operation, 'supervisor.shutdown');
});

test('supervisor errors keep their code, and a busy supervisor gets the request again', async () => {
  let busy = 1;
  const replies = supervisorReplies();
  const fake = fakeSupervisor((request, frame) => {
    if (request.operation === 'gateway.attach' && request.agent_id !== agentA)
      return [['error', { code: 'desktop.gateway_limit', retryable: false, limit: 16 }, {}]];
    if (request.operation === 'runtime.attach' && busy-- > 0)
      return [['error', { code: 'desktop.runtime_busy', retryable: true }, {}]];
    return replies(request, frame);
  });
  const owner = supervisor(fake);
  await owner.attachGateway('gw-agent-a', agentA, () => {});
  await owner.attachRuntime(credentials(), () => {});
  assert.equal(
    fake.children[0].requests.filter((r: any) => r.operation === 'runtime.attach').length,
    2,
  );
  await assert.rejects(
    owner.attachGateway('gw-b', '55555555-5555-4555-8555-555555555555', () => {}),
    /gateway_limit/,
  );
  // A refused attach keeps no listener.
  assert.deepEqual(owner.gateways(), ['gw-agent-a']);
});

test('a crash reports the gateways to restore, and a second crash in a minute fails', async () => {
  let now = 0;
  const lost: [string[], boolean][] = [];
  const fake = fakeSupervisor(supervisorReplies());
  const owner = supervisor(fake, {
    now: () => now,
    lost: (gateways: string[], repeated: boolean) => lost.push([gateways, repeated]),
  });
  await owner.attachGateway('gw-agent-a', agentA, () => {});
  await owner.attachRuntime(credentials(), () => {});
  fake.children[0].emit('close');
  assert.deepEqual(lost, [[['gw-agent-a'], false]]);
  await owner.attachGateway('gw-agent-a', agentA, () => {});
  assert.equal(fake.launches.length, 2);
  now = 30000;
  fake.children[1].emit('close');
  assert.deepEqual(lost[1], [['gw-agent-a'], true]);
  assert.equal(owner.failed, true);
  await assert.rejects(owner.start(), /gateway_failed/);
  owner.reset();
  await owner.start();
  assert.equal(fake.launches.length, 3);
});

test('a supervisor that breaks the protocol stops, and an older runtime is not supported', async () => {
  const fake = fakeSupervisor(() => [['gateway.attached', { gateway_id: 'other' }, {}]]);
  const owner = supervisor(fake);
  await assert.rejects(
    owner.attachGateway('gw-agent-a', agentA, () => {}),
    /protocol_invalid/,
  );
  fake.children[0].stdout.write('not json\n');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(fake.children[0].killed, true);
  await assert.rejects(
    new GatewaySupervisor({ executable: async () => null }).start(),
    /runtime_missing/,
  );
  // A process that stops before `supervisor.ready` has no multi mode.
  const old = fakeSupervisor();
  const launch = (...args: any[]) => {
    const child = old.launch(...args);
    child.stdout.write = () => true;
    setImmediate(() => child.emit('close'));
    return child;
  };
  const legacy = new GatewaySupervisor({ executable: async () => '/verdictan', launch });
  await assert.rejects(legacy.start(), /supervisor_unavailable/);
  assert.equal(legacy.unsupported, true);
  await assert.rejects(legacy.start(), /supervisor_unavailable/);
  assert.equal(old.launches.length, 1);
});
