import { createHash } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { resolve } from 'node:path';
import { backendLoader } from './helpers/backend-loader';
import { remoteProtocolVersion } from '../src/domain/host';

async function drain() {
  for (let i = 0; i < 60; i++) await Promise.resolve();
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
                            result:
                              row.method === 'chatStart'
                                ? {
                                    id: 'run',
                                    agent: 'codex',
                                    sessionId: 'session',
                                    status: 'running',
                                    activity: 'Waiting',
                                    messages: [
                                      { id: 'm', role: 'assistant', text: 'Saved output' },
                                    ],
                                    requests: [{ id: 'q', status: 'pending' }],
                                    approvals: [{ id: 'a', status: 'pending' }],
                                  }
                                : {
                                    protocol: mode === 'mismatch' ? 1 : remoteProtocolVersion,
                                    bundleDigest: createHash('sha256')
                                      .update('bundle')
                                      .digest('hex'),
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
  const resources: any[] = [];
  const hosts = new RemoteHosts(
    '/hosts',
    'bundle',
    () => {},
    (...args: any[]) => resources.push(args),
  );
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
  mode = 'install-timeout';
  const installation = hosts.install(host.id);
  assert.equal(hosts.install(host.id), installation);
  assert.equal(hosts.connect(host.id), installation);
  const canceled = assert.rejects(installation, /canceled/);
  await drain();
  const beforeCancel = children.length;
  assert.equal(hosts.list()[0].setup.phase, 'installing');
  hosts.disconnect(host.id);
  await canceled;
  children.at(-1).emit('close', 0);
  await drain();
  assert.equal(children.length, beforeCancel);
  assert.equal(hosts.list()[0].setup.phase, 'canceled');
  assert.equal(hosts.list()[0].status, 'disconnected');
  mode = 'normal';
  assert.equal((await hosts.install(host.id)).status, 'connected');
  assert.equal(hosts.list()[0].setup.phase, 'ready');
  assert.equal((await hosts.check(host.id)).status, 'connected');
  assert.equal((await hosts.connect(host.id)).status, 'connected');
  const reconciliation = hosts.reconcile();
  assert.equal(hosts.reconcile(), reconciliation);
  await reconciliation;
  assert.equal(hosts.list()[0].status, 'connected');
  lines
    .at(-1)
    .emit(
      'line',
      JSON.stringify({ event: 'project-resource-changed', groupId: 'g', resource: 'memory' }),
    );
  assert.deepEqual(resources, [[host.id, 'g', 'memory']]);
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
  const disconnectedChildren = children.length;
  await hosts.reconcile();
  assert.equal(children.length, disconnectedChildren);
  children.at(-1).emit('close');
  mode = 'mismatch';
  await assert.rejects(hosts.connect(host.id), /version mismatch/);
  mode = 'normal';
  await hosts.connect(host.id);
  await hosts.install(host.id);
  await hosts.call(host.id, 'chatStart', []);
  mode = 'silent';
  pending = hosts.call(host.id, 'operation', []);
  rejected = assert.rejects(pending, /broken/);
  children.at(-1).emit('error', Error('broken'));
  await rejected;
  const interrupted = await hosts.call(host.id, 'chatStatus', ['run']);
  assert.equal(interrupted.status, 'failed');
  assert.equal(interrupted.errorCode, 'transport_lost');
  assert.equal(interrupted.messages[0].text, 'Saved output');
  assert.equal(interrupted.requests[0].status, 'expired');
  assert.equal(interrupted.approvals[0].status, 'expired');
  await assert.rejects(hosts.call(host.id, 'chatRespond', ['run', 'q', {}]), /expired/);
  await assert.rejects(hosts.call(host.id, 'chatApprove', ['run', 'a', true]), /expired/);
  await hosts.call(host.id, 'chatStop', ['run']);
  await assert.rejects(hosts.call(host.id, 'operation', []), /offline/);
  mode = 'normal';
  await hosts.connect(host.id);
  mode = 'mismatch';
  await hosts.reconcile();
  assert.equal(hosts.list()[0].status, 'error');
  assert.match(hosts.list()[0].error, /version mismatch/);
  mode = 'normal';
  await hosts.connect(host.id);
  mode = 'silent';
  const wake = hosts.reconcile();
  await drain();
  for (const fn of [...timers.values()]) fn();
  await wake;
  assert.equal(hosts.list()[0].status, 'retry-wait');
  hosts.close();
  hosts.disconnect('missing');
  await hosts.remove(host.id);
  assert.deepEqual(hosts.list(), []);
});

test('startup reconnect is bounded, deduplicates manual connects, and respects disconnect and shutdown', async () => {
  const children: any[] = [];
  let notifications = 0;
  const saved = Array.from({ length: 5 }, (_, i) => ({
    id: String(i),
    name: `Host ${i}`,
    target: `host-${i}`,
    ...(i < 4 ? { version: 'a'.repeat(20) } : {}),
  }));
  const { RemoteHosts } = backendLoader({
    [resolve('electron/core.ts')]: { shellQuote: (value: string) => JSON.stringify(value) },
    'node:fs/promises': { readFile: async () => JSON.stringify(saved) },
    [resolve('electron/storage/atomic-json.ts')]: { writeJSON: async () => {} },
    'node:readline': { createInterface: ({ input }: any) => input },
    'node:child_process': {
      spawn: () => {
        const child = Object.assign(new EventEmitter(), {
          stdout: new EventEmitter(),
          stderr: new EventEmitter(),
          stdin: Object.assign(new EventEmitter(), {
            write: (line: string) => {
              child.request = JSON.parse(line);
            },
            end() {},
          }),
          request: null as any,
          killed: false,
          kill() {
            child.killed = true;
          },
        });
        children.push(child);
        return child;
      },
    },
  })(resolve('electron/remote-hosts.ts'));
  const hosts = new RemoteHosts('/hosts', '/bundle', () => notifications++);
  await hosts.load();
  const startup = hosts.connectSaved();
  await drain();
  assert.equal(children.length, 3);
  const same = hosts.connect('0');
  assert.equal(hosts.connect('0'), same);
  const reply = (index: number, error?: string) =>
    children[index].stdout.emit(
      'line',
      JSON.stringify({
        id: children[index].request.id,
        ...(error
          ? { error }
          : { result: { protocol: remoteProtocolVersion, node: 'v24', platform: 'linux' } }),
      }),
    );
  reply(0);
  await same;
  await drain();
  assert.equal(children.length, 4);
  hosts.disconnect('1');
  reply(1);
  reply(2, 'unreachable');
  reply(3);
  await startup;
  assert.deepEqual(
    hosts.list().map((host: any) => host.status),
    ['connected', 'disconnected', 'retry-wait', 'connected', 'disconnected'],
  );
  assert.ok(notifications > 0);
  hosts.close();
  await assert.rejects(hosts.connect('0'), /closing/);
  const next = new RemoteHosts('/hosts', '/bundle');
  await next.load();
  const count = children.length;
  const opening = next.connectSaved();
  next.close();
  await opening;
  assert.equal(children.length, count);
  assert.ok(children.slice(count).every((child) => child.killed));
});
