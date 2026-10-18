import { remoteNodeCommand } from './remote-node';
import { writeJSON } from './storage/atomic-json';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { readFile } from 'node:fs/promises';

import { createHash, randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { exec, shellQuote } from './core';
import type { RemoteHost } from '../src/types';
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
  constructor(
    private file: string,
    private bundle: string,
  ) {}
  async load() {
    try {
      const data = JSON.parse(await readFile(this.file, 'utf8'));
      if (!Array.isArray(data)) throw new Error('Invalid remote hosts');
      this.hosts = data.map((h: any) => {
        sshTarget(h.target);
        return { ...h, status: 'disconnected' };
      });
    } catch (e: any) {
      if (e.code !== 'ENOENT') throw e;
    }
  }
  private save() {
    const content = structuredClone(this.hosts.map(({ status, ...h }) => h));
    const task = this.writes
      .catch(() => {})
      .then(async () => {
        await writeJSON(this.file, content);
      });
    this.writes = task;
    return task;
  }
  list() {
    return this.hosts.map((h) => ({ ...h }));
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
      host.node = info.node;
      host.platform = info.platform;
      await this.save();
      return { ...host };
    } catch (e: any) {
      host.status = 'error';
      throw new Error(
        `SSH check failed for ${host.target}. ${String(e.stderr || e.message).slice(-1500)}\nUse a known host with key-based SSH access and Node.js 22 or later installed.`,
      );
    }
  }
  async install(id: string) {
    const host = this.host(id);
    await this.check(id);
    const data = await readFile(this.bundle);
    const version = createHash('sha256').update(data).digest('hex').slice(0, 20);
    const directory = `$HOME/.local/share/kalkidan/agents/${version}`;
    await new Promise<void>((resolve, reject) => {
      const child = spawn(
        'ssh',
        [
          ...flags,
          host.target,
          `umask 077; mkdir -p "${directory}" && cat > "${directory}/agent.cjs.tmp" && mv "${directory}/agent.cjs.tmp" "${directory}/agent.cjs"`,
        ],
        { stdio: ['pipe', 'pipe', 'pipe'] },
      );
      let error = '';
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error('Agent installation timed out. Retry when the host is reachable.'));
      }, 60000);
      child.stderr.on('data', (c) => (error += c.toString()));
      child.stdin.on('error', () => {});
      child.on('error', (e) => {
        clearTimeout(timer);
        reject(e);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        code === 0 ? resolve() : reject(new Error(error || 'Agent installation failed'));
      });
      child.stdin.end(data);
    });
    if (this.connections.has(id)) {
      this.disconnect(id);
      this.connections.delete(id);
    }
    host.version = version;
    await this.save();
    return this.connect(id);
  }
  async connect(id: string) {
    const host = this.host(id);
    if (this.connections.has(id)) {
      await this.call(id, 'hello', []);
      host.status = 'connected';
      return { ...host };
    }
    if (!host.version || !/^[a-f0-9]{20}$/.test(host.version))
      throw new Error('Install the Kalkidan agent first.');
    const child = spawn(
      'ssh',
      [
        ...flags,
        host.target,
        remoteNodeCommand(`"$HOME/.local/share/kalkidan/agents/${host.version}/agent.cjs"`),
      ],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    const connection: Connection = { child, pending: new Map(), stderr: '' };
    this.connections.set(id, connection);
    host.status = 'connecting';
    const fail = (error: Error) => {
      if (this.connections.get(id) !== connection) return;
      this.connections.delete(id);
      host.status = 'disconnected';
      for (const p of connection.pending.values()) {
        clearTimeout(p.timer);
        p.reject(error);
      }
      connection.pending.clear();
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
        const pending = connection.pending.get(result.id);
        if (!pending) return;
        clearTimeout(pending.timer);
        connection.pending.delete(result.id);
        result.error ? pending.reject(new Error(result.error)) : pending.resolve(result.result);
      } catch {}
    });
    try {
      const info = await this.call(id, 'hello', []);
      if (info.protocol !== 1) throw new Error('Agent version mismatch. Reinstall the agent.');
      host.status = 'connected';
      host.node = info.node;
      host.platform = info.platform;
      await this.save();
      return { ...host };
    } catch (e) {
      this.disconnect(id);
      throw e;
    }
  }
  call(id: string, method: string, args: any[]): Promise<any> {
    const connection = this.connections.get(id);
    if (!connection)
      return Promise.reject(new Error('Host is offline. Connect it from Settings → Remote hosts.'));
    return new Promise((resolve, reject) => {
      const key = randomUUID();
      const timer = setTimeout(
        () => {
          connection.pending.delete(key);
          reject(new Error('Remote request timed out. Check the connection before retrying.'));
        },
        method === 'clone' ? 310000 : 60000,
      );
      connection.pending.set(key, { resolve, reject, timer });
      connection.child.stdin.write(JSON.stringify({ id: key, method, args }) + '\n');
    });
  }
  disconnect(id: string) {
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
    if (host) host.status = 'disconnected';
  }
  close() {
    for (const id of this.connections.keys()) this.disconnect(id);
  }
}
