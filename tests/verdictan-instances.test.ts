import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ManagedRuntimes } from '../electron/verdictan/runtime';
import { GatewayInstances } from '../electron/verdictan/instances';
import type { RuntimeProvision } from '../electron/verdictan/protocol';
import { fakeSupervisor, supervisorReplies } from './helpers/fake-supervisor';

const id = '11111111-1111-4111-8111-111111111111';
const agentA = '44444444-4444-4444-8444-444444444444';
const agentB = '55555555-5555-4555-8555-555555555555';
const apiOrigin = 'https://api.eu.verdictan.com';
const agent = { kind: 'codex' as const, version: '0.163.0-alpha.10.2' };

function fixture({ supported = true, idleMs = 0, inPlace = true } = {}) {
  const ports: Record<string, number> = { 'gw-a': 47011, 'gw-b': 47012 };
  const requests: { operation: string; parameters: any }[] = [];
  const provisioned = new Map<string, RuntimeProvision & { generation: number }>();
  const client: any = {
    request: async (operation: string, parameters: any) => {
      requests.push({ operation, parameters });
      if (operation === 'runtime.provision') {
        const runtimeId = randomUUID();
        provisioned.set(runtimeId, { ...parameters.parameters, generation: 1 });
        return {
          data: {
            runtime_id: runtimeId,
            status: 'provisioned',
            credentials_stored: true,
            generation: 1,
          },
        };
      }
      if (operation === 'runtime.renew') {
        const binding = provisioned.get(parameters.runtime_id)!;
        binding.generation++;
        return { data: { runtime_id: parameters.runtime_id, generation: binding.generation } };
      }
      return { data: { runtime_id: parameters.runtime_id, revoked: true } };
    },
    exportRuntime: async (runtimeId: string) => {
      const binding = provisioned.get(runtimeId)!;
      return {
        schema_version: 1,
        correlation_id: 'export',
        runtime_id: runtimeId,
        runtime_registration_id: runtimeId,
        session_id: binding.session_id,
        gateway_id: binding.gateway_id,
        agent_id: binding.agent_id,
        api_url: apiOrigin,
        expires_at: new Date(Date.now() + 600000).toISOString(),
        runtime_credential: 'vdt_' + 'r'.repeat(20),
        inference_credential: 'vdt_' + 'i'.repeat(20),
        generation: binding.generation,
      };
    },
  };
  const process = fakeSupervisor(
    supervisorReplies((gatewayId) => `http://127.0.0.1:${ports[gatewayId]}`),
  );
  const launch: any = supported
    ? process.launch
    : (...args: any[]) => {
        // An older runtime stops at once: it has no multi mode.
        const child = process.launch(...args);
        child.stdout.write = () => true;
        setImmediate(() => child.emit('close'));
        return child;
      };
  const instances = new GatewayInstances({
    client: async () => client,
    supervisor: { executable: async () => '/verdictan', launch },
    idleMs,
  });
  const gateways: any[] = [];
  const runtimes = new ManagedRuntimes({
    apiOrigin,
    client: async () => client,
    executable: async () => '/verdictan',
    instances,
    multi: () => true,
    inPlaceRenewal: () => inPlace,
    gateway: (options) => {
      const gateway: any = {
        options,
        credentials: options.credentials,
        readiness: async () => {},
        stop: async () => {},
        renewed: (next: any) => {
          gateway.credentials = next;
        },
        endpoint: () => options.instance?.address ?? 'http://127.0.0.1:1',
      };
      // Settles when the shared gateway stops this chat.
      gateway.stopped = new Promise((resolve) => (gateway.signal = resolve));
      // As the real gateway: a moved gateway stops the chat with its own code.
      options.instance?.subscribe((reason) => {
        gateway.lost = reason ?? 'stopped';
        if (reason === 'moved') options.lost?.(undefined, 'desktop.gateway_moved');
        else options.lost?.(reason);
        gateway.signal();
      });
      gateways.push(gateway);
      return gateway;
    },
  });
  const chat = (agentId: string, gatewayId: string, project = 'project-1'): RuntimeProvision => ({
    installation_id: id,
    host_id: id,
    session_id: randomUUID(),
    agent_id: agentId,
    gateway_id: gatewayId,
    project_id: project,
    provider: 'openai',
    model: 'gpt-5',
    provider_connection_id: id,
  });
  const sent = (operation: string, child = 0) =>
    process.children[child].requests.filter((r: any) => r.operation === operation);
  const provisions = () => requests.filter((r) => r.operation === 'runtime.provision').length;
  return { requests, runtimes, instances, gateways, process, chat, ports, sent, provisions };
}

test('the chats of one agent attach their own runtimes to one gateway', async () => {
  const f = fixture();
  const first = f.chat(agentA, 'gw-a', 'project-1');
  const second = f.chat(agentA, 'gw-a', 'project-2');
  await f.runtimes.start(first, agent, async () => {});
  await f.runtimes.start(second, agent, async () => {});
  // Only the two chat runtimes. The gateway has no runtime of its own.
  assert.equal(f.provisions(), 2);
  assert.equal(f.process.launches.length, 1);
  assert.equal(f.sent('gateway.attach').length, 1);
  assert.deepEqual(
    f.sent('runtime.attach').map((r: any) => r.gateway_id),
    ['gw-a', 'gw-a'],
  );
  // Both chats use the shared address with their own credential.
  assert.equal(f.runtimes.endpoint(first.session_id), 'http://127.0.0.1:47011');
  assert.equal(f.runtimes.endpoint(second.session_id), 'http://127.0.0.1:47011');
  assert.deepEqual(
    f.process.children[0].frames.map((frame: any) => frame.session_id),
    [first.session_id, second.session_id],
  );
  // Another agent gets its own gateway in the same supervisor.
  const other = f.chat(agentB, 'gw-b');
  await f.runtimes.start(other, agent, async () => {});
  assert.equal(f.instances.size(), 2);
  assert.equal(f.runtimes.endpoint(other.session_id), 'http://127.0.0.1:47012');
  // Each chat that ends detaches its runtime. The last one stops the gateway.
  await f.runtimes.release(first.session_id);
  assert.equal(f.sent('runtime.detach').length, 1);
  assert.equal(f.instances.size(), 2);
  await f.runtimes.release(second.session_id);
  await f.instances.idleStop('gw-a');
  assert.deepEqual(
    f.sent('gateway.detach').map((r: any) => r.gateway_id),
    ['gw-a'],
  );
  assert.equal(f.instances.size(), 1);
});

