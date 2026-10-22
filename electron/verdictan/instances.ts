import { DesktopProtocolError, type DesktopClient } from './protocol';
import { parseRuntimeCredentials, type RuntimeCredentials } from './credentials';
import type { GatewayRevocation, SharedGateway } from './gateway';
import { GatewaySupervisor, type GatewayEvent, type SupervisorOptions } from './supervisor';

/**
 * A gateway without runtimes stops after this time. Each turn of a chat has its own runtime,
 * so the next turn of the chats of the agent uses the gateway again without a new start.
 */
export const gatewayIdleMs = 300000;

type Lost = (reason?: GatewayRevocation | 'moved') => void;
interface Gateway {
  gatewayId: string;
  agentId: string;
  address?: string;
  /** The runtimes of the chats that use the gateway now, by runtime ID. */
  runtimes: Map<string, { listeners: Set<Lost> }>;
  idle?: ReturnType<typeof setTimeout>;
  ready?: Promise<void>;
}
export interface InstanceOptions {
  client(): Promise<DesktopClient>;
  supervisor: Omit<SupervisorOptions, 'lost'>;
  /** The supervisor stopped twice in one minute. The chats stop with an error. */
  failed?(): void;
  /** How long a gateway without runtimes waits before it stops. */
  idleMs?: number;
}

/**
 * The gateways of one computer in its supervisor: one for each agent. Each running chat adds
 * its own runtime, with its own credential, to the gateway of its agent. All runtimes of a
 * gateway share its loopback port. The first chat of an agent opens the gateway. A gateway
 * without runtimes stops after `gatewayIdleMs`.
 */
