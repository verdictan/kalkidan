import { agentPrograms } from './chat';
import { subscriptionLogin } from './agent-installations';
import { detectTools } from './tool-detection';
import type { ToolStatus } from '../src/domain/desktop';

/**
 * Checks the tools of the computer that runs this process: the desktop, or the SSH helper on
 * a host. It finds each program as chats do, so the result matches what a chat runs.
 */
export function localToolStatus(gatewayReady = false): Promise<ToolStatus[]> {
  return detectTools({
    find: async (tool) => (await agentPrograms(tool)).selected,
    claudeLogin: async () => {
      const login = await subscriptionLogin('claude_code');
      return login === 'signed-in' ? 'yes' : login === 'signed-out' ? 'no' : 'unknown';
    },
    gatewayReady,
  });
}
