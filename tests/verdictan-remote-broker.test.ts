import test from 'node:test';
import assert from 'node:assert/strict';
import { RemoteAccountBroker, RemoteAccountClient } from '../electron/verdictan/remote-broker';
const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
function fixture(fallback = false) {
  const calls: { operation: string; parameters: any }[] = [];
  let key = 'account',
    afterProvision: (() => void) | undefined;
  const selection = {
    teamId: id,
    configurationId: fallback ? '' : id,
    configurationVersionId: fallback ? '' : id,
    providerConnectionId: id,
    model: 'model',
  };
  const client = {
    request: async (operation: string, parameters: any) => {
      calls.push({ operation, parameters });
      if (operation === 'runtime.provision') afterProvision?.();
      return { data: { agent_id: id, gateway_id: 'gateway', runtime_id: id, revoked: true } };
    },
    exportRuntime: async () => ({ runtime_id: id, inference_credential: 'synthetic' }),
  };
  const setup: any = {
    inspect: async () => ({
      client,
      key,
      account: { state: 'authenticated' },
      setup: {
        selections: { codex: selection },
        ...(fallback
          ? { defaultPolicy: { configuration_id: other, configuration_version_id: other } }
          : {}),
      },
    }),
    validate: () => {},
  };
  const bindings: any = {
    identities: async (host: string) => ({
      installationId: id,
      hostId: host === 'host' ? id : other,
    }),
  };
  const broker = new RemoteAccountBroker(setup, bindings);
  const resources = {
    parameters: {
      installation_id: id,
      host_id: id,
      team_id: id,
      configuration_id: id,
      configuration_version_id: id,
    },
  };
  const runtime = {
    parameters: {
      installation_id: id,
      host_id: id,
      session_id: other,
      agent_id: id,
      gateway_id: 'gateway',
      provider: 'openai' as const,
      provider_connection_id: id,
      model: 'model',
    },
  };
  return {
    broker,
    calls,
    resources,
    runtime,
    account: () => {
      key = 'different';
    },
    resetDuringProvision: () => {
      afterProvision = () => broker.reset();
    },
  };
}
test('SSH broker requires host-owned resources and never exposes account operations', async () => {
  const f = fixture();
  await assert.rejects(f.broker.request('host', 'runtime.provision', f.runtime), /scope_mismatch/);
  await assert.rejects(
    f.broker.request('other', 'resources.provision', f.resources),
    /scope_mismatch/,
  );
  await f.broker.request('host', 'resources.provision', f.resources);
  await f.broker.request('host', 'runtime.provision', f.runtime);
  await assert.rejects(
    f.broker.request('other', 'runtime.export', { runtime_id: id }),
    /scope_mismatch/,
  );
  await assert.rejects(
    f.broker.request('host', 'auth.start', { runtime_id: id }),
    /operation_unsupported/,
  );
  assert.deepEqual(await f.broker.request('host', 'runtime.export', { runtime_id: id }), {
    runtime_id: id,
    inference_credential: 'synthetic',
  });
  f.account();
  await assert.rejects(
    f.broker.request('host', 'runtime.export', { runtime_id: id }),
    /scope_mismatch/,
  );
});
test('SSH renewal requires stopped gateway and revocation drops ownership', async () => {
  const f = fixture();
  await f.broker.request('host', 'resources.provision', f.resources);
  await f.broker.request('host', 'runtime.provision', f.runtime);
  await assert.rejects(
    f.broker.request('host', 'runtime.renew', { runtime_id: id }),
    /gateway_must_stop/,
  );
  await f.broker.request('host', 'runtime.renew', { runtime_id: id, gateway_stopped: true });
  assert.equal(f.calls.filter((c) => c.operation === 'runtime.renew').length, 1);
  await f.broker.request('host', 'runtime.revoke', { runtime_id: id });
  await assert.rejects(
    f.broker.request('host', 'runtime.export', { runtime_id: id }),
    /scope_mismatch/,
  );
});
test('late SSH provisioning after logout revokes the issued runtime', async () => {
  const f = fixture();
  await f.broker.request('host', 'resources.provision', f.resources);
  f.resetDuringProvision();
  await assert.rejects(
    f.broker.request('host', 'runtime.provision', f.runtime),
    /transport_closed/,
  );
  assert.equal(f.calls.at(-1)?.operation, 'runtime.revoke');
});
test('reverse RPC correlates replies and expires all requests on transport loss', async () => {
  const frames: any[] = [];
  const client = new RemoteAccountClient((frame) => {
    frames.push(frame);
  });
  const first = client.query('status'),
    second = client.query('capabilities');
  client.receive({ event: 'managed-account-result', id: frames[1].id, result: { ok: 2 } });
  assert.deepEqual(await second, { ok: 2 });
  assert.equal(client.receive({ event: 'different' }), false);
  client.receive({ event: 'managed-account-result', id: 'stale', result: { ok: 9 } });
  const rejected = assert.rejects(first, /transport_closed/);
  client.close();
  await rejected;
  assert.equal(client.isClosed(), true);
  await assert.rejects(client.query('status'), /transport_closed/);
});

test('SSH broker provisions the default without policy IDs and never with one ID alone', async () => {
  const f = fixture(true);
  const { configuration_id, configuration_version_id, ...base } = f.resources.parameters;
  assert.ok(configuration_id && configuration_version_id);
  await f.broker.request('host', 'resources.provision', { parameters: base as any });
  const sent = f.calls.find((call) => call.operation === 'resources.provision')!;
  assert.equal('configuration_id' in sent.parameters.parameters, false);
  assert.equal('configuration_version_id' in sent.parameters.parameters, false);
  for (const half of [{ configuration_id }, { configuration_version_id }])
    await assert.rejects(
      f.broker.request('host', 'resources.provision', { parameters: { ...base, ...half } as any }),
      /scope_mismatch/,
    );
  // A picked policy cannot use the default selection, and the default needs a readable default.
  await assert.rejects(
    f.broker.request('host', 'resources.provision', f.resources),
    /scope_mismatch/,
  );
  const picked = fixture();
  await assert.rejects(
    picked.broker.request('host', 'resources.provision', { parameters: base as any }),
    /scope_mismatch/,
  );
});
