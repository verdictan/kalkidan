import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  collectSshWork,
  decideSshQuit,
  stopSshWork,
  type SshQuitSource,
} from '../electron/ssh-quit';
import { AppPreferences } from '../electron/app-preferences';
import {
  hasSshWork,
  parseSshQuitAnswer,
  sshDisconnectedNote,
  sshWorkSummary,
  type SshHostWork,
} from '../src/domain/ssh-quit';
import { desktopFixture } from './helpers/desktop-fixture';

const host = (runs: number, shells: number, name = 'Build'): SshHostWork => ({
  hostId: name.toLowerCase(),
  hostName: name,
  runs: Array.from({ length: runs }, (_, i) => ({ id: `r${i}`, label: `Run ${i}` })),
  shells: Array.from({ length: shells }, (_, i) => ({ id: `s${i}`, label: `Shell ${i}` })),
});

test('the summary counts the runs, the shells and the hosts with work', () => {
  assert.equal(sshWorkSummary([host(1, 0)]), '1 agent run on 1 SSH host');
  assert.equal(
    sshWorkSummary([host(2, 1), host(0, 0, 'Idle')]),
    '2 agent runs and 1 shell on 1 SSH host',
  );
  assert.equal(
    sshWorkSummary([host(0, 2), host(1, 0, 'Lab')]),
    '1 agent run and 2 shells on 2 SSH hosts',
  );
  assert.equal(hasSshWork([host(0, 0)]), false);
  assert.equal(hasSshWork([host(0, 0), host(0, 1, 'Lab')]), true);
});

test('the note names the disconnected hosts whose work can still run', () => {
  assert.equal(sshDisconnectedNote([]), '');
  assert.equal(
    sshDisconnectedNote(['Build', 'Lab']),
    'Work may still run on these disconnected computers: Build, Lab. You can stop it after they connect again.',
  );
});

test('an answer from a window must be valid', () => {
  assert.deepEqual(parseSshQuitAnswer({ id: 'q', choice: 'stop', dontAsk: true, extra: 1 }), {
    id: 'q',
    choice: 'stop',
    dontAsk: true,
  });
  for (const value of [
    null,
    'keep',
    { id: '', choice: 'keep', dontAsk: false },
    { id: 'x'.repeat(101), choice: 'keep', dontAsk: false },
    { id: 'q', choice: 'quit', dontAsk: false },
    { id: 'q', choice: 'keep', dontAsk: 'no' },
  ])
    assert.equal(parseSshQuitAnswer(value), null);
});

function source(overrides: Partial<SshQuitSource> = {}) {
  const calls: [string, string, unknown[]][] = [];
  const answers: string[] = [];
  let asks = true;
  const value: SshQuitSource = {
    hosts: () => [
      { id: 'h1', name: 'Build' },
      { id: 'h2', name: 'Lab' },
      { id: 'h3', name: 'Slow' },
    ],
    call: async (hostId, method, args) => {
      calls.push([hostId, method, args]);
      if (hostId === 'h3') return new Promise(() => {});
      if (hostId === 'h2') throw new Error('offline');
      if (method === 'chat-runs')
        return [
          { id: 'run-1', agent: 'codex', sessionId: 'abc' },
          { id: 'run-2', agent: 'claude', sessionId: 'unknown' },
          { id: 'run-3' },
          { agent: 'codex' },
          'nonsense',
        ];
      if (method === 'ptyList') return [{ id: 'shell-1', cwd: '/srv/app' }, { id: 'shell-2' }, {}];
      return null;
    },
    title: (hostId, agent, sessionId) =>
      hostId === 'h1' && agent === 'codex' && sessionId === 'abc' ? 'Fix the build' : undefined,
    asks: async () => asks,
    setAsks: async (next) => {
      asks = next;
    },
    askWindow: async () => {
      answers.push('window');
      return { id: 'q', choice: 'keep', dontAsk: false };
    },
    askSystem: async () => {
      answers.push('system');
      return { choice: 'keep', dontAsk: false };
    },
    callMs: 20,
    ...overrides,
  };
  return { value, calls, answers, asks: () => asks };
}

test('the app lists the runs and shells of each connected host', async () => {
  const { value } = source();
  const hosts = await collectSshWork(value);
  assert.deepEqual(hosts, [
    {
      hostId: 'h1',
      hostName: 'Build',
      runs: [
        { id: 'run-1', label: 'Fix the build' },
        { id: 'run-2', label: 'Claude Code chat' },
        { id: 'run-3', label: 'Agent chat' },
      ],
      shells: [
        { id: 'shell-1', label: 'Shell in /srv/app' },
        { id: 'shell-2', label: 'Shell' },
      ],
    },
    // A host that fails or does not answer has no work in the list.
    { hostId: 'h2', hostName: 'Lab', runs: [], shells: [] },
    { hostId: 'h3', hostName: 'Slow', runs: [], shells: [] },
  ]);
});

