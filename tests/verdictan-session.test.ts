import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DesktopProtocol } from '../electron/verdictan/protocol';
import {
  VerdictanAccountService,
  renewBeforeMs,
  renewRetryMs,
} from '../electron/verdictan/account';
import { AppPreferences, notificationKind } from '../electron/app-preferences';
import { VerdictanSetupService } from '../electron/verdictan/setup';
import {
  managedErrorInfo,
  recommendedSelection,
  signOutDetail,
  type VerdictanSetup,
} from '../src/domain/verdictan';

const apiOrigin = 'https://api.verdictan.com';
const consoleOrigin = 'https://console.verdictan.com';
const capabilities = {
  cli_version: '0.6.9',
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
  api_url: apiOrigin,
};
const authenticated = (expiresAt: string) => ({
  ...signedOut,
  state: 'authenticated',
  user_id: 'user',
  organization_id: 'org',
  expires_at: expiresAt,
});

/** A fake runtime CLI. `reply` answers the newest request with one event. */
function fixture(now = () => Date.parse('2026-10-20T00:00:00Z')) {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.stdin = new EventEmitter();
  child.stdio = [child.stdin, child.stdout, child.stderr, new PassThrough()];
  const requests: any[] = [];
  child.stdin.write = (line: string) => {
    requests.push(JSON.parse(line));
  };
  child.stdin.destroy = () => {};
  let kills = 0;
  child.kill = () => {
    kills++;
  };
  let sequence = 0;
  const client = new DesktopProtocol(
    resolve('fixture-verdictan'),
    [],
    (() => child) as any,
    30000,
    now,
  );
  return {
    client,
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
async function drain() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

test('a waiting sign-in shows its link, opens it again, and clears it when it finishes', async (t) => {
  const f = fixture();
  const opened: string[] = [];
  let changes = 0;
  const account = new VerdictanAccountService({
    apiOrigin,
    consoleOrigin,
    connect: async () => f.client,
    openBrowser: async (url) => {
      opened.push(url);
    },
    changed: () => changes++,
    now: () => Date.parse('2026-10-20T00:00:00Z'),
  });
  t.after(() => account.dispose());
  await assert.rejects(account.reopenBrowser(), /No sign-in waits/);
  const login = account.authorize('register');
  await drain();
  assert.equal(account.status().phase, 'authorizing');
  const url = 'https://console.verdictan.com/auth/cli?state=abc';
  f.reply('authorization.started', { authorization_url: url, expires_in_seconds: 240 });
  assert.deepEqual(account.status().authorization, {
    url,
    intent: 'register',
    startedAt: '2026-10-20T00:00:00.000Z',
    expiresAt: '2026-10-20T00:04:00.000Z',
  });
  assert.ok(changes >= 2, 'The phase and the link each tell the windows');
  await account.reopenBrowser();
  assert.deepEqual(opened, [url, url]);
  f.reply('authorization.completed', {});
  await drain();
  f.reply('account.status', authenticated('2026-10-21T00:00:00Z'));
  await drain();
  f.reply('capabilities', capabilities);
  const status = await login;
  assert.equal(status.phase, 'authenticated');
  assert.equal(status.authorization, undefined);
  await assert.rejects(account.reopenBrowser(), /No sign-in waits/);
});

test('a sign-in link without a time lasts 5 minutes, and cancel clears it', async (t) => {
  const f = fixture();
  const account = new VerdictanAccountService({
    apiOrigin,
    consoleOrigin,
    connect: async () => f.client,
    openBrowser: async () => {},
    now: () => Date.parse('2026-10-20T00:00:00Z'),
  });
  t.after(() => account.dispose());
  const login = account.authorize('login');
  await drain();
  f.reply('authorization.started', { authorization_url: `${consoleOrigin}/auth/cli` });
  assert.equal(account.status().authorization?.expiresAt, '2026-10-20T00:05:00.000Z');
  const cancel = account.cancel();
  await drain();
  f.reply('authorization.canceled', {}, 0);
  f.reply('authorization.cancel_completed', {}, 1);
  await drain();
  f.reply('account.status', signedOut);
  await drain();
  f.reply('capabilities', capabilities);
  assert.equal((await cancel).authorization, undefined);
  assert.equal((await login).phase, 'signed-out');
});

test('a sign-in that does not finish in time has its own code and plain words', async (t) => {
  mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => mock.timers.reset());
  const f = fixture();
  const account = new VerdictanAccountService({
    apiOrigin,
    consoleOrigin,
    connect: async () => f.client,
    openBrowser: async () => {},
  });
  t.after(() => account.dispose());
  const login = account.authorize('login');
  await drain();
  f.reply('authorization.started', { authorization_url: `${consoleOrigin}/auth/cli` });
  mock.timers.tick(310_000);
  const status = await login;
  assert.equal(status.phase, 'error');
  assert.equal(status.error, 'desktop.authorization_timeout');
  assert.equal(status.authorization, undefined);
  assert.match(managedErrorInfo('desktop.authorization_timeout').message, /Nothing changed/);
});

test('the session renews 10 minutes before it expires, and expires when renewal fails', async (t) => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-20T00:00:00Z') });
  t.after(() => mock.timers.reset());
  const f = fixture(() => Date.now());
  const phases: string[] = [];
  const account = new VerdictanAccountService({
    apiOrigin,
    consoleOrigin,
    connect: async () => f.client,
    openBrowser: async () => {},
    changed: () => phases.push(account.status().phase),
  });
  t.after(() => account.dispose());
  const check = account.check();
  await drain();
  f.reply('account.status', authenticated('2026-10-20T01:00:00Z'));
  await drain();
  f.reply('capabilities', capabilities);
  assert.equal((await check).phase, 'authenticated');
  const before = f.requests.length;
  mock.timers.tick(3600_000 - renewBeforeMs - 1);
  await drain();
  assert.equal(f.requests.length, before, 'No renewal before the time');
  mock.timers.tick(1);
  await drain();
  assert.equal(f.requests.at(-1).operation, 'session.renew');
  f.reply('session.renewed', {});
  await drain();
  f.reply('account.status', authenticated('2026-10-20T02:00:00Z'));
  await drain();
  f.reply('capabilities', capabilities);
  await drain();
  assert.equal(account.status().account?.expiresAt, '2026-10-20T02:00:00Z');
  // The next renewal fails for a short time. The session stays and the renewal tries again.
  mock.timers.tick(3600_000);
  await drain();
  assert.equal(f.requests.at(-1).operation, 'session.renew');
  f.reply('error', { code: 'desktop.event_authority_unavailable' });
  await drain();
  assert.equal(account.status().phase, 'authenticated');
  assert.ok(!phases.includes('error'), 'A quiet renewal never shows an error');
  mock.timers.tick(renewRetryMs);
  await drain();
  assert.equal(f.requests.at(-1).operation, 'session.renew');
  f.reply('error', { code: 'desktop.auth_expired' });
  await drain();
  const status = account.status();
  assert.equal(status.phase, 'expired');
  assert.equal(status.account?.state, 'expired');
});

