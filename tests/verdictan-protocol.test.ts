import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { resolve } from 'node:path';
import { DesktopProtocol } from '../electron/verdictan/protocol';
import {
  VerdictanAccountService,
  parseAccount,
  parseCapabilities,
  sessionCapabilities,
} from '../electron/verdictan/account';

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
const capabilities = {
  cli_version: '0.2.1',
  protocol_min: 1,
  protocol_max: 1,
  capabilities: ['authorization.browser.pkce'],
  managed_execution_ready: false,
  tested_agents: [],
};
const signedOut = {
  state: 'signed_out',
  user_id: null,
  organization_id: null,
  expires_at: null,
  api_url: 'https://api.verdictan.com',
};
async function drain() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}
test('desktop protocol correlates interleaved requests and never projects upstream error text', async (t) => {
  const f = fixture();
  t.after(() => f.client.close());
  const first = f.client.request('status');
  const second = f.client.request('capabilities');
  f.reply('capabilities', capabilities, 1);
  f.reply('account.status', signedOut, 0);
  assert.equal((await second).event, 'capabilities');
  assert.equal((await first).data.state, 'signed_out');
  const failed = f.client.request('session.renew');
  const rejection = assert.rejects(failed, { code: 'desktop.auth_expired' });
  f.reply('error', { code: 'desktop.auth_expired', message: 'private upstream diagnostic' });
  await rejection;
});
test('malformed, secret-bearing, stale and oversized frames terminate all pending operations', async () => {
  for (const frame of [
    'bad json\n',
    JSON.stringify({
      schema_version: 1,
      sequence: 2,
      correlation_id: 'stale',
      event: 'account.status',
      data: {},
    }) + '\n',
    'x'.repeat(262145),
  ]) {
    const f = fixture();
    const result = assert.rejects(
      f.client.request('status'),
      /desktop\.(protocol_invalid|frame_too_large)/,
    );
    f.child.stdout.emit('data', Buffer.from(frame));
    await result;
    assert.equal(f.kills(), 1);
    await assert.rejects(f.client.request('status'), /transport_closed/);
  }
  const f = fixture();
  const pending = assert.rejects(f.client.request('status'), /protocol_invalid/);
  f.reply('account.status', { nested: { api_token: 'never expose' } });
  await pending;
});
test('authorization streams progress before completion and cancellation has its own request', async (t) => {
  const f = fixture();
  t.after(() => f.client.close());
  const progress: any[] = [];
  const started = f.client.request('authorization.start', { intent: 'register' }, (event) =>
    progress.push(event.data),
  );
  assert.equal(f.requests[0].intent, 'register');
  f.reply(
    'authorization.started',
    { authorization_url: 'https://console.verdictan.com/auth/cli' },
    0,
  );
  assert.equal(progress.length, 1);
  const cancel = f.client.request('authorization.cancel');
  f.reply('authorization.canceled', {}, 0);
  f.reply('authorization.cancel_completed', {}, 1);
  await Promise.all([started, cancel]);
});
test('profile owner coalesces checks, retains unready capabilities and opens only the approved browser origin', async (t) => {
  const f = fixture();
  const opened: string[] = [];
  const account = new VerdictanAccountService({
    apiOrigin: 'https://api.verdictan.com',
    consoleOrigin: 'https://console.verdictan.com',
    connect: async () => f.client,
    openBrowser: async (url) => {
      opened.push(url);
    },
  });
  t.after(() => account.dispose());
  const checked = account.check();
  assert.equal(account.check(), checked);
  await assert.rejects(account.authorize('login'), /operation_in_progress/);
  await drain();
  f.reply('account.status', signedOut);
  await drain();
  f.reply('capabilities', capabilities);
  assert.equal((await checked).phase, 'signed-out');
  assert.equal(account.status().executionReady, false);
  const login = account.authorize('login');
  await drain();
  f.reply('authorization.started', {
    authorization_url: 'https://console.verdictan.com/auth/cli?state=abc',
    expires_in_seconds: 300,
  });
  assert.equal(opened.length, 1);
  f.reply('authorization.completed', {});
  await drain();
  f.reply('account.status', {
    ...signedOut,
    state: 'authenticated',
    user_id: 'user',
    organization_id: 'org',
    expires_at: '2026-10-21T00:00:00Z',
  });
  await drain();
  f.reply('capabilities', capabilities);
  const status = await login;
  assert.equal(status.phase, 'authenticated');
  assert.equal(status.executionReady, false);
  const logout = account.logout();
  await drain();
  f.reply('session.logged_out', { remote_revoked: false, execution_blocked: true });
  await drain();
  f.reply('capabilities', capabilities);
  assert.equal((await logout).remoteRevocationPending, true);
  assert.equal(account.status().account, undefined);
});
test('a launch waits for a running status check and refuses during sign-in', async (t) => {
  const f = fixture();
  const account = new VerdictanAccountService({
    apiOrigin: 'https://api.verdictan.com',
    consoleOrigin: 'https://console.verdictan.com',
    connect: async () => f.client,
    openBrowser: async () => {},
  });
  t.after(() => account.dispose());
  const checked = account.check();
  let launched = false;
  const client = account.runtimeClient().then((value) => {
    launched = true;
    return value;
  });
  await drain();
  assert.equal(launched, false);
  f.reply('account.status', signedOut);
  await drain();
  f.reply('capabilities', capabilities);
  await checked;
  assert.equal(await client, f.client);
  void account.authorize('login').catch(() => undefined);
  await assert.rejects(account.runtimeClient(), /operation_in_progress/);
});
test('account checks reject wrong identity origins and authorization rejects off-origin links', async (t) => {
  assert.throws(() =>
    parseAccount({ ...signedOut, api_url: 'https://other.test' }, signedOut.api_url),
  );
  assert.throws(() => parseAccount({ ...signedOut, state: 'authenticated' }, signedOut.api_url));
  assert.throws(() => parseCapabilities({ ...capabilities, protocol_min: 2 }));
  assert.throws(() =>
    parseCapabilities({ ...capabilities, tested_agents: [{ agent: 'unknown' }] }),
  );
  const f = fixture();
  const account = new VerdictanAccountService({
    apiOrigin: signedOut.api_url,
    consoleOrigin: 'https://console.verdictan.com',
    connect: async () => f.client,
    openBrowser: async () => {
      throw Error('Must not open');
    },
  });
  t.after(() => account.dispose());
  const login = account.authorize('register');
  await drain();
  f.reply('authorization.started', { authorization_url: 'https://evil.test/auth/cli' });
  assert.equal((await login).error, 'desktop.protocol_invalid');
  assert.equal(f.kills(), 1);
});
test('account owner invalidates idle state when the CLI exits and discards a late connection after reset', async (t) => {
  const f = fixture();
  let resolve!: (client: DesktopProtocol) => void;
  const account = new VerdictanAccountService({
    apiOrigin: signedOut.api_url,
    consoleOrigin: 'https://console.verdictan.com',
    connect: () =>
      new Promise((done) => {
        resolve = done;
      }),
    openBrowser: async () => {},
  });
  t.after(() => account.dispose());
  const checking = account.check();
  account.reset();
  resolve(f.client);
  assert.equal((await checking).phase, 'missing');
  assert.equal(f.kills(), 1);
  assert.equal(f.requests.length, 0);
  const second = fixture();
  const ready = account.check();
  resolve(second.client);
  await drain();
  second.reply('account.status', signedOut);
  await drain();
  second.reply('capabilities', capabilities);
  assert.equal((await ready).phase, 'signed-out');
  second.child.emit('close', 1);
  assert.equal(account.status().phase, 'error');
  assert.equal(account.status().executionReady, false);
});

