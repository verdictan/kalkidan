import type {
  VerdictanAccount,
  VerdictanCapabilities,
  VerdictanStatus,
} from '../../src/domain/verdictan';
import { projectServicePermissions } from '../../src/domain/project-services';
import { serviceName } from '../../src/domain/verdictan';
import { protocolSupported, runtimeCompatibility } from '../../src/domain/compatibility';
import { DesktopClient, DesktopProtocolError } from './protocol';

export interface DesktopAccountOptions {
  apiOrigin: string;
  consoleOrigin: string;
  connect(): Promise<DesktopClient | null>;
  openBrowser(url: string): Promise<unknown>;
  changed?(): void;
  /** The clock, for tests. */
  now?(): number;
}
/** One backend owner serves every window. The CLI owns account secrets and PKCE. */
/** How long a launch waits for a running status check or session renewal. */
const runtimeClientWaitMs = 30_000;
/** The session renews this long before it expires. */
export const renewBeforeMs = 10 * 60_000;
/** After a failed automatic renewal, the next try starts after this time. */
export const renewRetryMs = 60_000;
/** The browser link stops after this time when the runtime does not say. */
const authorizationMs = 300_000;
/** Codes that tell that the session ended. A renewal does not try again after them. */
const sessionEndedCodes = new Set([
  'desktop.auth_expired',
  'desktop.auth_required',
  'desktop.session_rejected',
  'desktop.account_invalid',
]);
/** The longest time that a timer can wait. A longer wait starts the timer again. */
const maxTimerMs = 2 ** 31 - 1;