test('renewal on wake renews a valid session and marks a past session as expired', async (t) => {
  let now = Date.parse('2026-10-20T00:00:00Z');
  const f = fixture(() => now);
  const account = new VerdictanAccountService({
    apiOrigin,
    consoleOrigin,
    connect: async () => f.client,
    openBrowser: async () => {},
    now: () => now,
  });
  t.after(() => account.dispose());
  assert.equal((await account.autoRenew()).phase, 'missing', 'Nothing to renew');
  const check = account.check();
  await drain();
  f.reply('account.status', authenticated('2026-10-20T01:00:00Z'));
  await drain();
  f.reply('capabilities', capabilities);
  await check;
  now = Date.parse('2026-10-20T03:00:00Z');
  const status = await account.autoRenew();
  assert.equal(status.phase, 'expired');
});

/** An account owner that starts a new fake runtime CLI for each connection. */
function refusingAccount(t: any, now = () => Date.parse('2026-10-20T00:00:00Z')) {
  const started: ReturnType<typeof fixture>[] = [];
  const account = new VerdictanAccountService({
    apiOrigin,
    consoleOrigin,
    connect: async () => {
      const next = fixture(now);
      started.push(next);
      return next.client;
    },
    openBrowser: async () => {},
    now,
  });
  t.after(() => account.dispose());
  const refused = { code: 'desktop.secure_storage_unavailable' };
  return { account, started, refused, last: () => started.at(-1)! };
}

