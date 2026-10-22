import { useEffect, useState } from 'react';
import type { API } from '../api/contracts';
import {
  completeSelection,
  initialSelection,
  type ManagedAgentKind,
  type VerdictanSetup,
} from '../domain/verdictan';
import type { ModelOption } from '../types';
import { modelChoice, type ModelChoice } from '../domain/model-choice';
import { allowedModels } from '../lib/verdictan-labels';
import {
  onPreferredAgentChange,
  readPreferredAgent,
  savePreferredAgent,
} from '../lib/agent-preference';
import { managedAgentsChangedEvent, notifyManagedAgentsChanged } from './verdictan-settings';
import { openComputers } from './computers-page';
import { ChevronDown, Settings2 } from 'lucide-react';
import { agentCatalog, isAgent } from '../config/agents';
import { AgentIcon } from './ui/agent-icon';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Hint } from './hint';
import { showToast } from './ui/toast';

// The setup choices change seldom. Chats share one read for a short time.
const setupCache = new WeakMap<API, { at: number; value: Promise<VerdictanSetup | undefined> }>();
const setupLifetime = 60_000;
function readSetup(api: API) {
  const cached = setupCache.get(api);
  if (cached && Date.now() - cached.at < setupLifetime) return cached.value;
  const value =
    typeof api.verdictanSetup === 'function'
      ? Promise.resolve()
          .then(() => api.verdictanSetup())
          .catch(() => undefined)
      : Promise.resolve(undefined);
  setupCache.set(api, { at: Date.now(), value });
  return value;
}

/** The API of the last composer. "Use for new chats" saves the default model through it. */
let setupApi: API | undefined;

/**
 * The models that the composer offers for a chat. A managed setup limits them to the models
 * that the organization allows.
 */
export function useModelChoice(
  api: API,
  agent: string,
  models: ModelOption[],
  agentName: string,
): ModelChoice {
  const [setup, setSetup] = useState<VerdictanSetup>();
  useEffect(() => {
    setupApi = api;
    let live = true;
    const read = (fresh = false) => {
      if (fresh) setupCache.delete(api);
      void readSetup(api).then((value) => live && setSetup(value));
    };
    read();
    const changed = () => read(true);
    window.addEventListener(managedAgentsChangedEvent, changed);
    const unsubscribe = api.onVerdictanChanged?.(changed);
    return () => {
      live = false;
      window.removeEventListener(managedAgentsChangedEvent, changed);
      unsubscribe?.();
    };
  }, [api]);
  const kind = agent === 'codex' || agent === 'claude' ? agent : undefined;
  return modelChoice({
    models,
    allowed: kind ? allowedModels(setup, kind) : undefined,
    setupModel: kind ? setup?.selections?.[kind]?.model || undefined : undefined,
    agentName,
  });
}

/** The value of the default item. A menu item cannot have an empty value. */
const defaultValue = 'default';
export const fixedModelHint = 'Your organization sets the model.';
/** @deprecated The chip has "Manage agents…" now. */
export const moreModelsHint = '';

/** Opens the Computers page at the agents, where each agent has its program and setup. */
function manageAgents() {
  openComputers('settings-agents');
}

/**
 * Saves the agent and the model of this chat for new chats. The agent is the preference of
 * this computer. The model is the default model of the organization setup of the agent. A
 * setup that is not complete keeps its model, and the toast opens the Computers page.
 */
async function saveForNewChats(agent: string, model: string, agentName: string) {
  const before = readPreferredAgent();
  if (isAgent(agent)) savePreferredAgent(agent);
  const kind: ManagedAgentKind | undefined =
    agent === 'codex' || agent === 'claude' ? agent : undefined;
  const api = setupApi;
  let saved = !model;
  if (kind && model && api && typeof api.verdictanSelect === 'function') {
    try {
      const setup = await api.verdictanSetup();
      const current = initialSelection(setup, kind);
      const next = { ...current, model };
      if (completeSelection(setup, kind, next)) {
        await api.verdictanSelect(kind, next);
        setupCache.delete(api);
        notifyManagedAgentsChanged();
        saved = true;
      }
    } catch {
      saved = false;
    }
  }
  if (saved)
    showToast({
      message: `New chats use ${agentName}${model ? ` with this model` : ''}`,
      actions:
        isAgent(agent) && before !== agent
          ? [{ label: 'Undo', onClick: () => savePreferredAgent(before) }]
          : undefined,
    });
  else
    showToast({
      message: `New chats use ${agentName}. Set up ${agentName} to save the model.`,
      actions: [{ label: 'Set up', onClick: manageAgents }],
    });
}

