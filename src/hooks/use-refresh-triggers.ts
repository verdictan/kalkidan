import { useEffect, useRef } from 'react';
import type { API } from '../api/contracts';

// Read again at most once in this time when the window gets focus many times.
const focusIntervalMs = 2000;

/**
 * Calls `refresh` when `open` becomes true, when the window gets focus, and when the desktop
 * reports a change of the managed agents. Settings uses it in place of "Check again" buttons.
 * Set `initial` to false when the caller reads the first time itself.
 */
export function useRefreshTriggers(
  api: Pick<API, 'onVerdictanChanged'> | undefined,
  open: boolean,
  refresh: () => void,
  { initial = true }: { initial?: boolean } = {},
) {
  const latest = useRef(refresh);
  latest.current = refresh;
  useEffect(() => {
    if (!open) return;
    let last = 0;
    const run = () => {
      last = Date.now();
      latest.current();
    };
    const onFocus = () => {
      if (Date.now() - last >= focusIntervalMs) run();
    };
    if (initial) run();
    window.addEventListener('focus', onFocus);
    const unsubscribe = api?.onVerdictanChanged?.(run);
    return () => {
      window.removeEventListener('focus', onFocus);
      unsubscribe?.();
    };
  }, [api, open, initial]);
}
