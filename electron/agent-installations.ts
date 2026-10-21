import { agentCatalog } from '../src/config/agents';
import { nativeAgentKind } from '../src/domain/agent-version';
import { executable } from './chat';
import { installedAgentVersion, type InstalledAgentVersion } from './agents/installed-version';
import type { AgentInstallation } from '../src/types';

/** Finds each agent and reads its version. Settings › Agents compares it with the minimum. */
export async function agentInstallations(
  find: typeof executable = executable,
  readVersion: InstalledAgentVersion = installedAgentVersion,
): Promise<AgentInstallation[]> {
  return Promise.all(
    agentCatalog.map(async ({ id: agent }) => {
      let found: Awaited<ReturnType<typeof executable>>;
      try {
        found = await find(agent);
      } catch {
        return { agent, status: 'missing' as const };
      }
      const kind = nativeAgentKind(agent);
      const version = kind ? await readVersion(kind, found).catch(() => undefined) : undefined;
      return {
        agent,
        status: 'installed' as const,
        path: found.path,
        ...(version ? { version } : {}),
      };
    }),
  );
}
