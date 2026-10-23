import { Check, Settings2, SquareArrowOutUpRight } from 'lucide-react';
import type { API } from '../api/contracts';
import { agentChoices, type ComputerTools } from '../domain/desktop';
import { agentCatalog, isAgent } from '../config/agents';
import { savePreferredAgent } from '../lib/agent-preference';
import { isMac } from '../lib/platform';
import { AgentIcon } from './ui/agent-icon';
import {
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from './ui/dropdown-menu';
import { openSettings } from './chat-links';
import { useComputerTools } from './settings-tools';

/**
 * The computers of the agent picker before a folder is chosen (ST-C2): this computer first,
 * then each connected SSH host with its tools. Undefined while the check runs.
 */
function pickerComputers(computers: ComputerTools[] | undefined) {
  if (!computers) return undefined;
  return [
    ...computers.filter((computer) => computer.computer === 'local'),
    ...computers.filter(
      (computer) =>
        computer.computer !== 'local' && computer.connected && computer.tools.length > 0,
    ),
  ];
}

/**
 * The menu rows of the agent picker of the first composer (ST-C2): one group for each
 * computer ("This Mac", then each SSH host such as "build-server") with the agent CLIs that
 * Kalkidan found there. An agent that is not found is a quiet row, "Not installed ↗", that
 * opens its official page. "Tools…" (⌘,) opens Settings at Tools. Kalkidan does not install,
 * update or set up agents.
 */
export function ComputerAgentGroups({
  api,
  agent,
  onAgentChange,
}: {
  api: API;
  /** The agent of the new chat, for example "codex". It shows a check on this computer. */
  agent: string;
  onAgentChange?: (agent: string) => void;
}) {
  const tools = useComputerTools(api);
  const computers = pickerComputers(tools.computers);
  const order = agentCatalog.map((item) => item.id as string);
  return (
    <>
      {!computers && (
        <p role="status" className="agent-picker-note">
          Finding agents…
        </p>
      )}
      {computers?.map((computer, index) => {
        const local = computer.computer === 'local';
        const choices = agentChoices(computer).sort(
          (a, b) => order.indexOf(a.agent) - order.indexOf(b.agent),
        );
        return (
          <div key={computer.computer} role="group" aria-label={computer.name}>
            {index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="agent-picker-computer" aria-hidden="true">
              {computer.name}
            </DropdownMenuLabel>
            {choices.map((choice) => {
              const selected = local && choice.agent === agent;
              return choice.available ? (
                <DropdownMenuItem
                  key={choice.agent}
                  disabled={!selected && !onAgentChange}
                  onSelect={() => {
                    if (selected) return;
                    if (isAgent(choice.agent)) savePreferredAgent(choice.agent);
                    onAgentChange?.(choice.agent);
                  }}
                >
                  <AgentIcon agent={choice.agent} />
                  <span className="min-w-0 flex-1 truncate">{choice.name}</span>
                  {selected && <Check aria-label="Selected" className="text-muted-foreground" />}
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem
                  key={choice.agent}
                  className="text-muted-foreground"
                  disabled={!choice.installUrl}
                  onSelect={() => window.open(choice.installUrl, '_blank', 'noreferrer')}
                >
                  <AgentIcon agent={choice.agent} />
                  <span className="min-w-0 flex-1 truncate">{choice.name}</span>
                  <span className="agent-picker-version">Not installed</span>
                  <SquareArrowOutUpRight aria-label="Opens the official page" className="size-3" />
                </DropdownMenuItem>
              );
            })}
          </div>
        );
      })}
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={() => openSettings('tools')}>
        <Settings2 />
        Tools…
        <DropdownMenuShortcut>{isMac ? '⌘,' : 'Ctrl+,'}</DropdownMenuShortcut>
      </DropdownMenuItem>
    </>
  );
}
