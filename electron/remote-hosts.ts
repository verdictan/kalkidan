import { ConnectionScheduler } from './connection-scheduler';
import { remoteProtocolVersion } from '../src/domain/host';
import { remoteNodeCommand } from './remote-node';
import { writeJSON } from './storage/atomic-json';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFile } from 'node:fs/promises';

import { createHash, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { exec, shellQuote } from './core';
import type { RemoteHost, ChatRun, AgentInstallation } from '../src/types';
import { sanitizeAgentInstallations } from '../src/domain/agent-programs';
export function sshTarget(value: string) {
  if (
    typeof value !== 'string' ||
    !value ||
    value.length > 200 ||
    !/^([a-zA-Z0-9_][a-zA-Z0-9_.-]*@)?[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(value)
  )
    throw new Error(
      'Use an SSH config alias or user@hostname. Configure ports and keys in ~/.ssh/config.',
    );
  return value;
}
const flags = [
  '-T',
  '-o',
  'BatchMode=yes',
  '-o',
  'StrictHostKeyChecking=yes',
  '-o',
  'ConnectTimeout=10',
  '-o',
  'ServerAliveInterval=15',
  '-o',
  'ServerAliveCountMax=3',
];
interface Connection {
  brokerPending: Set<string>;
  child: ChildProcessWithoutNullStreams;
  pending: Map<
    string,
    { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }
  >;
  stderr: string;
}
export class RemoteHosts {
  hosts: RemoteHost[] = [];
  private connections = new Map<string, Connection>();
  private writes = Promise.resolve();
  private connecting = new Map<string, Promise<RemoteHost>>();
  private installing = new Map<string, Promise<RemoteHost>>();
  private installations = new Map<string, AbortController>();
  private stopped = new Set<string>();
  private closing = false;
  private reconciling?: Promise<void>;
  private runs = new Map<string, { hostId: string; state: ChatRun }>();
  private interruptRuns(hostId: string) {
    for (const run of this.runs.values()) {
      if (
        run.hostId !== hostId ||
        (run.state.status !== 'running' &&
          (!run.state.governance || run.state.governance.finalized))
      )
        continue;
      run.state = {
        ...run.state,
        status: 'failed',
        errorCode: 'transport_lost',
        governance: run.state.governance
          ? { ...run.state.governance, status: 'unavailable', finalized: true }
          : undefined,
        activity: 'Connection lost',
        error:
          'The remote connection was lost. Reconnect and reopen the saved session to continue.',
        approvals: run.state.approvals?.map((a) =>
          a.status === 'pending' ? { ...a, status: 'expired' } : a,
        ),
        requests: run.state.requests?.map((r) =>
          ['pending', 'submitting'].includes(r.status) ? { ...r, status: 'expired' } : r,
        ),
      };
    }
  }
  private waiters = new Map<
    string,
    { resolve(host: RemoteHost): void; reject(error: Error): void }
  >();
  private scheduler = new ConnectionScheduler(
    (id) => this.openConnection(id),
    (id, state) => {
      const host = this.hosts.find((host) => host.id === id);
      if (!host) return;
      host.status = state.status;
      host.attempt = state.attempt;
      host.retryAt = state.retryAt;
      host.error = state.error;
      const waiter = this.waiters.get(id);
      if (state.status === 'connected') waiter?.resolve({ ...host });
      if (state.status === 'error' || state.status === 'retry-wait')
        waiter?.reject(new Error(state.error || 'Connection failed.'));
      this.changed();
    },
  );
  constructor(
    private file: string,
    private bundle: string,
    private changed: () => void = () => {},
    private resourceChanged: (
      hostId: string,
      groupId: string,
      resource: 'docs' | 'memory',
    ) => void = () => {},
    private managedAccount?: (
      hostId: string,
      operation: string,
      parameters: any,
    ) => Promise<unknown>,
  ) {}
  async load() {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      if (!Array.isArray(data)) throw new Error('Invalid remote hosts');
      this.hosts = data.map((h: any) => {
        sshTarget(h.target);
        const {
          error: _error,
          attempt: _attempt,
          retryAt: _retryAt,
          setup: _setup,
          runningDigest: _runningDigest,
          ...saved
        } = h;
        const setup =
          _setup && typeof _setup.id === 'string'
            ? {
                ..._setup,
                ...(['checking', 'installing', 'verifying'].includes(_setup.phase)
                  ? {
                      phase: 'interrupted',
                      error:
                        'Helper update was interrupted. Reconnect to inspect the installed helper.',
                    }
                  : {}),
              }
            : undefined;
        const agentCheck =
          saved.agentCheck && Number.isFinite(saved.agentCheck.checkedAt)
            ? {
                checkedAt: saved.agentCheck.checkedAt,
                agents: sanitizeAgentInstallations(saved.agentCheck.agents),
              }
            : undefined;
        return { ...saved, agentCheck, setup, status: 'disconnected' };
      });
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  private save() {
    // The status and the last error describe this app session only.
    const content = structuredClone(
      this.hosts.map(({ status, error, attempt, retryAt, runningDigest, ...h }) => h),
    );
    const task = this.writes
      .catch(() => {})
      .then(async () => {
        await writeJSON(this.file, content);
      });
    this.writes = task;
    return task;
  }
  busy(id: string) {
    return [...this.runs.values()].some(
      (run) => run.hostId === id && run.state.status === 'running',
    );
  }
  list() {
    return structuredClone(this.hosts);
  }
  async add(name: string, target: string) {
    target = sshTarget(target.trim());
    if (!name?.trim() || name.length > 100) throw new Error('Enter a host name.');
    const existing = this.hosts.find((h) => h.target === target);
    if (existing) return existing;
    const host: RemoteHost = {
      id: randomUUID(),
      name: name.trim(),
      target,
      status: 'disconnected',
    };
    this.hosts.push(host);
    await this.save();
    return { ...host };
  }
  private host(id: string) {
    const host = this.hosts.find((h) => h.id === id);
    if (!host) throw new Error('Remote host not found');
    return host;
  }
  async check(id: string) {
    const host = this.host(id);
    try {
      const { stdout } = await exec(
        'ssh',
        [
          ...flags,
          host.target,
          remoteNodeCommand(
            '-e ' +
              shellQuote(
                'if(Number(process.versions.node.split(".")[0])<22)process.exit(2);console.log(JSON.stringify({node:process.version,platform:process.platform,home:require("os").homedir()}))',
              ),
          ),
        ],
        { timeout: 20000, maxBuffer: 100000 },
      );
      const info = JSON.parse(stdout.trim().split('\n').at(-1)!);
      host.status = this.connections.has(id) ? 'connected' : 'checked';
      delete host.error;
      host.node = info.node;
      host.platform = info.platform;
      await this.save();
      return { ...host };
    } catch (e: any) {
      host.status = 'error';
      const error = new Error(
        `SSH check failed for ${host.target}. ${String(e.stderr || e.message).slice(-1500)}\nUse a known host with key-based SSH access and Node.js 22 or later installed.`,
      );
      host.error = error.message;
      throw error;
    }
  }
  install(id: string): Promise<RemoteHost> {
    const existing = this.installing.get(id);
    if (existing) return existing;
    if (this.closing) return Promise.reject(new Error('The app is closing.'));
    try {
      this.host(id);
    } catch (error) {
      return Promise.reject(error);
    }
    if (this.busy(id))
      return Promise.reject(
        new Error('Wait for active remote work to finish before updating the helper.'),
      );
    this.disconnect(id);
    this.stopped.delete(id);
    const controller = new AbortController();
    this.installations.set(id, controller);
    const task = this.performInstall(id, controller);
    this.installing.set(id, task);
    const clean = () => {
      if (this.installing.get(id) === task) this.installing.delete(id);
      if (this.installations.get(id) === controller) this.installations.delete(id);
    };
    void task.then(clean, clean);
    return task;
  }
  private async performInstall(id: string, controller: AbortController) {
    const host = this.host(id);
    const previous = { version: host.version, digest: host.installedDigest };
    if (host.setup)
      host.setupHistory = [
        ...(host.setupHistory || []),
        {
          id: host.setup.id,
          phase: host.setup.phase,
          targetDigest: host.setup.targetDigest,
          previousDigest: host.setup.previousDigest,
          updatedAt: host.setup.updatedAt,
        },
      ].slice(-20);
    host.setup = {
      id: randomUUID(),
      phase: 'checking',
      previousDigest: previous.digest,
      updatedAt: Date.now(),
    };
    this.changed();
    const assertCurrent = () => {
      if (controller.signal.aborted || this.closing || !this.hosts.includes(host))
        throw new Error('Agent installation canceled.');
    };
    try {
      await this.save();
      await this.check(id);
      assertCurrent();
      const data = await readFile(this.bundle);
      assertCurrent();
      const digest = createHash('sha256').update(data).digest('hex');
      const version = digest.slice(0, 20);
      const directory = `$HOME/.local/share/kalkidan/agents/${version}`;
      host.setup.phase = 'installing';
      host.setup.targetDigest = digest;
      host.setup.updatedAt = Date.now();
      await this.save();
      this.changed();
      await new Promise<void>((resolve, reject) => {
        const verify =
          'const f=require("fs"),c=require("crypto"),p=process.argv[1];' +
          `if(c.createHash("sha256").update(f.readFileSync(p)).digest("hex")!=="${digest}")process.exit(3);` +
          'f.renameSync(p,p.slice(0,-4));';
        const child = spawn(
          'ssh',
          [
            ...flags,
            host.target,
            `umask 077; mkdir -p "${directory}" && cat > "${directory}/agent.cjs.tmp" && ` +
              remoteNodeCommand(`-e ${shellQuote(verify)} "${directory}/agent.cjs.tmp"`),
          ],
          { stdio: ['pipe', 'pipe', 'pipe'] },
        );
        let error = '';
        const cancel = () => {
          clearTimeout(timer);
          child.kill();
          reject(new Error('Agent installation canceled.'));
        };
        const timer = setTimeout(() => {
          child.kill();
          reject(new Error('Agent installation timed out. Retry when the host is reachable.'));
        }, 60000);
        controller.signal.addEventListener('abort', cancel, { once: true });
        child.stderr.on('data', (c) => (error = (error + c.toString()).slice(-8192)));
        child.stdin.on('error', () => {});
        child.on('error', (e) => {
          clearTimeout(timer);
          controller.signal.removeEventListener('abort', cancel);
          reject(e);
        });
        child.on('close', (code) => {
          clearTimeout(timer);
          controller.signal.removeEventListener('abort', cancel);
          code === 0 ? resolve() : reject(new Error(error || 'Agent installation failed'));
        });
        child.stdin.end(data);
        if (controller.signal.aborted) cancel();
      });
      assertCurrent();
      host.setup.phase = 'verifying';
      this.changed();
      host.version = version;
      host.installedDigest = digest;
      await this.save();
      assertCurrent();
      const result = await this.beginConnection(id);
      assertCurrent();
      if (host.runningDigest !== digest)
        throw new Error('The running helper digest does not match the uploaded helper.');
      host.setup.phase = 'ready';
      host.setup.updatedAt = Date.now();
      await this.save();
      this.changed();
      return { ...result, setup: { ...host.setup } };
    } catch (error) {
      const changedVersion = host.version !== previous.version;
      if (changedVersion) {
        this.disconnect(id);
        host.version = previous.version;
        host.installedDigest = previous.digest;
        host.runningDigest = undefined;
      }
      host.setup.phase = controller.signal.aborted
        ? 'canceled'
        : changedVersion && previous.version
          ? 'rolled-back'
          : 'failed';
      host.setup.error = controller.signal.aborted
        ? undefined
        : error instanceof Error
          ? error.message
          : 'Agent installation failed.';
      if (controller.signal.aborted) {
        host.status = 'disconnected';
        delete host.error;
      }
      host.setup.updatedAt = Date.now();
      await this.save();
      this.changed();
      throw error;
    }
  }
  /** Reconnect saved installations without delaying the desktop window. */
  async connectSaved() {
    const queue = this.hosts
      .filter((host) => /^[a-f0-9]{20}$/.test(host.version || ''))
      .map((host) => host.id);
    await Promise.all(
      Array.from({ length: Math.min(3, queue.length) }, async () => {
        while (queue.length && !this.closing) {
          const id = queue.shift()!;
          if (this.stopped.has(id) || !this.hosts.some((host) => host.id === id)) continue;
          await this.connect(id).catch(() => {});
        }
      }),
    );
  }
  /** Recheck live connections after wake. Mutations and interrupted runs are never replayed. */
  reconcile(): Promise<void> {
    if (this.reconciling) return this.reconciling;
    const queue = this.hosts.filter((host) => !this.stopped.has(host.id)).map((host) => host.id);
    const task = Promise.all(
      Array.from({ length: Math.min(3, queue.length) }, async () => {
        while (queue.length && !this.closing) {
          const id = queue.shift()!;
          if (
            this.stopped.has(id) ||
            this.installing.has(id) ||
            !this.hosts.some((host) => host.id === id)
          )
            continue;
          const connection = this.connections.get(id);
          if (!connection) {
            if (/^[a-f0-9]{20}$/.test(this.host(id).version || '')) this.scheduler.start(id);
            continue;
          }
          try {
            const info = await this.call(id, 'hello', []);
            if (this.connections.get(id) !== connection || this.closing) continue;
            if (info?.protocol !== remoteProtocolVersion)
              throw new Error('Agent version mismatch. Update the Kalkidan helper in Settings.');
            const host = this.host(id);
            host.node = info.node;
            host.platform = info.platform;
            host.runningDigest = /^[a-f0-9]{64}$/.test(info.bundleDigest || '')
              ? info.bundleDigest
              : undefined;
            this.changed();
          } catch (error) {
            if (this.connections.get(id) !== connection || this.closing) continue;
            this.closeConnection(id);
            this.scheduler.failed(
              id,
              error instanceof Error ? error.message : 'Connection check failed.',
            );
          }
        }
      }),
    ).then(() => {});
    this.reconciling = task;
    void task
      .finally(() => {
        if (this.reconciling === task) this.reconciling = undefined;
      })
      .catch(() => {});
    return task;
  }
  connect(id: string): Promise<RemoteHost> {
    return this.installing.get(id) || this.beginConnection(id);
  }
  private beginConnection(id: string): Promise<RemoteHost> {
    if (this.closing) return Promise.reject(new Error('The app is closing.'));
    if (!this.hosts.some((host) => host.id === id))
      return Promise.reject(new Error('Remote host not found'));
    const pending = this.connecting.get(id);
    if (pending) return pending;
    this.stopped.delete(id);
    if (this.hosts.find((host) => host.id === id)?.status === 'connected')
      return Promise.resolve({ ...this.host(id) });
    const task = new Promise<RemoteHost>((resolve, reject) =>
      this.waiters.set(id, { resolve, reject }),
    );
    this.connecting.set(id, task);
    this.scheduler.start(id);
    const clean = () => {
      if (this.connecting.get(id) === task) {
        this.connecting.delete(id);
        this.waiters.delete(id);
      }
      this.changed();
    };
    void task.then(clean, clean);
    return task;
  }
  private async openConnection(id: string): Promise<RemoteHost> {
    const host = this.host(id);
    if (this.connections.has(id)) {
      const existing = this.connections.get(id);
      try {
        const info = await this.call(id, 'hello', []);
        if (info?.protocol !== remoteProtocolVersion)
          throw new Error('Agent version mismatch. Update the Kalkidan helper in Settings.');
      } catch {
        // The connection does not answer. Close it and make a new one.
        if (this.connections.get(id) !== existing || this.closing)
          throw new Error('Connection canceled.');
        this.closeConnection(id);
        return this.openConnection(id);
      }
      if (this.connections.get(id) !== existing || this.closing)
        throw new Error('Connection canceled.');
      host.status = 'connected';
      delete host.error;
      return { ...host };
    }
    if (!host.version || !/^[a-f0-9]{20}$/.test(host.version)) {
      host.status = 'error';
      host.error = 'Install the Kalkidan agent first.';
      throw new Error(host.error);
    }
    const child = spawn(
      'ssh',
      [
        ...flags,
        host.target,
        remoteNodeCommand(`"$HOME/.local/share/kalkidan/agents/${host.version}/agent.cjs"`),
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const connection: Connection = {
      child,
      pending: new Map(),
      stderr: '',
      brokerPending: new Set(),
    };
    this.connections.set(id, connection);
    host.status = 'connecting';
    this.changed();
    const fail = (error: Error) => {
      if (this.connections.get(id) !== connection) return;
      this.connections.delete(id);
      this.interruptRuns(id);
      host.status = host.status === 'connecting' ? 'error' : 'disconnected';
      host.error = error.message.trim();
      for (const p of connection.pending.values()) {
        clearTimeout(p.timer);
        p.reject(error);
      }
      connection.pending.clear();
      connection.child.kill();
      this.scheduler.failed(id, error.message);
      this.changed();
    };
    child.stderr.on(
      'data',
      (c) => (connection.stderr = (connection.stderr + c.toString()).slice(-4000)),
    );
    child.stdin.on('error', () => {});
    child.on('error', fail);
    child.on('close', () =>
      fail(new Error('SSH disconnected. Reconnect this host. ' + connection.stderr)),
    );
    createInterface({ input: child.stdout }).on('line', (line) => {
      if (line.length > 8000000) return;
      try {
        const result = JSON.parse(line);
        if (this.connections.get(id) !== connection) return;
        if (
          result.event === 'project-resource-changed' &&
          typeof result.groupId === 'string' &&
          ['docs', 'memory'].includes(result.resource)
        ) {
          this.resourceChanged(id, result.groupId, result.resource);
          return;
        }
        if (result.event === 'managed-account-request') {
          if (
            !this.managedAccount ||
            typeof result.id !== 'string' ||
            result.id.length > 64 ||
            typeof result.operation !== 'string' ||
            connection.brokerPending.has(result.id) ||
            connection.brokerPending.size >= 8
          )
            return;
          connection.brokerPending.add(result.id);
          const reply = (value: object) => {
            if (this.connections.get(id) === connection)
              child.stdin.write(
                JSON.stringify({ event: 'managed-account-result', id: result.id, ...value }) + '\n',
              );
          };
          void this.managedAccount(id, result.operation, result.parameters)
            .then(
              (value) => reply({ result: value }),
              (error) =>
                reply({
                  error: /^desktop\.[a-z_]{1,100}$/.test(error?.code)
                    ? error.code
                    : 'desktop.operation_failed',
                }),
            )
            .finally(() => connection.brokerPending.delete(result.id));
          return;
        }
        const pending = connection.pending.get(result.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        connection.pending.delete(result.id);
        result.error ? pending.reject(new Error(result.error)) : pending.resolve(result.result);
      } catch {}
    });
    try {
      const info = await this.call(id, 'hello', []);
      if (this.connections.get(id) !== connection) throw new Error('Connection canceled.');
      if (info.protocol !== remoteProtocolVersion)
        throw new Error('Agent version mismatch. Update the Kalkidan helper in Settings.');
      host.status = 'connected';
      delete host.error;
      host.node = info.node;
      host.platform = info.platform;
      host.runningDigest = /^[a-f0-9]{64}$/.test(info.bundleDigest || '')
        ? info.bundleDigest
        : undefined;
      if (host.installedDigest && host.runningDigest !== host.installedDigest)
        throw new Error(
          'The running helper digest does not match its installation. Update the helper.',
        );
      if (host.setup?.phase === 'interrupted' && host.setup.targetDigest === host.runningDigest) {
        host.setup.phase = 'ready';
        host.setup.error = undefined;
        host.setup.updatedAt = Date.now();
      }
      await this.save();
      return { ...host };
    } catch (e: any) {
      if (this.connections.get(id) !== connection) throw e;
      this.closeConnection(id);
      // Keep the reason, so the UI can show it next to Reconnect.
      host.status = 'error';
      const message = String(e?.message || 'The connection failed.').trim();
      const detail = connection.stderr.trim().slice(-800);
      host.error = detail && !message.includes(detail) ? `${message} ${detail}` : message;
      throw e;
    }
  }
  call(id: string, method: string, args: any[]): Promise<any> {
    const previous = this.runs.get(JSON.stringify([id, args[0]]))?.state;
    if (previous?.errorCode === 'transport_lost') {
      if (method === 'chatStatus') return Promise.resolve(structuredClone(previous));
      if (['chatApprove', 'chatRespond'].includes(method))
        return Promise.reject(new Error('This request expired when the remote connection closed.'));
      if (method === 'chatStop') return Promise.resolve();
    }
    const connection = this.connections.get(id);
    if (!connection)
      return Promise.reject(new Error('Host is offline. Connect it from Settings → Remote hosts.'));
    return new Promise<any>((resolve, reject) => {
      const key = randomUUID();
      const timer = setTimeout(
        () => {
          connection.pending.delete(key);
          const message = 'Remote request timed out. Check the connection before retrying.';
          reject(new Error(message));
          if (['hello', 'chatStatus'].includes(method) && this.connections.get(id) === connection) {
            this.closeConnection(id);
            this.scheduler.failed(id, message);
          }
        },
        method === 'hello' ? 15000 : method === 'clone' ? 310000 : 60000,
      );
      connection.pending.set(key, { resolve, reject, timer });
      try {
        connection.child.stdin.write(JSON.stringify({ id: key, method, args }) + '\n');
      } catch (error) {
        clearTimeout(timer);
        connection.pending.delete(key);
        reject(error);
        if (this.connections.get(id) === connection) {
          this.closeConnection(id);
          this.scheduler.failed(id, 'SSH transport failed.');
        }
      }
    }).then((result) => {
      if (
        ['chatCreate', 'chatStart', 'chatStatus'].includes(method) &&
        result &&
        typeof result.id === 'string'
      ) {
        const key = JSON.stringify([id, result.id]);
        const state = structuredClone(result) as ChatRun;
        this.runs.set(key, { hostId: id, state });
        if (this.connections.get(id) !== connection) this.interruptRuns(id);
        for (const [old, value] of this.runs)
          if (this.runs.size > 30 && value.state.status !== 'running' && old !== key)
            this.runs.delete(old);
        return structuredClone(this.runs.get(key)!.state);
      }
      return result;
    });
  }
  disconnect(id: string) {
    this.installations.get(id)?.abort();
    this.stopped.add(id);
    this.scheduler.stop(id);
    this.waiters.get(id)?.reject(new Error('Connection canceled.'));
    this.waiters.delete(id);
    this.connecting.delete(id);
    this.closeConnection(id);
  }
  private closeConnection(id: string) {
    this.interruptRuns(id);
    const connection = this.connections.get(id);
    if (connection) {
      this.connections.delete(id);
      for (const p of connection.pending.values()) {
        clearTimeout(p.timer);
        p.reject(new Error('SSH disconnected. Reconnect the host.'));
      }
      connection.pending.clear();
      connection.child.stdin.end();
      connection.child.kill();
    }
    const host = this.hosts.find((h) => h.id === id);
    if (host) {
      host.status = 'disconnected';
      delete host.error;
      delete host.retryAt;
      delete host.attempt;
    }
    this.changed();
  }
  /**
   * Checks the agent programs on a connected host and keeps the result, so Settings › Agents can
   * show it when the host is not connected. A helper without the check asks for an update.
   */
  async agentInstallations(id: string): Promise<AgentInstallation[]> {
    return this.recordAgentCheck(id, () => this.call(id, 'agent-installations', []));
  }
  /** Keeps the chosen program of an agent on the host. `null` returns to automatic detection. */
  async chooseAgentExecutable(id: string, agent: string, path: string | null) {
    return this.recordAgentCheck(id, () => this.call(id, 'agent-executable-choose', [agent, path]));
  }
  private async recordAgentCheck(id: string, request: () => Promise<unknown>) {
    const host = this.host(id);
    let result: unknown;
    try {
      result = await request();
    } catch (error) {
      if (error instanceof Error && /Unsupported remote operation/.test(error.message))
        throw new Error(
          'The Kalkidan helper on this host is too old to check agents. Update the helper in Settings › Remote hosts.',
        );
      throw error;
    }
    const agents = sanitizeAgentInstallations(result);
    if (this.hosts.includes(host)) {
      host.agentCheck = { checkedAt: Date.now(), agents };
      await this.save();
      this.changed();
    }
    return structuredClone(agents);
  }
  /** Disconnects a host and removes it from the saved list. */
  async remove(id: string) {
    this.host(id);
    this.disconnect(id);
    this.hosts = this.hosts.filter((h) => h.id !== id);
    for (const [key, run] of this.runs) if (run.hostId === id) this.runs.delete(key);
    await this.save();
  }
  close() {
    this.closing = true;
    this.scheduler.close();
    for (const host of this.hosts) this.disconnect(host.id);
  }
}
