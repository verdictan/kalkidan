import test from 'node:test';
import assert from 'node:assert/strict';
import { ProjectLoadCache } from '../src/domain/project-loading';
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
test('project loads deduplicate, reuse fresh data and preserve stale data through refresh errors', async () => {
  let now = 100;
  const cache = new ProjectLoadCache<string>(10, 2, () => now);
  const first = deferred<string>();
  let calls = 0;
  const fetch = () => {
    calls++;
    return first.promise;
  };
  assert.equal(cache.read('a').status, 'idle');
  const pending = cache.load('a', fetch);
  assert.equal(cache.read('a').status, 'loading');
  assert.equal(cache.load('a', fetch), pending);
  first.resolve('A');
  await pending;
  await cache.load('a', fetch);
  assert.equal(calls, 1);
  now = 111;
  const failed = deferred<string>();
  const refresh = cache.load('a', () => failed.promise);
  assert.deepEqual(cache.read('a'), { status: 'refreshing', value: 'A' });
  failed.reject(Error('offline'));
  await refresh;
  assert.deepEqual(cache.read('a'), { status: 'error', value: 'A', error: 'offline' });
  await cache.load('a', async () => 'Recovered');
  assert.equal(cache.read('a').value, 'Recovered');
});
test('project switching, invalidation, and eviction never let an old response overwrite current details', async () => {
  const cache = new ProjectLoadCache<string>(100, 2, () => 1);
  const old = deferred<string>();
  const previous = cache.load('a', () => old.promise);
  await cache.load('b', async () => 'B');
  assert.equal(cache.read('b').value, 'B');
  cache.invalidate();
  await cache.load('a', async () => 'New A');
  old.resolve('Old A');
  await previous;
  assert.equal(cache.read('a').value, 'New A');
  await cache.load('b', async () => 'New B');
  await cache.load('c', async () => 'C');
  assert.equal(cache.read('a').status, 'idle');
  cache.retain(new Set(['c']));
  assert.equal(cache.read('b').status, 'idle');
  assert.equal(cache.read('c').value, 'C');
});
test('evicted pending loads cannot repopulate the cache and listeners can unsubscribe', async () => {
  const cache = new ProjectLoadCache<string>(1, 1, () => 1);
  let notifications = 0;
  const stop = cache.subscribe(() => notifications++);
  const slow = deferred<string>();
  const pending = cache.load('slow', () => slow.promise);
  await cache.load('fast', async () => 'fast');
  const before = notifications;
  slow.resolve('old');
  await pending;
  assert.equal(notifications, before);
  assert.equal(cache.read('slow').status, 'idle');
  stop();
  cache.invalidate();
  assert.equal(notifications, before);
});

test('invalidating one project preserves other projects and detaches its old request', async () => {
  const cache = new ProjectLoadCache<string>();
  await cache.load('b', async () => 'B');
  const old = deferred<string>();
  const pending = cache.load('a', () => old.promise);
  cache.invalidate('a');
  await cache.load('a', async () => 'Updated');
  old.resolve('Outdated');
  await pending;
  await cache.load('b', async () => {
    throw Error('Fresh project must not reload');
  });
  assert.equal(cache.read('a').value, 'Updated');
  assert.equal(cache.read('b').status, 'ready');
  assert.equal(cache.read('b').value, 'B');
});

test('body caches enforce a byte budget and a saved revision defeats an older pending read', async () => {
  const cache = new ProjectLoadCache<string>(100, 40, () => 0, 12);
  cache.set('one', '123456');
  cache.set('two', 'abcdef');
  assert.equal(cache.read('one').status, 'idle');
  assert.equal(cache.read('two').value, 'abcdef');
  const slow = deferred<string>();
  const pending = cache.load('three', () => slow.promise);
  cache.set('three', 'saved');
  slow.resolve('outdated');
  await pending;
  assert.equal(cache.read('three').value, 'saved');
  cache.invalidateWhere((key) => key === 'three');
  await cache.load('three', async () => 'x'.repeat(20));
  assert.equal(cache.read('two').status, 'idle');
  let reloaded = false;
  await cache.load('three', async () => {
    reloaded = true;
    return 'small';
  });
  assert.equal(reloaded, true);
});