export class VerdictanAccountService {
  private state: VerdictanStatus = { phase: 'missing', executionReady: false };
  private client?: DesktopClient;
  private connecting?: Promise<DesktopClient | null>;
  private operation?: Promise<VerdictanStatus>;
  private operationKind = '';
  private disposed = false;
  private generation = 0;
  private connectionGeneration = 0;
  private detach?: () => void;
  private renewTimer?: ReturnType<typeof setTimeout>;
  private quietError?: string;
  private canceling?: Promise<void>;
  private now: () => number;
  constructor(private options: DesktopAccountOptions) {
    this.now = options.now ?? Date.now;
    for (const origin of [options.apiOrigin, options.consoleOrigin]) {
      const url = new URL(origin);
      if (url.protocol !== 'https:' || url.origin !== origin)
        throw new Error('Verdictan requires approved HTTPS origins.');
    }
  }
  status() {
    return structuredClone(this.state);
  }
  private set(next: VerdictanStatus) {
    this.state = next;
    this.schedule();
    this.options.changed?.();
    return this.status();
  }
  /**
   * Starts the automatic renewal for an authenticated session. The timer fires about
   * `renewBeforeMs` before the session expires. A failed renewal tries again after
   * `renewRetryMs` while time remains, and then marks the session as expired.
   */
  private schedule(delay?: number) {
    clearTimeout(this.renewTimer);
    this.renewTimer = undefined;
    const expiresAt = Date.parse(this.state.account?.expiresAt || '');
    if (this.disposed || this.state.phase !== 'authenticated' || !Number.isFinite(expiresAt))
      return;
    const wait = Math.max(0, delay ?? expiresAt - renewBeforeMs - this.now());
    this.renewTimer = setTimeout(
      () => {
        this.renewTimer = undefined;
        // A long wait fires early. Start the timer again for the remaining time.
        if (wait > maxTimerMs) this.schedule();
        else void this.autoRenew();
      },
      Math.min(wait, maxTimerMs),
    );
    this.renewTimer.unref?.();
  }
  /** Renews the session now. Used by the timer and when the computer wakes from sleep. */
  async autoRenew(): Promise<VerdictanStatus> {
    const before = this.state;
    const expiresAt = Date.parse(before.account?.expiresAt || '');
    if (this.disposed || before.phase !== 'authenticated' || !Number.isFinite(expiresAt))
      return this.status();
    if (this.now() < expiresAt) {
      this.quietError = undefined;
      try {
        await this.run(
          'auto-renew',
          async (client, generation) => {
            await client.request('session.renew');
            await this.refresh(client, generation);
          },
          true,
        );
      } catch (error) {
        // Another operation runs, for example a status check. Try again later.
        this.quietError = error instanceof DesktopProtocolError ? error.code : undefined;
      }
      const after = this.state;
      if (after.phase !== 'authenticated') return this.status();
      if (!this.quietError && after.account?.expiresAt !== before.account?.expiresAt)
        return this.status();
      const left = expiresAt - this.now();
      if (left > 0 && !sessionEndedCodes.has(this.quietError || '')) {
        // Keep the account while the session is still valid. The renewal tries again.
        this.schedule(Math.min(renewRetryMs, left));
        return this.status();
      }
    }
    // The session ended and did not renew. Start new chats only after a new sign-in.
    return this.set({
      ...before,
      phase: 'expired',
      account: before.account && { ...before.account, state: 'expired' },
      capabilities: before.capabilities && sessionCapabilities(before.capabilities),
      executionReady: false,
    });
  }
  private async connection() {
    if (this.client) return this.client;
    const generation = this.connectionGeneration;
    const pending = (this.connecting ??= this.options.connect());
    try {
      const client = await pending;
      if (this.disposed || generation !== this.connectionGeneration) {
        client?.close();
        throw new DesktopProtocolError('desktop.transport_closed');
      }
      if (client) {
        this.client = client;
        this.detach = client.onClose((code) => {
          if (this.client !== client) return;
          this.client = undefined;
          this.set({ phase: 'error', executionReady: false, error: code });
        });
      }
      return client;
    } finally {
      if (this.connecting === pending) this.connecting = undefined;
    }
  }
  /** Backend-only access. The CLI remains the single owner of account credentials. */
  async runtimeClient() {
    // A status check or a session renewal is short. It starts with the app and with Settings, so
    // a launch waits for it instead of refusing. Sign-in and sign-out still refuse a launch.
    const operation = this.operation;
    if (
      !this.disposed &&
      operation &&
      ['check', 'renew', 'auto-renew'].includes(this.operationKind)
    ) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        operation.catch(() => undefined),
        new Promise((done) => (timer = setTimeout(done, runtimeClientWaitMs))),
      ]);
      clearTimeout(timer);
    }
    if (this.disposed || this.operation)
      throw new DesktopProtocolError('desktop.operation_in_progress');
    const client = await this.connection();
    if (!client) throw new DesktopProtocolError('desktop.runtime_missing');
    return client;
  }
  /**
   * Runs one account operation. A `quiet` operation keeps the state when it fails and saves the
   * code in `quietError`, so an automatic renewal never stops running chats for a short failure.
   */
  private run(
    kind: string,
    work: (client: DesktopClient, generation: number) => Promise<void>,
    quiet = false,
  ) {
    if (this.disposed) return Promise.reject(new DesktopProtocolError('desktop.transport_closed'));
    if (this.operation)
      return kind === this.operationKind
        ? this.operation
        : Promise.reject(new DesktopProtocolError('desktop.operation_in_progress'));
    this.operationKind = kind;
    const generation = ++this.generation;
    const task = (async () => {
      try {
        const client = await this.connection();
        if (generation !== this.generation) return this.status();
        if (!client) return this.set({ phase: 'missing', executionReady: false });
        await work(client, generation);
      } catch (error) {
        const code =
          error instanceof DesktopProtocolError ? error.code : 'desktop.operation_failed';
        if (quiet) this.quietError = code;
        else if (generation === this.generation) {
          this.client?.close();
          this.client = undefined;
          this.set({
            phase: 'error',
            executionReady: false,
            error: code,
          });
        }
      }
      return this.status();
    })();
    this.operation = task;
    void task.finally(() => {
      if (this.operation === task) this.operation = undefined;
    });
    return task;
  }
  check() {
    return this.run('check', async (client, generation) => {
      this.set({ ...this.state, phase: 'checking', executionReady: false, error: undefined });
      await this.refresh(client, generation);
    });
  }
  authorize(intent: 'login' | 'register') {
    if (intent !== 'login' && intent !== 'register')
      return Promise.reject(new Error('Choose Sign in or Create account.'));
    return this.run(`authorize:${intent}`, async (client, generation) => {
      this.set({
        ...this.state,
        phase: 'authorizing',
        executionReady: false,
        error: undefined,
        authorization: undefined,
      });
      await client.request('authorization.start', { intent }, (event) => {
        const url = event.data.authorization_url;
        if (typeof url !== 'string') throw new Error('Missing authorization URL.');
        const parsed = new URL(url);
        if (
          parsed.origin !== this.options.consoleOrigin ||
          parsed.pathname !== '/auth/cli' ||
          parsed.username ||
          parsed.password ||
          parsed.hash ||
          [...parsed.searchParams.keys()].some((key) =>
            /^(?:token|access_token|refresh_token|password|api_key)$/i.test(key),
          )
        )
          throw new Error('Invalid authorization URL.');
        if (generation !== this.generation) return;
        // The window shows the link again, with Copy link and Open browser again.
        const seconds = event.data.expires_in_seconds;
        const lasts =
          Number.isSafeInteger(seconds) && Number(seconds) > 0 && Number(seconds) <= 310
            ? Number(seconds) * 1000
            : authorizationMs;
        const startedAt = this.now();
        this.set({
          ...this.state,
          authorization: {
            url: parsed.href,
            intent,
            startedAt: new Date(startedAt).toISOString(),
            expiresAt: new Date(startedAt + lasts).toISOString(),
          },
        });
        void this.options.openBrowser(parsed.href).catch(() => {
          client.close('desktop.browser_failed');
        });
      });
      // A canceled sign-in returns the state after the cancel, not the waiting state.
      if (generation !== this.generation) return void (await this.canceling);
      await this.refresh(client, generation);
    });
  }
  /** Opens the waiting sign-in link again. Rejects when no sign-in waits. */
  async reopenBrowser() {
    const authorization = this.state.authorization;
    if (this.state.phase !== 'authorizing' || !authorization)
      throw new Error('No sign-in waits. Select Sign in to start again.');
    if (Date.parse(authorization.expiresAt) <= this.now())
      throw new DesktopProtocolError('desktop.authorization_timeout');
    await this.options.openBrowser(authorization.url);
  }
  /**
   * Reads the account and then its session capabilities from the same account profile. The
   * broker adds project-service operations only for a signed-in, current account, so read
   * them again after each account change.
   */
  private async refresh(client: DesktopClient, generation: number) {
    const account = parseAccount((await client.request('status')).data, this.options.apiOrigin);
    const capabilities = parseCapabilities((await client.request('capabilities')).data);
    assertRuntimeSupported(capabilities, this.now());
    if (account.state === 'authenticated' && capabilities.capabilities.includes('account.inspect'))
      Object.assign(account, await accountNames(client, account));
    if (generation === this.generation)
      this.set({
        phase: account.state,
        account,
        capabilities: sessionCapabilities(capabilities, account),
        executionReady: false,
      });
  }
  cancel() {
    if (this.state.phase !== 'authorizing') return Promise.resolve(this.status());
    ++this.generation;
    const task = (async () => {
      try {
        await this.client?.request('authorization.cancel');
        if (this.client) await this.refresh(this.client, this.generation);
      } catch {
        this.client?.close();
        this.client = undefined;
        this.set({ phase: 'error', error: 'desktop.cancel_failed', executionReady: false });
      }
      return this.status();
    })();
    this.canceling = task.then(() => undefined);
    return task;
  }
  renew() {
    return this.run('renew', async (client, generation) => {
      await client.request('session.renew');
      await this.refresh(client, generation);
    });
  }
  async logout() {
    // Do not coalesce logout into an unrelated check or authorization operation.
    await this.cancel();
    if (this.operation) await this.operation;
    return this.run('logout', async (client, generation) => {
      const result = await client.request('session.logout');
      if (typeof result.data.remote_revoked !== 'boolean' || result.data.execution_blocked !== true)
        throw new DesktopProtocolError('desktop.protocol_invalid');
      // Drop session capabilities at once. A failed read below then leaves none.
      if (generation === this.generation)
        this.set({
          phase: 'signed-out',
          executionReady: false,
          remoteRevocationPending: !result.data.remote_revoked,
        });
      try {
        const capabilities = parseCapabilities((await client.request('capabilities')).data);
        if (generation === this.generation)
          this.set({ ...this.state, capabilities: sessionCapabilities(capabilities) });
      } catch {
        // Sign-out is complete. Keep the signed-out state without capabilities.
      }
    });
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.renewTimer);
    this.renewTimer = undefined;
    this.reset();
  }
  reset() {
    ++this.generation;
    ++this.connectionGeneration;
    this.connecting = undefined;
    this.detach?.();
    this.detach = undefined;
    this.client?.close();
    this.client = undefined;
    this.set({ phase: 'missing', executionReady: false });
  }
}
/**
 * Reads optional organization and user names. Names are display data only. A failed read, or
 * a response for another account, keeps the generic labels and never blocks the account.
 */
