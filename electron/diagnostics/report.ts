import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import {
  agentSupport,
  runtimeSupport,
  supportBundle,
  type AgentDiagnostics,
  type DiagnosticsReport,
  type RuntimeDiagnostics,
  type SupportBundlePreview,
} from '../../src/domain/diagnostics';
import { supportWindow } from '../../src/domain/compatibility';
import type { ComponentUpdateStatus } from '../../src/domain/updates';
import type { VerdictanStatus } from '../../src/domain/verdictan';
import type { AgentInstallation } from '../../src/types';
import type { DiagnosticsJournal } from './journal';

export interface DiagnosticsSources {
  app(): Promise<{ version: string; build: string; packaged: boolean }>;
  platform: string;
  arch: string;
  osVersion: string;
  account(): VerdictanStatus;
  hosts(): { id: string; name: string; connected: boolean; helper?: string }[];
  runtime(hostId?: string): Promise<ComponentUpdateStatus | undefined>;
  agents(hostId?: string): Promise<AgentInstallation[]>;
  journal: DiagnosticsJournal;
  now?: () => number;
  /** The wait for each host. A host that does not answer shows its error. */
  timeoutMs?: number;
}

function within<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    work,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('The host did not answer in time.')), ms);
      timer.unref?.();
    }),
  ]).finally(() => clearTimeout(timer));
}
const message = (error: unknown) =>
  error instanceof Error ? error.message.slice(0, 300) : 'Kalkidan could not read the status.';

/**
 * Reads the versions, the connection state, and the measurements. It only reads. It never
 * installs, updates, or connects. Disconnected SSH hosts show what Kalkidan knows.
 */
export async function collectDiagnostics(sources: DiagnosticsSources): Promise<DiagnosticsReport> {
  const now = sources.now ?? Date.now;
  const timeout = sources.timeoutMs ?? 5000;
  const status = sources.account();
  const hosts = sources.hosts();
  const runtime = async (
    hostId: string,
    name: string,
    connected: boolean,
    helper?: string,
  ): Promise<RuntimeDiagnostics> => {
    const base = { hostId, name, connected, ...(helper ? { helper } : {}) };
    if (!connected) return runtimeSupport(base, now());
    try {
      const value = await within(sources.runtime(hostId === 'local' ? undefined : hostId), timeout);
      return runtimeSupport(
        {
          ...base,
          ...(value?.installed ? { installed: value.installed.version } : {}),
          ...(value?.running ? { running: value.running.version } : {}),
          ...(value?.latest ? { latest: value.latest.version } : {}),
          ...(value?.error ? { error: value.error } : {}),
        },
        now(),
      );
    } catch (error) {
      return runtimeSupport({ ...base, error: message(error) }, now());
    }
  };
  const agents = async (hostId: string, connected: boolean): Promise<AgentDiagnostics[]> => {
    if (!connected) return [];
    try {
      const list = await within(sources.agents(hostId === 'local' ? undefined : hostId), timeout);
      return list.map((item) =>
        agentSupport({
          hostId,
          agent: item.agent,
          status: item.status,
          ...(item.version ? { version: item.version } : {}),
        }),
      );
    } catch {
      return [];
    }
  };
  const [app, runtimes, agentLists] = await Promise.all([
    sources.app(),
    Promise.all([
      runtime('local', 'This computer', true),
      ...hosts.map((host) => runtime(host.id, host.name, host.connected, host.helper)),
    ]),
    Promise.all([agents('local', true), ...hosts.map((host) => agents(host.id, host.connected))]),
  ]);
  return {
    schemaVersion: 1,
    createdAt: new Date(now()).toISOString(),
    app,
    platform: sources.platform,
    arch: sources.arch,
    osVersion: sources.osVersion,
    supportWindow: {
      protocol: supportWindow.protocol.current,
      runtimeMinimum: supportWindow.runtime.minimum,
      runtimeNewestVerified: supportWindow.runtime.newestVerified,
    },
    connection: {
      ...(status.region ? { region: status.region } : {}),
      phase: status.phase,
      executionReady: status.executionReady,
      ...(status.error ? { error: status.error } : {}),
      ...(status.capabilities
        ? {
            protocolMin: status.capabilities.protocolMin,
            protocolMax: status.capabilities.protocolMax,
          }
        : {}),
      capabilities: status.capabilities?.capabilities.slice(0, 100) ?? [],
    },
    runtimes,
    agents: agentLists.flat(),
    correlations: sources.journal.recentCorrelations(),
    measurements: sources.journal.summary(),
  };
}

/**
 * Keeps the last preview. Export writes only that exact text, so the user exports what they saw.
 */
export class SupportBundles {
  private last?: SupportBundlePreview;
  constructor(
    private collect: () => Promise<DiagnosticsReport>,
    private home?: string,
  ) {}
  async preview(): Promise<SupportBundlePreview> {
    const { value, count } = supportBundle(await this.collect(), this.home);
    const text = JSON.stringify(value, null, 2) + '\n';
    this.last = {
      text,
      digest: createHash('sha256').update(text).digest('hex'),
      redactions: count,
      bytes: Buffer.byteLength(text),
    };
    return this.last;
  }
  /**
   * Writes the previewed bundle to the file that the user chooses. Returns false when the user
   * cancels. Refuses a digest that is not the last preview.
   */
  async export(digest: unknown, choose: (name: string) => Promise<string | undefined>) {
    const last = this.last;
    if (!last || typeof digest !== 'string' || digest !== last.digest)
      throw new Error('Preview the support bundle again before you export it.');
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const file = await choose(`kalkidan-support-${stamp}.json`);
    if (!file) return false;
    await writeFile(file, last.text, { mode: 0o600 });
    return true;
  }
}
