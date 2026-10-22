import { agentVersionErrorCode, checkAgentVersion } from '../../src/domain/agent-version';
import { DesktopClient, DesktopProtocolError, type RuntimeProvision } from './protocol';
import {
  ManagedGateway,
  type GatewayOptions,
  type GatewayRevocation,
  type NativeAgent,
  type SharedGateway,
} from './gateway';
import { uuid, type RuntimeCredentials } from './credentials';
import { prepareEventDirectory } from './event-buffer';
import type { GatewayInstances } from './instances';

export type RuntimePhase =
  | 'provisioning'
  | 'starting'
  | 'ready'
  | 'stopping'
  | 'stopped'
  | 'renewing'
  | 'reconciliation-required'
  | 'revocation-pending'
  | 'revoked'
  | 'failed';
interface OwnedRuntime {
  generation: number;
  binding: RuntimeProvision;
  agent: NativeAgent;
  phase: RuntimePhase;
  runtimeId?: string;
  credentialGeneration?: number;
  gateway?: ManagedGateway;
  /** Ends the use of a shared gateway. Missing with one process for each runtime. */
  release?(): Promise<void>;
  shared?: SharedGateway & { renew(next: RuntimeCredentials): Promise<void> };
  /** Stops the coding agent. `code` says why, when the gateway stopped without a request. */
  stopAgent(code?: string): Promise<void>;
}
interface RuntimeOptions {
  apiOrigin: string;
  client(): Promise<DesktopClient>;
  executable(): Promise<string | null>;
  gateway?(options: GatewayOptions): ManagedGateway;
  /** The persistent folder of the durable event queue of each gateway. */
  eventDirectory?: string;
  changed?(): void;
  /** Verdictan revoked a runtime. The runtime is already stopped. */
  revoked?(reason: GatewayRevocation): void;
  /**
   * One supervisor for this computer, with one gateway instance for each agent. Used when
   * `multi` is true. Without it, or when the runtime cannot run it, each runtime starts its
   * own `gateway supervise` process.
   */
  instances?: GatewayInstances;
  /** True when the runtime advertises `gateway.supervise.multi`. */
  multi?(): boolean;
  /** True when the runtime advertises `runtime.renew.in_place`. */
  inPlaceRenewal?(): boolean;
}
/** One backend owner serializes credential mutations. Failed rotation is never retried. */
export class ManagedRuntimes {
  private records = new Map<string, OwnedRuntime>();
  private operations = new Set<string>();
  private closing = false;
  private generation = 0;
  private blockedHosts = new Set<string>();
  constructor(private options: RuntimeOptions) {}
  status() {
    return [...this.records].map(([sessionId, item]) => ({
      sessionId,
      runtimeId: item.runtimeId,
      phase: item.phase,
    }));
  }
  busy() {
    return this.operations.size > 0 || [...this.records.values()].some((r) => r.gateway);
  }
  /** The number of runtimes whose release did not complete, for example without an app. */
  releasing() {
    return [...this.records.values()].filter((item) => item.phase === 'revocation-pending').length;
  }
  /** Releases again each runtime whose release did not complete. A failure stays pending. */
  async retryReleases() {
    const pending = [...this.records]
      .filter(([, item]) => item.phase === 'revocation-pending')
      .map(([sessionId]) => sessionId);
    await Promise.all(pending.map((sessionId) => this.release(sessionId).catch(() => {})));
  }
  private set(item: OwnedRuntime, phase: RuntimePhase) {
    item.phase = phase;
    this.options.changed?.();
  }
  private async exclusive<T>(sessionId: string, work: () => Promise<T>) {
    if (this.closing || this.operations.has(sessionId))
      throw new DesktopProtocolError('desktop.operation_in_progress');
    this.operations.add(sessionId);
    try {
      return await work();
    } finally {
      this.operations.delete(sessionId);
    }
  }
  async start(
    binding: RuntimeProvision,
    agent: NativeAgent,
    stopAgent: (code?: string) => Promise<void>,
  ) {
    return this.exclusive(binding.session_id, async () => {
      if (this.blockedHosts.has(binding.installation_id + ':' + binding.host_id))
        throw new DesktopProtocolError('desktop.host_revoked');
      if (this.records.size >= 128) throw new DesktopProtocolError('desktop.runtime_limit');
      if (this.records.has(binding.session_id))
        throw new DesktopProtocolError('desktop.runtime_already_owned');
      // Kalkidan's minimum, not Verdictan's `tested_agents`, decides which agent can start.
      const refused = agentVersionErrorCode(checkAgentVersion(agent.kind, agent.version));
      if (refused) throw new DesktopProtocolError(refused, { version: agent.version });
      const generation = this.generation;
      const client = await this.options.client();
      if (generation !== this.generation || this.closing)
        throw new DesktopProtocolError('desktop.runtime_stopped');
      const item: OwnedRuntime = {
        generation,
        binding: structuredClone(binding),
        agent: { ...agent },
        phase: 'provisioning',
        stopAgent,
      };
      this.records.set(binding.session_id, item);
      this.options.changed?.();
      try {
        const event = await client.request('runtime.provision', { parameters: binding });
        const data = event.data;
        if (!uuid(data.runtime_id))
          throw new DesktopProtocolError('desktop.invalid_runtime_response');
        item.runtimeId = data.runtime_id;
        // Keep the issued ID above so that a mismatched runtime can still be revoked.
        if (
          binding.provider_access_mode === 'claude_subscription'
            ? event.event !== 'runtime.provisioned' ||
              data.provider_access_mode !== 'claude_subscription' ||
              data.provider_connection_id != null
            : event.event === 'runtime.provisioned'
        )
          throw new DesktopProtocolError('desktop.runtime_binding_mismatch');
        if (data.status !== 'provisioned' || data.credentials_stored !== true) {
          this.set(item, 'reconciliation-required');
          throw new DesktopProtocolError('desktop.runtime_reconciliation_required');
        }
        if (!Number.isSafeInteger(data.generation) || Number(data.generation) < 1)
          throw new DesktopProtocolError('desktop.invalid_runtime_response');
        item.credentialGeneration = Number(data.generation);
        await this.launch(item, client);
      } catch (error) {
        if (item.phase !== 'reconciliation-required' && item.phase !== 'revoked')
          this.set(item, 'failed');
        await this.drop(item);
        // Keep the ID so callers can revoke an issued runtime after startup failure.
        throw error;
      }
    });
  }
  private validateBinding(item: OwnedRuntime, frame: RuntimeCredentials) {
    if (
      (frame.provider_access_mode || 'byok') !== (item.binding.provider_access_mode || 'byok') ||
      frame.generation !== item.credentialGeneration ||
      frame.api_url !== this.options.apiOrigin ||
      frame.runtime_id !== item.runtimeId ||
      frame.session_id !== item.binding.session_id ||
      frame.agent_id !== item.binding.agent_id ||
      frame.gateway_id !== item.binding.gateway_id
    )
      throw new DesktopProtocolError('desktop.runtime_binding_mismatch');
  }
  private async launch(item: OwnedRuntime, client: DesktopClient) {
    if (this.closing || item.generation !== this.generation)
      throw new DesktopProtocolError('desktop.runtime_stopped');
    const frame = await client.exportRuntime(item.runtimeId!);
    this.validateBinding(item, frame);
    const executable = await this.options.executable();
    if (!executable) throw new DesktopProtocolError('desktop.runtime_missing');
    if (this.closing || item.generation !== this.generation)
      throw new DesktopProtocolError('desktop.runtime_stopped');
    this.set(item, 'starting');
    if (this.options.eventDirectory) await prepareEventDirectory(this.options.eventDirectory);
    const shared = await this.shared(item, frame);
    if (this.closing || item.generation !== this.generation)
      throw new DesktopProtocolError('desktop.runtime_stopped');
    const gateway = (this.options.gateway || ((options) => new ManagedGateway(options)))({
      executable,
      credentials: frame,
      eventDirectory: this.options.eventDirectory,
      ...(shared ? { instance: shared } : {}),
      lost: (revocation, code) => {
        item.gateway = undefined;
        void this.releaseShared(item);
        if (revocation && revocation !== 'offline_limit') {
          // A revoked host stays blocked until a new host identity is authorized.
          if (revocation === 'host_revoked')
            this.blockedHosts.add(item.binding.installation_id + ':' + item.binding.host_id);
          this.set(item, 'revoked');
        } else this.set(item, 'failed');
        void item.stopAgent(code).catch(() => {});
        if (revocation) this.options.revoked?.(revocation);
      },
    });
    item.gateway = gateway;
    await gateway.readiness(item.agent);
    if (this.closing || item.generation !== this.generation || item.phase !== 'starting')
      throw new DesktopProtocolError('desktop.runtime_stopped');
    this.set(item, 'ready');
  }
  /**
   * The gateway instance of the agent of a runtime, in the supervisor of this computer. Null
   * when the runtime cannot run the supervisor. Then the runtime starts its own process.
   */
  private async shared(item: OwnedRuntime, frame: RuntimeCredentials) {
    const instances = this.options.instances;
    if (!instances || !this.options.multi?.() || instances.supervisor.unsupported) return null;
    if (item.release) return item.shared ?? null;
    try {
      const shared = await instances.acquire(frame);
      item.release = shared.release;
      item.shared = shared;
      return shared;
    } catch (error) {
      // A runtime without the multi mode did not start the supervisor. Use one process.
      if (instances.supervisor.unsupported) return null;
      throw error;
    }
  }
  private async releaseShared(item: OwnedRuntime) {
    const release = item.release;
    item.release = undefined;
    item.shared = undefined;
    await release?.().catch(() => {});
  }
  /** Stops the gateway of a runtime and ends its use of a shared instance. */
  private async drop(item: OwnedRuntime) {
    await item.gateway?.stop();
    item.gateway = undefined;
    await this.releaseShared(item);
  }
  async route(
    sessionId: string,
    correlation: {
      projectId: string;
      taskId: string;
      conversationId: string;
      runId: string;
      turnId: string;
    },
  ) {
    const item = this.records.get(sessionId);
    if (!item?.gateway || item.phase !== 'ready' || this.operations.has(sessionId) || this.closing)
      throw new DesktopProtocolError('desktop.gateway_unavailable');
    // No positive readiness cache. Each new/resumed turn checks current authority.
    try {
      return await item.gateway.nativeRoute(item.agent, {
        ...correlation,
        hostId: item.binding.host_id,
      });
    } catch (error) {
      await this.stopOwned(item);
      this.set(item, 'failed');
      throw error;
    }
  }
  evidence(sessionId: string, kind: 'events' | 'snapshot', cursor?: string, signal?: AbortSignal) {
    const item = this.records.get(sessionId);
    if (!item?.gateway || item.phase !== 'ready')
      throw new DesktopProtocolError('desktop.gateway_unavailable');
    return item.gateway.evidence(kind, cursor, signal);
  }
  endpoint(sessionId: string) {
    const item = this.owned(sessionId);
    if (item.phase !== 'ready' || !item.gateway)
      throw new DesktopProtocolError('desktop.gateway_unavailable');
    return item.gateway.endpoint();
  }
  /** Allows a new supervisor start after repeated crashes, for example on Check status. */
  resetSupervisor() {
    this.options.instances?.supervisor.reset();
  }
  /** Stop each gateway whose credential expired while the computer slept. */
  checkExpiry() {
    for (const item of this.records.values()) item.gateway?.checkExpiry();
  }
  async release(sessionId: string) {
    try {
      await this.revoke(sessionId);
    } finally {
      if (this.records.get(sessionId)?.phase === 'revoked') this.records.delete(sessionId);
    }
  }
  async renew(sessionId: string) {
    return this.exclusive(sessionId, async () => {
      const item = this.owned(sessionId);
      if (!['ready', 'stopped'].includes(item.phase))
        throw new DesktopProtocolError('desktop.runtime_reconciliation_required');
      // In a shared gateway, the renewal is in place: the coding agent continues.
      if (item.shared && item.gateway && item.phase === 'ready') return this.renewShared(item);
      await this.stopOwned(item, true);
      this.set(item, 'renewing');
      try {
        const client = await this.options.client();
        const data = (
          await client.request('runtime.renew', {
            runtime_id: item.runtimeId,
            gateway_stopped: true,
          })
        ).data;
        if (
          data.runtime_id !== item.runtimeId ||
          data.generation !== item.credentialGeneration! + 1
        )
          throw new DesktopProtocolError('desktop.runtime_binding_mismatch');
        item.credentialGeneration = Number(data.generation);
        await this.launch(item, client);
      } catch (error) {
        await this.drop(item);
        this.set(item, 'reconciliation-required');
        throw error;
      }
    });
  }
  private async renewShared(item: OwnedRuntime) {
    const client = await this.options.client();
    // In a shared gateway, only the credential changes. Older runtimes ask for the stop
    // confirmation instead. They have no shared gateway, so this is only for safety.
    const data = (
      await client.request('runtime.renew', {
        runtime_id: item.runtimeId,
        ...(this.options.inPlaceRenewal?.() ? { renewal: 'in_place' } : { gateway_stopped: true }),
      })
    ).data;
    if (data.runtime_id !== item.runtimeId || data.generation !== item.credentialGeneration! + 1)
      throw new DesktopProtocolError('desktop.runtime_binding_mismatch');
    item.credentialGeneration = Number(data.generation);
    const frame = await client.exportRuntime(item.runtimeId!);
    this.validateBinding(item, frame);
    await item.shared!.renew(frame);
    item.gateway!.renewed(frame);
  }
  async revoke(sessionId: string) {
    return this.exclusive(sessionId, async () => {
      const item = this.owned(sessionId);
      await this.stopOwned(item);
      this.set(item, 'revocation-pending');
      const data = (
        await (
          await this.options.client()
        ).request('runtime.revoke', { runtime_id: item.runtimeId })
      ).data;
      if (data.runtime_id !== item.runtimeId || data.revoked !== true)
        throw new DesktopProtocolError('desktop.runtime_binding_mismatch');
      this.set(item, 'revoked');
    });
  }
  private owned(sessionId: string) {
    const item = this.records.get(sessionId);
    if (!item?.runtimeId) throw new DesktopProtocolError('desktop.runtime_not_found');
    return item;
  }
  private async stopOwned(item: OwnedRuntime, keepShared = false) {
    const previous = item.phase;
    this.set(item, 'stopping');
    // Both stops must complete before rotation is allowed.
    await Promise.all([item.stopAgent(), item.gateway?.stop()]);
    item.gateway = undefined;
    if (!keepShared) await this.releaseShared(item);
    this.set(
      item,
      ['revoked', 'revocation-pending', 'reconciliation-required'].includes(previous)
        ? previous
        : 'stopped',
    );
  }
  async stopAll() {
    this.closing = true;
    ++this.generation;
    try {
      await Promise.all([...this.records.values()].map((item) => this.stopOwned(item)));
      await this.options.instances?.stopAll();
    } finally {
      this.closing = false;
    }
  }
  async hosts() {
    const client = await this.options.client();
    const hosts: unknown[] = [];
    const cursors = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < 100; page++) {
      const data = (await client.request('hosts.inspect', cursor ? { cursor } : {})).data;
      if (
        !Array.isArray(data.hosts) ||
        data.hosts.length > 100 ||
        typeof data.has_more !== 'boolean'
      )
        throw new DesktopProtocolError('desktop.invalid_host_inventory');
      hosts.push(...data.hosts);
      if (!data.has_more) return hosts;
      if (
        typeof data.next_cursor !== 'string' ||
        !/^[A-Za-z0-9_-]{1,2048}$/.test(data.next_cursor) ||
        cursors.has(data.next_cursor)
      )
        throw new DesktopProtocolError('desktop.invalid_host_inventory');
      cursors.add(data.next_cursor);
      cursor = data.next_cursor;
    }
    throw new DesktopProtocolError('desktop.host_inventory_limit');
  }
  async revokeHost(installationId: string, hostId: string) {
    if (!uuid(installationId) || !uuid(hostId))
      throw new DesktopProtocolError('desktop.invalid_request');
    if (this.operations.size || this.closing)
      throw new DesktopProtocolError('desktop.operation_in_progress');
    this.blockedHosts.add(installationId + ':' + hostId);
    const items = [...this.records.values()].filter(
      (r) => r.binding.host_id === hostId && r.binding.installation_id === installationId,
    );
    await Promise.all(items.map((item) => this.stopOwned(item)));
    for (const item of items) this.set(item, 'revocation-pending');
    const data = (
      await (
        await this.options.client()
      ).request('host.revoke', { installation_id: installationId, host_id: hostId })
    ).data;
    if (data.installation_id !== installationId || data.host_id !== hostId || data.revoked !== true)
      throw new DesktopProtocolError('desktop.invalid_host_revocation');
    for (const item of items) this.set(item, 'revoked');
  }
}
