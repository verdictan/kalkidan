import type {
  VerdictanAccount,
  VerdictanCapabilities,
  VerdictanStatus,
} from '../../src/domain/verdictan';
import { projectServicePermissions } from '../../src/domain/project-services';
import { keychainRefusedCode, serviceName } from '../../src/domain/verdictan';
import { protocolSupported, runtimeCompatibility } from '../../src/domain/compatibility';
import { compareVersionCores } from '../../src/domain/agent-version';
import {
  DesktopClient,
  DesktopProtocolError,
  secureStorageOperations,
  secureStorageWaitingEvent,
  type DesktopOperation,
} from './protocol';
import { rejectedSessionCodes } from './sign-in-setup';

export interface DesktopAccountOptions {
  apiOrigin: string;
  consoleOrigin: string;
  connect(): Promise<DesktopClient | null>;
  openBrowser(url: string): Promise<unknown>;
  changed?(): void;
  /** The clock, for tests. */
  now?(): number;
  /**
   * True when a slow keychain write can mean an open keychain prompt, as on macOS. Some CLI
   * versions send no waiting event for these writes.
   */
  keychainPrompts?: boolean;
  /** How long a launch waits for a running account operation. For tests. */
  launchWaitMs?: number;
}
/** One backend owner serves every window. The CLI owns account secrets and PKCE. */
/** How long a launch waits for a running account operation. */
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
/**
 * Operations of the account itself. Their own handling reports a failure. A session call that
 * fails with a rejected session code (for example `setup.inspect`) marks the account.
 */