test('a revoked runtime stops its chat only', async () => {
  const f = fixture();
  const a = f.chat(agentA, 'gw-a');
  const b = f.chat(agentA, 'gw-a');
  await f.runtimes.start(a, agent, async () => {});
  await f.runtimes.start(b, agent, async () => {});
  const runtimeId = f.process.children[0].frames[0].runtime_id;
  f.process.children[0].send(
    'credential.revoked',
    { runtime_id: runtimeId, reason: 'runtime_revoked' },
    { gateway_id: 'gw-a', runtime_id: runtimeId, runtime_generation: 1 },
  );
  await f.gateways[0].stopped;
  assert.equal(f.gateways[0].lost, 'runtime_revoked');
  assert.equal(f.gateways[1].lost, undefined);
  assert.equal(f.instances.size(), 1);
});

test('a renewal is in place: the coding agent continues', async () => {
  const f = fixture();
  const stops: unknown[] = [];
  const a = f.chat(agentA, 'gw-a');
  await f.runtimes.start(a, agent, async (code) => {
    stops.push(code);
  });
  await f.runtimes.renew(a.session_id);
  const renewals = () =>
    f.requests.filter((r) => r.operation === 'runtime.renew').map((r) => r.parameters);
  assert.equal(renewals()[0].renewal, 'in_place');
  assert.equal('gateway_stopped' in renewals()[0], false);
  assert.equal(f.sent('credential.renew').length, 1);
  assert.equal(f.process.children[0].frames.at(-1).generation, 2);
  assert.equal(f.gateways[0].credentials.generation, 2);
  assert.deepEqual(stops, []);
  assert.equal(f.gateways.length, 1);
});

test('a runtime without the multi mode starts one process for each chat', async () => {
  const f = fixture({ supported: false });
  await f.runtimes.start(f.chat(agentA, 'gw-a'), agent, async () => {});
  assert.equal(f.gateways[0].options.instance, undefined);
  assert.equal(f.instances.supervisor.unsupported, true);
  await f.runtimes.start(f.chat(agentA, 'gw-a'), agent, async () => {});
  assert.equal(f.process.launches.length, 1);
  assert.equal(f.gateways[1].options.instance, undefined);
});

test('a crash attaches each gateway and runtime again on the same port', async () => {
  const f = fixture();
  const a = f.chat(agentA, 'gw-a');
  await f.runtimes.start(a, agent, async () => {});
  f.process.children[0].emit('close');
  await f.instances.settled();
  // A new process: the gateway, then the runtime with a new export. The chat continues.
  assert.equal(f.process.launches.length, 2);
  assert.equal(f.sent('gateway.attach', 1).length, 1);
  assert.equal(f.sent('runtime.attach', 1).length, 1);
  assert.equal(f.gateways[0].lost, undefined);
  assert.equal(f.provisions(), 1);
  // A second crash in one minute stops the chats. Check status allows a new start.
  f.process.children[1].emit('close');
  await f.instances.settled();
  assert.equal(f.gateways[0].lost, 'stopped');
  assert.equal(f.instances.supervisor.failed, true);
  f.runtimes.resetSupervisor();
  assert.equal(f.instances.supervisor.failed, false);
});

test('a restore on a new port stops the coding agents, and the next turn continues there', async () => {
  const f = fixture({ idleMs: 60000 });
  const stops: (string | undefined)[] = [];
  const a = f.chat(agentA, 'gw-a');
  await f.runtimes.start(a, agent, async (code) => {
    stops.push(code);
  });
  // The old port is not free after the crash. The supervisor gives a new one.
  f.ports['gw-a'] = 47020;
  f.process.children[0].emit('close');
  await f.instances.settled();
  // The coding agent stops with the reason. Its runtime is not attached again, and no
  // request is sent again.
  assert.deepEqual(stops, ['desktop.gateway_moved']);
  assert.equal(f.sent('runtime.attach', 1).length, 0);
  assert.equal(f.instances.size(), 1);
  // The next turn of the chat attaches its new runtime to the gateway on the new port.
  await f.runtimes.release(a.session_id);
  const next = f.chat(agentA, 'gw-a');
  await f.runtimes.start(next, agent, async () => {});
  assert.equal(f.runtimes.endpoint(next.session_id), 'http://127.0.0.1:47020');
  assert.equal(f.sent('gateway.attach', 1).length, 1);
  assert.equal(f.sent('runtime.attach', 1).length, 1);
  await f.runtimes.stopAll();
  assert.equal(f.instances.size(), 0);
});

test('a runtime without in-place renewal still confirms the stop', async () => {
  const f = fixture({ inPlace: false });
  const a = f.chat(agentA, 'gw-a');
  await f.runtimes.start(a, agent, async () => {});
  await f.runtimes.renew(a.session_id);
  const renewal = f.requests.find((r) => r.operation === 'runtime.renew')!.parameters;
  assert.equal(renewal.gateway_stopped, true);
  assert.equal('renewal' in renewal, false);
});
