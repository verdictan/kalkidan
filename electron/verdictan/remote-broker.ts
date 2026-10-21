import { VerdictanSetupService } from './setup';
import { BindingStore } from './bindings';
import {
  DesktopProtocolError,
  type DesktopClient,
  type DesktopParameters,
  type RuntimeProvision,
} from './protocol';
import { uuid, parseRuntimeCredentials } from './credentials';
import { randomUUID } from 'node:crypto';

/** Host-scoped backend channel. Account tokens never leave the desktop CLI. */
export class RemoteAccountBroker {
  private resources = new Map<string, Set<string>>();
  private runtimes = new Map<string, string>();
  private epoch = 0;
  private active = 0;
  constructor(
    private setup: VerdictanSetupService,
    private bindings: BindingStore,
  ) {}
  reset() {
    this.epoch++;
    this.resources.clear();
    this.runtimes.clear();
  }
  async request(host: string, operation: string, input: DesktopParameters = {}): Promise<unknown> {
    if (
      this.active >= 8 ||
      !/^[A-Za-z0-9_-]{1,128}$/.test(host) ||
      !input ||
      typeof input !== 'object' ||
      Array.isArray(input)
    )
      throw new DesktopProtocolError('desktop.broker_request_invalid');
    const epoch = this.epoch;
    this.active++;
    try {
      const { client, account, key, setup } = await this.setup.inspect();
      const scope = `${key}:${host}`;
      const identity = await this.bindings.identities(host);
      if (epoch !== this.epoch) throw new DesktopProtocolError('desktop.transport_closed');
      if (operation === 'host.identity') return identity;
      if (operation === 'setup.selection') return setup.selections;
      if (operation === 'capabilities' || operation === 'status' || operation === 'setup.inspect')
        return client.request(operation);
      if (operation === 'resources.provision') {
        const p = input.parameters as any;
        if (
          !p ||
          p.host_id !== identity.hostId ||
          p.installation_id !== identity.installationId ||
          !Object.values(setup.selections).some(
            (s) =>
              s &&
              s.teamId === p.team_id &&
              s.configurationId === p.configuration_id &&
              s.configurationVersionId === p.configuration_version_id,
          )
        )
          throw new DesktopProtocolError('desktop.broker_scope_mismatch');
        const event = await client.request(operation, {
          parameters: {
            installation_id: identity.installationId,
            host_id: identity.hostId,
            team_id: p.team_id,
            ...(p.project_id ? { project_id: p.project_id } : {}),
            configuration_id: p.configuration_id,
            configuration_version_id: p.configuration_version_id,
          },
        });
        if (epoch !== this.epoch) throw new DesktopProtocolError('desktop.transport_closed');
        const allowed = this.resources.get(scope) || new Set<string>();
        if (allowed.size >= 100) throw new DesktopProtocolError('desktop.connection_limit');
        if (uuid(event.data.agent_id) && typeof event.data.gateway_id === 'string')
          allowed.add(
            JSON.stringify([event.data.agent_id, event.data.gateway_id, p.project_id || null]),
          );
        this.resources.set(scope, allowed);
        return event;
      }
      if (operation === 'runtime.provision') {
        const p = input.parameters as RuntimeProvision;
        const agent =
          p?.provider === 'openai' ? 'codex' : p?.provider === 'anthropic' ? 'claude' : null;
        const selection = agent ? setup.selections[agent] : undefined;
        if (
          !p ||
          !selection ||
          p.installation_id !== identity.installationId ||
          p.host_id !== identity.hostId ||
          !uuid(p.session_id) ||
          p.model !== selection.model ||
          (p.provider_access_mode || 'byok') !== (selection.providerAccessMode || 'byok') ||
          (p.provider_connection_id || '') !== selection.providerConnectionId ||
          !this.resources
            .get(scope)
            ?.has(JSON.stringify([p.agent_id, p.gateway_id, p.project_id || null])) ||
          this.runtimes.size >= 1000
        )
          throw new DesktopProtocolError('desktop.broker_scope_mismatch');
        this.setup.validate(setup, agent!, selection);
        const event = await client.request(operation, {
          parameters: {
            installation_id: identity.installationId,
            host_id: identity.hostId,
            session_id: p.session_id,
            agent_id: p.agent_id,
            gateway_id: p.gateway_id,
            provider: p.provider,
            ...(p.project_id ? { project_id: p.project_id } : {}),
            model: p.model,
            ...(p.provider_access_mode === 'codex_subscription'
              ? { provider_access_mode: p.provider_access_mode }
              : { provider_connection_id: p.provider_connection_id }),
          },
        });
        if (uuid(event.data.runtime_id)) {
          if (epoch !== this.epoch) {
            await client.request('runtime.revoke', { runtime_id: event.data.runtime_id });
            throw new DesktopProtocolError('desktop.transport_closed');
          }
          this.runtimes.set(event.data.runtime_id, scope);
        }
        return event;
      }
      if (
        !uuid(input.runtime_id) ||
        this.runtimes.get(input.runtime_id) !== scope ||
        account.state !== 'authenticated'
      )
        throw new DesktopProtocolError('desktop.broker_scope_mismatch');
      if (operation === 'runtime.export') {
        const credentials = await client.exportRuntime(input.runtime_id);
        if (epoch !== this.epoch) throw new DesktopProtocolError('desktop.transport_closed');
        return credentials;
      }
      if (operation === 'runtime.revoke') {
        const event = await client.request(operation, { runtime_id: input.runtime_id });
        if (event.data.revoked === true) this.runtimes.delete(input.runtime_id);
        return event;
      }
      if (operation === 'runtime.renew') {
        if (input.gateway_stopped !== true)
          throw new DesktopProtocolError('desktop.gateway_must_stop');
        const event = await client.request(operation, {
          runtime_id: input.runtime_id,
          gateway_stopped: true,
        });
        if (epoch !== this.epoch) {
          await client.request('runtime.revoke', { runtime_id: input.runtime_id });
          throw new DesktopProtocolError('desktop.transport_closed');
        }
        return event;
      }
      throw new DesktopProtocolError('desktop.operation_unsupported');
    } finally {
      this.active--;
    }
  }
}