test('a refused keychain prompt stops the runtime, and Check status starts it again', async (t) => {
  const { account, started, refused, last } = refusingAccount(t);
  const check = account.check();
  await drain();
  // The user refuses the keychain prompt that the status read shows.
  last().reply('error', refused);
  const failed = await check;
  assert.equal(failed.phase, 'error');
  assert.equal(failed.error, 'desktop.secure_storage_unavailable');
  assert.equal(started.length, 1);
  assert.equal(last().kills(), 1, 'The refused runtime process stops');
  // Automatic work does not start the runtime again, so the system does not ask again.
  await assert.rejects(account.runtimeClient(), /desktop\.secure_storage_unavailable/);
  assert.equal((await account.autoRenew()).phase, 'error');
  assert.equal(started.length, 1, 'No new keychain prompt without a user action');
  // Check status starts a new runtime process. The user allows access this time.
  const retry = account.check();
  await drain();
  assert.equal(started.length, 2);
  last().reply('account.status', authenticated('2026-10-20T01:00:00Z'));
  await drain();
  last().reply('capabilities', capabilities);
  const status = await retry;
  assert.equal(status.phase, 'authenticated');
  assert.equal(status.error, undefined);
  const client = await account.runtimeClient();
  assert.equal(typeof client.request, 'function');
  assert.equal(started.length, 2);
});

test('a refused keychain prompt during a launch or a renewal does not ask again by itself', async (t) => {
  mock.timers.enable({ apis: ['setTimeout', 'Date'], now: Date.parse('2026-10-20T00:00:00Z') });
  t.after(() => mock.timers.reset());
  const { account, started, refused, last } = refusingAccount(t, () => Date.now());
  const check = account.check();
  await drain();
  last().reply('account.status', authenticated('2026-10-20T01:00:00Z'));
  await drain();
  last().reply('capabilities', capabilities);
  assert.equal((await check).phase, 'authenticated');
  // A launch reads the runtime credentials. The user refuses the keychain prompt.
  const launch = (await account.runtimeClient()).request('setup.inspect');
  await drain();
  last().reply('error', refused);
  await assert.rejects(launch, /desktop\.secure_storage_unavailable/);
  assert.equal(account.status().phase, 'error');
  assert.equal(account.status().error, 'desktop.secure_storage_unavailable');
  assert.equal(last().kills(), 1);
  // The renewal timer and the next launches do not start the runtime again.
  mock.timers.tick(3600_000);
  await drain();
  await assert.rejects(account.runtimeClient(), /desktop\.secure_storage_unavailable/);
  assert.equal(started.length, 1);
  // Check status asks again. A second refusal also stops, and no loop of prompts starts.
  const second = account.check();
  await drain();
  assert.equal(started.length, 2);
  last().reply('error', refused);
  assert.equal((await second).error, 'desktop.secure_storage_unavailable');
  mock.timers.tick(10 * renewRetryMs);
  await drain();
  assert.equal(started.length, 2);
  // The third try succeeds.
  const third = account.check();
  await drain();
  last().reply('account.status', authenticated('2026-10-20T02:00:00Z'));
  await drain();
  last().reply('capabilities', capabilities);
  assert.equal((await third).phase, 'authenticated');
  assert.equal(started.length, 3);
});

test('the keychain refusal tells the user what happened and what to do', () => {
  const message = managedErrorInfo('desktop.secure_storage_unavailable').message;
  assert.match(message, /did not get access to the system keychain/);
  assert.match(message, /Select Check status/);
});

test('preferences persist the first run and the notification choices', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'kalkidan-preferences-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'preferences.json');
  const preferences = new AppPreferences(file);
  assert.deepEqual(await preferences.firstRun(), { welcomeDone: false, everSignedIn: false });
  assert.deepEqual(await preferences.notifications(), { finished: true, needsInput: true });
  await preferences.setWelcomeDone();
  await preferences.setSignedIn();
  await preferences.setNotifications({ finished: false, needsInput: true });
  await assert.rejects(preferences.setNotifications({ finished: 'no' }), /Invalid/);
  const again = new AppPreferences(file);
  assert.deepEqual(await again.firstRun(), { welcomeDone: true, everSignedIn: true });
  assert.deepEqual(await again.notifications(), { finished: false, needsInput: true });
  assert.equal(await again.allows('finished'), false);
  assert.equal(await again.allows('needs-input'), true);
  assert.equal(JSON.parse(await readFile(file, 'utf8')).schema, 1);
  await writeFile(file, 'not json');
  assert.deepEqual(await new AppPreferences(file).firstRun(), {
    welcomeDone: false,
    everSignedIn: false,
  });
});

