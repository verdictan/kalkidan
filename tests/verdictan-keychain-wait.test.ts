import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { resolve } from 'node:path';
import {
  DesktopProtocol,
  secureStorageTimeoutMs,
  type DesktopEvent,
} from '../electron/verdictan/protocol';
import { VerdictanAccountService, keychainHintMs } from '../electron/verdictan/account';
import { managedLaunchBlock, managedRefusal } from '../src/domain/verdictan';
import { agentErrorMessage, managedLaunchError } from '../src/lib/agent-errors';

/** A fake `verdictan auth desktop` process. `reply` answers a written request. */
function fixture() {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdio = [child.stdin, child.stdout, child.stderr, new PassThrough()];
  const requests: any[] = [];
  let kills = 0;
  child.stdin.write = (line: string) => {
    requests.push(JSON.parse(line));
  };
  child.stdin.destroy = () => {};
  child.kill = () => {
    kills++;
  };
  let sequence = 0;
  const client = new DesktopProtocol(
    resolve('fixture-verdictan'),
    [],
    (() => child) as any,
    30000,
    () => Date.parse('2026-10-20T00:00:00Z'),
  );
  return {
    client,
    child,
    requests,
    kills: () => kills,
    reply(event: string, data: any, index = requests.length - 1) {
      child.stdout.emit(
        'data',
        Buffer.from(
          JSON.stringify({
            schema_version: 1,
            correlation_id: requests[index].correlation_id,
            sequence: ++sequence,
            event,
            data,
          }) + '\n',
        ),
      );
    },
  };
}
const apiOrigin = 'https://api.verdictan.com';
const capabilities = {
  cli_version: '0.6.13',
  protocol_min: 1,
  protocol_max: 1,
  capabilities: ['authorization.browser.pkce', 'runtime.provision'],
  managed_execution_ready: true,
  tested_agents: [],
};
const signedIn = {
  state: 'authenticated',
  user_id: 'user',
  organization_id: 'org',
  expires_at: '2026-10-21T00:00:00Z',
  api_url: apiOrigin,
};
const waiting = { operation: 'write', elapsed_ms: 2000 };
const provision = { parameters: { provider_access_mode: 'byok' } } as any;
async function drain() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}
function account(connect: () => Promise<DesktopProtocol>, keychainPrompts = false) {
  let changes = 0;
  const service = new VerdictanAccountService({
    apiOrigin,
    consoleOrigin: 'https://console.verdictan.com',
    connect,
    openBrowser: async () => {},
    changed: () => changes++,
    now: () => Date.parse('2026-10-20T00:00:00Z'),
    keychainPrompts,
  });
  return { service, changes: () => changes };
}
/** Answers the status and capabilities requests of one account check. */
async function answerCheck(f: ReturnType<typeof fixture>, status: unknown = signedIn) {
  await drain();
  f.reply('account.status', status);
  await drain();
  f.reply('capabilities', capabilities);
  await drain();
}

test('a secure-storage wait keeps the request open past the normal time limit', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  t.after(() => f.client.close());
  const progress: DesktopEvent[] = [];
  let settled = false;
  const status = f.client.request('status', {}, (event) => progress.push(event));
  void status.finally(() => (settled = true)).catch(() => undefined);
  t.mock.timers.tick(2000);
  f.reply('secure_storage.waiting', waiting);
  assert.deepEqual(
    progress.map((event) => event.event),
    ['secure_storage.waiting'],
  );
  // The person answers the Keychain prompt after one minute. The request still waits.
  t.mock.timers.tick(60_000);
  await drain();
  assert.equal(settled, false);
  f.reply('account.status', signedIn);
  assert.equal((await status).data.state, 'authenticated');
  assert.equal(f.kills(), 0);
});

test('a keychain write waits up to the long bound without a waiting event', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  t.after(() => f.client.close());
  let settled = false;
  const request = f.client.request('runtime.provision', provision);
  void request.finally(() => (settled = true)).catch(() => undefined);
  t.mock.timers.tick(31_000);
  await drain();
  assert.equal(settled, false);
  t.mock.timers.tick(secureStorageTimeoutMs);
  await assert.rejects(request, { code: 'desktop.request_timeout' });
  // A timed-out request fails alone. The connection stays open.
  assert.equal(f.kills(), 0);
});

