import type { PrepareManagedLaunch } from '../../electron/agents/managed-launch';

/**
 * A managed launch that already passed the Verdictan checks. It runs the resolved test agent
 * with its own environment, so protocol tests can use fake agent processes.
 */
export const acceptedManagedLaunch: PrepareManagedLaunch = async (request) => ({
  executable: request.executable.path,
  prefix: request.executable.args || [],
  args: [],
  env: request.executable.env,
  model: request.model || '',
  bindNativeSession: async () => {},
  redact: (text) => text,
  finish: async () => {},
});
