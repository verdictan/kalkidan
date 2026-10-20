import test from 'node:test';
import assert from 'node:assert/strict';
import { RemoteSnapshotCache } from '../electron/remote-snapshot-cache';

test('remote scans return immediately, deduplicate, retain data on failure and ignore removed hosts', async () => {
  let now = 1;
  let changes = 0;
  let finish!: (value: string) => void;
  let calls = 0;
  const cache = new RemoteSnapshotCache<string>(
    () => changes++,
    () => now,
  );
  const fetch = () => {
    calls++;
    return new Promise<string>((resolve) => {
      finish = resolve;
    });
  };
  assert.equal(cache.read('host', fetch).value, undefined);
  cache.read('host', fetch);
  await Promise.resolve();
  assert.equal(calls, 1);
  finish('sessions');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(cache.read('host', fetch).value, 'sessions');
  assert.equal(changes, 1);
  now += 15001;
  assert.equal(
    cache.read('host', async () => {
      throw Error('offline');
    }).value,
    'sessions',
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(cache.read('host', fetch), { value: 'sessions', error: 'offline' });
  now += 15001;
  cache.read('host', fetch);
  await Promise.resolve();
  cache.retain(new Set());
  finish('old');
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(changes, 2);
  assert.equal(cache.read('host', async () => 'new').value, undefined);
});