test('a late reply for a timed-out request does not break the connection', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  t.after(() => f.client.close());
  const slow = assert.rejects(f.client.request('status'), { code: 'desktop.request_timeout' });
  t.mock.timers.tick(30_000);
  await slow;
  // The CLI was slow, for example because of a Keychain prompt. Its reply comes late.
  f.reply('secure_storage.waiting', waiting, 0);
  f.reply('account.status', signedIn, 0);
  assert.equal(f.kills(), 0);
  const next = f.client.request('capabilities');
  f.reply('capabilities', capabilities, 1);
  assert.equal((await next).event, 'capabilities');
  // A frame for a correlation ID that the client never sent still stops the connection.
  const pending = assert.rejects(f.client.request('status'), { code: 'desktop.protocol_invalid' });
  f.child.stdout.emit(
    'data',
    Buffer.from(
      JSON.stringify({
        schema_version: 1,
        correlation_id: 'never-sent',
        sequence: 4,
        event: 'account.status',
        data: {},
      }) + '\n',
    ),
  );
  await pending;
  assert.equal(f.kills(), 1);
});

test('the account status tells the UI while a request waits for the keychain', async (t) => {
  const f = fixture();
  const { service, changes } = account(async () => f.client);
  t.after(() => service.dispose());
  const checked = service.check();
  await answerCheck(f);
  assert.equal((await checked).phase, 'authenticated');
  const client = await service.runtimeClient();
  const before = changes();
  const provisioned = client.request('runtime.provision', provision);
  await drain();
  assert.equal(service.status().keychainWaiting, undefined);
  f.reply('secure_storage.waiting', waiting);
  assert.equal(service.status().keychainWaiting, true);
  assert.equal(changes(), before + 1);
  f.reply('runtime.provisioning_result', { runtime_id: 'runtime' });
  await provisioned;
  await drain();
  assert.equal(service.status().keychainWaiting, undefined);
  assert.equal(changes(), before + 2);
});

test('a slow keychain write shows the wait also when the CLI sends no waiting event', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const prompts of [true, false]) {
    const f = fixture();
    const { service } = account(async () => f.client, prompts);
    const checked = service.check();
    await answerCheck(f);
    await checked;
    const client = await service.runtimeClient();
    const provisioned = client.request('runtime.provision', provision);
    await drain();
    t.mock.timers.tick(keychainHintMs);
    assert.equal(service.status().keychainWaiting, prompts || undefined);
    f.reply('runtime.provisioning_result', { runtime_id: 'runtime' });
    await provisioned;
    await drain();
    assert.equal(service.status().keychainWaiting, undefined);
    service.dispose();
  }
});

test('a sign-in ignores a keychain wait before its browser link', async (t) => {
  const f = fixture();
  const opened: string[] = [];
  const service = new VerdictanAccountService({
    apiOrigin,
    consoleOrigin: 'https://console.verdictan.com',
    connect: async () => f.client,
    openBrowser: async (url) => {
      opened.push(url);
    },
  });
  t.after(() => service.dispose());
  const login = service.authorize('login');
  await drain();
  f.reply('secure_storage.waiting', { operation: 'read', elapsed_ms: 2000 });
  f.reply('authorization.started', {
    authorization_url: 'https://console.verdictan.com/auth/cli?state=abc',
  });
  assert.equal(opened.length, 1);
  f.reply('authorization.completed', {});
  await answerCheck(f);
  assert.equal((await login).phase, 'authenticated');
  assert.equal(f.kills(), 0);
});

test('the account returns to signed in after a lost connection, without a restart', async (t) => {
  const connections = [fixture(), fixture()];
  let next = 0;
  const { service } = account(async () => connections[next++].client);
  t.after(() => service.dispose());
  const first = service.check();
  await answerCheck(connections[0]);
  assert.equal((await first).phase, 'authenticated');
  connections[0].child.emit('close', 1);
  assert.equal(service.status().phase, 'error');
  assert.equal(service.status().error, 'desktop.transport_lost');
  // A launch or a setup read checks the account again on a new connection first.
  const client = service.runtimeClient();
  await answerCheck(connections[1]);
  assert.equal(typeof (await client).request, 'function');
  assert.equal(service.status().phase, 'authenticated');
  assert.equal(service.status().error, undefined);
});

