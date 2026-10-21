/** One model in the composer model chip. */
export interface ModelChoiceOption {
  id: string;
  name: string;
  /** The model that runs when the chat picks no model. */
  isDefault: boolean;
}
/** The models that the composer model chip offers for one chat. */
export interface ModelChoice {
  /** True when managed agent setup chose a model for this agent. */
  managed: boolean;
  /** The name that the chip shows when the chat picks no model. */
  defaultName: string;
  options: ModelChoiceOption[];
  /** Only one model is allowed. The chip is a label, not a menu. */
  fixed: boolean;
}

/**
 * The models for the composer.
 * - Managed setup with a model: only the models that the organization allows, with the setup
 *   model marked as the default. When the service sends no list, the agent's models apply.
 * - No managed setup: the agent's own default and its models, as before.
 */
export function modelChoice({
  models,
  allowed,
  setupModel,
  agentName,
}: {
  /** The models that the agent reports, with their names. */
  models: { id: string; name: string }[];
  /** The models that the organization allows. Undefined: the service sent no list. */
  allowed?: string[];
  /** The model of the managed agent setup for this agent. */
  setupModel?: string;
  agentName: string;
}): ModelChoice {
  const nameOf = (id: string) => models.find((model) => model.id === id)?.name || id;
  if (!setupModel)
    return {
      managed: false,
      defaultName: `${agentName} · Default`,
      options: models.map((model) => ({ ...model, isDefault: false })),
      fixed: false,
    };
  const ids = [...new Set(allowed ?? models.map((model) => model.id))];
  // The setup model always shows. The setup page saved it, so the launch can use it.
  if (!ids.includes(setupModel)) ids.unshift(setupModel);
  const options = ids.map((id) => ({ id, name: nameOf(id), isDefault: id === setupModel }));
  return { managed: true, defaultName: nameOf(setupModel), options, fixed: options.length === 1 };
}

/**
 * The model to send for the choice of a chat. No choice, or a model that the chip does not offer,
 * sends no model: the launch then keeps the model of the chat or uses the setup model.
 */
export function chosenModel(choice: ModelChoice, value: string) {
  return choice.options.some((item) => item.id === value) ? value : '';
}
