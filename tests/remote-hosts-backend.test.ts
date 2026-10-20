import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import { backendLoader } from './helpers/backend-loader';

async function drain() {
  for (let i = 0; i < 15; i++) await Promise.resolve();
}
test('SSH lifecycle handles install failures, corrupt envelopes, RPC errors, timeouts and disconnects with a simulated transport', async () => {
  let text = '[]',
    checkFail = false,
    mode = 'normal',
    sequence = 0;
  const children: any[] = [],
    lines: any[] = [],
    timers = new Map<any, Function>();
  const { RemoteHosts } = backendLoader(
    {
      'node:fs/promises': {
        readFile: async (path: string) => (path === 'bundle' ? Buffer.from('bundle') : text),
      },
      'node:readline': {
        createInterface: () => {
          const stream = new EventEmitter();
          lines.push(stream);
          return stream;
        },
      },
      [resolve('electron/storage/atomic-json.ts')]: { writeJSON: async () => {} },
      [resolve('electron/core.ts')]: {
        shellQuote: (s: string) => JSON.stringify(s),
        exec: async () => {
          if (checkFail) throw { stderr: 'cannot connect' };
          return { stdout: 'banner\n{"node":"v24","platform":"linux"}' };
        },
      },
      'node:child_process': {
        spawn: (_cmd: string, args: string[]) => {
          const install = args.at(-1)!.includes('umask');
          const child = Object.assign(new EventEmitter(), {
            stdout: {},
            stderr: new EventEmitter(),
            stdin: Object.assign(new EventEmitter(), {
              end: () => {
                if (install)
                  queueMicrotask(() => {
                    if (mode === 'install-error') child.emit('error', Error('spawn'));
                    else if (mode !== 'install-timeout')
                      child.emit('close', mode === 'install-fail' ? 1 : 0);
                  });
              },
              write: (line: string) => {
                const row = JSON.parse(line);
                if (mode === 'silent') return;
                queueMicrotask(() =>
                  lines.at(-1).emit(
                    'line',
                    JSON.stringify({
                      id: row.id,
                      ...(mode === 'rpc-error'
                        ? { error: 'remote failure' }
                        : {
                            result: {
                              protocol: mode === 'mismatch' ? 2 : 1,
                              node: 'v24',
                              platform: 'linux',
                            },
                          }),
                    }),
                  ),
                );
              },
            }),
            kill() {},
          });
          children.push(child);
          return child;
        },
      },
    },
    {
      setTimeout: (fn: Function) => {
        const key = ++sequence;
        timers.set(key, fn);
        return key;
      },
      clearTimeout: (id: any) => timers.delete(id),
    },
  )(resolve('electron/remote-hosts.ts'));
  const hosts = new RemoteHosts('/hosts', 'bundle');
  text = '{}';
  await assert.rejects(hosts.load(), /Invalid remote/);
  text = '[{"id":"saved","target":"saved-host","status":"connected"}]';
  await hosts.load();
  assert.equal(hosts.list()[0].status, 'disconnected');
  text = '[]';
  await hosts.load();
  await assert.rejects(hosts.add('', 'host'), /host name/);
  const host = await hosts.add('Host', 'target');
  assert.equal((await hosts.add('Again', 'target')).id, host.id);
  await assert.rejects(hosts.connect(host.id), /Install/);
  await assert.rejects(hosts.check('missing'), /not found/);
  checkFail = true;
  await assert.rejects(hosts.check(host.id), /SSH check failed/);
  checkFail = false;
  for (mode of ['install-error', 'install-fail', 'install-timeout']) {
    const pending = hosts.install(host.id);
    const rejected = assert.rejects(pending, /spawn|failed|timed out/);
    await drain();
    if (mode === 'install-timeout') for (const fn of [...timers.values()]) fn();
    await rejected;
  }
  mode = 'normal';
  assert.equal((await hosts.install(host.id)).status, 'connected');
  assert.equal((await hosts.check(host.id)).status, 'connected');
  assert.equal((await hosts.connect(host.id)).status, 'connected');
  lines.at(-1).emit('line', 'bad');
  lines.at(-1).emit('line', 'x'.repeat(8000001));
  lines.at(-1).emit('line', '{"id":"unknown"}');
  children.at(-1).stdin.emit('error', Error('closed'));
  children.at(-1).stderr.emit('data', Buffer.from('details'));
  mode = 'rpc-error';
  await assert.rejects(hosts.call(host.id, 'operation', []), /remote failure/);
  mode = 'silent';
  let pending = hosts.call(host.id, 'clone', []);
  let rejected = assert.rejects(pending, /timed out/);
  for (const fn of [...timers.values()]) fn();
  await rejected;
  pending = hosts.call(host.id, 'operation', []);
  rejected = assert.rejects(pending, /disconnected/);
  hosts.disconnect(host.id);
  await rejected;
  children.at(-1).emit('close');
  mode = 'mismatch';
  await assert.rejects(hosts.connect(host.id), /version mismatch/);
  mode = 'normal';
  await hosts.connect(host.id);
  await hosts.install(host.id);
  mode = 'silent';
  pending = hosts.call(host.id, 'operation', []);
  rejected = assert.rejects(pending, /broken/);
  children.at(-1).emit('error', Error('broken'));
  await rejected;
  await assert.rejects(hosts.call(host.id, 'operation', []), /offline/);
  mode = 'normal';
  await hosts.connect(host.id);
  hosts.close();
  hosts.disconnect('missing');
  await hosts.remove(host.id);
  assert.deepEqual(hosts.list(), []);
});
