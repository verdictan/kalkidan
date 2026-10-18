import { isAbsolute } from 'node:path';
export interface RuntimeConfig {
  defaultTracker: string;
  agentRequestTimeoutMs: number;
  agentExecutable: Partial<Record<'codex' | 'claude', string>>;
}
/** Explicit environment configuration; no executable code or credentials in project data. */
export function runtimeConfig(env: NodeJS.ProcessEnv = process.env): RuntimeConfig {
  const defaultTracker = env.KALKIDAN_DEFAULT_TRACKER || 'github';
  if (!/^[a-z][a-z0-9-]*$/.test(defaultTracker))
    throw new Error('Invalid KALKIDAN_DEFAULT_TRACKER');
  const timeout = Number(env.KALKIDAN_AGENT_REQUEST_TIMEOUT_MS || 60000);
  if (!Number.isSafeInteger(timeout) || timeout < 1000 || timeout > 300000)
    throw new Error('KALKIDAN_AGENT_REQUEST_TIMEOUT_MS must be 1000–300000');
  const agentExecutable: RuntimeConfig['agentExecutable'] = {};
  for (const agent of ['codex', 'claude'] as const) {
    const value = env[`KALKIDAN_${agent.toUpperCase()}_PATH`];
    if (value !== undefined) {
      if (!isAbsolute(value) || value.includes('\0'))
        throw new Error(`KALKIDAN_${agent.toUpperCase()}_PATH must be an absolute executable path`);
      agentExecutable[agent] = value;
    }
  }
  return { defaultTracker, agentRequestTimeoutMs: timeout, agentExecutable };
}