export async function accountNames(client: DesktopClient, account: VerdictanAccount) {
  try {
    const data = (await client.request('account.inspect')).data;
    if (data.organization_id !== account.organizationId || data.user_id !== account.userId)
      return {};
    const organizationName = serviceName(data.organization_name, data.org_name);
    const userName = serviceName(data.user_name, data.user_display_name, data.display_name);
    return {
      ...(organizationName ? { organizationName } : {}),
      ...(userName ? { userName } : {}),
    };
  } catch {
    return {};
  }
}
function text(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 256;
}
export function parseAccount(data: Record<string, unknown>, apiOrigin: string): VerdictanAccount {
  const states = {
    signed_out: 'signed-out',
    authorizing: 'authorizing',
    authenticated: 'authenticated',
    expired: 'expired',
  } as const;
  if (
    typeof data.state !== 'string' ||
    !Object.hasOwn(states, data.state) ||
    data.api_url !== apiOrigin ||
    (data.user_id !== null && !text(data.user_id)) ||
    (data.organization_id !== null && !text(data.organization_id)) ||
    (data.expires_at !== null &&
      (!text(data.expires_at) || !Number.isFinite(Date.parse(data.expires_at))))
  )
    throw new DesktopProtocolError('desktop.account_invalid');
  if (
    data.state === 'authenticated' &&
    (!text(data.user_id) || !text(data.organization_id) || !text(data.expires_at))
  )
    throw new DesktopProtocolError('desktop.account_invalid');
  return {
    state: states[data.state as keyof typeof states],
    userId: (data.user_id as string | undefined) || undefined,
    organizationId: (data.organization_id as string | undefined) || undefined,
    apiUrl: apiOrigin,
    expiresAt: (data.expires_at as string | undefined) || undefined,
    // A name that is only an ID stays missing. The UI then shows a generic label.
    ...(serviceName(data.organization_name)
      ? { organizationName: serviceName(data.organization_name) }
      : {}),
    ...(text(data.user_email) ? { userEmail: data.user_email } : {}),
    // The plan name, for example "Team". Only when the service sends one.
    ...(serviceName(data.plan_name, data.plan)
      ? { plan: serviceName(data.plan_name, data.plan) }
      : {}),
  };
}
const sessionOperations = new Set([
  'project.permissions',
  'history.list',
  ...Object.keys(projectServicePermissions),
]);
/**
 * Session-scoped operations count only for an authenticated account. A signed-out, expired,
 * or authorizing profile never makes them available, whatever the response says.
 */
