import { projectServicePermissions } from '../../src/domain/project-services';
import type { ProjectServiceOperation } from '../../src/domain/project-services';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import type { Readable } from 'node:stream';
import { parseRuntimeCredentials, type RuntimeCredentials } from './credentials';

export type DesktopOperation =
  | ProjectServiceOperation
  | 'project.permissions'
  | 'capabilities'
  | 'status'
  | 'authorization.start'
  | 'authorization.cancel'
  | 'account.inspect'
  | 'setup.inspect'
  | 'session.renew'
  | 'session.logout'
  | 'runtime.provision'
  | 'runtime.export'
  | 'runtime.renew'
  | 'runtime.revoke'
  | 'hosts.inspect'
  | 'host.revoke'
  | 'resources.provision'
  | 'review.inspect';
export interface RuntimeProvision {
  project_id?: string;
  installation_id: string;
  host_id: string;
  session_id: string;
  agent_id: string;
  gateway_id: string;
  provider: string;
  model: string;
  provider_connection_id?: string;
  provider_access_mode?: 'byok' | 'codex_subscription';
}
export interface DesktopParameters {
  project_scope?: { organization_id: string; project_id: string };
  fields?: Record<string, unknown>;
  intent?: 'login' | 'register';
  parameters?:
    | RuntimeProvision
    | {
        installation_id: string;
        host_id: string;
        team_id: string;
        project_id?: string;
        configuration_id: string;
        configuration_version_id: string;
      };
  runtime_id?: string;
  gateway_stopped?: true;
  cursor?: string;
  installation_id?: string;
  host_id?: string;
  escalation_id?: string;
}
export interface DesktopEvent {
  schema_version: 1;
  correlation_id: string;
  sequence: number;
  event: string;
  data: Record<string, unknown>;
}
const terminalEvents: Record<DesktopOperation, string[]> = {
  'project.permissions': ['project.permissions_result'],
  'task.history': ['task.history_result'],
  'review.list': ['review.list_result'],
  'review.decide': ['review.decide_result'],
  'context.settings': ['context.settings_result'],
  'context.configure': ['context.configure_result'],
  'context.search': ['context.search_result'],
  'context.list': ['context.list_result'],
  'context.publish': ['context.publish_result'],
  'context.delete': ['context.delete_result'],
  'admin.templates': ['admin.templates_result'],
  'admin.template.save': ['admin.template.save_result'],
  'admin.template.apply': ['admin.template.apply_result'],
  'operation.inspect': ['operation.inspect_result'],
  capabilities: ['capabilities'],
  status: ['account.status'],
  'authorization.start': ['authorization.completed', 'authorization.canceled'],
  'authorization.cancel': ['authorization.cancel_completed'],
  'account.inspect': ['account.inspected'],
  'setup.inspect': ['setup.inspected'],
  'session.renew': ['session.renewed'],
  'session.logout': ['session.logged_out'],
  'runtime.provision': ['runtime.provisioning_result'],
  'runtime.export': ['runtime.exported'],
  'runtime.renew': ['runtime.renewed'],
  'runtime.revoke': ['runtime.revoked'],
  'hosts.inspect': ['hosts.inspected'],
  'host.revoke': ['host.revoked'],
  'resources.provision': ['resources.provisioned'],
  'review.inspect': ['review.inspected'],
};
export class DesktopProtocolError extends Error {
  constructor(public readonly code: string) {
    super(code);
  }
}
/** One process owns the secure CLI profile. Do not log its streams or arguments. */
export type DesktopClient = Pick<
  DesktopProtocol,
  'request' | 'exportRuntime' | 'close' | 'onClose'
