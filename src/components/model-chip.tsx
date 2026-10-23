import { useEffect, useState } from 'react';
import type { API } from '../api/contracts';
import type { ModelOption } from '../types';
import { modelChoice, type ModelChoice } from '../domain/model-choice';
import { agentChoices, type AgentChoice, type ComputerTools } from '../domain/desktop';
import { savePreferredAgent } from '../lib/agent-preference';
import { Check, ChevronDown, Settings2, SquareArrowOutUpRight } from 'lucide-react';
import { agentCatalog, isAgent } from '../config/agents';
import { AgentIcon } from './ui/agent-icon';
import { Button } from './ui/button';
import { composerChipClass } from './composer';
import { cn } from '../lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Hint } from './hint';
import { openSettings } from './chat-links';

/** The tool detection calls of the desktop app (DESKTOP). Older builds do not have them. */
type ToolsAPI = {
  toolStatus?: (computer?: string, options?: { fresh?: boolean }) => Promise<ComputerTools>;
  onToolsChange?: (callback: (computer: ComputerTools) => void) => () => void;
};

/** The line under the agent list. Kalkidan finds new programs when it starts. */
export const restartLine = 'Installed another agent? Restart Kalkidan to find it.';

/**
 * The agents that Kalkidan found on the computer of a chat: this computer, or the SSH host.
 * Kalkidan does not install, update or set up agents (R6). Undefined until the check answers.
 * Without the check (an older desktop app), every agent counts as available.
 */
export function useDetectedAgents(api: API, hostId?: string): AgentChoice[] | undefined {
  const tools = api as API & ToolsAPI;
  const computer = hostId || 'local';
  const [found, setFound] = useState<ComputerTools | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    if (typeof tools.toolStatus !== 'function') {
      setFound(null);
      return;
    }
    setFound(undefined);
    Promise.resolve()
      .then(() => tools.toolStatus!(computer))
      .then((value) => live && setFound(value))
      .catch(() => live && setFound(null));
    const unsubscribe = tools.onToolsChange?.((value) => {
      if (live && value.computer === computer) setFound(value);
    });
    return () => {
      live = false;
      unsubscribe?.();
    };
  }, [api, computer]);
  if (found === undefined) return undefined;
  const choices = found
    ? agentChoices(found)
    : agentCatalog.map((agent) => ({
        agent: agent.id,
        name: agent.name,
        available: true,
        installUrl: '',
      }));
  // The order of the agent catalog: Codex, then Claude Code (CH-B4).
  return agentCatalog
    .map((agent) => choices.find((choice) => choice.agent === agent.id))
    .filter((choice): choice is AgentChoice => !!choice);
}

/**
 * The agent picker of the composer (CH-B4): a 28px chip with the agent icon and name. The menu
 * lists the agent CLIs that Kalkidan found on this computer, with their versions, "through
 * Verdictan". An agent that is not found shows "Not installed" and opens its official page.
 * There is no model, no "Use for new chats" and no agent management. Before the first message,
 * the user can change the agent; Kalkidan remembers the last choice.
 */
export function AgentPicker({
  api,
  agent,
  hostId,
  onAgentChange,
  disabled,
}: {
  api: API;
  /** The agent of the chat, for example "codex". */
  agent: string;
  /** The SSH host of the chat. Undefined: this computer. */
  hostId?: string;
  /** Changes the agent of a new chat. Without it, the agent of the chat cannot change. */
  onAgentChange?: (agent: string) => void;
  disabled?: boolean;
}) {
  const choices = useDetectedAgents(api, hostId);
  const name = agentCatalog.find((item) => item.id === agent)?.name || agent;
  return (
    <DropdownMenu>
      <Hint label={onAgentChange ? 'Change the agent' : 'Agent'} disabled={disabled}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="chip"
            disabled={disabled}
            aria-label={`Agent: ${name}`}
            className={cn(
              'composer-agent max-w-[220px] min-w-0 shrink data-[state=open]:bg-[var(--surface-selected)] data-[state=open]:text-foreground',
              composerChipClass,
            )}
          >
            <AgentIcon agent={agent} className="size-3.5" />
            <span className="truncate">{name}</span>
            <ChevronDown aria-hidden="true" className="size-3.5" />
          </Button>
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent align="start" className="agent-picker-menu">
        <div className="agent-picker-head" role="presentation">
          <span>{hostId ? 'On this SSH host' : 'On this computer'}</span>
          <span className="agent-picker-through">through Verdictan</span>
        </div>
        {!choices && (
          <p role="status" className="agent-picker-note">
            Finding agents…
          </p>
        )}
        {choices?.map((choice) =>
          choice.available ? (
            <DropdownMenuItem
              key={choice.agent}
              disabled={choice.agent !== agent && !onAgentChange}
              onSelect={() => {
                if (choice.agent === agent) return;
                if (isAgent(choice.agent)) savePreferredAgent(choice.agent);
                onAgentChange?.(choice.agent);
              }}
            >
              <AgentIcon agent={choice.agent} />
              <span className="min-w-0 flex-1 truncate">{choice.name}</span>
              {choice.version && <span className="agent-picker-version">{choice.version}</span>}
              {choice.agent === agent ? (
                <Check aria-label="Selected" className="text-foreground" />
              ) : (
                <span className="size-4" aria-hidden="true" />
              )}
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
              <SquareArrowOutUpRight aria-label="Opens the official page" />
            </DropdownMenuItem>
          ),
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => openSettings('tools')}>
          <Settings2 />
          Tools…
        </DropdownMenuItem>
        <p className="agent-picker-note">{restartLine}</p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * The models of a chat. Round 11 removes the model choice from the composer: the agent CLI and
 * the organization policy choose the model. The hook stays for older callers.
 */
export function useModelChoice(
  _api: API,
  _agent: string,
  models: ModelOption[],
  agentName: string,
): ModelChoice {
  return modelChoice({ models, agentName });
}

/** @deprecated The composer has no model choice now. */
export const fixedModelHint = 'Your organization sets the model.';
/** @deprecated The composer has no model choice now. */
export const moreModelsHint = '';

/**
 * @deprecated Use AgentPicker. The model props are ignored: the chip is the agent picker.
 * Without `api`, every agent shows as available.
 */
export function ModelChip({
  api,
  agent,
  onAgentChange,
  disabled,
}: {
  api?: API;
  choice?: ModelChoice;
  value?: string;
  onChange?: (model: string) => void;
  disabled?: boolean;
  failed?: boolean;
  agent: string;
  agentName?: string;
  onAgentChange?: (agent: string) => void;
}) {
  return (
    <AgentPicker
      api={api || ({} as API)}
      agent={agent}
      onAgentChange={onAgentChange}
      disabled={disabled}
    />
  );
}
