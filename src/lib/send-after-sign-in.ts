// A message that the user sent while signed out. It waits until the account is signed in, then
// the chat sends it. It is kept in localStorage, so it stays through the browser sign-in and a
// restart of Kalkidan. One message for each chat key; a new message replaces the old one.

/** One message that waits for the sign-in. */
export interface QueuedSend {
  /** The chat key that the chat gives, for example `${agent}:${id}` or 'home'. */
  key: string;
  /** The typed text. */
  text: string;
  /** Other values that the chat needs to send, for example the repo and the agent. */
  data?: Record<string, unknown>;
  /** When the user sent it, in ms. */
  at: number;
}

const storageKey = 'kalkidan.queued-send.v1';
const changeEvent = 'kalkidan-queued-send-change';
// A message older than this does not send by itself. The chat shows it as a draft.
const maxAgeMs = 7 * 24 * 60 * 60 * 1000;

function readAll(): Record<string, QueuedSend> {
  try {
    const raw = localStorage.getItem(storageKey);
    const value = raw ? (JSON.parse(raw) as unknown) : {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result: Record<string, QueuedSend> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const entry = item as Partial<QueuedSend> | null;
      if (
        entry &&
        typeof entry.text === 'string' &&
        typeof entry.at === 'number' &&
        Date.now() - entry.at < maxAgeMs
      )
        result[key] = { key, text: entry.text, data: entry.data, at: entry.at };
    }
    return result;
  } catch {
    return {};
  }
}

function writeAll(items: Record<string, QueuedSend>) {
  try {
    if (Object.keys(items).length) localStorage.setItem(storageKey, JSON.stringify(items));
    else localStorage.removeItem(storageKey);
  } catch {
    /* Without storage the message waits only in this window. */
  }
  window.dispatchEvent(new Event(changeEvent));
}

/** The message that waits for this key, or the newest message when there is no key. */
export function queuedSend(key?: string): QueuedSend | undefined {
  const items = readAll();
  if (key) return items[key];
  return Object.values(items).sort((a, b) => b.at - a.at)[0];
}

/** All the messages that wait, the oldest first. */
export function queuedSends(): QueuedSend[] {
  return Object.values(readAll()).sort((a, b) => a.at - b.at);
}

/**
 * Keeps a message until the account is signed in. The chat that has `useSendAfterSignIn` for
 * this key sends it then. The chat shows the sign-in card (`SignInGate`) under the message. With
 * `startSignIn`, the sign-in dialog also opens at once.
 */
export function queueSendAfterSignIn(
  item: { key: string; text: string; data?: Record<string, unknown> },
  options: { startSignIn?: boolean } = {},
) {
  const items = readAll();
  items[item.key] = { key: item.key, text: item.text, data: item.data, at: Date.now() };
  writeAll(items);
  if (options.startSignIn)
    window.dispatchEvent(new CustomEvent('kalkidan-sign-in', { detail: { intent: 'login' } }));
}

/** Removes the message of this key. It does not send. */
export function cancelQueuedSend(key: string) {
  const items = readAll();
  if (!items[key]) return;
  delete items[key];
  writeAll(items);
}

/**
 * Removes the message of this key and returns it. Only one caller gets it, also with more
 * windows, because the item goes from the storage before the caller sends it.
 */
export function takeQueuedSend(key: string): QueuedSend | undefined {
  const items = readAll();
  const item = items[key];
  if (!item) return undefined;
  delete items[key];
  writeAll(items);
  return item;
}

/** Puts a message back, for example after the send failed. */
export function restoreQueuedSend(item: QueuedSend) {
  const items = readAll();
  if (!items[item.key]) items[item.key] = item;
  writeAll(items);
}

/** Calls `listener` when a message is added or removed, in this window or in another one. */
export function subscribeQueuedSend(listener: () => void) {
  const onStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === storageKey) listener();
  };
  window.addEventListener(changeEvent, listener);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(changeEvent, listener);
    window.removeEventListener('storage', onStorage);
  };
}
