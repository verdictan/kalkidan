import test from 'node:test';
import assert from 'node:assert/strict';
import { ManagedRuntimes } from '../electron/verdictan/runtime';
import type { RuntimeProvision } from '../electron/verdictan/protocol';
const id = '11111111-1111-4111-8111-111111111111';
const agent = { kind: 'codex' as const, version: '0.163.0-alpha.10.2' };
const binding: RuntimeProvision = {
  installation_id: id,
  host_id: id,
  session_id: id,
  agent_id: id,
  gateway_id: 'gateway',
  provider: 'openai',
  model: 'model',
  provider_connection_id: id,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
async function drain() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}
function fixture(revoked: string[] = []) {
  const calls: string[] = [];
  const requests: any[] = [];
  const gateways: any[] = [];
  let failure: string | undefined;
  let generation = 3;
  let provisioning: Promise<unknown> | undefined;
  let framePatch = {};
  let pages: any[] = [];
  const client: any = {
    async request(operation: string, parameters: any) {
      calls.push(operation);
      requests.push({ operation, parameters });
      if (failure === operation) throw Error('desktop.transport_lost');
      if (operation === 'capabilities')
        return {
          data: {
            cli_version: '0.2.1',
            protocol_min: 1,
            protocol_max: 1,
            capabilities: [],
            managed_execution_ready: false,
            tested_agents: [agent],
          },
        };
      if (operation === 'runtime.provision' && provisioning) return { data: await provisioning };
      if (operation === 'hosts.inspect') return { data: pages.shift() };
      if (operation === 'runtime.renew') generation++;
      if (operation === 'host.revoke') return { data: { ...parameters, revoked: true } };
      return {
        data: {
          runtime_id: id,
          generation,
          status: 'provisioned',
          credentials_stored: true,
          revoked: true,
        },
      };
    },
    async exportRuntime() {
      calls.push('export');
      return {
        runtime_id: id,
        session_id: id,
        agent_id: id,
        gateway_id: 'gateway',
        api_url: 'https://api.verdictan.com',
        generation,
        ...framePatch,
      };
    },
  };
  const owner = new ManagedRuntimes({
    apiOrigin: 'https://api.verdictan.com',
    client: async () => client,
    executable: async () => '/fixture/verdictan',
    revoked: (reason) => revoked.push(reason),
    gateway(options) {
      const gateway: any = {
        async readiness() {
          calls.push('readiness');
          if (failure === 'readiness') throw Error('desktop.readiness_failed');
        },
        async nativeRoute() {
          calls.push('route');
          if (failure === 'route') throw Error('desktop.readiness_failed');
          return { args: [], env: {} };
        },
        async stop() {
          calls.push('stop-gateway');
        },
        lost: options.lost,
      };
      calls.push('start-gateway');
      gateways.push(gateway);
      return gateway;
    },
  });
  return {
    owner,
    calls,
    requests,
    gateways,
    start: () =>
      owner.start(binding, agent, async () => {
        calls.push('stop-agent');
      }),
    fail: (operation?: string) => {
      failure = operation;
    },
    provision: (value: Promise<unknown>) => {
      provisioning = value;
    },
    frame: (value: object) => {
      framePatch = value;
    },
    pages: (value: any[]) => {
      pages = value;
    },
  };
}
test('runtime owns provisioning, readiness, rotation and revocation in order', async () => {
  const f = fixture();
  await f.start();
  assert.equal(f.owner.status()[0].phase, 'ready');
  assert.equal(f.owner.busy(), true);
  // No capabilities request: Verdictan's tested versions do not gate a start.
  assert.deepEqual(f.calls, ['runtime.provision', 'export', 'start-gateway', 'readiness']);
  await f.owner.route(id, {
    projectId: 'project',
    taskId: 'task',
    conversationId: 'conversation',
    runId: 'run',
    turnId: 'turn',
  });
  await f.owner.renew(id);
  const renewal = f.calls.indexOf('runtime.renew');
  assert.ok(f.calls.indexOf('stop-agent') < renewal);
  assert.ok(f.calls.indexOf('stop-gateway') < renewal);
  assert.equal(
    f.requests.find((r) => r.operation === 'runtime.renew').parameters.gateway_stopped,
    true,
  );
  await f.owner.revoke(id);
  assert.equal(f.owner.status()[0].phase, 'revoked');
  await assert.rejects(
    f.owner.route(id, { projectId: '', taskId: '', conversationId: '', runId: '', turnId: '' }),
    /unavailable/,
  );
});
test('versions below the minimum cannot provision; wrong protected bindings cannot start a gateway', async () => {
  const f = fixture();
  await assert.rejects(
    f.owner.start(binding, { ...agent, version: '0.1.0' }, async () => {}),
    /version_unsupported/,
  );
  assert.equal(f.calls.includes('runtime.provision'), false);
  for (const patch of [
    { session_id: 'foreign' },
    { agent_id: 'foreign' },
    { api_url: 'https://foreign.test' },
  ]) {
    const next = fixture();
    next.frame(patch);
    await assert.rejects(next.start(), /binding_mismatch/);
    assert.equal(next.calls.includes('start-gateway'), false);
    await next.owner.revoke(id);
    assert.equal(next.owner.status()[0].phase, 'revoked');
  }
});
test('lost renewal requires reconciliation and cannot be retried or dispatch', async () => {
  const f = fixture();
  await f.start();
  f.fail('runtime.renew');
  await assert.rejects(f.owner.renew(id), /transport_lost/);
  assert.equal(f.owner.status()[0].phase, 'reconciliation-required');
  await assert.rejects(f.owner.renew(id), /reconciliation_required/);
  assert.equal(f.calls.filter((call) => call === 'runtime.renew').length, 1);
  f.fail();
  await f.owner.revoke(id);
  assert.equal(f.owner.status()[0].phase, 'revoked');
});
test('revocation failure stays unconfirmed and permits only explicit retry', async () => {
  const f = fixture();
  await f.start();
  f.fail('runtime.revoke');
  await assert.rejects(f.owner.revoke(id), /transport_lost/);
  assert.equal(f.owner.status()[0].phase, 'revocation-pending');
  f.fail();
  await f.owner.revoke(id);
  assert.equal(f.owner.status()[0].phase, 'revoked');
});
test('shutdown invalidates in-flight provisioning and prevents late supervisor startup', async () => {
  const f = fixture();
  const provision = deferred<unknown>();
  f.provision(provision.promise);
  const start = f.start();
  await drain();
  await assert.rejects(f.start(), /operation_in_progress/);
  await f.owner.stopAll();
  provision.resolve({
    runtime_id: id,
    generation: 3,
    status: 'provisioned',
    credentials_stored: true,
  });
  await assert.rejects(start, /runtime_stopped/);
  assert.equal(f.calls.includes('start-gateway'), false);
});
test('provisioning reconciliation never exports an unrecoverable credential', async () => {
  const f = fixture();
  f.provision(Promise.resolve({ runtime_id: id, status: 'reconciliation_required' }));
  await assert.rejects(f.start(), /reconciliation_required/);
  assert.equal(f.owner.status()[0].phase, 'reconciliation-required');
  assert.equal(f.calls.includes('export'), false);
  await f.owner.revoke(id);
});
test('gateway loss stops its native agent and clears readiness', async () => {
  const f = fixture();
  await f.start();
  f.gateways[0].lost();
  await drain();
  assert.equal(f.owner.status()[0].phase, 'failed');
  assert.ok(f.calls.includes('stop-agent'));
  await f.owner.revoke(id);
});
test('a revoked runtime stops its agent, keeps the revoked phase and reports the reason', async () => {
  const revoked: string[] = [];
  const f = fixture(revoked);
  await f.start();
  f.gateways[0].lost('runtime_revoked');
  await drain();
  assert.equal(f.owner.status()[0].phase, 'revoked');
  assert.ok(f.calls.includes('stop-agent'));
  assert.deepEqual(revoked, ['runtime_revoked']);
  assert.equal(f.owner.busy(), false);
});
test('a revoked host blocks new runtimes on the same host identity', async () => {
  const revoked: string[] = [];
  const f = fixture(revoked);
  await f.start();
  f.gateways[0].lost('host_revoked');
  await drain();
  assert.deepEqual(revoked, ['host_revoked']);
  await f.owner.release(id);
  await assert.rejects(f.start(), /host_revoked/);
});
test('the offline limit fails the runtime without a revocation', async () => {
  const revoked: string[] = [];
  const f = fixture(revoked);
  await f.start();
  f.gateways[0].lost('offline_limit');
  await drain();
  assert.equal(f.owner.status()[0].phase, 'failed');
  assert.deepEqual(revoked, ['offline_limit']);
  await f.owner.revoke(id);
});
test('host inventory follows opaque cursors and rejects repeated or missing cursors', async () => {
  const f = fixture();
  f.pages([
    { hosts: [{ host_id: id }], has_more: true, next_cursor: 'opaque' },
    { hosts: [], has_more: false, next_cursor: null },
  ]);
  assert.equal((await f.owner.hosts()).length, 1);
  assert.deepEqual(f.requests[1].parameters, { cursor: 'opaque' });
  for (const next_cursor of [undefined, '', 'opaque']) {
    const next = fixture();
    next.pages([
      { hosts: [], has_more: true, next_cursor: 'opaque' },
      { hosts: [], has_more: true, next_cursor },
    ]);
    await assert.rejects(next.owner.hosts(), /invalid_host_inventory/);
  }
});
test('host revocation stops owned gateways and cannot silently restore a revoked host', async () => {
  const f = fixture();
  await f.start();
  await f.owner.revokeHost(id, id);
  assert.ok(f.calls.indexOf('stop-gateway') < f.calls.indexOf('host.revoke'));
  assert.equal(f.owner.status()[0].phase, 'revoked');
  await assert.rejects(
    f.owner.start(
      { ...binding, session_id: '22222222-2222-4222-8222-222222222222' },
      agent,
      async () => {},
    ),
    /host_revoked/,
  );
});

