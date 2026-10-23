import { beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cancelQueuedSend,
  queueSendAfterSignIn,
  queuedSend,
  queuedSends,
  restoreQueuedSend,
  subscribeQueuedSend,
  takeQueuedSend,
} from '../src/lib/send-after-sign-in';

// A small browser: localStorage and window events. The module reads them only when called.
const store = new Map<string, string>();
const target = new EventTarget();
Object.assign(globalThis, {
  localStorage: {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
  },
  window: target,
});

beforeEach(() => store.clear());

test('a message waits in storage until a chat takes it, once', () => {
  queueSendAfterSignIn({ key: 'codex:1', text: 'Add rate limits', data: { repoId: 'r1' } });
  const item = queuedSend('codex:1');
  assert.equal(item?.text, 'Add rate limits');
  assert.deepEqual(item?.data, { repoId: 'r1' });
  assert.ok(store.has('kalkidan.queued-send.v1'));
  assert.equal(takeQueuedSend('codex:1')?.text, 'Add rate limits');
  // The second window gets nothing.
  assert.equal(takeQueuedSend('codex:1'), undefined);
  assert.equal(store.has('kalkidan.queued-send.v1'), false);
});

test('a new message for the same chat replaces the old one; others stay', () => {
  queueSendAfterSignIn({ key: 'a', text: 'one' });
  queueSendAfterSignIn({ key: 'b', text: 'two' });
  queueSendAfterSignIn({ key: 'a', text: 'three' });
  assert.equal(queuedSend('a')?.text, 'three');
  assert.deepEqual(
    queuedSends()
      .map((item) => item.key)
      .sort(),
    ['a', 'b'],
  );
  cancelQueuedSend('b');
  assert.equal(queuedSend('b'), undefined);
  assert.equal(queuedSend()?.key, 'a');
});

test('a failed send puts the message back', () => {
  queueSendAfterSignIn({ key: 'a', text: 'one' });
  const item = takeQueuedSend('a')!;
  restoreQueuedSend(item);
  assert.equal(queuedSend('a')?.text, 'one');
});

test('old or broken entries are ignored', () => {
  store.set(
    'kalkidan.queued-send.v1',
    JSON.stringify({
      old: { text: 'x', at: Date.now() - 30 * 24 * 60 * 60 * 1000 },
      broken: { at: Date.now() },
      good: { text: 'ok', at: Date.now() },
    }),
  );
  assert.deepEqual(
    queuedSends().map((item) => item.key),
    ['good'],
  );
  store.set('kalkidan.queued-send.v1', 'not json');
  assert.deepEqual(queuedSends(), []);
});

test('listeners hear each change, and the sign-in starts only on request', () => {
  let changes = 0;
  let signIns = 0;
  const stop = subscribeQueuedSend(() => changes++);
  target.addEventListener('kalkidan-sign-in', () => signIns++);
  queueSendAfterSignIn({ key: 'a', text: 'one' });
  queueSendAfterSignIn({ key: 'b', text: 'two' }, { startSignIn: true });
  takeQueuedSend('a');
  stop();
  cancelQueuedSend('b');
  assert.equal(changes, 3);
  assert.equal(signIns, 1);
});
