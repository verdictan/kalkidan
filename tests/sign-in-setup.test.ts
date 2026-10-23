import test from 'node:test';
import assert from 'node:assert/strict';
import { SignInSetup } from '../electron/verdictan/sign-in-setup';
import { VerdictanAccountService } from '../electron/verdictan/account';
import { VerdictanLaunchService } from '../electron/verdictan/launch';
import { DesktopProtocolError, type DesktopClient } from '../electron/verdictan/protocol';
import type { VerdictanSetup } from '../src/domain/verdictan';

const id = '11111111-1111-4111-8111-111111111111';
const agentId = '33333333-3333-4333-8333-333333333333';
const origin = 'https://api.eu.verdictan.com';
const ready = (overrides: Partial<VerdictanSetup> = {}): VerdictanSetup => ({
  status: 'ready',
  teams: [{ team_id: id }],
  policies: [],
  providerConnections: [],
  selections: {},
  ...overrides,
});

/** A runner with fakes. `check` gives the setup check, `provision` the gateway result. */
function runner(options: {
  check?: () => Promise<VerdictanSetup>;
  provision?: () => Promise<{ status: 'created' | 'existing' | 'skipped' | 'failed' }>;
}) {
  const calls: string[] = [];
  const gateways: [string, unknown][] = [];
  const rejected: string[] = [];
  let changes = 0;
  const setup = new SignInSetup({
    check: async () => {
      calls.push('check');
      return options.check ? options.check() : ready({ bootstrapped: 'bootstrapped' });
    },
    provision: async () => {
      calls.push('provision');
      return options.provision ? options.provision() : { status: 'created' };
    },
    keepGateway: (key, gateway) => gateways.push([key, gateway]),
    sessionRejected: (code) => rejected.push(code),
    changed: () => changes++,
  });
  return { setup, calls, gateways, rejected, changes: () => changes };
}

test('the setup after sign-in runs once for each account: check, bootstrap, then the gateway', async () => {
  const f = runner({});
  await Promise.all([f.setup.run('account'), f.setup.run('account')]);
  await f.setup.run('account');
  assert.deepEqual(f.calls, ['check', 'provision']);
  assert.deepEqual(f.gateways, [['account', { status: 'created' }]]);
  assert.equal(f.changes(), 1);
  // Another account runs its own setup. Refresh runs it again: the gateway is the same one.
  await f.setup.run('other');
  await f.setup.run('account', true);
  assert.deepEqual(f.calls, ['check', 'provision', 'check', 'provision', 'check', 'provision']);
});

test('a running setup is pending, so Settings waits for its result', async () => {
  let finish!: () => void;
  const f = runner({
    check: () => new Promise((resolve) => (finish = () => resolve(ready()))),
  });
  const run = f.setup.run('account');
  assert.ok(f.setup.pending('account'));
  assert.equal(f.setup.pending('other'), undefined);
  finish();
  await run;
  assert.equal(f.setup.pending('account'), undefined);
});

test('an organization without an agent for this computer makes no gateway yet', async () => {
  for (const setup of [
    ready({ bootstrapReadiness: 'bootstrap_requires_admin' }),
    ready({ bootstrapIssue: 'team_required' }),
    ready({ bootstrapIssue: 'runtime_too_old' }),
  ]) {
    const f = runner({ check: async () => setup });
    await f.setup.run('account');
    assert.deepEqual(f.calls, ['check']);
    assert.deepEqual(f.gateways, [['account', { status: 'skipped' }]]);
  }
});

test('a refused session asks for a new sign-in, and the next sign-in runs the setup again', async () => {
  for (const code of [
    'desktop.auth_expired',
    'desktop.session_rejected',
    'desktop.identity_mismatch',
  ]) {
    const f = runner({
      check: async () => {
        throw new DesktopProtocolError(code);
      },
    });
    await f.setup.run('account');
    assert.deepEqual(f.rejected, [code]);
    assert.deepEqual(f.gateways, []);
    await f.setup.run('account');
    assert.deepEqual(f.calls, ['check', 'check']);
  }
});

test('another failure keeps its code for Settings', async () => {
  const f = runner({
    provision: async () => {
      throw new DesktopProtocolError('desktop.resource_conflict');
    },
  });
  await f.setup.run('account');
  assert.deepEqual(f.gateways, [
    ['account', { status: 'failed', code: 'desktop.resource_conflict' }],
  ]);
  assert.deepEqual(f.rejected, []);
});

