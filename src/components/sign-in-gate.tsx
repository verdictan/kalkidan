import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { API } from '../api/contracts';
import { useVerdictanStatus } from '../hooks/use-verdictan-status';
import {
  cancelQueuedSend,
  queuedSend,
  restoreQueuedSend,
  subscribeQueuedSend,
  takeQueuedSend,
  type QueuedSend,
} from '../lib/send-after-sign-in';
import { SignInSteps } from './sign-in-steps';

export {
  cancelQueuedSend,
  queueSendAfterSignIn,
  queuedSend,
  type QueuedSend,
} from '../lib/send-after-sign-in';

/**
 * True when a Verdictan account is signed in. Undefined while Kalkidan reads the state. Always
 * true in builds without accounts (the browser preview without a demo account).
 */
export function useSignedIn(api: API): boolean | undefined {
  const { status, supported } = useVerdictanStatus(api);
  if (!supported) return true;
  if (!status) return undefined;
  return status.phase === 'authenticated';
}

/**
 * The message of this chat that waits for the sign-in. When the account becomes signed in, it
 * calls `onSend` once with the message. The message goes from the storage first, so no other
 * window sends it again. When `onSend` fails, the message comes back.
 */
export function useSendAfterSignIn(
  api: API,
  key: string | undefined,
  onSend: (item: QueuedSend) => void | Promise<void>,
) {
  const queued = useSyncExternalStore(
    subscribeQueuedSend,
    () => (key ? snapshot(key) : undefined),
    () => undefined,
  );
  const { status, supported } = useVerdictanStatus(api);
  const signedIn = !supported || status?.phase === 'authenticated';
  const send = useRef(onSend);
  send.current = onSend;
  const [sending, setSending] = useState(false);
  useEffect(() => {
    if (!key || !queued || !signedIn || sending) return;
    const item = takeQueuedSend(key);
    if (!item) return;
    setSending(true);
    void Promise.resolve()
      .then(() => send.current(item))
      .catch((failure: unknown) => {
        restoreQueuedSend(item);
        console.error(failure);
      })
      .finally(() => setSending(false));
  }, [key, queued, signedIn, sending]);
  return {
    queued: queued ? parse(queued) : undefined,
    signingIn: status?.phase === 'authorizing',
    sending,
    cancel: () => key && cancelQueuedSend(key),
  };
}

// useSyncExternalStore needs a stable value: a string of the message, not a new object.
function snapshot(key: string) {
  const item = queuedSend(key);
  return item ? JSON.stringify(item) : undefined;
}

function parse(value: string) {
  return JSON.parse(value) as QueuedSend;
}

/**
 * The card under a message that waits for the sign-in: "Sign in to run agents", the account or
 * the region, and one brown "Sign in". The sign-in runs in the card. When it finishes, the
 * waiting message sends by itself (see `useSendAfterSignIn`).
 */
export function SignInGate({ api, onFinished }: { api: API; onFinished?: () => void }) {
  if (typeof api.verdictanStatus !== 'function') return null;
  return <SignInSteps api={api} mode="gate" onFinished={() => onFinished?.()} />;
}