test('Stop all stops each run and closes each shell, also when a host fails', async () => {
  const { value, calls } = source();
  await stopSshWork(value, [host(2, 1), host(1, 0, 'Lab'), host(0, 1, 'Slow')]);
  assert.deepEqual(
    calls.map(([hostId, method, args]) => [hostId, method, args[0]]),
    [
      ['build', 'chatStop', 'r0'],
      ['build', 'chatStop', 'r1'],
      ['build', 'ptyClose', 's0'],
      ['lab', 'chatStop', 'r0'],
      ['slow', 'ptyClose', 's0'],
    ],
  );
});

test('the question shows only with work, and "Don\'t ask again" turns it off', async () => {
  // No question after "Don't ask again". The hosts are not called.
  const off = source({ asks: async () => false });
  assert.equal(await decideSshQuit(off.value), 'keep');
  assert.deepEqual([off.calls, off.answers], [[], []]);
  // No question without work.
  const idle = source({ hosts: () => [{ id: 'h2', name: 'Lab' }] });
  assert.equal(await decideSshQuit(idle.value), 'keep');
  assert.deepEqual(idle.answers, []);
  // A window asks. The question has only the hosts with work.
  let asked: unknown;
  const stop = source({
    askWindow: async (request) => {
      asked = request;
      return { id: request.id, choice: 'stop', dontAsk: true };
    },
  });
  assert.equal(await decideSshQuit(stop.value), 'stop');
  assert.deepEqual(
    (asked as { hosts: SshHostWork[] }).hosts.map((value) => value.hostId),
    ['h1'],
  );
  assert.equal(stop.asks(), false);
  assert.deepEqual(
    stop.calls.filter(([, method]) => ['chatStop', 'ptyClose'].includes(method)).length,
    5,
  );
  // Without a window, a system dialog asks. Keep running stops nothing.
  const system = source({ askWindow: async () => null });
  assert.equal(await decideSshQuit(system.value), 'keep');
  assert.deepEqual(system.answers, ['system']);
  assert.equal(system.asks(), true);
  assert.equal(system.calls.filter(([, method]) => method === 'chatStop').length, 0);
  // A preference that cannot be read asks, and a failed save does not stop the quit.
  const broken = source({
    asks: async () => {
      throw new Error('broken');
    },
    askWindow: async (request) => ({ id: request.id, choice: 'keep', dontAsk: true }),
    setAsks: async () => {
      throw new Error('broken');
    },
  });
  assert.equal(await decideSshQuit(broken.value), 'keep');
});

test('the app keeps the choice to ask before it quits', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'kalkidan-quit-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = join(root, 'preferences.json');
  const preferences = new AppPreferences(file);
  assert.equal(await preferences.sshQuitPrompt(), true);
  assert.equal(await preferences.setSshQuitPrompt(false), false);
  assert.equal(await new AppPreferences(file).sshQuitPrompt(), false);
  assert.equal(await preferences.setSshQuitPrompt(true), true);
  assert.equal(await new AppPreferences(file).sshQuitPrompt(), true);
  await assert.rejects(preferences.setSshQuitPrompt('no'), /Invalid/);
});

test('the desktop asks a window before it quits and stops the work on Stop all', async () => {
  const f = await desktopFixture();
  f.state.ptyShells = [{ id: 'shell-1', cwd: '/remote' }];
  const requests = () =>
    f.calls.filter((call) => call[0] === 'send' && call[1] === 'ssh-quit-request');
  const settle = () => new Promise((done) => setTimeout(done, 20));
  // The quit waits for the answer.
  let prevented = 0;
  f.app.emit('before-quit', { preventDefault: () => prevented++ });
  await settle();
  assert.equal(prevented, 1);
  const [, , request] = requests().at(-1)!;
  assert.deepEqual(request.hosts, [
    {
      hostId: 'host',
      hostName: 'Host',
      runs: [],
      shells: [{ id: 'shell-1', label: 'Shell in /remote' }],
    },
  ]);
  // A second quit while the question shows asks no new question.
  f.app.emit('before-quit', { preventDefault: () => prevented++ });
  await settle();
  assert.equal(requests().length, 1);
  await assert.rejects(f.invoke('ssh-quit-answer', { id: request.id, choice: 'later' }), /Invalid/);
  await f.invoke('ssh-quit-answer', { id: request.id, choice: 'stop', dontAsk: true });
  await settle();
  assert.ok(f.calls.some((call) => call[0] === 'remote' && call[2] === 'ptyClose'));
  assert.ok(f.calls.some((call) => call[0] === 'quit'));
  assert.equal(await f.invoke('ssh-quit-prompt'), false);
  // The next quit does not ask again.
  f.app.emit('before-quit', { preventDefault: () => prevented++ });
  assert.equal(prevented, 2);
  assert.equal(await f.invoke('set-ssh-quit-prompt', true), true);
});

