import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import { backendLoader } from './helpers/backend-loader';

test('PTY transport handles readiness, malformed output, truncation, failures and Windows adapters', async () => {
  for (const platform of ['linux', 'win32']) {
    const children: any[] = [],
      lines: any[] = [],
      timers: Function[] = [],
      writes: any[] = [];
    let sequence = 0,
      data!: Function,
      exit!: Function;
    const record = (...args: any[]) => writes.push(args);
    const { PtyTerminal } = backendLoader(
      {
        'node:crypto': { randomUUID: () => String(++sequence) },
        'node:readline': {
          createInterface: () => {
            const e = new EventEmitter();
            lines.push(e);
            return e;
          },
        },
        'node:child_process': {
          spawn: () => {
            const child = Object.assign(new EventEmitter(), {
              stdin: Object.assign(new EventEmitter(), { write: record, end: record }),
              stderr: new EventEmitter(),
              stdout: {},
              kill: record,
            });
            children.push(child);
            return child;
          },
        },
      },
      {
        process: { platform, env: {} },
        setTimeout: (fn: Function) => {
          timers.push(fn);
          return 1;
        },
        clearTimeout: () => {},
      },
    )(resolve('electron/pty-terminal.ts'));
    const pty = new PtyTerminal(async () => ({
      spawn: () => ({
        onData: (fn: Function) => (data = fn),
        onExit: (fn: Function) => (exit = fn),
        write: record,
        resize: record,
        kill: record,
      }),
    }));
    await assert.rejects(pty.open('/repo', 1, 24), /dimensions/);
    const pending = pty.open('/repo', 80, 24);
    if (platform === 'linux') {
      lines[0].emit('line', 'bad');
      lines[0].emit('line', JSON.stringify({ ready: true }));
      children[0].stdin.emit('error', Error('closed'));
    }
    const { id } = await pending;
    const emit = (text: string) =>
      platform === 'linux' ? lines[0].emit('line', JSON.stringify({ data: text })) : data(text);
    emit('x'.repeat(1000001));
    assert.equal(pty.read(id, 0).truncated, true);
    assert.equal(pty.read(id, 1000001).data, '');
    assert.throws(() => pty.read(id, -1), /cursor/);
    assert.throws(() => pty.read('missing', 0), /no longer/);
    assert.throws(() => pty.write(id, 'x'.repeat(100001)), /too long/);
    pty.write(id, 'input');
    pty.resize(id, 100, 30);
    if (platform === 'linux') {
      children[0].stderr.emit('data', Buffer.from('error'));
      children[0].stderr.emit('data', Buffer.from(' detail'));
      assert.equal(pty.read(id, 0).error, 'error detail');
    }
    pty.close(id);
    pty.close(id);
    pty.resize(id, 100, 30);
    assert.throws(() => pty.write(id, 'input'), /exited/);
    if (platform === 'win32') {
      exit();
      pty.closeAll();
      continue;
    }
    for (const mode of ['error', 'close', 'timeout']) {
      const next = pty.open('/repo', 80, 24);
      const rejection = assert.rejects(next, /Python|closed|timed out/);
      if (mode === 'timeout') timers.at(-1)!();
      else children.at(-1).emit(mode);
      await rejection;
    }
    for (let i = 0; i < 8; i++) {
      const next = pty.open('/repo', 80, 24);
      lines.at(-1).emit('line', '{"ready":true}');
      await next;
    }
    await assert.rejects(pty.open('/repo', 80, 24), /Close an existing/);
    pty.closeAll();
  }
});

