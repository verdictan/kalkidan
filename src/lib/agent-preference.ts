import { agentCatalog, isAgent, type BuiltinAgent } from '../config/agents';
import type { AgentInstallation } from '../domain/conversation';

// One preference for the agent of a new chat. Settings shows it, and choosing an agent
// in a "New chat" menu updates it. The default is an installed agent: when the preferred
// agent is not installed, the first installed agent is the default.
export const agentPreferenceKey = 'kalkidan-default-agent';
const changeEvent = 'kalkidan-agent-preference';

/** The installation state of each agent. An agent without an entry is not checked yet. */
let installations = new Map<BuiltinAgent, AgentInstallation['status']>();
let pendingCheck: Promise<void> | null = null;

/** The agent that the user chose, without the installation check. */
function savedAgent(): BuiltinAgent {
  try {
    const value = localStorage.getItem(agentPreferenceKey);
    if (isAgent(value)) return value;
    // Read the older "last used" key once, so an upgrade keeps the user's choice.
    const legacy = localStorage.getItem('kalkidan-last-agent');
    return isAgent(legacy) ? legacy : 'codex';
  } catch {
    return 'codex';
  }
}

/**
 * False only when the check found that the agent is missing. An agent that the app cannot
 * check (the browser preview, a remote host) counts as available.
 */
export function agentInstalled(agent: string) {
  return !isAgent(agent) || installations.get(agent) !== 'missing';
}

/** The preferred agent if it is installed. Else the first installed agent. */
export function readPreferredAgent(): BuiltinAgent {
  const saved = savedAgent();
  if (agentInstalled(saved)) return saved;
  return agentCatalog.find((item) => agentInstalled(item.id))?.id || saved;
}

/** The menu label of an agent: "Codex · Not installed" when the check found it missing. */
export function agentMenuLabel(agent: string, label: string) {
  return agentInstalled(agent) ? label : `${label} · Not installed`;
}

/**
 * Reads the agent installations once and keeps them. Listeners of the preference hear a
 * change when the default agent changes because of the result.
 */
export function loadAgentInstallations(
  read: () => Promise<AgentInstallation[]>,
  force = false,
): Promise<void> {
  if (pendingCheck && !force) return pendingCheck;
  const before = readPreferredAgent();
  pendingCheck = Promise.resolve()
    .then(read)
    .then((list) => {
      setAgentInstallations(list);
      if (readPreferredAgent() !== before) notify(readPreferredAgent());
    })
    .catch(() => {
      /* Without a result, every agent stays available. */
    });
  return pendingCheck;
}

/** Keeps the result of a check that another view made, for example Settings › Agents. */
export function setAgentInstallations(list: AgentInstallation[]) {
  const before = readPreferredAgent();
  installations = new Map(
    list.filter((item) => isAgent(item.agent)).map((item) => [item.agent, item.status]),
  );
  const after = readPreferredAgent();
  if (after !== before) notify(after);
}

function notify(agent: BuiltinAgent) {
  window.dispatchEvent(new CustomEvent(changeEvent, { detail: agent }));
}

export function savePreferredAgent(agent: BuiltinAgent) {
  try {
    localStorage.setItem(agentPreferenceKey, agent);
  } catch {
    /* The choice applies for this run only. */
  }
  notify(readPreferredAgent());
}

/** Calls `listener` when the preference changes. Returns a function that stops it. */
export function onPreferredAgentChange(listener: (agent: BuiltinAgent) => void) {
  const handle = (event: Event) => {
    const agent = (event as CustomEvent).detail;
    if (isAgent(agent)) listener(agent);
  };
  window.addEventListener(changeEvent, handle);
  return () => window.removeEventListener(changeEvent, handle);
}
