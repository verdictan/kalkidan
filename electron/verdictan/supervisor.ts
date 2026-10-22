import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { uuid, type RuntimeCredentials } from './credentials';
import { DesktopProtocolError } from './protocol';
import { eventBufferEnvironment } from './event-buffer';
import { StderrTail, logGatewayFailure } from './gateway-log';

/** The capability of a runtime that runs many gateways in one supervisor process. */
export const multiGatewayCapability = 'gateway.supervise.multi';

/** The state of one gateway in the supervisor, from `gateway.attached`. */
export interface GatewaySummary {
  gateway_id: string;
  agent_id: string;
  state: string;
  /** The shared loopback address of the gateway, for example `http://127.0.0.1:47011`. */
  effective_address: string;
}
/** The state of one runtime in a gateway, from `runtime.attached` and `credential.renewed`. */
export interface RuntimeSummary {
  gateway_id: string;
  runtime_id: string;
  session_id: string;
  state: string;
  effective_address: string;
  expires_at: string;
}
/** An event that the supervisor sent for one gateway or runtime without a request. */
export interface GatewayEvent {
  event: string;
  runtimeGeneration: number | null;
  data: Record<string, unknown>;
}
interface Pending {
  /** The request operation, for diagnostics. */
  operation: string;
  resolve(value: { event: string; data: Record<string, unknown> }): void;
  reject(error: Error): void;
  /** Events that end the request. `error` always ends it. */
  ends: string[];
  timer: ReturnType<typeof setTimeout>;
}
export interface SupervisorOptions {
  executable(): Promise<string | null>;
  /** The persistent folder of the durable event queues. Each gateway has its own subfolder. */
  eventDirectory?: string;
  launch?: typeof spawn;
  /** How long a request waits for its reply. */
  timeout?: number;
  now?(): number;
  /**
   * The process stopped without a request. Kalkidan starts it again at once, attaches each
   * gateway, and then each runtime with a new credential. `repeated` is true when it stopped
   * twice in one minute. Then Kalkidan does not start it again, and the chats stop.
   */
  lost?(gatewayIds: string[], repeated: boolean): void;
}
const correlationPattern = /^[A-Za-z0-9_-]{1,128}$/;
/** Codes that a second request can fix. */
const retryable = new Set([
  'desktop.gateway_busy',
  'desktop.runtime_busy',
  'desktop.supervisor_busy',
]);
const address = /^http:\/\/127\.0\.0\.1:\d{1,5}$/;
/** The listener key of a runtime. A gateway key has no slash. */
const runtimeKey = (gatewayId: string, runtimeId: string) => `${gatewayId}/${runtimeId}`;
/** A crash within this time of the last crash counts as repeated. */
const crashWindowMs = 60000;
/** Safe fields of a supervisor `error` event, for diagnostics. Never its message text. */
function errorReason(data: Record<string, unknown>) {
  return ['code', 'failure_stage', 'failure_kind', 'http_status']
    .filter((key) => /^[A-Za-z0-9_.-]{1,100}$/.test(String(data[key] ?? '')))
    .map((key) => `${key} ${String(data[key])}`)
    .join(', ');
}

/**
 * One `verdictan gateway supervise --multi` process for each computer. It hosts one gateway for
 * each agent, and one runtime in that gateway for each running chat. The runtimes of a gateway
 * share its loopback port. Requests go on stdin. Each runtime credential goes as one line on
 * descriptor 3, never on stdin, stdout, or argv. Replies and events come on stdout.
 */