>;
export class DesktopProtocol {
  private process: ChildProcessWithoutNullStreams;
  private decoder = new StringDecoder('utf8');
  private buffer = '';
  private sequence = 0;
  private closed = false;
  private requests = 0;
  private secretBuffer = Buffer.alloc(0);
  private secret?: {
    runtimeId: string;
    correlationId?: string;
    received?: boolean;
    resolve(value: RuntimeCredentials): void;
    reject(error: Error): void;
  };
  private protectedPipe?: Readable;
  private closeListeners = new Set<(code: string) => void>();
  private pending = new Map<
    string,
    {
      operation: DesktopOperation;
      resolve(event: DesktopEvent): void;
      reject(error: Error): void;
      progress?: (event: DesktopEvent) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(
    executable: string,
    args: string[],
    launch: typeof spawn = spawn,
    private timeoutMs = 30000,
    private now = Date.now,
  ) {
    if (!isAbsolute(executable) || executable.includes('\0'))
      throw new DesktopProtocolError('desktop.executable_invalid');
    this.process = launch(executable, ['auth', 'desktop', ...args], {
      stdio: ['pipe', 'pipe', 'pipe', 'pipe'],
      windowsHide: true,
      // Do not let provider or Verdictan credential overrides change the secure profile.
      env: Object.fromEntries(
        Object.entries(process.env).filter(
          ([key]) => !/^(?:VERDICTAN_|OPENAI_|ANTHROPIC_|NODE_OPTIONS$)/i.test(key),
        ),
      ),
    }) as ChildProcessWithoutNullStreams;
    this.protectedPipe = this.process.stdio?.[3] as Readable | undefined;
    this.protectedPipe?.on('data', (bytes: Buffer) => this.receiveSecret(bytes));
    this.protectedPipe?.on('error', () => this.close('desktop.transport_lost'));
    this.process.stdout.on('data', (bytes: Buffer) => this.receive(bytes));
    this.process.stderr.on('data', () => {});
    this.process.stdin.on('error', () => this.close('desktop.transport_lost'));
    this.process.on('error', () => this.close('desktop.process_failed'));
    this.process.on('close', () => this.close('desktop.transport_lost'));
  }
  onClose(listener: (code: string) => void) {
    if (this.closed) listener('desktop.transport_closed');
    else this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }
  request(
    operation: DesktopOperation,
    parameters: DesktopParameters = {},
    progress?: (event: DesktopEvent) => void,
  ): Promise<DesktopEvent> {
    if (this.closed) return Promise.reject(new DesktopProtocolError('desktop.transport_closed'));
    if (!Object.hasOwn(terminalEvents, operation))
      return Promise.reject(new DesktopProtocolError('desktop.operation_unsupported'));
    if (this.pending.size >= 8 || this.requests >= 4000)
      return Promise.reject(new DesktopProtocolError('desktop.connection_limit'));
    if (
      parameters.fields &&
      (!Object.hasOwn(projectServicePermissions, operation) ||
        Object.keys(parameters.fields).some((key) =>
          [
            'schema_version',
            'correlation_id',
            'operation',
            'project_scope',
            'parameters',
            'fields',
          ].includes(key),
        ))
    )
      return Promise.reject(new DesktopProtocolError('desktop.invalid_request'));
    const { fields, ...envelope } = parameters;
    const id = randomUUID();
    this.requests++;
    if (operation === 'runtime.export' && this.secret) this.secret.correlationId = id;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => this.close('desktop.request_timeout'),
        operation === 'authorization.start' ? 310000 : this.timeoutMs,
      );
      timer.unref?.();
      this.pending.set(id, { operation, resolve, reject, progress, timer });
      try {
        const request = {
          ...envelope,
          ...fields,
          schema_version: 1,
          correlation_id: id,
          operation,
          ...(operation === 'authorization.start' ? { intent: parameters.intent || 'login' } : {}),
        };
        this.process.stdin.write(JSON.stringify(request) + '\n');
      } catch {
        this.close('desktop.transport_lost');
      }
    });
  }
  async exportRuntime(runtimeId: string): Promise<RuntimeCredentials> {
    if (!this.protectedPipe || this.secret)
      throw new DesktopProtocolError('desktop.protected_pipe_unavailable');
    const credentials = new Promise<RuntimeCredentials>((resolve, reject) => {
      this.secret = { runtimeId, resolve, reject };
    });
    const timer = setTimeout(() => this.close('desktop.credential_export_timeout'), 5000);
    try {
      const [event, frame] = await Promise.all([
        this.request('runtime.export', { runtime_id: runtimeId }),
        credentials,
      ]);
      if (
        frame.correlation_id !== event.correlation_id ||
        event.data.runtime_id !== runtimeId ||
        event.data.credentials_exported !== true
      )
        throw new DesktopProtocolError('desktop.protocol_invalid');
      return frame;
    } catch (error) {
      this.close('desktop.credential_export_failed');
      throw error;
    } finally {
      clearTimeout(timer);
      this.secret = undefined;
      this.secretBuffer.fill(0);
      this.secretBuffer = Buffer.alloc(0);
    }
  }
  private receiveSecret(bytes: Buffer) {
    try {
      if (!this.secret || this.secretBuffer.length + bytes.length > 8192) throw new Error();
      const combined = Buffer.concat([this.secretBuffer, bytes]);
      this.secretBuffer.fill(0);
      this.secretBuffer = combined;
      const end = combined.indexOf(10);
      if (end < 0) return;
      if (end !== combined.length - 1) throw new Error();
      const frame = parseRuntimeCredentials(
        JSON.parse(combined.subarray(0, end).toString('utf8')),
        this.now(),
      );
      if (
        frame.runtime_id !== this.secret.runtimeId ||
        frame.correlation_id !== this.secret.correlationId ||
        this.secret.received
      )
        throw new Error();
      this.secret.received = true;
      const secret = this.secret;
      // Keep the operation reserved until both public confirmation and the secret arrive.
      secret.resolve(frame);
      this.secretBuffer.fill(0);
      this.secretBuffer = Buffer.alloc(0);
    } catch {
      this.close('desktop.protocol_invalid');
    }
  }
  private receive(bytes: Buffer) {
    if (this.closed) return;
    this.buffer += this.decoder.write(bytes);
    // Bound complete frames and unfinished frames before JSON parsing.
    if (Buffer.byteLength(this.buffer) > 256 * 1024) {
      this.close('desktop.frame_too_large');
      return;
    }
    let end: number;
    while ((end = this.buffer.indexOf('\n')) >= 0 && !this.closed) {
      const line = this.buffer.slice(0, end);
      this.buffer = this.buffer.slice(end + 1);
      try {
        const value = JSON.parse(line) as DesktopEvent;
        if (
          !value ||
          value.schema_version !== 1 ||
          !Number.isSafeInteger(value.sequence) ||
          value.sequence !== this.sequence + 1 ||
          typeof value.correlation_id !== 'string' ||
          typeof value.event !== 'string' ||
          !value.data ||
          Array.isArray(value.data) ||
          typeof value.data !== 'object'
        )
          throw new Error();
        this.sequence = value.sequence;
        const pending = this.pending.get(value.correlation_id);
        if (!pending) throw new Error();
        // Exported credentials use a separate protected pipe, never this client.
        if (containsCredential(value.data)) throw new Error();
        if (
          value.event === 'authorization.started' &&
          pending.operation === 'authorization.start'
        ) {
          pending.progress?.(value);
          continue;
        }
        if (value.event !== 'error' && !terminalEvents[pending.operation].includes(value.event))
          throw new Error();
        clearTimeout(pending.timer);
        this.pending.delete(value.correlation_id);
        if (value.event === 'error') {
          const code = value.data.code;
          pending.reject(
            new DesktopProtocolError(
              typeof code === 'string' && /^desktop\.[a-z_]{1,100}$/.test(code)
                ? code
                : 'desktop.operation_failed',
            ),
          );
        } else pending.resolve(value);
      } catch {
        this.close('desktop.protocol_invalid');
      }
    }
  }
  close(code = 'desktop.transport_closed') {
    if (this.closed) return;
    this.closed = true;
    this.buffer = '';
    this.secret?.reject(new DesktopProtocolError(code));
    this.secret = undefined;
    this.secretBuffer.fill(0);
    this.secretBuffer = Buffer.alloc(0);
    this.protectedPipe?.destroy();
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new DesktopProtocolError(code));
    }
    this.pending.clear();
    this.process.stdin.destroy();
    this.process.kill();
    for (const listener of this.closeListeners) listener(code);
    this.closeListeners.clear();
  }
}
function containsCredential(value: unknown, depth = 0): boolean {
  if (depth > 20) return true;
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(
    ([key, child]) =>
      /^(?:runtime_credential|inference_credential|api_token|apiToken|token|refresh_token|password|secret)$/i.test(
        key,
      ) || containsCredential(child, depth + 1),
  );
}