test('a failed recovery check gives the real reason, not a missing runtime', async (t) => {
  const connections = [fixture(), fixture()];
  let next = 0;
  const { service } = account(async () => connections[next++].client);
  t.after(() => service.dispose());
  const first = service.check();
  await answerCheck(connections[0]);
  await first;
  connections[0].child.emit('close', 1);
  const client = service.runtimeClient();
  await drain();
  connections[1].reply('error', { code: 'desktop.request_timeout' });
  await assert.rejects(client, { code: 'desktop.request_timeout' });
  assert.equal(service.status().phase, 'error');
});

test('a broken runtime connection asks to try again, not to install the runtime', () => {
  const block = managedLaunchBlock(new Error('x [desktop.protocol_invalid]'));
  assert.equal(block.step, 'status');
  assert.doesNotMatch(block.message, /install/i);
  assert.equal(managedRefusal('desktop.protocol_invalid').retry, true);
  const launch = managedLaunchError({ message: block.message, code: block.code });
  assert.doesNotMatch(launch.message, /install/i);
  assert.equal(launch.retryFirst, true);
  const error = agentErrorMessage(new Error('Stopped. [desktop.protocol_invalid]'), 'codex');
  assert.doesNotMatch(error.message, /install/i);
  assert.equal(error.action?.kind, 'retry');
});

const runtimeId = '22222222-2222-4222-8222-222222222222';
/** The protected credential frame of one export. Synthetic values only. */
function exported(correlation_id: string) {
  return {
    schema_version: 1,
    correlation_id,
    runtime_id: runtimeId,
    runtime_registration_id: runtimeId,
    session_id: runtimeId,
    agent_id: runtimeId,
    gateway_id: 'gateway',
    api_url: apiOrigin,
    generation: 1,
    expires_at: '2026-10-20T00:10:00Z',
    runtime_credential: 'vdt_' + 'a'.repeat(20),
    inference_credential: 'vdt_' + 'b'.repeat(20),
  };
}

test('the account status tells the UI while a runtime export waits for the keychain', async (t) => {
  const f = fixture();
  const { service } = account(async () => f.client);
  t.after(() => service.dispose());
  const checked = service.check();
  await answerCheck(f);
  await checked;
  const client = await service.runtimeClient();
  const result = client.exportRuntime(runtimeId);
  await drain();
  f.reply('secure_storage.waiting', { operation: 'read', elapsed_ms: 2000 });
  assert.equal(service.status().keychainWaiting, true);
  f.reply('runtime.exported', { runtime_id: runtimeId, credentials_exported: true });
  const frame = exported(f.requests.at(-1).correlation_id);
  f.child.stdio[3].write(Buffer.from(JSON.stringify(frame) + '\n'));
  assert.equal((await result).runtime_id, runtimeId);
  await drain();
  assert.equal(service.status().keychainWaiting, undefined);
});

test('a runtime with waiting events shows the wait only after the event', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture();
  const { service } = account(async () => f.client, true);
  t.after(() => service.dispose());
  const checked = service.check();
  await drain();
  f.reply('account.status', signedIn);
  await drain();
  f.reply('capabilities', { ...capabilities, cli_version: '0.6.14' });
  await drain();
  await checked;
  const client = await service.runtimeClient();
  const provisioned = client.request('runtime.provision', provision);
  await drain();
  // No guess after 5 s: this runtime tells when it waits.
  t.mock.timers.tick(keychainHintMs);
  assert.equal(service.status().keychainWaiting, undefined);
  f.reply('secure_storage.waiting', waiting);
  assert.equal(service.status().keychainWaiting, true);
  f.reply('runtime.provisioning_result', { runtime_id: 'runtime' });
  await provisioned;
  await drain();
  assert.equal(service.status().keychainWaiting, undefined);
});
