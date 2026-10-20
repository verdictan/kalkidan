import { isAgent, type BuiltinAgent } from '../config/agents';

// One preference for the agent of a new session. Settings shows it, and choosing an agent
// in a "New session" menu updates it.
export const agentPreferenceKey = 'kalkidan-default-agent';
const changeEvent = 'kalkidan-agent-preference';

export function readPreferredAgent(): BuiltinAgent {
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

export function savePreferredAgent(agent: BuiltinAgent) {
  try {
    localStorage.setItem(agentPreferenceKey, agent);
  } catch {
    /* The choice applies for this run only. */
  }
  window.dispatchEvent(new CustomEvent(changeEvent, { detail: agent }));
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
