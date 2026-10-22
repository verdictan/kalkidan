import { randomUUID } from 'node:crypto';
import { agentLabel } from '../src/config/agents';
import {
  hasSshWork,
  type SshHostWork,
  type SshQuitAnswer,
  type SshQuitChoice,
  type SshQuitRequest,
} from '../src/domain/ssh-quit';

/** A host call waits this long. A host that does not answer has no work in the list. */
export const sshQuitCallMs = 3000;

export interface SshQuitSource {
  /** The SSH hosts that are connected now. Only they can list and stop their work. */
  hosts(): { id: string; name: string }[];
  call(hostId: string, method: string, args: unknown[]): Promise<unknown>;
  /**
   * The names of the hosts that are not connected now, but had runs or shells that the app
   * knows, for example from the last list or from a reattach.
   */
  disconnected?(): string[];
  /** The title of a chat on a host, when the app knows it. */
  title?(hostId: string, agent: string, sessionId: string): string | undefined;
  /** True when the user wants the question. "Don't ask again" sets it to false. */
  asks(): Promise<boolean>;
  setAsks(value: boolean): Promise<unknown>;
  /** Asks in a window. Null when no window can ask, or the window closed first. */
  askWindow(request: SshQuitRequest): Promise<SshQuitAnswer | null>;
  /** Asks with a system dialog, when no window can ask. */
  askSystem(request: SshQuitRequest): Promise<Omit<SshQuitAnswer, 'id'>>;
  callMs?: number;
}

function withTimeout<T>(task: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    task,
    new Promise<T>((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error('The host did not answer.')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

const text = (value: unknown, limit: number) =>
  typeof value === 'string' && value.length > 0 && value.length <= limit ? value : undefined;

/**
 * The agent runs and shells that work on the connected SSH hosts. The helper of each host lists
 * them, also the ones that an earlier app session started. A host that fails or does not answer
 * gives no work.
 */
export async function collectSshWork(source: SshQuitSource): Promise<SshHostWork[]> {
  const ms = source.callMs ?? sshQuitCallMs;
  return Promise.all(
    source.hosts().map(async (host) => {
      const list = (method: string) =>
        withTimeout(source.call(host.id, method, []), ms).then(
          (value) => (Array.isArray(value) ? value.slice(0, 200) : []),
          () => [],
        );
      const [runs, shells] = await Promise.all([list('chat-runs'), list('ptyList')]);
      return {
        hostId: host.id,
        hostName: host.name,
        runs: runs.flatMap((value: any) => {
          const id = text(value?.id, 160);
          if (!id) return [];
          const agent = text(value.agent, 40) ?? '';
          const sessionId = text(value.sessionId, 160);
          const title = sessionId && source.title?.(host.id, agent, sessionId);
          return [{ id, label: title || `${agent ? agentLabel(agent) : 'Agent'} chat` }];
        }),
        shells: shells.flatMap((value: any) => {
          const id = text(value?.id, 160);
          const cwd = text(value?.cwd, 4096);
          return id ? [{ id, label: cwd ? `Shell in ${cwd}` : 'Shell' }] : [];
        }),
      };
    }),
  );
}

/** Stops each run and closes each shell. A host that fails or does not answer is skipped. */
export async function stopSshWork(source: SshQuitSource, hosts: SshHostWork[]) {
  const ms = source.callMs ?? sshQuitCallMs;
  await Promise.allSettled(
    hosts.flatMap((host) => [
      ...host.runs.map((run) => withTimeout(source.call(host.hostId, 'chatStop', [run.id]), ms)),
      ...host.shells.map((shell) =>
        withTimeout(source.call(host.hostId, 'ptyClose', [shell.id]), ms),
      ),
    ]),
  );
}

/**
 * Asks what to do with the work on the SSH hosts when the app quits. Without work, or after
 * "Don't ask again", the work continues and nothing shows. "Stop all" stops the work first.
 * The app always quits after the answer: Escape and closing the question keep the work. The
 * question also names the disconnected hosts whose work can still run. With only such hosts,
 * "Keep running" is the only choice.
 */
export async function decideSshQuit(source: SshQuitSource): Promise<SshQuitChoice> {
  if (!(await source.asks().catch(() => true))) return 'keep';
  const hosts = await collectSshWork(source);
  const disconnected = [...new Set(source.disconnected?.() ?? [])].slice(0, 50);
  if (!hasSshWork(hosts) && !disconnected.length) return 'keep';
  const request: SshQuitRequest = {
    id: randomUUID(),
    hosts: hosts.filter((host) => host.runs.length + host.shells.length > 0),
    disconnected,
  };
  const answer = (await source.askWindow(request)) ?? (await source.askSystem(request));
  if (answer.dontAsk) await source.setAsks(false).catch(() => {});
  // Without work on a connected host, there is nothing to stop.
  const choice = hasSshWork(request.hosts) ? answer.choice : 'keep';
  if (choice === 'stop') await stopSshWork(source, request.hosts);
  return choice;
}