test('session capabilities come from the account profile and refresh after each account change', async (t) => {
  const f = fixture();
  const account = new VerdictanAccountService({
    apiOrigin: signedOut.api_url,
    consoleOrigin: 'https://console.verdictan.com',
    connect: async () => f.client,
    openBrowser: async () => {},
  });
  t.after(() => account.dispose());
  const project = ['project.permissions', 'review.decide', 'context.search'];
  const signedIn = {
    ...signedOut,
    state: 'authenticated',
    user_id: 'user',
    organization_id: 'org',
    expires_at: '2026-10-21T00:00:00Z',
  };
  const advertised = { ...capabilities, capabilities: [...project, 'session.renew'] };
  const names = () => account.status().capabilities?.capabilities;
  // A signed-out profile is never authoritative for session operations.
  const checked = account.check();
  await drain();
  f.reply('account.status', signedOut);
  await drain();
  f.reply('capabilities', advertised);
  await checked;
  assert.deepEqual(names(), ['session.renew']);
  // Sign-in reads the capabilities again from the same account profile.
  const login = account.authorize('login');
  await drain();
  f.reply('authorization.completed', {});
  await drain();
  f.reply('account.status', signedIn);
  await drain();
  assert.equal(f.requests.at(-1).operation, 'capabilities');
  f.reply('capabilities', advertised);
  assert.equal((await login).phase, 'authenticated');
  assert.deepEqual(names(), advertised.capabilities);
  // Renewal reads them again. An expired account loses session operations.
  const renew = account.renew();
  await drain();
  f.reply('session.renewed', {});
  await drain();
  f.reply('account.status', { ...signedIn, state: 'expired' });
  await drain();
  f.reply('capabilities', advertised);
  await renew;
  assert.deepEqual(names(), ['session.renew']);
  const again = account.check();
  await drain();
  f.reply('account.status', signedIn);
  await drain();
  f.reply('capabilities', advertised);
  await again;
  assert.deepEqual(names(), advertised.capabilities);
  // Sign-out drops session operations before the next read. A failed read leaves none.
  const logout = account.logout();
  await drain();
  f.reply('session.logged_out', { remote_revoked: false, execution_blocked: true });
  await drain();
  assert.equal(account.status().capabilities, undefined);
  f.reply('error', { code: 'desktop.operation_failed' });
  const status = await logout;
  assert.equal(status.phase, 'signed-out');
  assert.equal(status.remoteRevocationPending, true);
  assert.equal(status.capabilities, undefined);
});
test('a failed capability read after sign-in fails closed', async (t) => {
  const f = fixture();
  const account = new VerdictanAccountService({
    apiOrigin: signedOut.api_url,
    consoleOrigin: 'https://console.verdictan.com',
    connect: async () => f.client,
    openBrowser: async () => {},
  });
  t.after(() => account.dispose());
  const login = account.authorize('login');
  await drain();
  f.reply('authorization.completed', {});
  await drain();
  f.reply('account.status', {
    ...signedOut,
    state: 'authenticated',
    user_id: 'user',
    organization_id: 'org',
    expires_at: '2026-10-21T00:00:00Z',
  });
  await drain();
  f.reply('capabilities', { ...capabilities, capabilities: 'project.permissions' });
  const status = await login;
  assert.equal(status.phase, 'error');
  assert.equal(status.error, 'desktop.capabilities_invalid');
  assert.equal(status.capabilities, undefined);
});
test('sessionCapabilities keeps static operations for every account state', () => {
  const value = parseCapabilities({
    ...capabilities,
    capabilities: ['project.permissions', 'operation.inspect', 'history.list', 'setup.inspect'],
  });
  for (const state of ['signed-out', 'authorizing', 'expired'] as const)
    assert.deepEqual(
      sessionCapabilities(value, { state, apiUrl: signedOut.api_url }).capabilities,
      ['setup.inspect'],
    );
  assert.deepEqual(sessionCapabilities(value).capabilities, ['setup.inspect']);
  assert.equal(
    sessionCapabilities(value, { state: 'authenticated', apiUrl: signedOut.api_url }),
    value,
  );
});

