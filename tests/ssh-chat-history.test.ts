import test from 'node:test';
import assert from 'node:assert/strict';
import { desktopFixture } from './helpers/desktop-fixture';
import { bindingSummary, parseBindingSummary } from '../electron/verdictan/bindings';

const conversation = '00000000-0000-4000-8000-000000000003';

test('a binding summary keeps identifiers and the folder only', () => {
  const summary = {
    organization_id: '00000000-0000-4000-8000-000000000001',
    user_id: '00000000-0000-4000-8000-000000000002',
    conversation_id: conversation,
    cwd: '/srv/app',
  };
  assert.equal(bindingSummary(null), null);
  assert.deepEqual(
    bindingSummary({ ...summary, model: 'm', provider: 'openai' } as never),
    summary,
  );
  assert.deepEqual(parseBindingSummary({ ...summary, provider_access_mode: 'byok', extra: 1 }), {
    ...summary,
    provider_access_mode: 'byok',
  });
  for (const value of [
    null,
    'text',
    { ...summary, conversation_id: 'x' },
    { ...summary, user_id: 1 },
    { ...summary, organization_id: undefined },
    { ...summary, cwd: '' },
    { ...summary, cwd: 'x'.repeat(4097) },
    { ...summary, provider_access_mode: 'other' },
  ])
    assert.equal(parseBindingSummary(value), null);
});

test('Insights and Usage history read the chats of an SSH host from the host binding', async () => {
  const f = await desktopFixture();
  f.state.remoteBinding = {
    organization_id: f.account.org,
    user_id: f.account.user,
    conversation_id: conversation,
    cwd: '/remote/app',
    provider_access_mode: 'claude_subscription',
  };
  const usage = await f.invoke('project-usage', 'remote', [
    { agent: 'claude', sessionId: 'host::c' },
    // A second chat of the same conversation does not count again.
    { agent: 'claude', sessionId: 'host::copy' },
  ]);
  assert.deepEqual(
    usage.chats.map((chat: any) => [chat.sessionId, chat.hostId, chat.hostName, chat.billing]),
    [['host::c', 'host', 'Host', 'subscription']],
  );
  assert.deepEqual(
    f.calls.find((call) => call[0] === 'remote' && call[2] === 'conversation-binding'),
    ['remote', 'host', 'conversation-binding', ['claude_code', 'c']],
  );
  // The chat of a host is not a chat of a project on this computer.
  const local = await f.invoke('project-usage', 'g', [{ agent: 'claude', sessionId: 'host::c' }]);
  assert.deepEqual([local.chats, local.unmanaged], [[], 1]);
  // The Usage history of the chat reads the same conversation.
  const page = await f.invoke('managed-history', {
    kind: 'conversation',
    agent: 'claude',
    sessionId: 'host::c',
  });
  assert.deepEqual(page.entries, []);
  // A binding of a different account, a binding that is not valid, or an unknown host has no
  // history.
  f.state.remoteBinding = { ...(f.state.remoteBinding as object), user_id: conversation };
  await assert.rejects(
    f.invoke('managed-history', { kind: 'conversation', agent: 'claude', sessionId: 'host::c' }),
    /no managed agent history/,
  );
  f.state.remoteBinding = { conversation_id: 'x' };
  const invalid = await f.invoke('project-usage', 'remote', [
    { agent: 'codex', sessionId: 'host::s' },
    { agent: 'codex', sessionId: 'gone::s' },
  ]);
  assert.deepEqual([invalid.chats, invalid.unmanaged], [[], 2]);
  // A host that fails gives no binding, and the read continues.
  f.state.remoteError = 'Host is offline.';
  const offline = await f.invoke('project-usage', 'remote', [
    { agent: 'codex', sessionId: 'host::s' },
  ]);
  assert.equal(offline.unmanaged, 1);
  f.state.remoteError = '';
  // A chat on this computer still uses the local binding.
  f.state.localBinding = {
    organization_id: f.account.org,
    user_id: f.account.user,
    conversation_id: conversation,
    cwd: '/repo',
  };
  const own = await f.invoke('project-usage', 'g', [{ agent: 'codex', sessionId: 's' }]);
  assert.deepEqual(
    own.chats.map((chat: any) => [chat.sessionId, chat.hostId]),
    [['s', undefined]],
  );
  assert.ok(f.calls.some((call) => call[0] === 'bindingRead' && call[2] === 's'));
});

test('the snapshot marks a chat whose run continues on its SSH host', async () => {
  const f = await desktopFixture();
  // The first read starts the host read. The next read has the sessions of the host.
  await f.invoke('snapshot');
  await new Promise((done) => setTimeout(done, 10));
  const snapshot = await f.invoke('snapshot');
  const remote = snapshot.sessions.find((session: any) => session.id === 'host::s');
  assert.equal(remote.liveRunId, 'live-run');
  assert.equal(snapshot.sessions.find((session: any) => session.id === 's').liveRunId, undefined);
});