export class GatewayInstances {
  private gateways = new Map<string, Gateway>();
  /** Work that runs without a caller, for example a restore after a crash. */
  private work = new Set<Promise<unknown>>();
  /** For each gateway with a running idle timer: settles when the gateway stopped. */
  private idleStops = new Map<string, Promise<void>>();
  readonly supervisor: GatewaySupervisor;
  constructor(private options: InstanceOptions) {
    this.supervisor = new GatewaySupervisor({
      ...options.supervisor,
      lost: (gateways, repeated) => this.track(this.restore(gateways, repeated)),
    });
  }
  private track(work: Promise<unknown>) {
    const done = work.catch(() => {}).finally(() => this.work.delete(done));
    this.work.add(done);
  }
  /**
   * Settles when the work that runs without a caller is complete: a restore after a crash, and
   * the stop of a gateway that stopped. A timer of an idle gateway does not count.
   */
  async settled() {
    while (this.work.size) await Promise.all([...this.work]);
  }
  /** Settles when an idle gateway stopped. Missing when its timer does not run. */
  idleStop(gatewayId: string) {
    return this.idleStops.get(gatewayId);
  }
  /** Stops the idle timer of a gateway, for example when a new chat uses the gateway. */
  private cancelIdle(gateway: Gateway) {
    clearTimeout(gateway.idle);
    gateway.idle = undefined;
    this.idleStops.delete(gateway.gatewayId);
  }
  /**
   * Starts the timer that stops a gateway without runtimes. The timer keeps the process
   * alive, so that a caller that waits for `idleStop` gets the stop.
   */
  private schedule(gateway: Gateway) {
    this.cancelIdle(gateway);
    const stopped = new Promise<void>((resolve) => {
      gateway.idle = setTimeout(
        () =>
          void this.stop(gateway).finally(() => {
            if (this.idleStops.get(gateway.gatewayId) === stopped)
              this.idleStops.delete(gateway.gatewayId);
            resolve();
          }),
        this.options.idleMs ?? gatewayIdleMs,
      );
    });
    this.idleStops.set(gateway.gatewayId, stopped);
  }
  /** The number of gateways that run. */
  size() {
    return this.gateways.size;
  }
  /**
   * Adds the runtime of a chat to the gateway of its agent. It opens the gateway when it does
   * not run. The chat sends its own credential to the shared address.
   */
  async acquire(
    credentials: RuntimeCredentials,
  ): Promise<
    SharedGateway & { release(): Promise<void>; renew(next: RuntimeCredentials): Promise<void> }
  > {
    let gateway = this.gateways.get(credentials.gateway_id);
    if (gateway && gateway.agentId !== credentials.agent_id)
      throw new DesktopProtocolError('desktop.runtime_binding_mismatch');
    if (!gateway) {
      gateway = {
        gatewayId: credentials.gateway_id,
        agentId: credentials.agent_id,
        runtimes: new Map(),
      };
      this.gateways.set(credentials.gateway_id, gateway);
    }
    this.cancelIdle(gateway);
    const runtime = { listeners: new Set<Lost>() };
    gateway.runtimes.set(credentials.runtime_id, runtime);
    const current = gateway;
    const release = () => this.release(current, credentials.runtime_id);
    try {
      await (gateway.ready ??= this.open(gateway));
      await this.supervisor.attachRuntime(credentials, (event) =>
        this.runtimeEvent(current, credentials.runtime_id, event),
      );
    } catch (error) {
      await release();
      throw error;
    }
    return {
      address: current.address!,
      subscribe: (lost) => {
        runtime.listeners.add(lost);
        return () => runtime.listeners.delete(lost);
      },
      release,
      // In place: the runtime does not restart, and requests in progress continue.
      renew: async (next) => {
        await this.supervisor.renew(next);
      },
    };
  }
  /** Opens the shared port of a gateway. It takes no credential. */
  private async open(gateway: Gateway) {
    const summary = await this.supervisor.attachGateway(
      gateway.gatewayId,
      gateway.agentId,
      (event) => {
        if (['gateway.stopped', 'error'].includes(event.event)) this.lose(gateway);
      },
    );
    gateway.address = summary.effective_address;
  }
  private runtimeEvent(gateway: Gateway, runtimeId: string, event: GatewayEvent) {
    const runtime = gateway.runtimes.get(runtimeId);
    if (!runtime) return;
    let reason: GatewayRevocation | undefined;
    if (event.event === 'credential.revoked') reason = event.data.reason as GatewayRevocation;
    else if (!['credential.expired', 'runtime.stopped', 'error'].includes(event.event)) return;
    // Only the chat of this runtime stops. The other runtimes of the gateway continue.
    for (const lost of [...runtime.listeners]) lost(reason);
    runtime.listeners.clear();
  }
  /** Stops the chats of a gateway that stopped. */
  private lose(gateway: Gateway, reason?: 'moved') {
    if (this.gateways.get(gateway.gatewayId) !== gateway) return;
    this.gateways.delete(gateway.gatewayId);
    this.cancelIdle(gateway);
    for (const runtime of gateway.runtimes.values())
      for (const lost of [...runtime.listeners]) lost(reason);
    gateway.runtimes.clear();
    this.track(this.supervisor.detachGateway(gateway.gatewayId));
  }
  private async release(gateway: Gateway, runtimeId: string) {
    if (!gateway.runtimes.delete(runtimeId)) return;
    await this.supervisor.detachRuntime(gateway.gatewayId, runtimeId).catch(() => {});
    if (gateway.runtimes.size || this.gateways.get(gateway.gatewayId) !== gateway) return;
    // A gateway that did not open leaves nothing to keep.
    if (!gateway.address) return this.stop(gateway);
    this.schedule(gateway);
  }
  /** Stops a gateway without runtimes. */
  private async stop(gateway: Gateway) {
    if (gateway.runtimes.size || this.gateways.get(gateway.gatewayId) !== gateway) return;
    this.gateways.delete(gateway.gatewayId);
    // `idleStop` stays until the stop is complete.
    clearTimeout(gateway.idle);
    await this.supervisor.detachGateway(gateway.gatewayId).catch(() => {});
  }
  /**
   * The supervisor stopped. Start it again at once. Attach each gateway, then each runtime
   * with a new credential export, so that running chats keep their address. When the old port
   * is not free, the gateway gets a new port: the coding agents of its chats stop, and each chat
   * continues on the new port with its next turn. Kalkidan never sends a request again by
   * itself. A second stop in one minute stops the chats.
   */
  private async restore(gatewayIds: string[], repeated: boolean) {
    const gateways = gatewayIds
      .map((id) => this.gateways.get(id))
      .filter((item): item is Gateway => !!item);
    if (repeated) {
      for (const gateway of gateways) this.lose(gateway);
      this.options.failed?.();
      return;
    }
    // The restore of each gateway is complete before `settled` settles.
    const restored: Promise<void>[] = [];
    for (const gateway of gateways) {
      const address = gateway.address;
      gateway.ready = this.open(gateway).then(
        async () => {
          if (gateway.address !== address) {
            const runtimes = [...gateway.runtimes.values()];
            gateway.runtimes.clear();
            for (const runtime of runtimes)
              for (const lost of [...runtime.listeners]) lost('moved');
            this.schedule(gateway);
            return;
          }
          const client = await this.options.client();
          for (const [runtimeId, runtime] of gateway.runtimes)
            await client
              .exportRuntime(runtimeId)
              .then((frame) =>
                this.supervisor.attachRuntime(parseRuntimeCredentials(frame), (event) =>
                  this.runtimeEvent(gateway, runtimeId, event),
                ),
              )
              .catch(() => {
                for (const lost of [...runtime.listeners]) lost();
                gateway.runtimes.delete(runtimeId);
              });
        },
        () => this.lose(gateway),
      );
      restored.push(gateway.ready);
    }
    await Promise.all(restored);
  }
  /** Stops each gateway and the supervisor, for example when the app quits. */
  async stopAll() {
    for (const gateway of this.gateways.values()) this.cancelIdle(gateway);
    this.gateways.clear();
    await this.supervisor.shutdown();
  }
}
