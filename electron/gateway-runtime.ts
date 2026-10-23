import type { GatewayRuntimeState } from '../src/domain/desktop';
import type { ComponentUpdateStatus, UpdatePhase } from '../src/domain/updates';

/** Phases after which the installed runtime may not run: install it again. */
const repairPhases = new Set<UpdatePhase>(['interrupted', 'unknown-outcome', 'rollback-failed']);
/** Phases of an operation that does not run now. */
const endPhases = new Set<UpdatePhase>([
  ...repairPhases,
  'completed',
  'canceled',
  'failed',
  'rolled-back',
]);

/** The words for a failure that the user can act on. No codes and no paths. */
const failureMessage =
  'Kalkidan could not set up its connection to Verdictan. Check your network, then try again.';

/**
 * The state that the renderer shows: only a failure is a message. A failed update of a runtime
 * that is installed is not a failure: the installed runtime still runs, and the next check
 * tries the update again.
 */
export function gatewayRuntimeState(
  status: ComponentUpdateStatus | undefined,
  lastError?: string,
): GatewayRuntimeState {
  if (!status)
    return lastError ? { state: 'failed', message: failureMessage } : { state: 'unknown' };
  if (status.installing || (status.operation && !endPhases.has(status.operation.phase)))
    return { state: 'working' };
  if (!needsRepair(status)) return { state: 'ready' };
  if (lastError || status.operation) return { state: 'failed', message: failureMessage };
  return { state: 'unknown' };
}

/** True when the runtime is missing, or its last install did not finish. */
export function needsRepair(status: ComponentUpdateStatus) {
  return !status.installed || (!!status.operation && repairPhases.has(status.operation.phase));
}

export interface GatewayRuntimeOptions {
  check(): Promise<ComponentUpdateStatus | undefined>;
  install(): Promise<unknown>;
  changed?(): void;
}

/**
 * Installs or repairs the managed gateway runtime by itself, after sign-in and at launch. It
 * is never a user task: the renderer shows only a failure, with "Try again".
 */
export class GatewayRuntime {
  private running?: Promise<GatewayRuntimeState>;
  private lastError?: string;
  private status?: ComponentUpdateStatus;
  constructor(private options: GatewayRuntimeOptions) {}
  /** The last known state. It does not check. */
  current() {
    return gatewayRuntimeState(this.status, this.lastError);
  }
  /** Checks the runtime, and installs or repairs it when it needs it. */
  ensure(): Promise<GatewayRuntimeState> {
    if (this.running) return this.running;
    const task = (async () => {
      try {
        this.status = await this.options.check();
        if (this.status && !this.status.installing && needsRepair(this.status)) {
          this.options.changed?.();
          await this.options.install();
          this.status = await this.options.check();
        }
        this.lastError =
          this.status && needsRepair(this.status) && !this.status.installing
            ? this.status.operation?.error || this.status.error || 'not installed'
            : undefined;
      } catch (error) {
        this.lastError = error instanceof Error ? error.message : 'failed';
      }
      return this.current();
    })().finally(() => {
      if (this.running === task) this.running = undefined;
      this.options.changed?.();
    });
    this.running = task;
    return task;
  }
}