test('capabilities accept the real supported-agent registry and reject the old invented shape', () => {
  const tested_agents = [
    { kind: 'codex', version: '0.163.0-alpha.10.2' },
    { kind: 'claude_code', version: '2.1.304' },
  ];
  assert.deepEqual(
    parseCapabilities({ ...capabilities, tested_agents }).testedAgents,
    tested_agents,
  );
  assert.equal(parseCapabilities({ ...capabilities, tested_agents }).managedExecutionReady, false);
  for (const entry of [
    { agent: 'claude', version: '2.1.304', modes: [] },
    { kind: 'other', version: '1.0.0' },
    { kind: 'codex', version: '' },
  ])
    assert.throws(
      () => parseCapabilities({ ...capabilities, tested_agents: [entry] }),
      /capabilities_invalid/,
    );
});

const runtimeId = '11111111-1111-4111-8111-111111111111';
function secretFrame(correlation_id: string) {
  return {
    schema_version: 1,
    correlation_id,
    runtime_id: runtimeId,
    runtime_registration_id: runtimeId,
    session_id: runtimeId,
    agent_id: runtimeId,
    gateway_id: 'gateway',
    api_url: 'https://api.verdictan.com',
    generation: 1,
    expires_at: '2026-10-20T00:10:00Z',
    runtime_credential: 'vdt_' + 'a'.repeat(20),
    inference_credential: 'vdt_' + 'b'.repeat(20),
  };
}
test('protected export accepts either pipe ordering and keeps secrets off stdout', async () => {
  for (const publicFirst of [true, false]) {
    const f = fixture();
    const result = f.client.exportRuntime(runtimeId);
    const frame = secretFrame(f.requests[0].correlation_id);
    const confirm = () =>
      f.reply('runtime.exported', { runtime_id: runtimeId, credentials_exported: true });
    if (publicFirst) confirm();
    const bytes = Buffer.from(JSON.stringify(frame) + '\n');
    f.child.stdio[3].write(bytes.subarray(0, 30));
    f.child.stdio[3].write(bytes.subarray(30));
    if (!publicFirst) confirm();
    assert.deepEqual(await result, frame);
    assert.equal(JSON.stringify(f.requests).includes(frame.runtime_credential), false);
    f.client.close();
  }
});
test('protected export rejects wrong scope, correlation, oversized frames, expiry and duplicate frames', async () => {
  for (const mode of ['scope', 'correlation', 'oversize', 'expiry', 'duplicate', 'stdout']) {
    const f = fixture();
    const result = assert.rejects(f.client.exportRuntime(runtimeId), /protocol_invalid/);
    const frame = secretFrame(f.requests[0].correlation_id);
    if (mode === 'scope') frame.runtime_id = '22222222-2222-4222-8222-222222222222';
    if (mode === 'correlation') frame.correlation_id = 'wrong';
    if (mode === 'expiry') frame.expires_at = '2000-01-01T00:00:00Z';
    const bytes = JSON.stringify(frame) + '\n';
    if (mode === 'stdout') f.reply('runtime.exported', frame);
    else
      f.child.stdio[3].write(
        mode === 'oversize' ? 'x'.repeat(8193) : mode === 'duplicate' ? bytes + bytes : bytes,
      );
    await result;
    assert.equal(f.kills(), 1);
  }
});
test('runtime and host operations preserve command parameters and correlate their response events', async () => {
  const commands = [
    ['runtime.provision', { parameters: { session_id: runtimeId } }, 'runtime.provisioning_result'],
    ['runtime.renew', { runtime_id: runtimeId, gateway_stopped: true }, 'runtime.renewed'],
    ['runtime.revoke', { runtime_id: runtimeId }, 'runtime.revoked'],
    ['hosts.inspect', { cursor: 'page2' }, 'hosts.inspected'],
    ['host.revoke', { installation_id: runtimeId, host_id: runtimeId }, 'host.revoked'],
    ['resources.provision', { parameters: { team_id: runtimeId } }, 'resources.provisioned'],
    ['review.inspect', { escalation_id: runtimeId }, 'review.inspected'],
    ['setup.ensure_default', {}, 'setup.default_ensured'],
    ['setup.bootstrap', { parameters: { team_id: runtimeId } }, 'setup.bootstrapped'],
    [
      'resources.provision',
      { parameters: { team_id: runtimeId, agent_id: runtimeId } },
      'resources.provisioned',
    ],
    [
      'history.list',
      { history_scope: { organization_id: 'org', conversation_id: 'chat-1' }, limit: 25 },
      'history.list_result',
    ],
  ] as const;
  for (const [operation, parameters, event] of commands) {
    const f = fixture();
    const result = f.client.request(operation, parameters as any);
    for (const [key, value] of Object.entries(parameters))
      assert.deepEqual(f.requests[0][key], value);
    f.reply(event, {});
    assert.equal((await result).event, event);
    f.client.close();
  }
});

