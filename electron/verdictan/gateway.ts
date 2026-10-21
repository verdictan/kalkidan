import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Writable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';
import { parseRuntimeCredentials, uuid, type RuntimeCredentials } from './credentials';
import { DesktopProtocolError } from './protocol';
import { claudeSubscriptionRecovery } from '../../src/domain/verdictan';
import { agentVersionErrorCode, checkAgentVersion } from '../../src/domain/agent-version';

class ReadinessError extends Error {
  constructor(public readonly code?: string) {
    super('readiness');
  }
}
export type NativeAgent = { kind: 'codex' | 'claude_code'; version: string };
export interface GatewayOptions {
  executable: string;
  credentials: RuntimeCredentials;
  launch?: typeof spawn;
  request?: typeof fetch;
  now?: () => number;
  lost?(): void;
}
/** Owns one runtime generation. A listening socket never authorizes execution. */
export class ManagedGateway {
  private child: ChildProcess;
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
  private startupTimer: ReturnType<typeof setTimeout>;
  private expiryTimer: ReturnType<typeof setTimeout>;
  private stopTask?: Promise<void>;
  constructor(private options: GatewayOptions) {
    this.credentials = parseRuntimeCredentials(options.credentials, this.now());
    this.listening = new Promise((resolve, reject) => {
      this.resolveListening = resolve;
      this.rejectListening = reject;
    });
    // Observe errors even if the caller has not yet started its preflight.
    void this.listening.catch(() => {});
    this.child = (options.launch || spawn)(options.executable, ['gateway', 'supervise'], {
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      windowsHide: true,
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => !/^(?:VERDICTAN_|OPENAI_|ANTHROPIC_|NODE_OPTIONS$)/i.test(key),
        ),
      ),
    });
    this.exited = new Promise((resolve) =>
      this.child.once('close', () => {
        this.fail('desktop.gateway_stopped');
        resolve();
      }),
    );
    this.child.on('error', () => this.fail('desktop.gateway_failed'));
    this.child.stdin?.on('error', () => this.fail('desktop.gateway_failed'));
    const pipe = this.child.stdio[3] as Writable;
    pipe.on('error', () => this.fail('desktop.credential_delivery_failed'));
    pipe.end(JSON.stringify(this.credentials) + '\n');
    this.child.stderr?.on('data', () => {});
    let buffer = '';
    const decoder = new StringDecoder('utf8');
    this.child.stdout?.on('data', (bytes: Buffer) => {
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
    this.expiryTimer = setTimeout(
      () => this.fail('desktop.runtime_expired'),
      Math.max(0, Date.parse(this.credentials.expires_at) - this.now()),
    );
    this.startupTimer.unref?.();
    this.expiryTimer.unref?.();
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
    } else if (['credential.expired', 'gateway.stopped', 'error'].includes(event.event)) {
      this.fail('desktop.gateway_unavailable');
    } else if (!['gateway.status', 'gateway.stopping'].includes(event.event)) throw new Error();
  }
  private fail(code: string) {
    if (this.closed) return;
    this.closed = true;
    this.controller.abort();
    clearTimeout(this.startupTimer);
    clearTimeout(this.expiryTimer);
    this.rejectListening(new DesktopProtocolError(code));
    if (!this.stopping) {
      // Fail closed. A dead or invalid supervisor cannot retain agent ownership.
      this.options.lost?.();
      this.child.kill('SIGKILL');
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
      const result = await this.readJSON(url);
      if (
        this.closed ||
        this.stopping ||
        result.schema_version !== 1 ||
        result.ready !== true ||
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
        throw new ReadinessError(result?.error?.code);
    } catch (error) {
      // Relay only known safe Claude subscription codes so that the user gets a recovery action.
      const code = error instanceof ReadinessError ? error.code : undefined;
      throw new DesktopProtocolError(
        this.credentials.provider_access_mode === 'claude_subscription' &&
          claudeSubscriptionRecovery(code)
          ? code!
          : 'desktop.readiness_failed',
      );
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
    const reader = response.body.getReader();
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
    if (refused) throw new DesktopProtocolError(refused);
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
    if (this.child.exitCode !== null || this.child.signalCode !== null) return;
    if (this.generation && !this.child.stdin?.destroyed)
      this.child.stdin?.write(
        JSON.stringify({
          schema_version: 1,
          correlation_id: randomUUID(),
          generation_id: this.generation,
          operation: 'gateway.shutdown',
        }) + '\n',
      );
    this.child.stdin?.end();
    const kill = setTimeout(() => this.child.kill('SIGKILL'), 15000);
    try {
      await this.exited;
    } finally {
      clearTimeout(kill);
      this.closed = true;
      this.credentials = { ...this.credentials, runtime_credential: '', inference_credential: '' };
    }
  }
}
