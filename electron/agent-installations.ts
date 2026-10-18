import { agentCatalog } from '../src/config/agents';
import { executable } from './chat';
import type { AgentInstallation } from '../src/types';

export async function agentInstallations(): Promise<AgentInstallation[]> {
  return Promise.all(
    agentCatalog.map(async ({ id: agent }) => {
      try {
        const { path } = await executable(agent);
        return { agent, status: 'installed' as const, path };
      } catch {
        return { agent, status: 'missing' as const };
      }
    }),
  );
}