const accountOperations = new Set([
  'status',
  'capabilities',
  'authorization.start',
  'authorization.cancel',
  'session.logout',
]);
/** The longest time that a timer can wait. A longer wait starts the timer again. */
const maxTimerMs = 2 ** 31 - 1;
/** A keychain write without a result after this time can wait for a keychain prompt. */
export const keychainHintMs = 5_000;
/** The first runtime version that sends `secure_storage.waiting` for each keychain call. */
export const keychainEventsVersion = '0.6.14';

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
  /**
   * True after the system keychain refused access. No automatic operation starts the runtime
   * again, because each start shows the keychain prompt again. Only a user action clears it.
   */
  private keychainRefused = false;
  /** The requests that wait for keychain access now. */
  private keychainWaits = 0;
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
    const status = structuredClone(this.state);
    if (this.keychainWaits) status.keychainWaiting = true;
    return status;
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
    // Do not start the runtime again without a user action. A new start asks the keychain again.
    if (this.keychainRefused) throw new DesktopProtocolError(keychainRefusedCode);
    const generation = this.connectionGeneration;
    const pending = (this.connecting ??= this.options.connect());
    try {
      const client = await pending;
      if (this.disposed || generation !== this.connectionGeneration) {
        client?.close();
        throw new DesktopProtocolError('desktop.transport_closed');
      }
      if (!client) return null;
      const watched = this.watchKeychain(client);
      this.client = watched;
      this.detach = client.onClose((code) => {
        if (this.client !== watched) return;
        this.client = undefined;
        this.set({ phase: 'error', executionReady: false, error: code });
      });
      return watched;
    } finally {
      if (this.connecting === pending) this.connecting = undefined;
    }
  }
  /**
   * Returns the client with a check of each result. When the keychain refuses access, the
   * running runtime process cannot ask again. Stop it, and keep it stopped until a user action.
   */
  private watchKeychain(client: DesktopClient): DesktopClient {
    const refused = (error: unknown): never => {
      if (error instanceof DesktopProtocolError && error.code === keychainRefusedCode)
        this.refuseKeychain(watched);
      throw error;
    };
    const watched: DesktopClient = {
      request: (operation, parameters, progress) => {
        const wait = this.keychainWait(operation);
        return client
          .request(operation, parameters, (event) => {
            if (event.event === secureStorageWaitingEvent) wait.start();
            progress?.(event);
          })
          .catch((error: unknown) => {
            if (
              error instanceof DesktopProtocolError &&
              rejectedSessionCodes.has(error.code) &&
              !accountOperations.has(operation)
            )
              this.sessionRejected(error.code);
            return refused(error);
          })
          .finally(wait.end);
      },
      exportRuntime: (runtimeId) => {
        const wait = this.keychainWait('runtime.export');
        return client
          .exportRuntime(runtimeId, (event) => {
            if (event.event === secureStorageWaitingEvent) wait.start();
          })
          .catch(refused)
          .finally(wait.end);
      },
      close: (code) => client.close(code),
      onClose: (listener) => client.onClose(listener),
    };
    return watched;
  }
  /**
   * True when the runtime sends `secure_storage.waiting` for each keychain call, also for the
   * runtime secrets. Then only that event shows the wait.
   */
  private keychainEvents() {
    const version = this.state.capabilities?.cliVersion;
    return (compareVersionCores(version, keychainEventsVersion) ?? -1) >= 0;
  }
  /**
   * Counts one request while it waits for keychain access. The UI then asks the person to
   * answer the keychain prompt. The waiting event of the CLI starts the wait. An older runtime
   * does not send it for each keychain write. Then a slow keychain write also starts the wait,
   * where the system shows keychain prompts.
   */
  private keychainWait(operation: DesktopOperation) {
    let waiting = false;
    let ended = false;
    const start = () => {
      if (waiting || ended) return;
      waiting = true;
      if (this.keychainWaits++ === 0) this.options.changed?.();
    };
    const hint =
      (this.options.keychainPrompts ?? process.platform === 'darwin') &&
      secureStorageOperations.has(operation) &&
      !this.keychainEvents()
        ? setTimeout(start, keychainHintMs)
        : undefined;
    hint?.unref?.();
    return {
      start,
      end: () => {
        ended = true;
        clearTimeout(hint);
        if (waiting && --this.keychainWaits === 0) this.options.changed?.();
      },
    };
  }
  /**
   * Verdictan refused the session in a session call, but `status` can still say signed in. The
   * account then shows "Sign in again" with the code, until a new sign-in. A check of the same
   * session keeps this state: the session has the same expiry time.
   */
  private rejected?: { organizationId?: string; userId?: string; expiresAt?: string; code: string };
  /** The rejected code that a call reported during the current account read. */
  private rejectedDuringRead?: string;
  sessionRejected(code: string) {
    if (!rejectedSessionCodes.has(code)) return;
    this.rejectedDuringRead = code;
    const account = this.state.account;
    if (this.disposed || this.state.phase !== 'authenticated' || !account) return;
    this.rejected = {
      organizationId: account.organizationId,
      userId: account.userId,
      expiresAt: account.expiresAt,
      code,
    };
    this.set(this.rejectedState(this.state, code));
  }
  /** The "Sign in again" state of a signed-in account whose session Verdictan refused. */
  private rejectedState(state: VerdictanStatus, code: string): VerdictanStatus {
    return {
      ...state,
      phase: 'expired',
      account: state.account && { ...state.account, state: 'expired' },
      capabilities: state.capabilities && sessionCapabilities(state.capabilities),
      executionReady: false,
      error: code,
    };
  }
  private refuseKeychain(client: DesktopClient) {
    if (this.disposed || this.client !== client) return;
    this.keychainRefused = true;
    this.detach?.();
    this.detach = undefined;
    this.client = undefined;
    client.close();
    // The error state also stops the renewal timer. No timer asks the keychain again.
    this.set({ ...this.state, phase: 'error', executionReady: false, error: keychainRefusedCode });
  }
  /** Backend-only access. The CLI remains the single owner of account credentials. */
  async runtimeClient() {
    // A launch waits for an account operation instead of refusing at once: a status check, a
    // renewal and a sign-out are short, and a browser sign-in can finish in the wait.
    const operation = this.operation;
    if (!this.disposed && operation) {
      let timer: ReturnType<typeof setTimeout> | undefined;
      await Promise.race([
        operation.catch(() => undefined),
        new Promise(
          (done) => (timer = setTimeout(done, this.options.launchWaitMs ?? runtimeClientWaitMs)),
        ),
      ]);
      clearTimeout(timer);
    }
    if (!this.disposed && this.operation && this.operationKind.startsWith('authorize:'))
      throw new DesktopProtocolError('desktop.authorization_in_progress');
    if (this.disposed || this.operation)
      throw new DesktopProtocolError('desktop.operation_in_progress');
    // After a lost or broken connection, check the account again. The UI then shows the state
    // of the new connection, and a failed check gives the real reason. After a refused
    // keychain prompt, only a user action starts the runtime again.
    if (this.state.phase === 'error' && !this.keychainRefused) {
      const checked = await this.check();
      if (checked.phase === 'error')
        throw new DesktopProtocolError(checked.error || 'desktop.operation_failed');
    }
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
    // A user action, such as Check status, starts the runtime again. It asks the keychain again.
    if (!quiet) this.keychainRefused = false;
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
    // A new sign-in gives a new session. A refused earlier session does not count any more.
    this.rejected = undefined;
    return this.run(`authorize:${intent}`, async (client, generation) => {
      this.set({
        ...this.state,
        phase: 'authorizing',
        executionReady: false,
        error: undefined,
        authorization: undefined,
      });
      await client.request('authorization.start', { intent }, (event) => {
        // A keychain wait is also progress. Only the start of the sign-in has the link.
        if (event.event !== 'authorization.started') return;
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
    this.rejectedDuringRead = undefined;
    const account = parseAccount((await client.request('status')).data, this.options.apiOrigin);
    const capabilities = parseCapabilities((await client.request('capabilities')).data);
    assertRuntimeSupported(capabilities, this.now());
    if (account.state === 'authenticated' && capabilities.capabilities.includes('account.inspect'))
      Object.assign(account, await accountNames(client, account));
    // `account.inspect` refused the session, although `status` says signed in.
    if (account.state === 'authenticated' && this.rejectedDuringRead)
      this.rejected = {
        organizationId: account.organizationId,
        userId: account.userId,
        expiresAt: account.expiresAt,
        code: this.rejectedDuringRead,
      };
    const rejected =
      account.state === 'authenticated' &&
      this.rejected?.organizationId === account.organizationId &&
      this.rejected?.userId === account.userId &&
      this.rejected?.expiresAt === account.expiresAt
        ? this.rejected
        : undefined;
    if (generation !== this.generation) return;
    const next: VerdictanStatus = {
      phase: account.state,
      account,
      capabilities: sessionCapabilities(capabilities, account),
      executionReady: false,
    };
    this.set(rejected ? this.rejectedState(next, rejected.code) : next);
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
  /**
   * Verdictan revoked the account session of this device, for example with "Revoke device" in
   * the Console. Sign out at once, so that the local account credentials are removed. Kalkidan
   * does not wait for the next renewal. A failed sign-out keeps the expired state.
   */
  async revokedRemotely() {
    if (this.state.phase !== 'authenticated') return this.status();
    try {
      return await this.logout();
    } catch {
      return this.set({
        ...this.state,
        phase: 'expired',
        account: this.state.account && { ...this.state.account, state: 'expired' },
        capabilities: this.state.capabilities && sessionCapabilities(this.state.capabilities),
        executionReady: false,
      });
    }
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
    // A reset starts with a new runtime, for example after an update or a new SSH connection.
    this.keychainRefused = false;
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
  assertRuntimeVersionSupported(capabilities.cliVersion, now);
}
/** The same check for a runtime version that a probe confirmed. */
export function assertRuntimeVersionSupported(version: string, now = Date.now()) {
  const result = runtimeCompatibility(version, now);
  if (result.status === 'unsupported' || result.status === 'unknown')
    throw new DesktopProtocolError('desktop.runtime_version_unsupported', { version });
}
