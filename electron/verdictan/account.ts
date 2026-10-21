import type {
  VerdictanAccount,
  VerdictanCapabilities,
  VerdictanStatus,
} from '../../src/domain/verdictan';
import { projectServicePermissions } from '../../src/domain/project-services';
import { DesktopClient, DesktopProtocolError } from './protocol';

export interface DesktopAccountOptions {
  apiOrigin: string;
  consoleOrigin: string;
  connect(): Promise<DesktopClient | null>;
  openBrowser(url: string): Promise<unknown>;
  changed?(): void;
}
/** One backend owner serves every window. The CLI owns account secrets and PKCE. */
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
  constructor(private options: DesktopAccountOptions) {
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
    this.options.changed?.();
    return this.status();
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
    if (this.disposed || this.operation)
      throw new DesktopProtocolError('desktop.operation_in_progress');
    const client = await this.connection();
    if (!client) throw new DesktopProtocolError('desktop.runtime_missing');
    return client;
  }
  private run(kind: string, work: (client: DesktopClient, generation: number) => Promise<void>) {
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
        if (generation === this.generation) {
          this.client?.close();
          this.client = undefined;
          this.set({
            phase: 'error',
            executionReady: false,
            error: error instanceof DesktopProtocolError ? error.code : 'desktop.operation_failed',
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
      this.set({ ...this.state, phase: 'authorizing', executionReady: false, error: undefined });
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
        void this.options.openBrowser(parsed.href).catch(() => {
          client.close('desktop.browser_failed');
        });
      });
      if (generation !== this.generation) return;
      await this.refresh(client, generation);
    });
  }
  /**
   * Reads the account and then its session capabilities from the same account profile. The
   * broker adds project-service operations only for a signed-in, current account, so read
   * them again after each account change.
   */
  private async refresh(client: DesktopClient, generation: number) {
    const account = parseAccount((await client.request('status')).data, this.options.apiOrigin);
    const capabilities = parseCapabilities((await client.request('capabilities')).data);
    if (generation === this.generation)
      this.set({
        phase: account.state,
        account,
        capabilities: sessionCapabilities(capabilities, account),
        executionReady: false,
      });
  }
  async cancel() {
    if (this.state.phase !== 'authorizing') return this.status();
    ++this.generation;
    try {
      await this.client?.request('authorization.cancel');
      if (this.client) await this.refresh(this.client, this.generation);
    } catch {
      this.client?.close();
      this.client = undefined;
      this.set({ phase: 'error', error: 'desktop.cancel_failed', executionReady: false });
    }
    return this.status();
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
    ...(text(data.organization_name) ? { organizationName: data.organization_name } : {}),
    ...(text(data.user_email) ? { userEmail: data.user_email } : {}),
  };
}
const sessionOperations = new Set([
  'project.permissions',
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
    Number(data.protocol_min) > 1 ||
    Number(data.protocol_max) < 1 ||
    !Array.isArray(data.capabilities) ||
    data.capabilities.length > 100 ||
    !data.capabilities.every(text) ||
    typeof data.managed_execution_ready !== 'boolean' ||
    !Array.isArray(data.tested_agents) ||
    data.tested_agents.length > 100
  )
    throw new DesktopProtocolError('desktop.capabilities_invalid');
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
