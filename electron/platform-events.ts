import { networkInterfaces } from 'node:os';

/** The work that the app does after the computer wakes or the network changes. */
export interface ConnectionRecovery {
  /** Stop each managed gateway whose credential expired while the computer slept. */
  checkExpiry(): void;
  /** Check each SSH connection, and reconnect the hosts that do not answer. */
  reconcileHosts(): Promise<unknown>;
  /** Renew the account session when it expires soon. */
  renewAccount(): Promise<unknown>;
  /** Check for a runtime release. A recent successful check uses no network. */
  checkRuntime(): Promise<unknown>;
}

/**
 * Recover after a sleep or a network change. Expired credentials stop first, so that no request
 * uses them. The other steps run together, and a failure of one step does not stop the others.
 * No step replays a request or a mutation.
 */
export async function recoverConnections(recovery: ConnectionRecovery) {
  try {
    recovery.checkExpiry();
  } catch {
    // A failed expiry check must not stop the reconnection.
  }
  const steps = [recovery.reconcileHosts, recovery.renewAccount, recovery.checkRuntime];
  return Promise.allSettled(steps.map(async (step) => step.call(recovery)));
}

/** The external network addresses of this computer. A change means a different network. */
export function networkFingerprint(read = networkInterfaces) {
  const addresses: string[] = [];
  try {
    for (const [name, entries] of Object.entries(read()))
      for (const entry of entries || [])
        if (!entry.internal) addresses.push(`${name}/${entry.family}/${entry.address}`);
  } catch {
    // Without the list, only the online state shows a change.
    return '';
  }
  return addresses.sort().join(',');
}

export interface WatcherClock {
  later(fn: () => void, ms: number): () => void;
}
const timers: WatcherClock = {
  later(fn, ms) {
    const timer = setTimeout(fn, ms);
    timer.unref?.();
    return () => clearTimeout(timer);
  },
};

/**
 * Watches for a network change. The Electron main process has no event for it, so the watcher
 * reads the state at an interval. It reports when the computer comes online, and when the
 * network addresses change while it is online, for example after a change to another Wi-Fi.
 */
export class NetworkWatcher {
  private online = false;
  private fingerprint = '';
  private cancel?: () => void;
  constructor(
    private isOnline: () => boolean,
    private changed: (reason: 'online' | 'offline' | 'network-changed') => void,
    private fingerprintOf: () => string = networkFingerprint,
    private clock: WatcherClock = timers,
    private intervalMs = 5000,
  ) {}
  start() {
    if (this.cancel) return;
    this.online = this.isOnline();
    this.fingerprint = this.fingerprintOf();
    this.schedule();
  }
  private schedule() {
    this.cancel = this.clock.later(() => this.tick(), this.intervalMs);
  }
  /** Read the network state once. Tests call this directly. */
  tick() {
    try {
      const online = this.isOnline();
      const fingerprint = this.fingerprintOf();
      const wasOnline = this.online;
      const moved = fingerprint !== this.fingerprint;
      this.online = online;
      this.fingerprint = fingerprint;
      if (online && !wasOnline) this.changed('online');
      else if (!online && wasOnline) this.changed('offline');
      else if (online && moved) this.changed('network-changed');
    } catch {
      // A failed read changes nothing. The next read tries again.
    }
    if (this.cancel) this.schedule();
  }
  close() {
    this.cancel?.();
    this.cancel = undefined;
  }
}
