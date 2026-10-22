import { useEffect, useState } from 'react';
import type { API } from '../api/contracts';
import { runtimeOutdated, updateRunning } from '../lib/verdictan-labels';

export interface UpdateSummary {
  /** True when an update waits for the user: an SSH helper or the managed agents runtime. */
  available: boolean;
  /** Plain words for the dot tooltip, for example "SSH helper update for devbox". */
  label?: string;
}

/** Settings fires this event after it checks for or installs a runtime update. */
export const updatesChangedEvent = 'kalkidan-updates-changed';

export function notifyUpdatesChanged() {
  window.dispatchEvent(new Event(updatesChangedEvent));
}

// Read the cached state at most once each minute when the window gets focus.
const focusIntervalMs = 60_000;
const pollIntervalMs = 30 * 60_000;

/**
 * If an SSH helper or runtime update is available, for the dot on the sidebar Settings row.
 * The dot opens Settings › Computers. It reads the cached update state. It does not download.
 */
export function useUpdateStatus(api: API): UpdateSummary {
  const [summary, setSummary] = useState<UpdateSummary>({ available: false });
  useEffect(() => {
    let live = true;
    let last = 0;
    const read = async () => {
      last = Date.now();
      const [helpers, runtime] = await Promise.allSettled([
        Promise.resolve().then(() => api.helperUpdates?.()),
        Promise.resolve().then(() => api.runtimeUpdateStatus?.('local')),
      ]);
      if (!live) return;
      const labels: string[] = [];
      if (helpers.status === 'fulfilled' && helpers.value) {
        const helpersAvailable = helpers.value.filter((helper) => helper.discovery === 'available');
        if (helpersAvailable.length === 1)
          labels.push(`SSH helper update for ${helpersAvailable[0].name}`);
        else if (helpersAvailable.length > 1)
          labels.push(`${helpersAvailable.length} SSH helper updates`);
      }
      if (runtime.status === 'fulfilled' && runtime.value) {
        const status = runtime.value;
        // A runtime that is not installed is part of setup. Only updates count here.
        if (status.installed && runtimeOutdated(status) && !updateRunning(status))
          labels.push(`Managed agents runtime ${status.latest!.version} available`);
      }
      setSummary(
        labels.length ? { available: true, label: labels.join(' · ') } : { available: false },
      );
    };
    const refresh = () => void read().catch(() => {});
    const onFocus = () => {
      if (Date.now() - last >= focusIntervalMs) refresh();
    };
    refresh();
    const timer = setInterval(refresh, pollIntervalMs);
    window.addEventListener('focus', onFocus);
    window.addEventListener(updatesChangedEvent, refresh);
    const unsubscribe = api.onRemoteHostsChange?.(refresh);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(updatesChangedEvent, refresh);
      unsubscribe?.();
    };
  }, [api]);
  return summary;
}
