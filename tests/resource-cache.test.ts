import test from 'node:test';
import assert from 'node:assert/strict';
import { ResourceCache } from '../electron/resource-cache';
test('backend cache coalesces reads, isolates callers, bounds memory and rejects stale completion', async () => {
  let now = 0,
    calls = 0;
  const cache = new ResourceCache<{ items: string[] }>(10, 2, 100, () => now);
  let resolve!: (value: { items: string[] }) => void;
  const fetch = () => {
    calls++;
    return new Promise<{ items: string[] }>((done) => {
      resolve = done;
    });
  };
  const first = cache.read('a', fetch);
  const second = cache.read('a', fetch);
  await Promise.resolve();
  assert.equal(calls, 1);
  resolve({ items: ['A'] });
  const a = await first;
  a.items.push('mutation');
  assert.deepEqual(await second, { items: ['A'] });
  await cache.read('a', fetch);
  assert.equal(calls, 1);
  now = 11;
  const stale = cache.read('a', fetch);
  await Promise.resolve();
  cache.invalidate('a');
  await cache.read('a', async () => ({ items: ['new'] }), true);
  resolve({ items: ['old'] });
  await stale;
  assert.deepEqual(await cache.read('a', fetch), { items: ['new'] });
  await cache.read('b', async () => ({ items: ['B'] }));
  await cache.read('c', async () => ({ items: ['C'] }));
  await assert.rejects(
    cache.read('a', async () => {
      throw Error('evicted');
    }),
    /evicted/,
  );
  await cache.read('big', async () => ({ items: ['x'.repeat(120)] }));
  await assert.rejects(
    cache.read('big', async () => {
      throw Error('not cached');
    }),
    /not cached/,
  );
  cache.invalidate();
});
