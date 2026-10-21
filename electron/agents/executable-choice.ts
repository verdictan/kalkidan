import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { writeJSON } from '../storage/atomic-json';

/** The agents that can have a chosen program. */
export type ChoosableAgent = 'codex' | 'claude';
export type ChosenExecutables = Partial<Record<ChoosableAgent, string>>;

let root: string | undefined;

/**
 * Sets the data folder of the store. The desktop uses its data folder. The SSH helper uses the
 * default, `~/.kalkidan` on the host.
 */
export function setAgentExecutableRoot(path: string) {
  root = path;
}

/** The file that keeps the program that the user chose for each agent on this computer. */
export function agentExecutableFile() {
  return join(root ?? join(homedir(), '.kalkidan'), 'agent-executables.json');
}

/** True for a path that the store accepts: absolute, without control characters, not too long. */
export function validExecutablePath(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= 4096 &&
    isAbsolute(value) &&
    // oxlint-disable-next-line no-control-regex
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

/** Reads the chosen programs. A missing or damaged file means automatic detection. */
export async function readChosenExecutables(): Promise<ChosenExecutables> {
  let data: unknown;
  try {
    data = JSON.parse(await readFile(agentExecutableFile(), 'utf8'));
  } catch {
    return {};
  }
  const agents = (data as { agents?: Record<string, unknown> } | null)?.agents;
  const chosen: ChosenExecutables = {};
  if (!agents || typeof agents !== 'object') return chosen;
  for (const agent of ['codex', 'claude'] as const)
    if (validExecutablePath(agents[agent])) chosen[agent] = agents[agent];
  return chosen;
}

/** Keeps the chosen program of one agent. `null` removes it, so automatic detection applies. */
export async function writeChosenExecutable(agent: ChoosableAgent, path: string | null) {
  const chosen = await readChosenExecutables();
  if (path === null) delete chosen[agent];
  else {
    if (!validExecutablePath(path)) throw new Error('Choose an absolute program path.');
    chosen[agent] = path;
  }
  await writeJSON(agentExecutableFile(), { schema_version: 1, agents: chosen });
}