/** A fake account client. `fail` gives the code for each operation that fails. */
function accountClient(fail: Record<string, string> = {}, expiresAt = '2026-10-21T00:00:00Z') {
  const state = { expiresAt };
  const client: DesktopClient = {
    request: async (operation) => {
      if (fail[operation]) throw new DesktopProtocolError(fail[operation]);
      if (operation === 'status')
        return {
          data: {
            state: 'authenticated',
            user_id: id,
            organization_id: id,
            expires_at: state.expiresAt,
            api_url: origin,
          },
        } as any;
      if (operation === 'capabilities')
        return {
          data: {
            cli_version: '0.6.14',
            protocol_min: 1,
            protocol_max: 1,
            capabilities: ['account.inspect'],
            managed_execution_ready: true,
            tested_agents: [],
          },
        } as any;
      return { data: { organization_id: id, user_id: id } } as any;
    },
    exportRuntime: async () => {
      throw new Error('unused');
    },
    close: () => {},
    onClose: () => () => true,
  };
  return { client, state };
}
function accountService(client: DesktopClient) {
  return new VerdictanAccountService({
    apiOrigin: origin,
    consoleOrigin: 'https://console.eu.verdictan.com',
    connect: async () => client,
    openBrowser: async () => {},
    now: () => Date.parse('2026-10-20T00:00:00Z'),
  });
}

test('a refused account read shows "Sign in again" with the code, also after a new check', async (t) => {
  const { client, state } = accountClient({ 'account.inspect': 'desktop.auth_expired' });
  const account = accountService(client);
  t.after(() => account.dispose());
  const status = await account.check();
  assert.equal(status.phase, 'expired');
  assert.equal(status.error, 'desktop.auth_expired');
  assert.equal(status.executionReady, false);
  // The same session stays refused.
  assert.equal((await account.check()).phase, 'expired');
  // A new session, for example after a new sign-in, counts again.
  state.expiresAt = '2026-10-21T01:00:00Z';
  (client as any).request = accountClient({}, state.expiresAt).client.request;
  assert.equal((await account.check()).phase, 'authenticated');
});

test('a refused session call marks a signed-in account', async (t) => {
  const { client } = accountClient({ 'setup.inspect': 'desktop.session_rejected' });
  const account = accountService(client);
  t.after(() => account.dispose());
  assert.equal((await account.check()).phase, 'authenticated');
  const runtime = await account.runtimeClient();
  await assert.rejects(runtime.request('setup.inspect'), { code: 'desktop.session_rejected' });
  assert.equal(account.status().phase, 'expired');
  assert.equal(account.status().error, 'desktop.session_rejected');
  // Other failures do not change the account.
  const other = accountService(accountClient({ 'setup.inspect': 'desktop.setup_invalid' }).client);
  t.after(() => other.dispose());
  await other.check();
  await assert.rejects((await other.runtimeClient()).request('setup.inspect'));
  assert.equal(other.status().phase, 'authenticated');
});

test('the gateway of this computer is made for the agent of this computer, without a chat', async () => {
  const requests: { operation: string; parameters?: any }[] = [];
  let status = 'created';
  const client = {
    request: async (operation: string, parameters: any) => {
      requests.push({ operation, parameters });
      const result = { ...parameters.parameters, status, gateway_id: 'gateway-1' };
      status = 'existing';
      return { data: result };
    },
  };
  const setup = ready({
    agents: [
      {
        agent_id: agentId,
        team_id: id,
        configuration_id: `cfg_${'a'.repeat(32)}`,
        configuration_version_id: `cfgv_${'b'.repeat(32)}`,
        default: true,
      },
    ],
  });
  const launch = new VerdictanLaunchService(
    null as any,
    { inspect: async () => ({ client, setup }) } as any,
    null as any,
    'local',
    async () => ({ installationId: id, hostId: id }),
  );
  launch.hostName = () => 'Studio Mac';
  assert.deepEqual(await launch.provisionComputer(), { status: 'created' });
  // A second run makes no second gateway: Verdictan returns the same one.
  assert.deepEqual(await launch.provisionComputer(), { status: 'existing' });
  assert.deepEqual(requests[0], {
    operation: 'resources.provision',
    parameters: {
      parameters: {
        installation_id: id,
        host_id: id,
        team_id: id,
        agent_id: agentId,
        host_name: 'Studio Mac',
      },
    },
  });
  // Without the agent choice, the first chat makes the gateway.
  const older = new VerdictanLaunchService(
    null as any,
    { inspect: async () => ({ client, setup: ready() }) } as any,
    null as any,
    'local',
    async () => ({ installationId: id, hostId: id }),
  );
  assert.deepEqual(await older.provisionComputer(), { status: 'skipped' });
  assert.equal(requests.length, 2);
});
