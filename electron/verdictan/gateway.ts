import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { parseRuntimeCredentials, uuid, type RuntimeCredentials } from './credentials';
import { DesktopProtocolError } from './protocol';
import { eventBufferEnvironment } from './event-buffer';
import { claudeSubscriptionRecovery } from '../../src/domain/verdictan';
import { agentVersionErrorCode, checkAgentVersion } from '../../src/domain/agent-version';
import { StderrTail, logGatewayFailure, readinessReason } from './gateway-log';

class ReadinessError extends Error {
  constructor(
    public readonly code?: string,
    public readonly reason = '',
  ) {
    super('readiness');
  }
}
/**
 * In Codex subscription mode, the gateway proves the ChatGPT access of the native Codex login
 * only when Codex reads its model catalog through the gateway. Until then, readiness replies
 * with this code. Each Codex request through the gateway does the same proof before it goes to
 * the provider, so the code does not block the start of Codex.
 */
const providerProbeRequired = 'desktop.provider_probe_required';
/**
 * Readiness codes from the gateway that Kalkidan relays, so that the UI shows the exact cause.
 * Other codes become `desktop.readiness_failed`. The gateway's message text is never relayed.
 */
const relayedReadinessCodes = new Set([
  'desktop.readiness_blocked',
  'desktop.readiness_required',
  'desktop.event_authority_unavailable',
  'desktop.evidence_unavailable',
  'desktop.event_buffer_full',
  'desktop.operation_in_progress',
  'desktop.secure_storage_unavailable',
  'desktop.codex_version_unsupported',
  'desktop.claude_code_version_unsupported',
  'desktop.agent_version_unsupported',
]);
/** The `error.code` of a gateway reply, or nothing when it is not a short safe code. */
function replyCode(reply: unknown) {
  const error =
    reply && typeof reply === 'object' ? (reply as { error?: unknown }).error : undefined;
  const code = error && typeof error === 'object' ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' && /^desktop\.[a-z_]{1,100}$/.test(code) ? code : undefined;
}
export type NativeAgent = { kind: 'codex' | 'claude_code'; version: string };
export interface GatewayOptions {
  executable: string;
  credentials: RuntimeCredentials;
  launch?: typeof spawn;
  request?: typeof fetch;
  now?: () => number;
  /** The persistent folder of the durable event queue. Without it, Verdictan uses a temporary one. */
  eventDirectory?: string;
  /**
   * The gateway instance of the agent in the supervisor of this computer. Then no process
   * starts: the chat sends its own credential to the address of the instance.
   */
  instance?: SharedGateway;
  /**
   * The gateway stopped without a request from Kalkidan. `revocation` is set when Verdictan
   * revoked the runtime. Then the runtime must not start again with the same credentials.
   */
  lost?(revocation?: GatewayRevocation, code?: string): void;
}
/** The reasons of a `credential.revoked` event from the supervised gateway. */
export const gatewayRevocationReasons = [
  'host_revoked',
  'session_revoked',
  'runtime_revoked',
  'credential_revoked',
  'offline_limit',
] as const;
export type GatewayRevocation = (typeof gatewayRevocationReasons)[number];
function isRevocation(value: unknown): value is GatewayRevocation {
  return (gatewayRevocationReasons as readonly unknown[]).includes(value);
}
/** One gateway instance that several chat runtimes of the same agent use. */
export interface SharedGateway {
  address: string;
  /**
   * Calls `lost` when the instance stops, or with `moved` when it restarted on another port.
   * Returns the function that ends the subscription.
   */
  subscribe(lost: (reason?: GatewayRevocation | 'moved') => void): () => void;
}
/** Owns one runtime generation. A listening socket never authorizes execution. */
export class ManagedGateway {
  private child?: ChildProcess;
  private unsubscribe?: () => void;
  private credentials: RuntimeCredentials;
  private address?: string;
  private generation?: string;
  private sequence = 0;
  private closed = false;
  private stopping = false;
  private controller = new AbortController();
  private listening: Promise<void>;
  private resolveListening!: () => void;
  private rejectListening!: (error: Error) => void;
  private exited: Promise<void>;
  private startupTimer?: ReturnType<typeof setTimeout>;
  private expiryTimer: ReturnType<typeof setTimeout>;
  private stopTask?: Promise<void>;
  private stderr = new StderrTail();
  constructor(private options: GatewayOptions) {
    this.credentials = parseRuntimeCredentials(options.credentials, this.now());
    this.listening = new Promise((resolve, reject) => {
      this.resolveListening = resolve;
      this.rejectListening = reject;
    });
    // Observe errors even if the caller has not yet started its preflight.
    void this.listening.catch(() => {});
    this.expiryTimer = setTimeout(
      () => this.fail('desktop.runtime_expired'),
      Math.max(0, Date.parse(this.credentials.expires_at) - this.now()),
    );
    this.expiryTimer.unref?.();
    if (options.instance) {
      // The supervisor runs the instance. This chat uses its address with its own credential.
      this.address = new URL(options.instance.address).origin;
      this.exited = Promise.resolve();
      this.resolveListening();
      this.unsubscribe = options.instance.subscribe((reason) =>
        reason === 'moved'
          ? this.fail('desktop.gateway_moved')
          : this.fail(
              reason ? 'desktop.credential_revoked' : 'desktop.gateway_unavailable',
              reason,
            ),
      );
      return;
    }
    const child = (options.launch || spawn)(options.executable, ['gateway', 'supervise'], {
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...Object.fromEntries(
          Object.entries(process.env).filter(
            ([key]) => !/^(?:VERDICTAN_|OPENAI_|ANTHROPIC_|NODE_OPTIONS$)/i.test(key),
          ),
        ),
        ...eventBufferEnvironment(options.eventDirectory),
      },
    });
    this.child = child;
    this.exited = new Promise((resolve) =>
      child.once('close', () => {
        this.fail('desktop.gateway_stopped');
        resolve();
      }),
    );
    child.on('error', () => this.fail('desktop.gateway_failed'));
    child.stdin?.on('error', () => this.fail('desktop.gateway_failed'));
    const pipe = child.stdio[3] as Writable;
    pipe.on('error', () => this.fail('desktop.credential_delivery_failed'));
    pipe.end(JSON.stringify(this.credentials) + '\n');
    child.stderr?.on('data', (bytes: Buffer) => this.stderr.push(bytes));
    let buffer = '';
    const decoder = new StringDecoder('utf8');
    child.stdout?.on('data', (bytes: Buffer) => {
      if (this.closed) return;
      buffer += decoder.write(bytes);
      if (Buffer.byteLength(buffer) > 65536) return this.fail('desktop.gateway_protocol_invalid');
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0 && !this.closed) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        try {
          this.event(JSON.parse(line));
        } catch {
          this.fail('desktop.gateway_protocol_invalid');
        }
      }
    });
    this.startupTimer = setTimeout(() => this.fail('desktop.gateway_start_timeout'), 15000);
    this.startupTimer.unref?.();
  }
  private now() {
    return (this.options.now || Date.now)();
  }
  private event(event: any) {
    if (
      !event ||
      event.schema_version !== 1 ||
      event.sequence !== this.sequence + 1 ||
      !uuid(event.generation_id) ||
      event.runtime_generation !== this.credentials.generation ||
      (this.generation && event.generation_id !== this.generation) ||
      !event.data ||
      typeof event.data !== 'object' ||
      Array.isArray(event.data)
    )
      throw new Error();
    this.sequence = event.sequence;
    this.generation = event.generation_id;
    const data = event.data;
    if (event.event === 'gateway.starting') {
      if (
        data.runtime_id !== this.credentials.runtime_id ||
        data.gateway_id !== this.credentials.gateway_id
      )
        throw new Error();
    } else if (event.event === 'gateway.listening') {
      if (
        this.address ||
        data.runtime_id !== this.credentials.runtime_id ||
        data.session_id !== this.credentials.session_id ||
        data.gateway_id !== this.credentials.gateway_id ||
        data.ready !== false ||
        data.reason_code !== 'desktop.readiness_required' ||
        typeof data.effective_address !== 'string' ||
        !/^http:\/\/127\.0\.0\.1:\d+$/.test(data.effective_address)
      )
        throw new Error();
      const url = new URL(data.effective_address);
      if (!Number(url.port) || Number(url.port) > 65535) throw new Error();
      this.address = url.origin;
      clearTimeout(this.startupTimer);
      this.resolveListening();
    } else if (event.event === 'credential.revoked') {
      if (data.runtime_id !== this.credentials.runtime_id || !isRevocation(data.reason))
        throw new Error();
      this.fail('desktop.credential_revoked', data.reason);
    } else if (['credential.expired', 'gateway.stopped', 'error'].includes(event.event)) {
      this.fail('desktop.gateway_unavailable');
    } else if (!['gateway.status', 'gateway.stopping'].includes(event.event)) throw new Error();
  }
  /**
   * Takes the renewed credential of a runtime in a shared gateway. The gateway does not
   * restart. New requests use the new credential, and the expiry follows it.
   */
  renewed(value: RuntimeCredentials) {
    if (this.closed || this.stopping || this.child) return;
    const next = parseRuntimeCredentials(value, this.now());
    if (
      next.runtime_id !== this.credentials.runtime_id ||
      next.session_id !== this.credentials.session_id ||
      next.generation <= this.credentials.generation
    )
      throw new DesktopProtocolError('desktop.runtime_binding_mismatch');
    this.credentials = next;
    clearTimeout(this.expiryTimer);
    this.expiryTimer = setTimeout(
      () => this.fail('desktop.runtime_expired'),
      Math.max(0, Date.parse(next.expires_at) - this.now()),
    );
    this.expiryTimer.unref?.();
  }
  /**
   * Stop this generation when its credential expired. Timers do not count the time while the
   * computer sleeps, so the expiry timer can fire late. The app calls this after a wake.
   */
  checkExpiry() {
    if (!this.closed && Date.parse(this.credentials.expires_at) <= this.now())
      this.fail('desktop.runtime_expired');
  }
  private fail(code: string, revocation?: GatewayRevocation) {
    if (this.closed) return;
    // Keep why the process stopped, before its credentials leave memory.
    if (!this.stopping && this.child) logGatewayFailure('gateway.process', code, this.stderrText());
    this.closed = true;
    // A stopped gateway never uses its credentials again. Do not keep the secrets in memory.
    this.credentials = { ...this.credentials, runtime_credential: '', inference_credential: '' };
    this.controller.abort();
    clearTimeout(this.startupTimer);
    clearTimeout(this.expiryTimer);
    this.unsubscribe?.();
    this.rejectListening(new DesktopProtocolError(code));
    if (!this.stopping) {
      // Fail closed. A dead or invalid supervisor cannot retain agent ownership.
      this.options.lost?.(revocation, code);
      this.child?.kill('SIGKILL');
    }
  }
  async readiness(agent: NativeAgent) {
    await this.listening;
    if (this.closed || this.stopping || Date.parse(this.credentials.expires_at) <= this.now())
      throw new DesktopProtocolError('desktop.gateway_unavailable');
    const url = new URL('/verdictan/desktop/readiness', this.address);
    url.search = new URLSearchParams({
      runtime_id: this.credentials.runtime_id,
      session_id: this.credentials.session_id,
      agent_kind: agent.kind,
      agent_version: agent.version,
    }).toString();
    try {
      const { ok, status, body: result } = await this.fetchJSON(url);
      const reason = readinessReason(status, result);
      // A Codex subscription runtime that is ready except for the proof of Codex itself.
      const probePending =
        !ok &&
        this.credentials.provider_access_mode === 'codex_subscription' &&
        result?.ready === false &&
        result?.provider_authentication === 'probe_required' &&
        replyCode(result) === providerProbeRequired;
      if (!ok && !probePending) throw new ReadinessError(replyCode(result), reason);
      if (
        this.closed ||
        this.stopping ||
        result.schema_version !== 1 ||
        (result.ready !== true && !probePending) ||
        result.dispatch_authorized !== false ||
        result.runtime_id !== this.credentials.runtime_id ||
        result.session_id !== this.credentials.session_id ||
        result.credential !== 'ready' ||
        result.dependencies !== 'ready' ||
        result.protocol_acceptance !== 'verified' ||
        result.control_plane?.ready !== true ||
        result.control_plane?.generation !== this.credentials.generation ||
        result.control_plane?.runtime_id !== this.credentials.runtime_id ||
        result.control_plane?.session_id !== this.credentials.session_id ||
        !this.billingMatches(result.control_plane?.billing)
      )
        throw new ReadinessError(replyCode(result), reason);
    } catch (error) {
      // Fail closed. Relay only known safe codes, so that the user gets the exact cause and a
      // recovery action. Claude subscription codes apply only to a Claude subscription runtime.
      const code = error instanceof ReadinessError ? error.code : undefined;
      const relayed =
        code &&
        (relayedReadinessCodes.has(code) ||
          (this.credentials.provider_access_mode === 'claude_subscription' &&
            claudeSubscriptionRecovery(code)))
          ? code
          : 'desktop.readiness_failed';
      const reason =
        error instanceof ReadinessError
          ? error.reason
          : error instanceof DesktopProtocolError
            ? error.code
            : 'no reply';
      logGatewayFailure(
        'gateway.readiness',
        relayed,
        [reason, this.stderrText()].filter(Boolean).join('\n'),
      );
      throw new DesktopProtocolError(relayed);
    }
  }
  /** Claude subscription readiness must not report an organization payer or a currency. */
  private billingMatches(billing: any) {
    if (this.credentials.provider_access_mode !== 'claude_subscription') return true;
    if (billing === undefined) return true;
    return (
      !!billing &&
      billing.payer === 'user_claude_subscription' &&
      billing.provider_connection_id == null &&
      billing.currency == null &&
      (billing.provider_access_mode === undefined ||
        billing.provider_access_mode === 'claude_subscription')
    );
  }
  /** The redacted end of the stderr of this gateway process. Empty for a shared instance. */
  private stderrText() {
    return this.stderr.text([
      this.credentials.runtime_credential,
      this.credentials.inference_credential,
    ]);
  }
  /**
   * Reads a JSON reply, also when it is not OK. The body is read with the same size limit. A
   * reply that is not JSON has no body.
   */
  private async fetchJSON(url: URL): Promise<{ ok: boolean; status: number; body: any }> {
    if (this.closed || this.stopping) throw new DesktopProtocolError('desktop.gateway_unavailable');
    const response = await (this.options.request || fetch)(url, {
      redirect: 'error',
      headers: { authorization: 'Bearer ' + this.credentials.inference_credential },
      signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(10000)]),
    });
    const body = response.body
      ? await this.readBody(response.body).catch((error) => {
          if (response.ok) throw error;
          return undefined;
        })
      : undefined;
    return { ok: response.ok, status: response.status, body };
  }
  /** Reads a JSON reply that must be OK. */
  private async readJSON(url: URL, signal?: AbortSignal): Promise<any> {
    if (this.closed || this.stopping) throw new DesktopProtocolError('desktop.gateway_unavailable');
    const response = await (this.options.request || fetch)(url, {
      redirect: 'error',
      headers: { authorization: 'Bearer ' + this.credentials.inference_credential },
      signal: AbortSignal.any([
        this.controller.signal,
        AbortSignal.timeout(10000),
        ...(signal ? [signal] : []),
      ]),
    });
    if (!response.ok || !response.body)
      throw new DesktopProtocolError('desktop.evidence_unavailable');
    return this.readBody(response.body);
  }
  private async readBody(body: ReadableStream<Uint8Array>): Promise<any> {
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.length;
        if (length > 256 * 1024) throw new DesktopProtocolError('desktop.frame_too_large');
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    if (this.closed || this.stopping) throw new DesktopProtocolError('desktop.gateway_unavailable');
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  }
  async evidence(kind: 'events' | 'snapshot', cursor?: string, signal?: AbortSignal) {
    await this.listening;
    const url = new URL('/verdictan/desktop/' + kind, this.address);
    url.search = new URLSearchParams({
      runtime_id: this.credentials.runtime_id,
      session_id: this.credentials.session_id,
      ...(cursor ? { cursor } : {}),
    }).toString();
    return this.readJSON(url, signal);
  }
  /** Backend-only launch data. The caller must also enforce process-tree isolation. */
  async nativeRoute(
    agent: NativeAgent,
    correlation: {
      hostId: string;
      projectId: string;
      taskId: string;
      conversationId: string;
      runId: string;
      turnId: string;
    },
  ) {
    await this.readiness(agent);
    if (
      !Object.values(correlation).every((value) => /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value))
    )
      throw new DesktopProtocolError('desktop.invalid_correlation');
    const fields = {
      runtime_id: this.credentials.runtime_id,
      session_id: this.credentials.session_id,
      host_id: correlation.hostId,
      project_id: correlation.projectId,
      task_id: correlation.taskId,
      // A project-bound runtime rejects requests without a run.
      run_id: correlation.runId,
      conversation_id: correlation.conversationId,
      turn_id: correlation.turnId,
      agent_kind: agent.kind,
      agent_version: agent.version,
    };
    const headers = Object.fromEntries(
      Object.entries(fields).map(([key, value]) => [
        `x-verdictan-desktop-${key.replaceAll('_', '-')}`,
        value,
      ]),
    );
    const mode = this.credentials.provider_access_mode || 'byok';
    // A subscription runtime never falls back to another agent's route or to API billing.
    if (
      (mode === 'codex_subscription' && agent.kind !== 'codex') ||
      (mode === 'claude_subscription' && agent.kind !== 'claude_code')
    )
      throw new DesktopProtocolError('desktop.subscription_agent_required');
    // The same minimum as the launch check. No exact version is pinned.
    const refused = agentVersionErrorCode(checkAgentVersion(agent.kind, agent.version));
    if (refused) throw new DesktopProtocolError(refused, { version: agent.version });
    if (mode === 'claude_subscription') {
      // The gateway key is a separate header. Native subscription authentication stays intact,
      // so no API key, auth token, or key helper is set. The value stays in the child env only.
      return {
        address: this.address!,
        args: ['--setting-sources', '', '--strict-mcp-config'],
        env: {
          ANTHROPIC_BASE_URL: this.address!,
          ANTHROPIC_CUSTOM_HEADERS: [
            `X-Gateway-Key: ${this.credentials.inference_credential}`,
            ...Object.entries(headers).map(([key, value]) => `${key}: ${value}`),
          ].join('\n'),
          DISABLE_AUTOUPDATER: '1',
          CLAUDE_CODE_MAX_RETRIES: '0',
          CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK: '1',
          CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
        } as NodeJS.ProcessEnv,
      };
    }
    if (agent.kind === 'claude_code')
      return {
        address: this.address!,
        args: [] as string[],
        env: {
          ANTHROPIC_BASE_URL: this.address!,
          ANTHROPIC_API_KEY: this.credentials.inference_credential,
          ANTHROPIC_CUSTOM_HEADERS: Object.entries(headers)
            .map(([key, value]) => `${key}: ${value}`)
            .join('\n'),
          CLAUDE_CODE_MAX_RETRIES: '0',
          CLAUDE_CODE_DISABLE_NONSTREAMING_FALLBACK: '1',
        } as NodeJS.ProcessEnv,
      };
    const tomlHeaders =
      '{' +
      Object.entries(headers)
        .map(([key, value]) => `${JSON.stringify(key)}=${JSON.stringify(value)}`)
        .join(',') +
      '}';
    if (mode === 'codex_subscription') {
      return {
        address: this.address!,
        args: [
          '-c',
          'model_provider="verdictan_subscription"',
          '-c',
          'features.apps=false',
          '-c',
          `model_providers.verdictan_subscription={name="Verdictan subscription",base_url=${JSON.stringify(this.address + '/backend-api/codex')},wire_api="responses",requires_openai_auth=true,supports_websockets=false,request_max_retries=0,stream_max_retries=0,http_headers=${tomlHeaders},env_http_headers={"X-Gateway-Key"="KALKIDAN_INFERENCE_CREDENTIAL"}}`,
        ],
        env: {
          KALKIDAN_INFERENCE_CREDENTIAL: this.credentials.inference_credential,
        } as NodeJS.ProcessEnv,
      };
    }
    return {
      address: this.address!,
      args: [
        '-c',
        'model_provider="verdictan"',
        '-c',
        `model_providers.verdictan={name="Verdictan",base_url=${JSON.stringify(this.address + '/v1')},env_key="OPENAI_API_KEY",wire_api="responses",request_max_retries=0,stream_max_retries=0,http_headers=${tomlHeaders}}`,
      ],
      env: { OPENAI_API_KEY: this.credentials.inference_credential } as NodeJS.ProcessEnv,
    };
  }
  endpoint() {
    if (this.closed || this.stopping || !this.address)
      throw new DesktopProtocolError('desktop.gateway_unavailable');
    return this.address;
  }
  stop(): Promise<void> {
    return (this.stopTask ??= this.stopOnce());
  }
  private async stopOnce() {
    this.stopping = true;
    this.controller.abort();
    clearTimeout(this.startupTimer);
    clearTimeout(this.expiryTimer);
    this.rejectListening(new DesktopProtocolError('desktop.gateway_stopped'));
    const child = this.child;
    if (!child) {
      // A shared instance continues for the other chats of the agent. Only this chat stops.
      this.unsubscribe?.();
      this.closed = true;
      this.credentials = { ...this.credentials, runtime_credential: '', inference_credential: '' };
      return;
    }
    if (child.exitCode !== null || child.signalCode !== null) return;
    if (this.generation && !child.stdin?.destroyed)
      child.stdin?.write(
        JSON.stringify({
          schema_version: 1,
          correlation_id: randomUUID(),
          generation_id: this.generation,
          operation: 'gateway.shutdown',
        }) + '\n',
      );
    child.stdin?.end();
    const kill = setTimeout(() => child.kill('SIGKILL'), 15000);
    try {
      await this.exited;
    } finally {
      clearTimeout(kill);
      this.closed = true;
      this.credentials = { ...this.credentials, runtime_credential: '', inference_credential: '' };
    }
  }
}
