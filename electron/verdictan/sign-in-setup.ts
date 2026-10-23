import type { VerdictanSetup } from '../../src/domain/verdictan';
import { DesktopProtocolError } from './protocol';

/**
 * Codes of a session call that mean the Verdictan session is not accepted, also when `status`
 * still says signed in. The account then needs a new sign-in.
 */
export const rejectedSessionCodes: ReadonlySet<string> = new Set([
  'desktop.auth_expired',
  'desktop.session_rejected',
  'desktop.identity_mismatch',
]);

export interface SignInSetupOptions {
  /** The setup check with the one-time bootstrap. See `VerdictanSetupService.status`. */
  check(): Promise<VerdictanSetup>;
  /** Makes the gateway of this computer. See `VerdictanLaunchService.provisionComputer`. */
  provision(): Promise<NonNullable<VerdictanSetup['computerGateway']>>;
  /** Keeps the result of the gateway for Settings. */
  keepGateway(key: string, gateway: NonNullable<VerdictanSetup['computerGateway']>): void;
  /** A session call failed with a code of `rejectedSessionCodes`. */
  sessionRejected(code: string): void;
  /** The result changed. Settings reads it again. */
  changed?(): void;
}

/**
 * The setup of this computer after sign-in, once for each account: the setup check, the
 * one-time bootstrap when the organization needs it, and the gateway of this computer for the
 * agent of this computer. It runs in the background: sign-in does not wait for it. SSH hosts
 * keep their own flow. A second run for the same account does nothing, except a forced run.
 */
export class SignInSetup {
  private done = new Set<string>();
  private running?: { key: string; task: Promise<void> };
  constructor(private options: SignInSetupOptions) {}
  /** The run for the account, while it runs. Settings waits for it before it reads the setup. */
  pending(key: string) {
    return this.running?.key === key ? this.running.task : undefined;
  }
  /** Runs the setup for an account once. `force` runs it again, for example for Refresh. */
  run(key: string, force = false): Promise<void> {
    if (this.running?.key === key) return this.running.task;
    if (!force && this.done.has(key)) return Promise.resolve();
    this.done.add(key);
    const task = this.runOnce(key).finally(() => {
      if (this.running?.task === task) this.running = undefined;
      this.options.changed?.();
    });
    this.running = { key, task };
    return task;
  }
  private async runOnce(key: string) {
    try {
      const setup = await this.options.check();
      // The organization has no agent for this computer yet, for example while an
      // administrator must connect Kalkidan. The first chat after that makes the gateway.
      if (setup.bootstrapReadiness === 'bootstrap_requires_admin' || setup.bootstrapIssue) {
        this.options.keepGateway(key, { status: 'skipped' });
        return;
      }
      this.options.keepGateway(key, await this.options.provision());
    } catch (error) {
      const code = error instanceof DesktopProtocolError ? error.code : 'desktop.operation_failed';
      if (rejectedSessionCodes.has(code)) {
        // A new sign-in runs the setup again.
        this.done.delete(key);
        this.options.sessionRejected(code);
        return;
      }
      this.options.keepGateway(key, { status: 'failed', code });
    }
  }
}
