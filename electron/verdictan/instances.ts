import { randomUUID } from 'node:crypto';
import { DesktopProtocolError, type DesktopClient, type RuntimeProvision } from './protocol';
import { parseRuntimeCredentials, uuid } from './credentials';
import type { GatewayRevocation, SharedGateway } from './gateway';
import { GatewaySupervisor, type GatewayEvent, type SupervisorOptions } from './supervisor';

/** Renew the credential of an instance this long before it expires. */
const renewMarginMs = 120000;
/**
 * An instance without chats stops after this time. Each turn of a chat has its own runtime,
 * so the next turn of the same chats uses the instance again without a new start.
 */
export const instanceIdleMs = 300000;

interface Instance {
  gatewayId: string;
  agentId: string;
  binding: RuntimeProvision;
  runtimeId?: string;
  generation?: number;
  address?: string;
  /** The chat runtimes that use the instance now, by session ID. */
  users: Set<string>;
  listeners: Set<(reason?: GatewayRevocation | 'moved') => void>;
  renewal?: ReturnType<typeof setTimeout>;
  idle?: ReturnType<typeof setTimeout>;
  ready?: Promise<void>;
}
export interface InstanceOptions {
  apiOrigin: string;
  client(): Promise<DesktopClient>;
  supervisor: Omit<SupervisorOptions, 'lost'>;
  /** An instance stopped with a revocation. */
  revoked?(reason: GatewayRevocation): void;
  /** How long an instance without chats waits before it stops. */
  idleMs?: number;
  /** The supervisor stopped twice in one minute. The chats stop with an error. */
  failed?(): void;
}

/**
 * The gateway instances of one computer in its supervisor: one for each agent. Each instance
 * has its own runtime, which gives the gateway its identity. Each chat keeps its own runtime
 * and sends its own credential to the address of the instance. The first chat of an agent
 * starts the instance. It stops, and its runtime is revoked, when the last chat ends.
 */
