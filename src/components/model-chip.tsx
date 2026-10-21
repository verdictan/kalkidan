import { useEffect, useState } from 'react';
import type { API } from '../api/contracts';
import type { VerdictanSetup } from '../domain/verdictan';
import type { ModelOption } from '../types';
import { modelChoice, type ModelChoice } from '../domain/model-choice';
import { allowedModels } from '../lib/verdictan-labels';
import { managedAgentsChangedEvent } from './verdictan-settings';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { Hint } from './hint';
import { cn } from '../lib/utils';

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

/** The value of the default item. A select item cannot have an empty value. */
const defaultValue = 'default';
export const fixedModelHint = 'Your organization sets the model.';

/**
 * The model chip of the composer. It shows the active model. With one allowed model, it is a
 * label with a tooltip. The value '' means that the chat picked no model.
 */
export function ModelChip({
  choice,
  value,
  onChange,
  disabled,
  failed,
}: {
  choice: ModelChoice;
  value: string;
  onChange: (model: string) => void;
  disabled?: boolean;
  /** True when the agent's models did not load. */
  failed?: boolean;
}) {
  const current = choice.options.find((option) => option.id === value);
  const name = current?.name || choice.defaultName;
  if (choice.fixed)
    return (
      <Hint label={fixedModelHint}>
        <span
          tabIndex={0}
          role="note"
          aria-label={`Model: ${name}. ${fixedModelHint}`}
          className="model-chip-label inline-flex h-7 max-w-[180px] min-w-0 items-center rounded-full px-2.5 text-xs font-medium text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-color)]"
        >
          <span className="truncate">{name}</span>
        </span>
      </Hint>
    );
  // Managed: the setup model is an option. Not managed: the agent's default is an option.
  const selected = current
    ? current.id
    : choice.managed
      ? choice.options.find((option) => option.isDefault)?.id || defaultValue
      : defaultValue;
  return (
    <Select
      value={selected}
      disabled={disabled}
      onValueChange={(next) => onChange(next === defaultValue ? '' : next)}
    >
      <Hint label={`Model: ${name}`} disabled={disabled}>
        <SelectTrigger
          variant="chip"
          size="sm"
          aria-label="Model"
          className={cn('min-w-0 max-w-[180px]')}
        >
          <SelectValue>
            <span className="truncate">{name}</span>
          </SelectValue>
        </SelectTrigger>
      </Hint>
      <SelectContent align="start" className="max-h-80 w-60">
        {!choice.managed && (
          <SelectItem value={defaultValue}>
            <span className="truncate">{choice.defaultName}</span>
          </SelectItem>
        )}
        {choice.options.map((option) => (
          <SelectItem key={option.id} value={option.id} title={option.name}>
            <span className="flex w-full min-w-0 items-center gap-2">
              <span className="truncate">{option.name}</span>
              {option.isDefault && (
                <span className="ml-auto text-xs text-muted-foreground">Default</span>
              )}
            </span>
          </SelectItem>
        ))}
        {failed && !choice.managed && (
          <p className="px-2 py-1.5 text-xs text-muted-foreground">
            Could not load models. The default model is used.
          </p>
        )}
      </SelectContent>
    </Select>
  );
}
