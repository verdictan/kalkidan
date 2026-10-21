import { useEffect, useRef, useState } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import type { API } from '../api/contracts';
import type { ModelOption } from '../domain/conversation';
import {
  agentConfigurationLabel,
  agentLabels,
  bootstrapAdminNotice,
  connectionLabels,
  defaultRemoved,
  defaultRemovedNotice,
  isSubscriptionMode,
  kalkidanAgentLabel,
  kalkidanDefaultLabel,
  noAgentNotice,
  policyLabels,
  policyRecovery,
  sameSelection,
  selectionIssue,
  teamLabels,
  usesAgentChoice,
  usesDefaultPolicy,
  type ProviderAccessMode,
  type VerdictanSetup,
  type VerdictanSelection,
} from '../domain/verdictan';
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { SegmentedControl } from './ui/segmented-control';
import { showToast } from './ui/toast';
import { Choice } from './choice';
import { Hint } from './hint';
import { allowedModels, providerName } from '../lib/verdictan-labels';

type ManagedAgent = 'codex' | 'claude';

const agentNames: Record<ManagedAgent, string> = { codex: 'Codex', claude: 'Claude Code' };
const agentProvider: Record<ManagedAgent, string> = { codex: 'openai', claude: 'anthropic' };

/** The option value of the default Kalkidan configuration. It is not an ID. */
const defaultOption = 'kalkidan-default';

const emptySelection: VerdictanSelection = {
  teamId: '',
  configurationId: '',
  configurationVersionId: '',
  providerConnectionId: '',
  model: '',
};

/**
 * A selection for an agent: the saved one, or the only choice of each list. The user must
 * still choose when a list has more than one item.
 */
function initialSelection(setup: VerdictanSetup, agent: ManagedAgent): VerdictanSelection {
  const saved = setup.selections[agent];
  const issue = saved && selectionIssue(setup, saved);
  const agentChoice = usesAgentChoice(setup);
  if (saved && !issue && !!saved.agentId === agentChoice) return saved;
  const connections = setup.providerConnections.filter((p) => p.provider === agentProvider[agent]);
  // A saved selection that needs a new agent or policy keeps its access and model.
  const { agentId: _agent, ...kept } = saved || {
    ...emptySelection,
    providerConnectionId: connections.length === 1 ? connections[0].provider_connection_id : '',
  };
  if (agentChoice) {
    // The Kalkidan agent is preselected. When it is gone, the user must choose an agent.
    const removed = defaultRemoved(setup);
    const pick = issue
      ? undefined
      : setup.agents!.find((a) => a.default) ||
        (setup.agents!.length === 1 && !removed ? setup.agents![0] : undefined);
    return {
      ...kept,
      agentId: pick?.agent_id || '',
      teamId: pick?.team_id || '',
      configurationId: '',
      configurationVersionId: '',
    };
  }
  // With a default, empty policy IDs select it. Otherwise the only policy, when there is one.
  const fallback = !defaultRemoved(setup) && !!setup.defaultPolicy;
  const [policy] = !fallback && setup.policies.length === 1 ? setup.policies : [];
  return {
    ...kept,
    teamId: setup.teams.length === 1 ? setup.teams[0].team_id : '',
    configurationId: policy?.configuration_id || '',
    configurationVersionId: policy?.configuration_version_id || '',
  };
}

/**
 * Settings › Agents › Managed setup. The choices load when the section shows. A complete
 * selection saves at once, with Undo in the toast.
 */