export class GatewayInstances {
  private instances = new Map<string, Instance>();
  readonly supervisor: GatewaySupervisor;
  constructor(private options: InstanceOptions) {
    this.supervisor = new GatewaySupervisor({
      ...options.supervisor,
      lost: (gateways, repeated) => void this.restore(gateways, repeated),
    });
  }
  /** The number of instances that run. */
  size() {
    return this.instances.size;
  }
  /**
   * The instance of the gateway of a chat runtime. It starts the instance when it does not
   * run. `binding` is the provision of the chat. The instance runtime gets the same agent,
   * gateway, provider and model, with its own session.
   */
  async acquire(binding: RuntimeProvision): Promise<SharedGateway & { release(): Promise<void> }> {
    let instance = this.instances.get(binding.gateway_id);
    if (instance && instance.agentId !== binding.agent_id)
      throw new DesktopProtocolError('desktop.runtime_binding_mismatch');
    if (!instance) {
      const { project_id: _project, ...shared } = binding;
      instance = {
        gatewayId: binding.gateway_id,
        agentId: binding.agent_id,
        binding: { ...shared, session_id: randomUUID() },
        users: new Set(),
        listeners: new Set(),
      };
      this.instances.set(binding.gateway_id, instance);
    }
    instance.users.add(binding.session_id);
    clearTimeout(instance.idle);
    try {
      await (instance.ready ??= this.start(instance));
    } catch (error) {
      await this.release(instance, binding.session_id);
      throw error;
    }
    const current = instance;
    return {
      address: current.address!,
      subscribe: (lost) => {
        current.listeners.add(lost);
        return () => current.listeners.delete(lost);
      },
      release: () => this.release(current, binding.session_id),
    };
  }
  /** Provisions the instance runtime and attaches it to the supervisor. */
  private async start(instance: Instance) {
    const client = await this.options.client();
    if (!instance.runtimeId) {
      const event = await client.request('runtime.provision', { parameters: instance.binding });
      const data = event.data;
      if (!uuid(data.runtime_id))
        throw new DesktopProtocolError('desktop.invalid_runtime_response');
      instance.runtimeId = data.runtime_id;
      if (data.status !== 'provisioned' || data.credentials_stored !== true)
        throw new DesktopProtocolError('desktop.runtime_reconciliation_required');
    }
    const credentials = parseRuntimeCredentials(await client.exportRuntime(instance.runtimeId));
    if (
      credentials.api_url !== this.options.apiOrigin ||
      credentials.runtime_id !== instance.runtimeId ||
      credentials.gateway_id !== instance.gatewayId ||
      credentials.agent_id !== instance.agentId
    )
      throw new DesktopProtocolError('desktop.runtime_binding_mismatch');
    const summary = await this.supervisor.attach(credentials, (event) =>
      this.event(instance, event),
    );
    if (!summary.effective_address) throw new DesktopProtocolError('desktop.gateway_unavailable');
    instance.address = summary.effective_address;
    instance.generation = credentials.generation;
    this.schedule(instance, credentials.expires_at);
  }
  /** Renews the instance credential before it expires. Only this instance restarts. */
  private schedule(instance: Instance, expiresAt: string) {
    clearTimeout(instance.renewal);
    const delay = Math.max(0, Date.parse(expiresAt) - Date.now() - renewMarginMs);
    instance.renewal = setTimeout(() => void this.renew(instance), delay);
    instance.renewal.unref?.();
  }
  private async renew(instance: Instance) {
    if (this.instances.get(instance.gatewayId) !== instance) return;
    try {
      const client = await this.options.client();
      const data = (
        await client.request('runtime.renew', {
          runtime_id: instance.runtimeId,
          gateway_stopped: true,
        })
      ).data;
      if (data.runtime_id !== instance.runtimeId || data.generation !== instance.generation! + 1)
        throw new DesktopProtocolError('desktop.runtime_binding_mismatch');
      const credentials = parseRuntimeCredentials(await client.exportRuntime(instance.runtimeId!));
      const summary = await this.supervisor.renew(credentials);
      instance.generation = credentials.generation;
      if (summary.effective_address) instance.address = summary.effective_address;
      this.schedule(instance, credentials.expires_at);
    } catch {
      // The instance cannot continue. Its chats stop and start again with a new instance.
      this.lose(instance);
    }
  }
  private event(instance: Instance, event: GatewayEvent) {
    if (event.event === 'credential.revoked') {
      const reason = event.data.reason as GatewayRevocation;
      this.lose(instance, reason);
      this.options.revoked?.(reason);
    } else if (['credential.expired', 'gateway.stopped', 'error'].includes(event.event))
      this.lose(instance);
  }
  /** Stops the chats of an instance that stopped. A revoked instance runtime stays revoked. */
  private lose(instance: Instance, revocation?: GatewayRevocation) {
    if (this.instances.get(instance.gatewayId) !== instance) return;
    this.instances.delete(instance.gatewayId);
    clearTimeout(instance.renewal);
    clearTimeout(instance.idle);
    for (const lost of [...instance.listeners]) lost(revocation);
    instance.listeners.clear();
    void this.supervisor.detach(instance.gatewayId).catch(() => {});
    if (!revocation) void this.revoke(instance);
  }
  private async release(instance: Instance, sessionId: string) {
    instance.users.delete(sessionId);
    if (instance.users.size || this.instances.get(instance.gatewayId) !== instance) return;
    // A failed start leaves nothing to keep.
    if (!instance.address) return this.stop(instance);
    clearTimeout(instance.idle);
    instance.idle = setTimeout(
      () => void this.stop(instance),
      this.options.idleMs ?? instanceIdleMs,
    );
    instance.idle.unref?.();
  }
  /** Detaches an instance without chats and revokes its runtime. */
  private async stop(instance: Instance) {
    if (instance.users.size || this.instances.get(instance.gatewayId) !== instance) return;
    this.instances.delete(instance.gatewayId);
    clearTimeout(instance.renewal);
    clearTimeout(instance.idle);
    await this.supervisor.detach(instance.gatewayId).catch(() => {});
    await this.revoke(instance);
  }
  private async revoke(instance: Instance) {
    if (!instance.runtimeId) return;
    try {
      await (
        await this.options.client()
      ).request('runtime.revoke', { runtime_id: instance.runtimeId });
    } catch {
      // The instance runtime expires by itself. Its credential is not in memory any more.
    }
  }
  /**
   * The supervisor stopped. Start it again at once and attach each instance with a new
   * credential export, on the same port. A second stop in one minute stops the chats.
   */
  private async restore(gateways: string[], repeated: boolean) {
    const instances = gateways
      .map((id) => this.instances.get(id))
      .filter((item): item is Instance => !!item);
    if (repeated) {
      for (const instance of instances) this.lose(instance);
      this.options.failed?.();
      return;
    }
    for (const instance of instances) {
      const address = instance.address;
      instance.ready = this.start(instance).then(
        () => {
          // The chats keep their address. When the old port was not free, the instance has a
          // new port. The coding agents of its chats stop, and each chat continues on the new
          // port with its next turn. Kalkidan never sends a request again by itself.
          if (instance.address === address) return;
          const moved = [...instance.listeners];
          instance.listeners.clear();
          for (const lost of moved) lost('moved');
        },
        () => this.lose(instance),
      );
    }
  }
  /** Stops each instance and revokes its runtime, for example when the app quits. */
  async stopAll() {
    const instances = [...this.instances.values()];
    this.instances.clear();
    for (const instance of instances) {
      clearTimeout(instance.renewal);
      clearTimeout(instance.idle);
    }
    await this.supervisor.shutdown();
    await Promise.all(instances.map((instance) => this.revoke(instance)));
  }
}
