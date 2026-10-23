import { useEffect, useState } from 'react';
import { ArrowUpRight, Check } from 'lucide-react';
import type { Agent, API } from '../types';
import { agentChoices, type AgentChoice, type DesktopAPI } from '../domain/desktop';
import { agentPreferenceKey } from '../lib/agent-preference';
import { agentCatalog, agentLabel, isAgent } from '../config/agents';
import { AgentIcon } from './ui/agent-icon';
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from './ui/dropdown-menu';

/** The agents that a task can start with: the agent CLIs found on the computer of the repo. */
export interface DetectedAgents {
  /** The agents found, in picker order. */
  found: AgentChoice[];
  /** The known agents that are not found. They show as "Not installed ↗". */
  missing: AgentChoice[];
  /** "This Mac" or the name of the SSH host. */
  computerName: string;
  /** False until the first check returns. */
  checked: boolean;
}

/** The agents of the browser preview and of an older desktop bridge: every known agent. */
const fallbackChoices: AgentChoice[] = agentCatalog.map(({ id }) => ({
  agent: id,
  name: agentLabel(id),
  available: true,
  installUrl: '',
}));

/**
 * The agent CLIs found on a computer (`local` or an SSH host ID). Kalkidan does not install or
 * set up agents: it lists only what it finds. It updates after each new check.
 */
export function useDetectedAgents(api: API, computer = 'local'): DetectedAgents {
  const desktop = api as API & DesktopAPI;
  const supported = typeof desktop.toolStatus === 'function';
  const [state, setState] = useState<{ choices: AgentChoice[]; name: string; checked: boolean }>(
    () => ({ choices: supported ? [] : fallbackChoices, name: 'This Mac', checked: !supported }),
  );
  useEffect(() => {
    if (typeof desktop.toolStatus !== 'function') return;
    let live = true;
    desktop
      .toolStatus(computer)
      .then((value) => {
        if (live) setState({ choices: agentChoices(value), name: value.name, checked: true });
      })
      .catch(() => {
        if (live) setState((current) => ({ ...current, checked: true }));
      });
    const stop = desktop.onToolsChange?.((value) => {
      if (live && value.computer === computer)
        setState({ choices: agentChoices(value), name: value.name, checked: true });
    });
    return () => {
      live = false;
      stop?.();
    };
  }, [desktop, computer]);
  return {
    found: state.choices.filter((choice) => choice.available),
    missing: state.choices.filter((choice) => !choice.available),
    computerName: state.name,
    checked: state.checked,
  };
}

/** The agent that Start uses: the preferred agent when it is found, else the first found. */
export function startAgent(agents: DetectedAgents): Agent | undefined {
  let preferred = '';
  try {
    const saved = localStorage.getItem(agentPreferenceKey);
    preferred = isAgent(saved) ? saved : '';
  } catch {
    // Without storage, the first agent found starts.
  }
  return agents.found.find((choice) => choice.agent === preferred)?.agent || agents.found[0]?.agent;
}

/** Opens Settings at Tools, where the user sees what Kalkidan found. */
export function openToolsSettings() {
  window.dispatchEvent(new CustomEvent('kalkidan-open-settings', { detail: { section: 'tools' } }));
}

/**
 * The items of a Start menu: "Found on this Mac", each found agent with its version and a check
 * on the current one, the known agents that are not installed (they open the official page),
 * then "Settings › Tools".
 */
export function AgentMenuItems({
  agents,
  current,
  onPick,
}: {
  agents: DetectedAgents;
  current?: Agent;
  onPick: (agent: Agent) => void;
}) {
  return (
    <>
      <DropdownMenuLabel>
        Found on {agents.computerName.replace(/^This /, 'this ')}
      </DropdownMenuLabel>
      {agents.found.map((choice) => (
        <DropdownMenuItem key={choice.agent} onSelect={() => onPick(choice.agent)}>
          <span className="task-agent-tile" aria-hidden="true">
            <AgentIcon agent={choice.agent} />
          </span>
          <span className="min-w-0 flex-1 truncate">{choice.name}</span>
          {choice.version && <span className="task-agent-version">{choice.version}</span>}
          {choice.agent === current ? (
            <Check className="size-4" aria-label="Current" />
          ) : (
            <span className="size-4" aria-hidden="true" />
          )}
        </DropdownMenuItem>
      ))}
      {!agents.found.length && (
        <DropdownMenuItem disabled>
          <span className="text-muted-foreground">No agent found</span>
        </DropdownMenuItem>
      )}
      {agents.missing.map((choice) =>
        choice.installUrl ? (
          <DropdownMenuItem key={choice.agent} asChild className="text-muted-foreground">
            <a href={choice.installUrl} target="_blank" rel="noreferrer">
              <span className="task-agent-tile" data-missing aria-hidden="true">
                <AgentIcon agent={choice.agent} />
              </span>
              <span className="min-w-0 flex-1 truncate">{choice.name}</span>
              <span className="task-agent-version">Not installed</span>
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </a>
          </DropdownMenuItem>
        ) : null,
      )}
      <DropdownMenuSeparator />
      <DropdownMenuItem className="task-agent-tools" onSelect={openToolsSettings}>
        <span className="min-w-0 flex-1">Settings › Tools</span>
        <ArrowUpRight className="size-4" aria-hidden="true" />
      </DropdownMenuItem>
    </>
  );
}