test('a notification has a kind, also from an older window', () => {
  assert.equal(notificationKind({ title: 'Codex finished' }), 'finished');
  assert.equal(notificationKind({ title: 'Codex asks a question' }), 'needs-input');
  assert.equal(notificationKind({ title: 'Codex needs your approval' }), 'needs-input');
  assert.equal(notificationKind({ title: 'Codex finished', kind: 'needs-input' }), 'needs-input');
});

test('the sign-out confirmation names what stops', () => {
  assert.equal(
    signOutDetail(2, 1),
    'Sign out stops 2 running agents and disconnects 1 SSH host. Your projects and chats stay on this computer.',
  );
  assert.match(signOutDetail(1, 0), /^Sign out stops 1 running agent\. /);
  assert.match(signOutDetail(0, 3), /^Sign out disconnects 3 SSH hosts\. /);
});

const team = '00000000-0000-4000-8000-000000000001';
const baseSetup: VerdictanSetup = {
  status: 'ready',
  providerAccessModes: ['byok', 'claude_subscription'],
  teams: [{ team_id: team }],
  policies: [],
  defaultPolicy: { configuration_id: 'cfg', configuration_version_id: 'cfv' },
  providerConnections: [{ provider_connection_id: 'pc-openai', provider: 'openai' }],
  allowedModels: { codex: ['gpt-5.1-codex'] },
  selections: {},
};

test('the recommended setup uses the preselection, the only connection and the first model', () => {
  assert.deepEqual(recommendedSelection(baseSetup, 'codex'), {
    teamId: team,
    configurationId: '',
    configurationVersionId: '',
    providerConnectionId: 'pc-openai',
    model: 'gpt-5.1-codex',
  });
  // No Anthropic connection: the Claude subscription that the runtime offers.
  assert.deepEqual(recommendedSelection(baseSetup, 'claude', ['sonnet', 'opus']), {
    teamId: team,
    configurationId: '',
    configurationVersionId: '',
    providerConnectionId: '',
    providerAccessMode: 'claude_subscription',
    model: 'sonnet',
  });
  // Two teams: the user must choose.
  assert.equal(
    recommendedSelection(
      { ...baseSetup, teams: [{ team_id: team }, { team_id: 'other' }] },
      'codex',
    ),
    undefined,
  );
  // A saved setup stays.
  const saved = { ...baseSetup, selections: { codex: recommendedSelection(baseSetup, 'codex')! } };
  assert.equal(recommendedSelection(saved, 'codex'), undefined);
});

test('apply recommended saves each agent that has no setup and keeps the others', async () => {
  const saved: string[] = [];
  let setup: VerdictanSetup = structuredClone(baseSetup);
  const service = Object.create(VerdictanSetupService.prototype) as VerdictanSetupService;
  service.status = async () => structuredClone(setup);
  service.select = async (agent, value) => {
    saved.push(agent);
    setup = { ...setup, selections: { ...setup.selections, [agent]: value } };
    return structuredClone(setup);
  };
  const result = await service.applyRecommended(async (agent) =>
    agent === 'claude' ? ['sonnet'] : [],
  );
  assert.deepEqual(saved, ['codex', 'claude']);
  assert.equal(result.selections.codex?.model, 'gpt-5.1-codex');
  assert.equal(result.selections.claude?.providerAccessMode, 'claude_subscription');
  saved.length = 0;
  await service.applyRecommended(async () => []);
  assert.deepEqual(saved, [], 'Saved setups do not change');
});

test('the account plan passes through only when the service sends it', async () => {
  const { parseAccount } = await import('../electron/verdictan/account');
  const base = authenticated('2026-10-21T00:00:00Z');
  assert.equal(parseAccount(base, apiOrigin).plan, undefined);
  assert.equal(parseAccount({ ...base, plan_name: 'Team' }, apiOrigin).plan, 'Team');
});
