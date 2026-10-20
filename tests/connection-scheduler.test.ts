import test from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionScheduler, type RetryState } from '../electron/connection-scheduler';
const drain = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};
test('connections share a bounded queue, back off, stop, and reset only after stability', async () => {
  let now = 0;
  const timers = new Map<() => void, number>();
  const states = new Map<string, RetryState>();
  const pending = new Map<string, { resolve(): void; reject(error: Error): void }>();
  const calls: string[] = [];
  const scheduler = new ConnectionScheduler(
    (id) => {
      calls.push(id);
      return new Promise<void>((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    (id, state) => states.set(id, state),
    {
      now: () => now,
      random: () => 1,
      later: (fn, ms) => {
        timers.set(fn, ms);
        return () => {
          timers.delete(fn);
        };
      },
    },
  );
  for (const id of ['a', 'b', 'c', 'd']) scheduler.start(id);
  scheduler.start('a');
  await drain();
  assert.deepEqual(calls, ['a', 'b', 'c']);
  pending.get('a')!.resolve();
  await drain();
  assert.equal(calls.at(-1), 'd');
  scheduler.failed('a', 'network down');
  assert.equal(states.get('a')!.retryAt, 1000);
  const retry = [...timers].find(([, ms]) => ms === 1000)![0];
  timers.delete(retry);
  now = 1000;
  retry();
  pending.get('b')!.resolve();
  await drain();
  assert.equal(calls.at(-1), 'a');
  pending.get('a')!.resolve();
  await drain();
  assert.equal(states.get('a')!.attempt, 2);
  for (const [fn, ms] of [...timers])
    if (ms === 60000) {
      timers.delete(fn);
      fn();
    }
  assert.equal(states.get('a')!.attempt, 0);
  pending.get('c')!.reject(Error('Permission denied'));
  await drain();
  assert.equal(states.get('c')!.status, 'error');
  scheduler.failed('a', 'network');
  scheduler.stop('a');
  for (const fn of [...timers.keys()]) fn();
  await drain();
  assert.equal(calls.filter((id) => id === 'a').length, 2);
  scheduler.close();
  pending.get('d')!.resolve();
  await drain();
  scheduler.start('new');
  assert.ok(!calls.includes('new'));
});
test('retry budget is finite and terminal errors do not spin', async () => {
  let next: (() => void) | undefined;
  let state: RetryState | undefined;
  const scheduler = new ConnectionScheduler(
    async () => {
      throw Error('offline');
    },
    (_id, value) => {
      state = value;
    },
    {
      now: () => 0,
      random: () => 0,
      later: (fn) => {
        next = fn;
        return () => {
          next = undefined;
        };
      },
    },
  );
  scheduler.start('host');
  for (let i = 0; i < 8; i++) {
    await drain();
    const fn = next;
    next = undefined;
    fn?.();
  }
  await drain();
  assert.equal(state?.status, 'error');
  assert.equal(state?.attempt, 8);
  scheduler.close();
});

test('a drop before handshake completion cannot publish a connected state', async () => {
  let complete!: () => void;
  let state: RetryState | undefined;
  const scheduler = new ConnectionScheduler(
    () =>
      new Promise<void>((resolve) => {
        complete = resolve;
      }),
    (_id, value) => {
      state = value;
    },
    { now: () => 0, random: () => 0, later: () => () => {} },
  );
  scheduler.start('host');
  await drain();
  scheduler.failed('host', 'transport closed');
  complete();
  await drain();
  assert.equal(state?.status, 'retry-wait');
  scheduler.close();
});