test('command processes bound output, reject invalid input and release old runs without executing a shell', () => {
  for (const platform of ['linux', 'win32']) {
    let sequence = 0;
    const children: any[] = [],
      timers: Function[] = [],
      killed: any[] = [];
    const stream = () =>
      Object.assign(new EventEmitter(), {
        setEncoding() {
          return this;
        },
        write() {},
      });
    const { CommandTerminal } = backendLoader(
      {
        'node:crypto': { randomUUID: () => String(++sequence) },
        'node:child_process': {
          spawn: () => {
            const child = Object.assign(new EventEmitter(), {
              pid: 1,
              stdout: stream(),
              stderr: stream(),
              stdin: stream(),
              kill: (s: string) => killed.push(s),
            });
            children.push(child);
            return child;
          },
        },
        [resolve('electron/core.ts')]: {
          exec: () => {
            throw Error('Unexpected Git');
          },
        },
      },
      {
        process: { platform, env: {}, kill: (_pid: number, s: string) => killed.push(s) },
        setTimeout: (fn: Function) => {
          timers.push(fn);
          return { unref() {} };
        },
      },
    )(resolve('electron/conversation-tools.ts'));
    const terminal = new CommandTerminal();
    assert.throws(() => terminal.start('/repo', ''), /Enter a command/);
    assert.throws(() => terminal.status('missing'), /no longer/);
    assert.throws(() => terminal.input('missing', 'x'), /not running/);
    terminal.stop('missing');
    const run = terminal.start('/repo', 'command'),
      child = children.at(-1);
    child.stdout.emit('data', 'x'.repeat(100001));
    child.stdin.emit('error', Error('closed'));
    assert.equal(terminal.status(run.id).truncated, true);
    assert.throws(() => terminal.input(run.id, 'x'.repeat(10001)), /too long/);
    terminal.input(run.id, 'input');
    terminal.stop(run.id);
    timers.at(-1)!();
    assert.deepEqual(killed, ['SIGTERM', 'SIGKILL']);
    child.emit('close', 1);
    assert.equal(terminal.status(run.id).status, 'stopped');
    const failed = terminal.start('/repo', 'command');
    children.at(-1).emit('error', Error('spawn failed'));
    assert.equal(terminal.status(failed.id).status, 'failed');
    for (let i = 0; i < 41; i++) {
      const done = terminal.start('/repo', 'command');
      children.at(-1).emit('close', i % 2);
      assert.equal(terminal.status(done.id).status, i % 2 ? 'failed' : 'completed');
    }
    assert.throws(() => terminal.status(run.id), /no longer/);
    for (let i = 0; i < 8; i++) terminal.start('/repo', 'command');
    assert.throws(() => terminal.start('/repo', 'command'), /Stop an existing/);
    terminal.stopAll();
  }
});
test('terminal close settles pending startup and late Windows loading cannot spawn an orphan', async () => {
  let load!: (module: any) => void;
  let spawns = 0;
  const { PtyTerminal } = backendLoader(
    {},
    { process: { platform: 'win32', env: {} } },
  )(resolve('electron/pty-terminal.ts'));
  const terminal = new PtyTerminal(
    () =>
      new Promise((done) => {
        load = done;
      }),
  );
  const pending = terminal.open('/repo', 80, 24);
  const rejected = assert.rejects(pending, /closed before startup/);
  terminal.closeAll();
  await rejected;
  load({
    spawn: () => {
      spawns++;
      throw Error('Must not spawn');
    },
  });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(spawns, 0);
});
test('opening terminals reserve capacity before asynchronous native loading', async () => {
  const { PtyTerminal } = backendLoader(
    {},
    { process: { platform: 'win32', env: {} } },
  )(resolve('electron/pty-terminal.ts'));
  const terminal = new PtyTerminal(() => new Promise(() => {}));
  const pending = Array.from({ length: 8 }, () =>
    assert.rejects(terminal.open('/repo', 80, 24), /closed before startup/),
  );
  await assert.rejects(terminal.open('/repo', 80, 24), /Close an existing/);
  terminal.closeAll();
  await Promise.all(pending);
});
test('closing a Python terminal before readiness rejects startup and ignores late output', async () => {
  const lines = new EventEmitter();
  let kills = 0;
  const child = Object.assign(new EventEmitter(), {
    stdin: Object.assign(new EventEmitter(), { write() {}, end() {} }),
    stderr: new EventEmitter(),
    stdout: {},
    kill: () => {
      kills++;
    },
  });
  const { PtyTerminal } = backendLoader(
    {
      'node:crypto': { randomUUID: () => 'opening' },
      'node:readline': { createInterface: () => lines },
      'node:child_process': { spawn: () => child },
    },
    { process: { platform: 'linux', env: {} } },
  )(resolve('electron/pty-terminal.ts'));
  const terminal = new PtyTerminal();
  const pending = terminal.open('/repo', 80, 24);
  const rejected = assert.rejects(pending, /closed before startup/);
  assert.equal(terminal.read('opening', 0).phase, 'opening');
  assert.throws(() => terminal.resize('opening', 80, 25), /not ready/);
  assert.throws(() => terminal.write('opening', 'input'), /not ready/);
  terminal.closeAll();
  await rejected;
  lines.emit('line', '{"ready":true}');
  lines.emit('line', '{"data":"late"}');
  child.emit('close');
  assert.equal(terminal.read('opening', 0).phase, 'closed');
  assert.equal(terminal.read('opening', 0).data, '');
  terminal.close('opening');
  assert.equal(kills, 1);
});