test('a host connection recovers the run outcomes that the app did not see', async () => {
  const f = await desktopFixture();
  const listener = f.calls.find((call) => call[0] === 'remoteConnected')![1] as (
    hostId: string,
  ) => void;
  const sent = () =>
    f.calls.filter((call) => call[0] === 'send' && call[1] === 'remote-hosts-changed').length;
  const saved = () =>
    f.calls.filter(
      (call) => call[0] === 'writeJSON' && String(call[1]).endsWith('chat-outcomes.json'),
    );
  const settle = () => new Promise((done) => setTimeout(done, 20));
  f.state.runOutcomes = {
    now: new Date().toISOString(),
    outcomes: [
      {
        agent: 'codex',
        id: 's',
        outcome: 'failed',
        reason: 'api_error',
        at: new Date().toISOString(),
        runId: 'run-1',
      },
    ],
  };
  const before = sent();
  listener('host');
  await settle();
  assert.ok(f.calls.some((call) => call[0] === 'remote' && call[2] === 'run-outcomes'));
  const write = saved().at(-1)!;
  assert.deepEqual(
    write[2].outcomes.map((row: any) => [row.id, row.hostId, row.outcome, row.reason]),
    [['host::s', 'host', 'failed', 'api_error']],
  );
  // The windows load the chats again, so the status dots show the outcome.
  assert.equal(sent(), before + 1);
  // The same outcomes again change nothing.
  listener('host');
  await settle();
  assert.equal(saved().length, 1);
  assert.equal(sent(), before + 1);
  // A helper without the outcomes, or a host that fails, changes nothing.
  f.state.runOutcomes = undefined;
  listener('host');
  f.state.remoteError = 'Unsupported remote operation';
  listener('host');
  await settle();
  f.state.remoteError = 'SSH disconnected.';
  const warn = console.warn;
  const warnings: unknown[][] = [];
  console.warn = (...args: unknown[]) => warnings.push(args);
  try {
    listener('host');
    await settle();
  } finally {
    console.warn = warn;
  }
  assert.deepEqual(warnings, [['Remote run outcomes not recovered', 'SSH disconnected.']]);
  assert.equal(saved().length, 1);
});

test('runs and shells on an SSH host continue when their window closes, with one owner', async () => {
  const f = await desktopFixture();
  await f.invoke('session-action', f.sessions[0], 'window');
  const [first, second] = f.windows;
  const as = (window: any, name: string, ...args: unknown[]) =>
    Promise.resolve().then(() =>
      f.handlers.get(name)!(
        { sender: window.webContents, senderFrame: window.webContents.mainFrame },
        ...args,
      ),
    );
  const remoteCalls = (method: string) =>
    f.calls.filter((call) => call[0] === 'remote' && call[2] === method).length;
  // The first window opens a shell on the host.
  assert.deepEqual(await as(first, 'remote-call', 'host', 'ptyOpen', ['/remote', 80, 24]), {
    id: 'ptyOpen',
  });
  // Shells of the folder continue on the host. A window attaches to the newest shell that no
  // window owns. Then that window owns it.
  f.state.ptyShells = [
    { id: 'old', cwd: '/remote' },
    { id: 'ptyOpen', cwd: '/remote' },
    { id: 'other', cwd: '/remote/other' },
  ];
  assert.deepEqual(await as(second, 'remote-call', 'host', 'ptyAttach', ['/remote']), {
    id: 'old',
  });
  assert.equal(await as(first, 'remote-call', 'host', 'ptyAttach', ['/remote']), null);
  // An older helper without a shell list has no shell to attach to.
  f.state.ptyShells = undefined;
  assert.equal(await as(first, 'remote-call', 'host', 'ptyAttach', ['/remote/other']), null);
  // A shell on this computer stops with the app.
  assert.equal(await as(first, 'pty-attach', '/repo'), null);
  // The first window reads a run of the host, so it owns the run and answers its approvals.
  await as(first, 'remote-call', 'host', 'chatStatus', ['run-1']);
  await as(first, 'remote-call', 'host', 'chatApprove', ['run-1', 'a', true]);
  // A second window can read the run, but cannot answer for it.
  assert.equal((await as(second, 'remote-call', 'host', 'chatStatus', ['run-1'])).id, 'run-1');
  await assert.rejects(
    as(second, 'remote-call', 'host', 'chatApprove', ['run-1', 'a', true]),
    /another window/,
  );
  // The first window closes. Its run and shell continue on the host.
  first.emit('closed');
  assert.equal(remoteCalls('chatStop'), 0);
  assert.equal(remoteCalls('ptyClose'), 0);
  // The window that reads the run next owns it.
  await as(second, 'remote-call', 'host', 'chatStatus', ['run-1']);
  await as(second, 'remote-call', 'host', 'chatApprove', ['run-1', 'a', true]);
  assert.equal(remoteCalls('chatApprove'), 2);
  // The app quits. The runs and shells on the host continue.
  second.emit('closed');
  f.app.emit('before-quit', { preventDefault() {} });
  assert.equal(remoteCalls('chatStop'), 0);
  assert.equal(remoteCalls('ptyClose'), 0);
});