test('stale rotated credentials cannot restart a gateway', async () => {
  const f = fixture();
  await f.start();
  f.frame({ generation: 3 });
  await assert.rejects(f.owner.renew(id), /binding_mismatch/);
  assert.equal(f.owner.status()[0].phase, 'reconciliation-required');
  assert.equal(f.calls.filter((call) => call === 'start-gateway').length, 1);
  await f.owner.stopAll();
  assert.equal(f.owner.status()[0].phase, 'reconciliation-required');
  await assert.rejects(f.owner.renew(id), /reconciliation_required/);
});

test('a failed turn preflight stops both owners and removes ready state', async () => {
  const f = fixture();
  await f.start();
  f.fail('route');
  await assert.rejects(
    f.owner.route(id, {
      projectId: 'project',
      taskId: 'task',
      conversationId: 'conversation',
      runId: 'run',
      turnId: 'turn',
    }),
    /readiness_failed/,
  );
  assert.equal(f.owner.status()[0].phase, 'failed');
  assert.ok(f.calls.includes('stop-agent'));
  assert.ok(f.calls.includes('stop-gateway'));
});

test('application shutdown cannot make a revoked runtime renewable', async () => {
  const f = fixture();
  await f.start();
  await f.owner.revoke(id);
  await f.owner.stopAll();
  assert.equal(f.owner.status()[0].phase, 'revoked');
  await assert.rejects(f.owner.renew(id), /reconciliation_required/);
});

test('runtime start refuses an agent below the Kalkidan minimum before any provision', async () => {
  for (const [kind, version, code] of [
    ['codex', '0.159.9', 'desktop.codex_version_unsupported'],
    ['claude_code', '2.1.299', 'desktop.claude_code_version_unsupported'],
    ['claude_code', 'latest', 'desktop.claude_code_version_unknown'],
  ] as const) {
    const f = fixture();
    await assert.rejects(
      f.owner.start(binding, { kind, version }, async () => {}),
      (error: any) => error.code === code,
    );
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.owner.status(), []);
  }
});