test('project operations use top-level fields and cannot override the protocol envelope', async (t) => {
  const f = fixture();
  t.after(() => f.client.close());
  const scope = { organization_id: 'org', project_id: 'project' };
  const pending = f.client.request('review.list', {
    project_scope: scope,
    fields: { task_id: 'task', cursor: 'page-2' },
  });
  assert.equal(f.requests[0].task_id, 'task');
  assert.equal(f.requests[0].cursor, 'page-2');
  assert.equal(f.requests[0].fields, undefined);
  assert.deepEqual(f.requests[0].project_scope, scope);
  f.reply('review.list_result', { items: [], next_cursor: null });
  await pending;
  for (const key of [
    'schema_version',
    'correlation_id',
    'operation',
    'project_scope',
    'parameters',
    'history_scope',
    'fields',
  ]) {
    await assert.rejects(
      f.client.request('review.list', { project_scope: scope, fields: { [key]: 'override' } }),
    );
  }
  await assert.rejects(f.client.request('status', { fields: { task_id: 'task' } }));
  assert.equal(f.requests.length, 1);
});

test('the history request has no project scope, and removed operations stay closed', async (t) => {
  const f = fixture();
  t.after(() => f.client.close());
  const pending = f.client.request('history.list', {
    history_scope: { organization_id: 'org', task_id: 'task', project_id: 'project' },
    cursor: 'next',
    limit: 25,
  });
  assert.equal(f.requests[0].operation, 'history.list');
  assert.equal(f.requests[0].project_scope, undefined);
  assert.deepEqual(f.requests[0].history_scope, {
    organization_id: 'org',
    task_id: 'task',
    project_id: 'project',
  });
  assert.equal(f.requests[0].cursor, 'next');
  f.reply('history.list_result', { items: [], next_cursor: null });
  assert.equal((await pending).event, 'history.list_result');
  for (const operation of [
    'admin.templates',
    'admin.template.save',
    'admin.template.apply',
    'task.history',
  ])
    await assert.rejects(f.client.request(operation as any), /operation_unsupported/);
  assert.equal(f.requests.length, 1);
});