export function VerdictanSetupForm({
  api,
  open = true,
  onSetup,
}: {
  api: API;
  /** False while Settings is closed. The choices load again when it opens. */
  open?: boolean;
  onSetup?: (setup: VerdictanSetup) => void;
}) {
  const [setup, setSetup] = useState<VerdictanSetup>();
  const [agent, setAgent] = useState<ManagedAgent>('codex');
  const [selection, setSelection] = useState<VerdictanSelection>(emptySelection);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const agentRef = useRef(agent);
  agentRef.current = agent;
  const onSetupRef = useRef(onSetup);
  onSetupRef.current = onSetup;
  async function load() {
    setLoading(true);
    setError('');
    try {
      const next = await api.verdictanSetup();
      setSetup(next);
      setSelection(initialSelection(next, agentRef.current));
      onSetupRef.current?.(next);
    } catch {
      setError(
        'Could not load the setup choices. Check your account and your organization access.',
      );
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    if (open) void load();
  }, [api, open]);
  useEffect(() => {
    let live = true;
    setModels([]);
    void Promise.resolve()
      .then(() => api.models?.(agent))
      .then((list) => live && setModels(list || []))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [api, agent]);
  /**
   * Saves a complete selection of the agent that shows. A save after a change offers Undo,
   * which saves the selection that was there before.
   */
  async function save(next: VerdictanSelection, undo = false) {
    const target = agent;
    const before = setup?.selections[target];
    setSaving(true);
    setError('');
    try {
      // The agent ID goes only with the agent choice. The team and policy choice omits it.
      const { agentId, ...rest } = next;
      const result = await api.verdictanSelect(
        target,
        agentChoice && agentId ? { ...rest, agentId } : rest,
      );
      setSetup(result);
      onSetup?.(result);
      if (undo) {
        showToast(`Restored the earlier ${agentNames[target]} setup`);
        return;
      }
      showToast({
        message: `Saved the ${agentNames[target]} setup`,
        actions: before
          ? [
              {
                label: 'Undo',
                onClick: () => {
                  if (agentRef.current === target) setSelection(before);
                  void save(before, true);
                },
              },
            ]
          : undefined,
      });
    } catch {
      setError('Could not save the setup. Select Refresh choices, then try again.');
    } finally {
      setSaving(false);
    }
  }
  const busy = loading || saving;
  const agentChoice = usesAgentChoice(setup);
  const removed = defaultRemoved(setup);
  const agents = setup?.agents || [];
  const chosenAgent = agents.find((a) => a.agent_id === selection.agentId);
  const connections =
    setup?.providerConnections.filter((p) => p.provider === agentProvider[agent]) || [];
  // Each agent can use only its own subscription mode, and only when the runtime offers it.
  const subscriptionMode: ProviderAccessMode =
    agent === 'codex' ? 'codex_subscription' : 'claude_subscription';
  const subscriptionOffered = !!setup?.providerAccessModes?.includes(subscriptionMode);
  const subscription = isSubscriptionMode(selection.providerAccessMode);
  // Visible labels. IDs stay in option values and never show as text.
  // The default shows once, as "Kalkidan default". The list shows the other policies.
  // A removed default is not a choice. Verdictan does not make it again.
  const defaultPolicy = removed ? undefined : setup?.defaultPolicy;
  const policies = setup?.defaultPolicy
    ? setup.policies.filter((policy) => !policy.default)
    : setup?.policies || [];
  const labels = setup && {
    teams: teamLabels(setup.teams),
    policies: policyLabels(policies),
    connections: connectionLabels(connections),
    agents: agentLabels(agents),
  };
  const policyValue = usesDefaultPolicy(selection)
    ? defaultPolicy
      ? defaultOption
      : ''
    : defaultPolicy &&
        selection.configurationId === defaultPolicy.configuration_id &&
        !policies.some((p) => p.configuration_version_id === selection.configurationVersionId)
      ? defaultOption
      : selection.configurationVersionId;
  const requiresAdmin = setup?.bootstrapReadiness === 'bootstrap_requires_admin';
  // The bootstrap note replaces the policy recovery for a member: one note, one action.
  const recovery = requiresAdmin ? undefined : policyRecovery(setup?.policyReadiness);
  const otherAgents = agents.filter((a) => !a.default);
  const allowed = allowedModels(setup, agent);
  const listed = allowed
    ? allowed.map((id) => ({ value: id, label: models.find((m) => m.id === id)?.name || id }))
    : models.map((m) => ({ value: m.id, label: m.name }));
  // A saved model that is not in the list stays a choice. Without a list, the model is a text
  // field, also while the user types a name.
  const modelOptions = listed.concat(
    listed.length && selection.model && !listed.some((m) => m.value === selection.model)
      ? [{ value: selection.model, label: selection.model }]
      : [],
  );
  const saved = setup?.selections[agent];
  const savedIssue = setup && saved ? selectionIssue(setup, saved) : undefined;
  // A saved selection in another shape, for example one without an agent, is not a change.
  const changedFrom = (value: VerdictanSelection) => !setup || !sameSelection(setup, saved, value);
  const completeSelection = (value: VerdictanSelection) =>
    !!value.teamId &&
    (agentChoice
      ? agents.some((a) => a.agent_id === value.agentId)
      : !!value.configurationVersionId || (!!defaultPolicy && usesDefaultPolicy(value))) &&
    (isSubscriptionMode(value.providerAccessMode) || !!value.providerConnectionId) &&
    !!value.model;
  const changed = changedFrom(selection);
  const complete = completeSelection(selection);
  /** Shows a choice of the user, and saves it at once when the selection is complete. */
  function commit(next: VerdictanSelection) {
    setSelection(next);
    if (!busy && completeSelection(next) && changedFrom(next)) void save(next);
  }
  return (
    <div className="grid gap-4" aria-busy={loading}>
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          label="Agent"
          value={agent}
          onChange={(next) => {
            setAgent(next);
            if (setup) setSelection(initialSelection(setup, next));
          }}
          options={(['codex', 'claude'] as const).map((value) => ({
            value,
            disabled: busy,
            label: agentNames[value],
            icon: setup?.selections[value] ? (
              <Check className="size-3.5 text-success" aria-label="Set up" />
            ) : undefined,
          }))}
        />
        <Hint label="Refresh choices">
          <Button
            variant="ghost"
            size="icon-sm"
            className="ml-auto"
            aria-label="Refresh choices"
            disabled={busy}
            onClick={() => void load()}
          >
            <RefreshCw className={loading ? 'animate-spin' : ''} />
          </Button>
        </Hint>
      </div>
      {!setup && loading && (
        <p role="status" className="form-help">
          Loading the choices of your organization…
        </p>
      )}
      {setup && (
        <>
          <div className="managed-setup-grid">
            {agentChoice ? (
              <label className="form-label">
                Agent
                <Choice
                  className="w-full"
                  label="Agent"
                  value={chosenAgent ? chosenAgent.agent_id : ''}
                  disabled={busy}
                  onChange={(value) => {
                    // The agent sets the team. Its deployed policy applies, so no policy IDs.
                    const next = agents.find((a) => a.agent_id === value);
                    commit({
                      ...selection,
                      agentId: next?.agent_id || '',
                      teamId: next?.team_id || '',
                      configurationId: '',
                      configurationVersionId: '',
                    });
                  }}
                  options={[
                    { value: '', label: 'Choose an agent' },
                    ...agents.map((item, index) => ({
                      value: item.agent_id,
                      label: labels!.agents[index],
                      description: agentConfigurationLabel(item),
                    })),
                  ]}
                />
              </label>
            ) : (
              <>
                <label className="form-label">
                  Team
                  <Choice
                    className="w-full"
                    label="Team"
                    value={selection.teamId}
                    disabled={busy}
                    onChange={(teamId) => commit({ ...selection, teamId })}
                    options={[
                      { value: '', label: 'Choose a team' },
                      ...setup.teams.map((team, index) => ({
                        value: team.team_id,
                        label: labels!.teams[index],
                      })),
                    ]}
                  />
                </label>
                <label className="form-label">
                  Policy
                  <Choice
                    className="w-full"
                    label="Policy"
                    value={policyValue}
                    disabled={busy}
                    onChange={(value) => {
                      // The default sends no policy IDs. Verdictan then uses its newest version.
                      const policy = policies.find((p) => p.configuration_version_id === value);
                      commit({
                        ...selection,
                        configurationId: policy?.configuration_id || '',
                        configurationVersionId: policy?.configuration_version_id || '',
                      });
                    }}
                    options={[
                      defaultPolicy
                        ? { value: defaultOption, label: kalkidanDefaultLabel }
                        : { value: '', label: 'Choose a policy' },
                      ...policies.map((policy, index) => ({
                        value: policy.configuration_version_id,
                        label: labels!.policies[index],
                      })),
                    ]}
                  />
                </label>
              </>
            )}
            {(subscriptionOffered || subscription) && (
              <label className="form-label">
                Model access
                <Choice
                  className="w-full"
                  label="Model access"
                  disabled={busy}
                  value={selection.providerAccessMode || 'byok'}
                  onChange={(value) =>
                    commit({
                      ...selection,
                      providerAccessMode: value as ProviderAccessMode,
                      providerConnectionId:
                        value === subscriptionMode
                          ? ''
                          : connections.length === 1
                            ? connections[0].provider_connection_id
                            : '',
                    })
                  }
                  options={[
                    { value: 'byok', label: 'Organization connection' },
                    {
                      value: subscriptionMode,
                      label: `${agentNames[agent]} subscription on the computer`,
                    },
                  ]}
                />
              </label>
            )}
            {!subscription && (
              <label className="form-label">
                Connection
                <Choice
                  className="w-full"
                  label="Connection"
                  value={selection.providerConnectionId}
                  disabled={busy || !connections.length}
                  onChange={(providerConnectionId) =>
                    commit({ ...selection, providerConnectionId })
                  }
                  options={[
                    {
                      value: '',
                      label: connections.length
                        ? 'Choose a connection'
                        : `No ${providerName(agentProvider[agent])} connection`,
                    },
                    ...connections.map((connection, index) => ({
                      value: connection.provider_connection_id,
                      label: labels!.connections[index],
                    })),
                  ]}
                />
              </label>
            )}
            <label className="form-label">
              Model
              {modelOptions.length ? (
                <Choice
                  className="w-full"
                  label="Model"
                  value={selection.model}
                  disabled={busy}
                  onChange={(model) => commit({ ...selection, model })}
                  options={[{ value: '', label: 'Choose a model' }, ...modelOptions]}
                />
              ) : (
                <Input
                  value={selection.model}
                  disabled={busy}
                  placeholder="Model name, for example gpt-5"
                  onChange={(e) => setSelection({ ...selection, model: e.target.value.trim() })}
                  // A typed name saves when the field loses focus or on Enter.
                  onBlur={() => commit(selection)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commit(selection);
                  }}
                />
              )}
            </label>
          </div>
          {agentChoice && chosenAgent && agentConfigurationLabel(chosenAgent) && (
            <p className="form-help">
              The policy of this agent is {agentConfigurationLabel(chosenAgent)}. The organization
              changes it in Verdictan.
            </p>
          )}
          {requiresAdmin && (
            <Alert size="sm" role="note">
              <AlertDescription className="text-xs leading-4">
                {bootstrapAdminNotice}
                {defaultPolicy
                  ? ` Until then, Kalkidan uses the ${kalkidanDefaultLabel} policy.`
                  : ''}
              </AlertDescription>
            </Alert>
          )}
          {removed && (
            <Alert size="sm" role="note">
              <AlertDescription className="text-xs leading-4">
                {agentChoice && otherAgents.length ? defaultRemovedNotice : noAgentNotice}
                {!agentChoice && policies.length ? ' Until then, choose another policy.' : ''}
              </AlertDescription>
            </Alert>
          )}
          {setup.bootstrapIssue && !requiresAdmin && (
            <Alert size="sm" role="note">
              <AlertDescription className="text-xs leading-4">
                {setup.bootstrapIssue === 'team_required'
                  ? 'Kalkidan could not finish Kalkidan setup. You need a team that can make and deploy agents. Ask an organization administrator to add you to one.'
                  : 'Kalkidan could not finish Kalkidan setup now. Select Refresh choices to try again.'}
              </AlertDescription>
            </Alert>
          )}
          {setup.bootstrapped === 'bootstrapped' && (
            <p role="status" className="form-help">
              Kalkidan set up the {kalkidanAgentLabel} for your organization.
            </p>
          )}
          {recovery && !removed && (
            <Alert size="sm" role="note">
              <AlertDescription className="text-xs leading-4">
                {recovery}
                {policies.length ? ' Until then, choose another policy.' : ''}
              </AlertDescription>
            </Alert>
          )}
          {setup.defaultUnavailable && !recovery && (
            <Alert size="sm" role="note">
              <AlertDescription className="text-xs leading-4">
                Kalkidan could not make the {kalkidanDefaultLabel} policy now.
                {policies.length
                  ? ' Choose another policy, or select Refresh choices to try again.'
                  : ' Select Refresh choices to try again.'}
              </AlertDescription>
            </Alert>
          )}
          {setup.defaultEnsured === 'created' && (
            <p role="status" className="form-help">
              Kalkidan made the {kalkidanDefaultLabel} policy for your organization.
            </p>
          )}
          {subscription && (
            <p className="form-help">
              Uses the {agentNames[agent]} subscription that is signed in on the computer where the
              work runs. Sign in on each SSH host. Kalkidan does not send sign-in tokens to other
              hosts. The policy of your organization still applies.
            </p>
          )}
          {agent === 'claude' && !subscriptionOffered && (
            <p role="note" className="form-help">
              Claude Code uses an Anthropic connection from your organization. To use your own
              Claude Code sign-in, update the managed agents runtime.
            </p>
          )}
          <div className="flex min-h-8 flex-wrap items-center justify-end gap-2">
            {saving ? (
              <span role="status" className="text-xs leading-4 text-muted-foreground">
                Saving…
              </span>
            ) : saved && !changed && !savedIssue ? (
              <span className="flex items-center gap-1 text-xs leading-4 text-success">
                <Check className="size-3.5" aria-hidden="true" />
                Ready for {agentNames[agent]}
              </span>
            ) : complete && changed ? (
              // A selection that Kalkidan chose, or a save that failed. The user confirms it.
              <Button variant="outline" disabled={busy} onClick={() => void save(selection)}>
                Use this setup
              </Button>
            ) : (
              <span className="text-xs leading-4 text-muted-foreground">
                Make all the choices. Kalkidan then saves the {agentNames[agent]} setup.
              </span>
            )}
          </div>
        </>
      )}
      {error && (
        <Alert size="sm" variant="destructive">
          <AlertDescription className="text-xs leading-4">{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
