import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RemoteHosts } from '../electron/remote-hosts';
import { remoteProtocolVersion } from '../src/domain/host';

/** A connection that answers each request with the reply for its method. */
function fakeConnection(replies: Map<string, unknown>) {
  const connection = {
    brokerPending: new Set<string>(),
    stderr: '',
    pending: new Map<
      string,
      { resolve: (v: any) => void; reject: (e: Error) => void; timer: any }
    >(),
    child: {
      kill() {},
      stdin: {
        end() {},
        write(line: string) {
          const { id, method } = JSON.parse(line);
          const entry = connection.pending.get(id)!;
          clearTimeout(entry.timer);
          connection.pending.delete(id);
          queueMicrotask(() => entry.resolve(structuredClone(replies.get(method))));
        },
      },
    },
  };
  return connection;
}

test('a host tells the listener once when it becomes connected', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'kalkidan-connected-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const hosts = new RemoteHosts(join(root, 'hosts.json'), join(root, 'agent.cjs'));
  const connected: string[] = [];
  hosts.onConnected((hostId) => connected.push(hostId));
  (hosts as any).hosts = [
    { id: 'h', name: 'Devbox', target: 'user@devbox', status: 'error', version: 'a'.repeat(20) },
  ];
  const replies = new Map<string, unknown>([['hello', { protocol: remoteProtocolVersion }]]);
  (hosts as any).connections.set('h', fakeConnection(replies));
  const first = await (hosts as any).openConnection('h');
  assert.equal(first.status, 'connected');
  assert.deepEqual(connected, ['h']);
  // A check of a host that is already connected does not tell the listener again.
  await (hosts as any).openConnection('h');
  assert.deepEqual(connected, ['h']);
});

test('a listener error does not break the connection', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'kalkidan-connected-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const hosts = new RemoteHosts(join(root, 'hosts.json'), join(root, 'agent.cjs'));
  hosts.onConnected(() => {
    throw new Error('listener failed');
  });
  (hosts as any).hosts = [
    { id: 'h', name: 'Devbox', target: 'user@devbox', status: 'error', version: 'a'.repeat(20) },
  ];
  const replies = new Map<string, unknown>([['hello', { protocol: remoteProtocolVersion }]]);
  (hosts as any).connections.set('h', fakeConnection(replies));
  const host = await (hosts as any).openConnection('h');
  assert.equal(host.status, 'connected');
});