export class GatewaySupervisor {
  private child?: ChildProcess;
  private starting?: Promise<void>;
  private generation?: string;
  private sequence = 0;
  private pending = new Map<string, Pending>();
  private listeners = new Map<string, (event: GatewayEvent) => void>();
  private stopping = false;
  private lastCrash = -Infinity;
  private stderr = new StderrTail();
  /** The process whose failure is already in the diagnostics. Its close adds no record. */
  private logged?: ChildProcess;
  /** True after a repeated crash. The supervisor does not start again until `reset`. */
  failed = false;
  /**
   * True when the process stopped before `supervisor.ready`, for example an older runtime
   * without the multi mode. Kalkidan then uses one process for each runtime.
   */
  unsupported = false;
  constructor(private options: SupervisorOptions) {}
  private now() {
    return (this.options.now || Date.now)();
  }
  /** The IDs of the gateways that run in the process. */
  gateways() {
    return [...this.listeners.keys()].filter((key) => !key.includes('/'));
  }
  /** Starts the process once. Concurrent callers share the start. */
  start(): Promise<void> {
    if (this.unsupported)
      return Promise.reject(new DesktopProtocolError('desktop.supervisor_unavailable'));
    if (this.failed) return Promise.reject(new DesktopProtocolError('desktop.gateway_failed'));
    if (this.child && this.generation) return Promise.resolve();
    return (this.starting ??= this.launch().finally(() => {
      this.starting = undefined;
    }));
  }
  private async launch() {
    const executable = await this.options.executable();
    if (!executable) throw new DesktopProtocolError('desktop.runtime_missing');
    this.stopping = false;
    this.sequence = 0;
    this.generation = undefined;
    this.stderr = new StderrTail();
    const child = (this.options.launch || spawn)(executable, ['gateway', 'supervise', '--multi'], {
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            ([key]) => !/^(?:VERDICTAN_|OPENAI_|ANTHROPIC_|NODE_OPTIONS$)/i.test(key),
          ),
        ),
        ...eventBufferEnvironment(this.options.eventDirectory),
      },
    });
    this.child = child;
    const ready = new Promise<void>((resolve, reject) => {
      this.pending.set('supervisor', {
        operation: 'supervisor.start',
        resolve: () => resolve(),
        reject,
        ends: ['supervisor.ready'],
        timer: setTimeout(
          () => this.fail(child, new DesktopProtocolError('desktop.gateway_start_timeout')),
          this.options.timeout ?? 15000,
        ),
      });
    });
    child.on('error', () => this.fail(child, new DesktopProtocolError('desktop.gateway_failed')));
    child.stdin?.on('error', () => {});
    (child.stdio[3] as Writable | null)?.on('error', () => {});
    const stderr = this.stderr;
    child.stderr?.on('data', (bytes: Buffer) => stderr.push(bytes));
    child.once('close', () => this.closed(child));
    let buffer = '';
    const decoder = new StringDecoder('utf8');
    child.stdout?.on('data', (bytes: Buffer) => {
      if (this.child !== child) return;
      buffer += decoder.write(bytes);
      if (Buffer.byteLength(buffer) > 65536)
        return this.fail(child, new DesktopProtocolError('desktop.gateway_protocol_invalid'));
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0 && this.child === child) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        try {
          this.event(JSON.parse(line));
        } catch {
          this.fail(child, new DesktopProtocolError('desktop.gateway_protocol_invalid'));
        }
      }
    });
    await ready;
  }
  private event(event: any) {
    if (
      !event ||
      event.schema_version !== 1 ||
      event.sequence !== this.sequence + 1 ||
      !uuid(event.generation_id) ||
      (this.generation && event.generation_id !== this.generation) ||
      typeof event.event !== 'string' ||
      typeof event.correlation_id !== 'string' ||
      (event.gateway_id !== null && typeof event.gateway_id !== 'string') ||
      (event.runtime_id != null && !uuid(event.runtime_id)) ||
      !event.data ||
      typeof event.data !== 'object' ||
      Array.isArray(event.data)
    )
      throw new Error();
    this.sequence = event.sequence;
    if (event.event === 'supervisor.ready') {
      if (
        this.generation ||
        event.data.protocol_version !== 1 ||
        !Array.isArray(event.data.capabilities) ||
        !event.data.capabilities.includes(multiGatewayCapability)
      )
        throw new Error();
      this.generation = event.generation_id;
    } else if (!this.generation) throw new Error();
    const pending = this.pending.get(event.correlation_id);
    // A detach of something that is not attached any more is not a failure.
    if (event.event === 'error' && !pending?.operation.endsWith('.detach'))
      logGatewayFailure(
        `gateway.${pending?.operation ?? 'event'}`,
        typeof event.data.code === 'string' && /^desktop\.[a-z_]{1,100}$/.test(event.data.code)
          ? event.data.code
          : 'desktop.gateway_unavailable',
        errorReason(event.data),
      );
    if (pending && (event.event === 'error' || pending.ends.includes(event.event))) {
      this.pending.delete(event.correlation_id);
      clearTimeout(pending.timer);
      if (event.event === 'error') {
        const code = typeof event.data.code === 'string' ? event.data.code : '';
        pending.reject(
          new DesktopProtocolError(
            /^desktop\.[a-z_]{1,100}$/.test(code) ? code : 'desktop.gateway_unavailable',
          ),
        );
      } else pending.resolve({ event: event.event, data: event.data });
      return;
    }
    if (typeof event.gateway_id === 'string')
      this.listeners.get(
        event.runtime_id ? runtimeKey(event.gateway_id, event.runtime_id) : event.gateway_id,
      )?.({
        event: event.event,
        runtimeGeneration:
          typeof event.runtime_generation === 'number' ? event.runtime_generation : null,
        data: event.data,
      });
  }
  /** Stops a process that broke the protocol. Its close starts the crash handling. */
  private fail(child: ChildProcess, error: Error) {
    if (this.child !== child) return;
    this.logged = child;
    logGatewayFailure(
      'gateway.supervisor',
      error instanceof DesktopProtocolError ? error.code : 'desktop.gateway_failed',
      this.stderr.text(),
    );
    this.rejectAll(error);
    child.kill('SIGKILL');
  }
  private rejectAll(error: Error) {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
  private closed(child: ChildProcess) {
    if (this.child !== child) return;
    const started = !!this.generation;
    this.child = undefined;
    this.generation = undefined;
    // A process that stops before `supervisor.ready` did not start, for example a runtime
    // without the multi mode. That is not a crash.
    this.rejectAll(
      new DesktopProtocolError(
        started ? 'desktop.gateway_stopped' : 'desktop.supervisor_unavailable',
      ),
    );
    const gateways = this.gateways();
    if (!this.stopping && this.logged !== child)
      logGatewayFailure(
        'gateway.supervisor',
        started ? 'desktop.gateway_stopped' : 'desktop.supervisor_unavailable',
        this.stderr.text(),
      );
    if (!started && !this.stopping) this.unsupported = true;
    if (this.stopping || !started) return;
    const repeated = this.now() - this.lastCrash < crashWindowMs;
    this.lastCrash = this.now();
    if (repeated) this.failed = true;
    this.listeners.clear();
    this.options.lost?.(gateways, repeated);
  }
  /** Sends one request. A credential goes first on descriptor 3 with the same correlation. */
  private async request(
    operation: string,
    fields: Record<string, string>,
    ends: string[],
    credentials?: RuntimeCredentials,
  ) {
    await this.start();
    const child = this.child!;
    const correlation = randomUUID();
    if (!correlationPattern.test(correlation))
      throw new DesktopProtocolError('desktop.invalid_request');
    const reply = new Promise<{ event: string; data: Record<string, unknown> }>(
      (resolve, reject) => {
        this.pending.set(correlation, {
          operation,
          resolve,
          reject,
          ends,
          timer: setTimeout(() => {
            this.pending.delete(correlation);
            reject(new DesktopProtocolError('desktop.request_timeout'));
          }, this.options.timeout ?? 15000),
        });
      },
    );
    if (credentials)
      (child.stdio[3] as Writable).write(
        JSON.stringify({ ...credentials, correlation_id: correlation }) + '\n',
      );
    child.stdin!.write(
      JSON.stringify({
        schema_version: 1,
        correlation_id: correlation,
        generation_id: this.generation,
        operation,
        ...fields,
      }) + '\n',
    );
    return reply;
  }
  /** Sends a request again while the supervisor reports that it is busy. */
  private async retry<T>(work: () => Promise<T>): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await work();
      } catch (error) {
        const code = error instanceof DesktopProtocolError ? error.code : '';
        if (!retryable.has(code) || attempt >= 4) throw error;
        await new Promise((resolve) => setTimeout(resolve, 200 * (attempt + 1)));
      }
    }
  }
  /**
   * Opens the shared port of the gateway of one agent. It takes no credential. `listener` gets
   * the events of the gateway. The supervisor refuses a second gateway for the same agent.
   */
  async attachGateway(
    gatewayId: string,
    agentId: string,
    listener: (event: GatewayEvent) => void,
  ): Promise<GatewaySummary> {
    this.listeners.set(gatewayId, listener);
    try {
      const { data } = await this.retry(() =>
        this.request('gateway.attach', { gateway_id: gatewayId, agent_id: agentId }, [
          'gateway.attached',
        ]),
      );
      if (
        data.gateway_id !== gatewayId ||
        data.agent_id !== agentId ||
        typeof data.state !== 'string' ||
        typeof data.effective_address !== 'string' ||
        !address.test(data.effective_address)
      )
        throw new DesktopProtocolError('desktop.gateway_protocol_invalid');
      return data as unknown as GatewaySummary;
    } catch (error) {
      if (this.listeners.get(gatewayId) === listener) this.listeners.delete(gatewayId);
      throw error;
    }
  }
  private runtimeSummary(data: Record<string, unknown>, credentials: RuntimeCredentials) {
    if (
      data.gateway_id !== credentials.gateway_id ||
      data.runtime_id !== credentials.runtime_id ||
      data.session_id !== credentials.session_id ||
      typeof data.state !== 'string' ||
      typeof data.effective_address !== 'string' ||
      !address.test(data.effective_address)
    )
      throw new DesktopProtocolError('desktop.gateway_protocol_invalid');
    return data as unknown as RuntimeSummary;
  }
  /**
   * Adds the runtime of one chat to its gateway. The credential goes on descriptor 3.
   * `listener` gets the events of the runtime until it stops.
   */
  async attachRuntime(credentials: RuntimeCredentials, listener: (event: GatewayEvent) => void) {
    const key = runtimeKey(credentials.gateway_id, credentials.runtime_id);
    this.listeners.set(key, listener);
    try {
      const { data } = await this.retry(() =>
        this.request(
          'runtime.attach',
          { gateway_id: credentials.gateway_id, runtime_id: credentials.runtime_id },
          ['runtime.attached'],
          credentials,
        ),
      );
      return this.runtimeSummary(data, credentials);
    } catch (error) {
      if (this.listeners.get(key) === listener) this.listeners.delete(key);
      throw error;
    }
  }
  /**
   * Gives one runtime its renewed credential. The runtime does not restart, and requests in
   * progress continue.
   */
  async renew(credentials: RuntimeCredentials) {
    const { data } = await this.retry(() =>
      this.request(
        'credential.renew',
        { gateway_id: credentials.gateway_id, runtime_id: credentials.runtime_id },
        ['credential.renewed'],
        credentials,
      ),
    );
    return this.runtimeSummary(data, credentials);
  }
  /** Ignores a detach of something that is not attached any more. */
  private detached(code: string) {
    return (error: unknown) => {
      if (!(error instanceof DesktopProtocolError) || error.code !== code) throw error;
    };
  }
  /** Stops the runtime of one chat. The other runtimes of the gateway continue. */
  async detachRuntime(gatewayId: string, runtimeId: string) {
    const key = runtimeKey(gatewayId, runtimeId);
    if (!this.child || !this.listeners.has(key)) return;
    this.listeners.delete(key);
    await this.retry(() =>
      this.request('runtime.detach', { gateway_id: gatewayId, runtime_id: runtimeId }, [
        'runtime.stopping',
      ]),
    ).catch(this.detached('desktop.runtime_not_attached'));
  }
  /** Stops one gateway and its runtimes. The other gateways continue. */
  async detachGateway(gatewayId: string) {
    if (!this.child || !this.listeners.has(gatewayId)) return;
    for (const key of [...this.listeners.keys()])
      if (key === gatewayId || key.startsWith(gatewayId + '/')) this.listeners.delete(key);
    await this.retry(() =>
      this.request('gateway.detach', { gateway_id: gatewayId }, ['gateway.stopping']),
    ).catch(this.detached('desktop.gateway_not_attached'));
  }
  /** Stops all gateways and the process. */
  async shutdown() {
    const child = this.child;
    this.stopping = true;
    this.listeners.clear();
    if (!child) return;
    const closed = new Promise<void>((resolve) => child.once('close', () => resolve()));
    if (this.generation)
      await this.request('supervisor.shutdown', {}, ['supervisor.stopping']).catch(() => {});
    child.stdin?.end();
    const kill = setTimeout(() => child.kill('SIGKILL'), 15000);
    try {
      await closed;
    } finally {
      clearTimeout(kill);
    }
  }
  /** Allows a new start after a repeated crash, for example when the user checks the status. */
  reset() {
    this.failed = false;
    this.unsupported = false;
    this.lastCrash = -Infinity;
  }
}