test('closing the last window asks, and Keep running leaves the work', async () => {
  const f = await desktopFixture();
  f.state.ptyShells = [{ id: 'shell-1', cwd: '/remote' }];
  const window = f.windows[0];
  let prevented = 0;
  window.emit('close', { preventDefault: () => prevented++ });
  await new Promise((done) => setTimeout(done, 20));
  assert.equal(prevented, 1);
  const request = f.calls.filter(
    (call) => call[0] === 'send' && call[1] === 'ssh-quit-request',
  )[0][2];
  window.close = () => f.calls.push(['windowClose']);
  await f.invoke('ssh-quit-answer', { id: request.id, choice: 'keep', dontAsk: false });
  await new Promise((done) => setTimeout(done, 20));
  assert.ok(f.calls.some((call) => call[0] === 'windowClose'));
  assert.equal(f.calls.filter((call) => call[0] === 'remote' && call[2] === 'ptyClose').length, 0);
  // The window closes now without a new question.
  window.emit('close', { preventDefault: () => prevented++ });
  assert.equal(prevented, 1);
});

test('without a window that can ask, a system dialog asks', async () => {
  const f = await desktopFixture();
  f.state.ptyShells = [{ id: 'shell-1', cwd: '/remote' }];
  f.windows[0].webContents.isLoading = () => true;
  f.state.choice = 1;
  f.app.emit('before-quit', { preventDefault: () => {} });
  await new Promise((done) => setTimeout(done, 20));
  const box = f.calls.filter((call) => call[0] === 'messageBox').at(-1)![1];
  assert.deepEqual(box.buttons, ['Keep running', 'Stop all']);
  assert.equal(box.cancelId, 0);
  assert.equal(box.checkboxLabel, "Don't ask again");
  assert.match(box.detail, /Host\n {2}Shell in \/remote/);
  assert.ok(f.calls.some((call) => call[0] === 'remote' && call[2] === 'ptyClose'));
});

test('disconnected hosts with work get a note, and alone they allow only Keep running', async () => {
  // Only disconnected hosts: the question shows, but nothing stops, also after Stop all.
  let asked: any;
  const only = source({
    hosts: () => [{ id: 'h2', name: 'Lab' }],
    disconnected: () => ['Build', 'Build', 'Lab 2'],
    askWindow: async (request) => {
      asked = request;
      return { id: request.id, choice: 'stop', dontAsk: true };
    },
  });
  assert.equal(await decideSshQuit(only.value), 'keep');
  assert.deepEqual([asked.hosts, asked.disconnected], [[], ['Build', 'Lab 2']]);
  assert.equal(only.calls.filter(([, method]) => method === 'chatStop').length, 0);
  assert.equal(only.asks(), false);
  // Work on a connected host and on a disconnected host: both show.
  const both = source({
    disconnected: () => ['Lab 2'],
    askWindow: async (request) => {
      asked = request;
      return { id: request.id, choice: 'keep', dontAsk: false };
    },
  });
  await decideSshQuit(both.value);
  assert.deepEqual(
    [asked.hosts.map((host: SshHostWork) => host.hostId), asked.disconnected],
    [['h1'], ['Lab 2']],
  );
  // Without work and without disconnected hosts, nothing shows.
  const none = source({ hosts: () => [], disconnected: () => [] });
  assert.equal(await decideSshQuit(none.value), 'keep');
  assert.deepEqual(none.answers, []);
});

test('a disconnected host with a run or a known shell is in the note', async () => {
  const f = await desktopFixture();
  // The fixture host had a shell, then its connection stopped. Its run continues on it.
  f.state.ptyShells = [{ id: 'shell-1', cwd: '/remote' }];
  await f.invoke('remote-call', 'host', 'ptyAttach', ['/other']);
  const [host] = await f.invoke('remote-hosts');
  host.status = 'disconnected';
  f.app.emit('before-quit', { preventDefault: () => {} });
  await new Promise((done) => setTimeout(done, 20));
  const request = f.calls.filter(
    (call) => call[0] === 'send' && call[1] === 'ssh-quit-request',
  )[0][2];
  assert.deepEqual([request.hosts, request.disconnected], [[], ['Host']]);
  host.status = 'connected';
});

test('the system dialog shows the note, and only Keep running without connected work', async () => {
  const f = await desktopFixture();
  const [host] = await f.invoke('remote-hosts');
  host.status = 'disconnected';
  f.windows[0].webContents.isLoading = () => true;
  f.state.choice = 0;
  f.app.emit('before-quit', { preventDefault: () => {} });
  await new Promise((done) => setTimeout(done, 20));
  const box = f.calls.filter((call) => call[0] === 'messageBox').at(-1)![1];
  assert.deepEqual(box.buttons, ['Keep running']);
  assert.equal(box.message, 'Work may continue on SSH hosts after Kalkidan quits');
  assert.match(box.detail, /disconnected computers: Host\. You can stop it/);
  host.status = 'connected';
});