export function sessionCapabilities(
  value: VerdictanCapabilities,
  account?: VerdictanAccount,
): VerdictanCapabilities {
  if (account?.state === 'authenticated') return value;
  return {
    ...value,
    capabilities: value.capabilities.filter((name) => !sessionOperations.has(name)),
  };
}
export function parseCapabilities(data: Record<string, unknown>): VerdictanCapabilities {
  if (
    !text(data.cli_version) ||
    !Number.isSafeInteger(data.protocol_min) ||
    !Number.isSafeInteger(data.protocol_max) ||
    Number(data.protocol_min) > Number(data.protocol_max) ||
    !Array.isArray(data.capabilities) ||
    data.capabilities.length > 100 ||
    !data.capabilities.every(text) ||
    typeof data.managed_execution_ready !== 'boolean' ||
    !Array.isArray(data.tested_agents) ||
    data.tested_agents.length > 100
  )
    throw new DesktopProtocolError('desktop.capabilities_invalid');
  // A well-formed range without the Kalkidan protocol has its own code and plain words.
  if (!protocolSupported(Number(data.protocol_min), Number(data.protocol_max)))
    throw new DesktopProtocolError('desktop.protocol_unsupported');
  const agents = data.tested_agents.map((entry) => {
    if (!entry || !['codex', 'claude_code'].includes(entry.kind) || !text(entry.version))
      throw new DesktopProtocolError('desktop.capabilities_invalid');
    return { kind: entry.kind as 'codex' | 'claude_code', version: entry.version };
  });
  return {
    cliVersion: data.cli_version,
    protocolMin: Number(data.protocol_min),
    protocolMax: Number(data.protocol_max),
    capabilities: [...data.capabilities],
    managedExecutionReady: data.managed_execution_ready,
    testedAgents: agents,
  };
}
/**
 * Refuses a runtime below the minimum of the support window, or a deprecated runtime after its
 * end-of-support date. See `docs/compatibility.md`. A deprecated runtime before that date works.
 */
export function assertRuntimeSupported(capabilities: VerdictanCapabilities, now = Date.now()) {
  const result = runtimeCompatibility(capabilities.cliVersion, now);
  if (result.status === 'unsupported' || result.status === 'unknown')
    throw new DesktopProtocolError('desktop.runtime_version_unsupported', {
      version: capabilities.cliVersion,
    });
}