/** Private reverse RPC over the authenticated SSH stdio connection. Never exposed through IPC. */
export class RemoteAccountClient implements DesktopClient {
  private pending = new Map<
    string,
    { resolve(value: any): void; reject(error: Error): void; timer: ReturnType<typeof setTimeout> }
  >();
  private listeners = new Set<(code: string) => void>();
  private closed = false;
  constructor(
    private send: (frame: object) => void,
    private timeout = 30000,
  ) {}
  isClosed() {
    return this.closed;
  }
  query(operation: string, parameters: DesktopParameters = {}): Promise<any> {
    if (this.closed || this.pending.size >= 8)
      return Promise.reject(new DesktopProtocolError('desktop.transport_closed'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new DesktopProtocolError('desktop.request_timeout'));
      }, this.timeout);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ event: 'managed-account-request', id, operation, parameters });
      } catch {
        this.close();
      }
    });
  }
  request: DesktopClient['request'] = (operation, parameters) => this.query(operation, parameters);
  async exportRuntime(id: string) {
    return parseRuntimeCredentials(
      await this.query('runtime.export', { runtime_id: id }),
      Date.now(),
    );
  }
  receive(frame: any) {
    if (frame?.event !== 'managed-account-result') return false;
    const pending = this.pending.get(frame.id);
    if (!pending) return true;
    this.pending.delete(frame.id);
    clearTimeout(pending.timer);
    if (frame.error)
      pending.reject(
        new DesktopProtocolError(
          /^desktop\.[a-z_]{1,100}$/.test(frame.error) ? frame.error : 'desktop.operation_failed',
        ),
      );
    else pending.resolve(frame.result);
    return true;
  }
  onClose(listener: (code: string) => void) {
    if (this.closed) listener('desktop.transport_closed');
    else this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  close(code = 'desktop.transport_closed') {
    if (this.closed) return;
    this.closed = true;
    for (const p of this.pending.values()) {
      clearTimeout(p.timer);
      p.reject(new DesktopProtocolError(code));
    }
    this.pending.clear();
    for (const listener of this.listeners) listener(code);
    this.listeners.clear();
  }
}