/** The agent of new chats. It changes when another view saves it. */
function usePreferredAgent() {
  const [agent, setAgent] = useState<string>(readPreferredAgent);
  useEffect(() => onPreferredAgentChange(setAgent), []);
  return agent;
}

/**
 * The "Agent · Model" picker of the composer. It shows the agent and the active model. Before
 * the first message, it can also change the agent. With one model and no agent choice, it is a
 * label with a tooltip and no arrow.
 *
 * Composer variant: like every composer control, the picker is a 28px pill (Button `chip`).
 * Use pills only in the composer. Forms use Select.
 */
export function ModelChip({
  choice,
  value,
  onChange,
  disabled,
  failed,
  agent,
  agentName,
  onAgentChange,
}: {
  choice: ModelChoice;
  value: string;
  onChange: (model: string) => void;
  disabled?: boolean;
  /** True when the agent's models did not load. */
  failed?: boolean;
  /** The agent of the chat, for example "codex". */
  agent: string;
  agentName: string;
  /** Changes the agent of a new chat. Without it, the agent cannot change. */
  onAgentChange?: (agent: string) => void;
}) {
  const preferred = usePreferredAgent();
  const current = choice.options.find((option) => option.id === value);
  const modelName = current?.name || (choice.managed ? choice.defaultName : 'Default');
  const label = `${agentName} · ${modelName}`;
  const agents = onAgentChange ? agentCatalog : [];
  if (choice.fixed && agents.length < 2)
    return (
      <Hint label={fixedModelHint}>
        <span
          tabIndex={0}
          role="note"
          aria-label={`Agent and model: ${label}. ${fixedModelHint}`}
          className="model-chip-label inline-flex h-7 max-w-[220px] min-w-0 shrink items-center gap-1.5 rounded-full px-2.5 text-xs font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-color)] focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <AgentIcon agent={agent} className="size-3.5" />
          <span className="truncate">{label}</span>
        </span>
      </Hint>
    );
  // Managed: the setup model is an option. Not managed: the agent's default is an option.
  const selected = current
    ? current.id
    : choice.managed
      ? choice.options.find((option) => option.isDefault)?.id || defaultValue
      : defaultValue;
  // The model that new chats would use: the selected one, or none for the default.
  const chosen = selected === defaultValue ? '' : selected;
  const setupModel = choice.options.find((option) => option.isDefault)?.id || '';
  const usedForNewChats = preferred === agent && (!chosen || chosen === setupModel);
  return (
    <DropdownMenu>
      <Hint
        label={onAgentChange ? 'Change the agent or the model' : `Model: ${modelName}`}
        disabled={disabled}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant="chip"
            disabled={disabled}
            aria-label={`Agent and model: ${label}`}
            className="max-w-[220px] min-w-0 shrink gap-1.5"
          >
            <AgentIcon agent={agent} className="size-3.5" />
            <span className="truncate">{label}</span>
            <ChevronDown aria-hidden="true" className="size-3.5 opacity-60" />
          </Button>
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent align="start" className="max-h-96 w-64">
        {agents.length > 1 && (
          <>
            <DropdownMenuLabel>Agent</DropdownMenuLabel>
            <DropdownMenuRadioGroup
              value={agent}
              onValueChange={(next) => next !== agent && onAgentChange?.(next)}
            >
              {agents.map((item) => (
                <DropdownMenuRadioItem key={item.id} value={item.id}>
                  <AgentIcon agent={item.id} />
                  {item.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuLabel>Model</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={selected}
          onValueChange={(next) => onChange(next === defaultValue ? '' : next)}
        >
          {!choice.managed && (
            <DropdownMenuRadioItem value={defaultValue}>
              <span className="truncate">Default</span>
            </DropdownMenuRadioItem>
          )}
          {choice.options.map((option) => (
            <DropdownMenuRadioItem key={option.id} value={option.id} title={option.name}>
              <span className="truncate">{option.name}</span>
              {option.isDefault && (
                <span className="ml-auto text-xs text-muted-foreground">Default</span>
              )}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {failed && !choice.managed && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            Could not load models. The default model is used.
          </p>
        )}
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={usedForNewChats}
          disabled={usedForNewChats}
          onSelect={() => void saveForNewChats(agent, chosen, agentName)}
        >
          Use for new chats
        </DropdownMenuCheckboxItem>
        <DropdownMenuItem onSelect={manageAgents}>
          <Settings2 />
          Manage agents…
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
