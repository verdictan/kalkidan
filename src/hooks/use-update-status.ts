import { useEffect, useState } from 'react';
import type { API } from '../api/contracts';
import type { DesktopUpdateStatus } from '../domain/updates';
import { displayVersion } from '../lib/verdictan-labels';

export interface UpdateSummary {
  /**
   * True only when a Kalkidan desktop update is downloaded and ready to install with a restart.
   * The runtime and the SSH helpers update by themselves, so they do not count.
   */
  available: boolean;
  /** Plain words for the "Update" pill tooltip, for example "Kalkidan 1.5.0 is ready". */
  label?: string;
}

/** Settings fires this event after it checks for or installs updates. */
export const updatesChangedEvent = 'kalkidan-updates-changed';

export function notifyUpdatesChanged() {
  window.dispatchEvent(new Event(updatesChangedEvent));
}

/** True when a desktop update is staged, so only a restart is necessary. */
export function desktopUpdateReady(desktop: DesktopUpdateStatus | undefined) {
  return desktop?.install.kind !== 'development' && desktop?.update?.phase === 'staged';
}

// Read the cached state at most once each minute when the window gets focus.
const focusIntervalMs = 60_000;
const pollIntervalMs = 30 * 60_000;

/**
 * If a desktop update is ready to restart, for the "Update" pill on the sidebar. The pill
 * opens Settings › About. It reads the cached update state. It does not download anything.
 */
export function useUpdateStatus(api: API): UpdateSummary {
  const [summary, setSummary] = useState<UpdateSummary>({ available: false });
  useEffect(() => {
    // Older desktop builds and the browser demo do not report updates.
    if (typeof api.componentUpdates !== 'function') return;
    let live = true;
    let last = 0;
    const read = async () => {
      last = Date.now();
      const { desktop } = await api.componentUpdates(false);
      if (!live) return;
      setSummary(
        desktopUpdateReady(desktop)
          ? {
              available: true,
              label: `Kalkidan ${displayVersion(desktop.update!.version)} is ready. Restart to update.`,
            }
          : { available: false },
      );
    };
    const refresh = () =>
      void Promise.resolve()
        .then(read)
        .catch(() => {});
    const onFocus = () => {
      if (Date.now() - last >= focusIntervalMs) refresh();
    };
    refresh();
    const timer = setInterval(refresh, pollIntervalMs);
    window.addEventListener('focus', onFocus);
    window.addEventListener(updatesChangedEvent, refresh);
    return () => {
      live = false;
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(updatesChangedEvent, refresh);
    };
  }, [api]);
  return summary;
}
