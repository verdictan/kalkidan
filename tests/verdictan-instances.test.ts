import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ManagedRuntimes } from '../electron/verdictan/runtime';
import { GatewayInstances } from '../electron/verdictan/instances';
import type { RuntimeProvision } from '../electron/verdictan/protocol';
import { attached, fakeSupervisor } from './helpers/fake-supervisor';

const id = '11111111-1111-4111-8111-111111111111';
const agentA = '44444444-4444-4444-8444-444444444444';
const agentB = '55555555-5555-4555-8555-555555555555';
const apiOrigin = 'https://api.eu.verdictan.com';
const agent = { kind: 'codex' as const, version: '0.163.0-alpha.10.2' };

function fixture(supported = true) {
  const requests: { operation: string; parameters: any }[] = [];
  const provisioned = new Map<string, RuntimeProvision>();
  const client: any = {
    request: async (operation: string, parameters: any) => {
      requests.push({ operation, parameters });
      if (operation === 'runtime.provision') {
        const runtimeId = randomUUID();
        provisioned.set(runtimeId, parameters.parameters);
        return {
          data: {
            runtime_id: runtimeId,
            status: 'provisioned',
            credentials_stored: true,
            generation: 1,
          },
        };
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
        generation: 1,
      };
    },
  };
  const process = fakeSupervisor((request, frame) =>
    request.operation === 'gateway.attach'
      ? attached(
          request,
          `http://127.0.0.1:${request.agent_id === agentA ? 47011 : 47012}`,
          frame.runtime_id,
        )
      : request.operation === 'gateway.detach'
        ? [['gateway.stopping', {}, { gateway_id: request.gateway_id }]]
        : [],
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
    apiOrigin,
    client: async () => client,
    supervisor: { executable: async () => '/verdictan', launch },
  });
  const gateways: any[] = [];
  const runtimes = new ManagedRuntimes({
    apiOrigin,
    client: async () => client,
    executable: async () => '/verdictan',
    instances,
    multi: () => true,
    gateway: (options) => {
      const gateway: any = {
        options,
        readiness: async () => {},
        stop: async () => {},
        endpoint: () => options.instance?.address ?? 'http://127.0.0.1:1',
      };
      options.instance?.subscribe((revocation) => {
        gateway.lost = revocation ?? 'stopped';
        options.lost?.(revocation);
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
  return { requests, provisioned, runtimes, instances, gateways, process, chat };
}

test('chats of one agent share one gateway instance with its own runtime', async () => {
  const f = fixture();
  const first = f.chat(agentA, 'gw-a', 'project-1');
  const second = f.chat(agentA, 'gw-a', 'project-2');
  await f.runtimes.start(first, agent, async () => {});
  await f.runtimes.start(second, agent, async () => {});
  // Two chat runtimes and one instance runtime, with its own session and no project.
  const provisions = f.requests.filter((r) => r.operation === 'runtime.provision');
  assert.equal(provisions.length, 3);
  const instance = provisions[1].parameters.parameters;
  assert.equal(instance.gateway_id, 'gw-a');
  assert.equal('project_id' in instance, false);
  assert.notEqual(instance.session_id, first.session_id);
  // One supervisor process and one attach. Both chats use the address of the instance.
  assert.equal(f.process.launches.length, 1);
  const attaches = f.process.children[0].requests.filter(
    (r: any) => r.operation === 'gateway.attach',
  );
  assert.equal(attaches.length, 1);
  assert.deepEqual(
    f.gateways.map((g) => g.options.instance?.address),
    ['http://127.0.0.1:47011', 'http://127.0.0.1:47011'],
  );
  assert.deepEqual(f.runtimes.endpoint(first.session_id), 'http://127.0.0.1:47011');

  // Another agent gets its own instance in the same supervisor.
  const other = f.chat(agentB, 'gw-b');
  await f.runtimes.start(other, agent, async () => {});
  assert.equal(f.process.launches.length, 1);
  assert.equal(f.instances.size(), 2);
  assert.equal(f.runtimes.endpoint(other.session_id), 'http://127.0.0.1:47012');

  // The instance stays while a chat uses it. The last chat detaches it and revokes its runtime.
  await f.runtimes.release(first.session_id);
  assert.equal(f.instances.size(), 2);
  await f.runtimes.release(second.session_id);
  assert.equal(f.instances.size(), 1);
  const detaches = f.process.children[0].requests.filter(
    (r: any) => r.operation === 'gateway.detach',
  );
  assert.deepEqual(
    detaches.map((r: any) => r.gateway_id),
    ['gw-a'],
  );
  const revoked = f.requests
    .filter((r) => r.operation === 'runtime.revoke')
    .map((r) => r.parameters.runtime_id);
  const instanceRuntime = [...f.provisioned].find(
    ([, b]) => b.session_id === instance.session_id,
  )![0];
  assert.ok(revoked.includes(instanceRuntime));
});

test('a revoked instance stops the chats of its agent only', async () => {
  const f = fixture();
  const a = f.chat(agentA, 'gw-a');
  const b = f.chat(agentB, 'gw-b');
  await f.runtimes.start(a, agent, async () => {});
  await f.runtimes.start(b, agent, async () => {});
  f.process.children[0].send(
    'credential.revoked',
    { runtime_id: id, reason: 'runtime_revoked' },
    {
      gateway_id: 'gw-a',
      runtime_generation: 1,
    },
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(f.gateways[0].lost, 'runtime_revoked');
  assert.equal(f.gateways[1].lost, undefined);
  assert.equal(f.instances.size(), 1);
});

test('a runtime without the multi mode starts one process for each chat', async () => {
  const f = fixture(false);
  const a = f.chat(agentA, 'gw-a');
  await f.runtimes.start(a, agent, async () => {});
  assert.equal(f.gateways[0].options.instance, undefined);
  assert.equal(f.instances.supervisor.unsupported, true);
  // Only the chat runtime. The supervisor does not start again.
  await f.runtimes.start(f.chat(agentA, 'gw-a'), agent, async () => {});
  assert.equal(f.process.launches.length, 1);
  assert.equal(f.gateways[1].options.instance, undefined);
});

test('a supervisor crash attaches each instance again, and a second crash stops the chats', async () => {
  const f = fixture();
  const a = f.chat(agentA, 'gw-a');
  await f.runtimes.start(a, agent, async () => {});
  f.process.children[0].emit('close');
  // A new process attaches the instance again with a new export. The chat keeps its address.
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(f.process.launches.length, 2);
  assert.equal(
    f.process.children[1].requests.filter((r: any) => r.operation === 'gateway.attach').length,
    1,
  );
  assert.equal(f.gateways[0].lost, undefined);
  assert.equal(f.instances.size(), 1);
  // A second crash in one minute stops the chats. Check status allows a new start.
  f.process.children[1].emit('close');
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(f.gateways[0].lost, 'stopped');
  assert.equal(f.instances.supervisor.failed, true);
  f.runtimes.resetSupervisor();
  assert.equal(f.instances.supervisor.failed, false);
});
