import { useEffect, useRef, useState, type ReactNode } from 'react';
import type { API } from '../api/contracts';
import type { ModelOption } from '../domain/conversation';
import {
  bootstrapAdminNotice,
  completeSelection,
  connectionLabels,
  defaultRemoved,
  defaultRemovedNotice,
  initialSelection,
  isSubscriptionMode,
  kalkidanAgentLabel,
  kalkidanDefaultLabel,
  noAgentNotice,
  policyLabels,
  policyRecovery,
  sameSelection,
  setupAllowedModels,
  teamLabels,
  usesAgentChoice,
  usesDefaultPolicy,
  type ManagedAgentKind,
  type ProviderAccessMode,
  type VerdictanSetup,
  type VerdictanSelection,
} from '../domain/verdictan';
import { runtimeSetupNotice } from '../domain/compatibility';
import { useRefreshTriggers } from '../hooks/use-refresh-triggers';
import { Alert, AlertDescription } from './ui/alert';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { showToast } from './ui/toast';
import { Choice } from './choice';
import { providerName } from '../lib/verdictan-labels';

export const managedAgentNames: Record<ManagedAgentKind, string> = {
  codex: 'Codex',
  claude: 'Claude Code',
};
const agentProvider: Record<ManagedAgentKind, string> = { codex: 'openai', claude: 'anthropic' };

/** The option value of the default Kalkidan configuration. It is not an ID. */
const defaultOption = 'kalkidan-default';

const emptySelection: VerdictanSelection = {
  teamId: '',
  configurationId: '',
  configurationVersionId: '',
  providerConnectionId: '',
  model: '',
};

/** The access type of a saved selection, for example "Organization connection". */
export function accessLabel(agent: ManagedAgentKind, selection: VerdictanSelection | undefined) {
  return isSubscriptionMode(selection?.providerAccessMode)
    ? `${managedAgentNames[agent]} subscription`
    : 'Organization connection';
}

/**
 * The team and policy of a saved selection in plain words, for example "Platform team ·
 * Kalkidan default". With the agent choice, it is empty: the agent belongs to the computer.
 */
export function teamPolicyLabel(setup: VerdictanSetup, selection: VerdictanSelection | undefined) {
  if (!selection || usesAgentChoice(setup)) return '';
  const teamIndex = setup.teams.findIndex((t) => t.team_id === selection.teamId);
  const team = teamIndex >= 0 ? teamLabels(setup.teams)[teamIndex] : '';
  const policyIndex = setup.policies.findIndex(
    (p) => p.configuration_version_id === selection.configurationVersionId,
  );
  const policy = usesDefaultPolicy(selection)
    ? kalkidanDefaultLabel
    : policyIndex >= 0
      ? policyLabels(setup.policies)[policyIndex]
      : '';
  return [team, policy].filter(Boolean).join(' · ');
}

/**
 * The one notice of the setup sheet. When there are more, only the most important shows.
 * Errors come first, then what blocks the setup, then information.
 */
function setupNotice(
  setup: VerdictanSetup,
  agent: ManagedAgentKind,
  selection: VerdictanSelection,
  policyCount: number,
): { text: string; tone: 'default' | 'info' } | undefined {
  const agentChoice = usesAgentChoice(setup);
  const removed = defaultRemoved(setup);
  const defaultPolicy = removed ? undefined : setup.defaultPolicy;
  const requiresAdmin = setup.bootstrapReadiness === 'bootstrap_requires_admin';
  const recovery = requiresAdmin ? undefined : policyRecovery(setup.policyReadiness);
  const otherAgents = (setup.agents || []).filter((a) => !a.default);
  if (requiresAdmin)
    return {
      tone: 'default',
      text:
        bootstrapAdminNotice +
        (defaultPolicy ? ` Until then, Kalkidan uses the ${kalkidanDefaultLabel} policy.` : ''),
    };
  if (removed)
    return {
      tone: 'default',
      text:
        (agentChoice && otherAgents.length ? defaultRemovedNotice : noAgentNotice) +
        (!agentChoice && policyCount ? ' Until then, choose another policy.' : ''),
    };
  if (setup.bootstrapIssue)
    return {
      tone: 'default',
      text:
        setup.bootstrapIssue === 'team_required'
          ? 'Kalkidan could not finish its setup. You need a team that can make and deploy agents. Ask an organization administrator to add you to one.'
          : setup.bootstrapIssue === 'runtime_too_old'
            ? runtimeSetupNotice
            : 'Kalkidan could not finish its setup now. Select Refresh in Settings › Computers › Details to try again.' +
              (setup.setupCode ? ` Code: ${setup.setupCode}` : ''),
    };
  if (recovery)
    return {
      tone: 'default',
      text: recovery + (policyCount ? ' Until then, choose another policy.' : ''),
    };
  if (setup.defaultUnavailable)
    return {
      tone: 'default',
      text:
        `Kalkidan could not make the ${kalkidanDefaultLabel} policy now.` +
        (policyCount ? ' Choose another policy.' : ' Kalkidan tries again later.'),
    };
  if (isSubscriptionMode(selection.providerAccessMode))
    return {
      tone: 'info',
      text: `Uses the ${managedAgentNames[agent]} subscription that is signed in on the computer where the work runs. Sign in on each SSH host.`,
    };
  if (agent === 'claude' && !setup.providerAccessModes?.includes('claude_subscription'))
    return {
      tone: 'info',
      text: 'Claude Code uses an Anthropic connection from your organization. To use your own Claude Code sign-in, update the managed agents runtime.',
    };
  if (setup.bootstrapped === 'bootstrapped')
    return {
      tone: 'info',
      text: `Kalkidan set up the ${kalkidanAgentLabel} for your organization.`,
    };
  if (setup.defaultEnsured === 'created')
    return {
      tone: 'info',
      text: `Kalkidan made the ${kalkidanDefaultLabel} policy for your organization.`,
    };
  return undefined;
}

/**
 * The organization setup of one coding agent, inline under its row on the Computers page: the
 * team and policy (older runtimes only), the model access, the connection, and the default
 * model. The agent is not here: each computer has one agent for Codex and Claude Code.
 * A list with only one choice does not show. Each complete selection saves at once, with Undo in
 * the toast; there is no Save button. The choices load on open and when the window gets focus.
 */
export function VerdictanSetupForm({
  api,
  agent,
  onSetup,
}: {
  api: API;
  agent: ManagedAgentKind;
  onSetup?: (setup: VerdictanSetup) => void;
}) {
  const [setup, setSetup] = useState<VerdictanSetup>();
  const [selection, setSelection] = useState<VerdictanSelection>(emptySelection);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const onSetupRef = useRef(onSetup);
  onSetupRef.current = onSetup;
  // A change that the user makes is kept when the choices load again on focus.
  const touched = useRef(false);
  async function load() {
    setLoading(true);
    setError('');
    try {
      const next = await api.verdictanSetup();
      setSetup(next);
      if (!touched.current) setSelection(initialSelection(next, agent));
      onSetupRef.current?.(next);
    } catch {
      setError('Could not load the choices of your organization. Check your account.');
    } finally {
      setLoading(false);
    }
  }
  useRefreshTriggers(api, true, () => void load());
  useEffect(() => {
    let live = true;
    void Promise.resolve()
      .then(() => api.models?.(agent))
      .then((list) => live && setModels(list || []))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [api, agent]);
  /**
   * Saves a complete selection. A save after a change offers Undo, which saves the selection
   * that was there before.
   */
  async function save(next: VerdictanSelection, undo = false) {
    const before = setup?.selections[agent];
    setSaving(true);
    setError('');
    try {
      // The agent belongs to the computer, so the selection has no agent.
      const { agentId: _agent, ...rest } = next;
      const result = await api.verdictanSelect(agent, rest);
      setSetup(result);
      onSetup?.(result);
      if (undo) {
        showToast(`Restored the earlier ${managedAgentNames[agent]} setup`);
        return;
      }
      showToast({
        message: `Saved the ${managedAgentNames[agent]} setup`,
        actions: before
          ? [
              {
                label: 'Undo',
                onClick: () => {
                  setSelection(before);
                  void save(before, true);
                },
              },
            ]
          : undefined,
      });
    } catch {
      setError('Could not save the setup. Try again.');
    } finally {
      setSaving(false);
    }
  }
  const busy = loading || saving;
  const agentChoice = usesAgentChoice(setup);
  const removed = defaultRemoved(setup);
  const connections =
    setup?.providerConnections.filter((p) => p.provider === agentProvider[agent]) || [];
  // Each agent can use only its own subscription mode, and only when the runtime offers it.
  const subscriptionMode: ProviderAccessMode =
    agent === 'codex' ? 'codex_subscription' : 'claude_subscription';
  const subscriptionOffered = !!setup?.providerAccessModes?.includes(subscriptionMode);
  const subscription = isSubscriptionMode(selection.providerAccessMode);
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
  const allowed = setupAllowedModels(setup, agent);
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
  const changedFrom = (value: VerdictanSelection) => !setup || !sameSelection(setup, saved, value);
  const complete = (value: VerdictanSelection) => !!setup && completeSelection(setup, agent, value);
  // A list with only one model selects it.
  useEffect(() => {
    if (setup && !selection.model && listed.length === 1)
      setSelection((value) => ({ ...value, model: listed[0].value }));
  }, [setup, listed.length]);
  /** Shows a choice of the user, and saves it at once when the selection is complete. */
  function commit(next: VerdictanSelection) {
    touched.current = true;
    setSelection(next);
    if (!busy && complete(next) && changedFrom(next)) void save(next);
  }
  const notice = setup && setupNotice(setup, agent, selection, policies.length);
  // Lists with only one choice do not show. Kalkidan selects that choice.
  const showTeam = !agentChoice && (setup?.teams.length || 0) !== 1;
  const policyCount = policies.length + (defaultPolicy ? 1 : 0);
  const showPolicy = !agentChoice && policyCount !== 1;
  const showConnection = !subscription && connections.length !== 1;
  const showModel = modelOptions.length !== 1 || selection.model !== modelOptions[0]?.value;
  const pending = complete(selection) && changedFrom(selection);
  // One save model: each choice saves at once. A complete selection that Kalkidan chose when
  // the setup opened also saves at once, so there is no Save button. Undo is in the toast.
  const autoSaved = useRef(false);
  useEffect(() => {
    if (autoSaved.current || touched.current || busy || error || !pending) return;
    autoSaved.current = true;
    void save(selection);
  }, [pending, busy, error]);
  return (
    <>
      <div className="grid content-start gap-3" aria-busy={loading}>
        {error ? (
          <Alert size="sm" variant="destructive">
            <AlertDescription className="text-xs leading-4">
              {error}{' '}
              <Button
                type="button"
                variant="link"
                onClick={() => void (setup && pending ? save(selection) : load())}
              >
                Try again
              </Button>
            </AlertDescription>
          </Alert>
        ) : (
          notice && (
            <Alert size="sm" role="note">
              <AlertDescription className="text-xs leading-4">{notice.text}</AlertDescription>
            </Alert>
          )
        )}
        {!setup && loading && (
          <p role="status" className="form-help mt-0">
            Loading…
          </p>
        )}
        {setup && (
          <div className="grid gap-3">
            {showTeam && (
              <Field label="Team">
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
              </Field>
            )}
            {showPolicy && (
              <Field label="Policy">
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
              </Field>
            )}
            {(subscriptionOffered || subscription) && (
              <Field label="Model access">
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
                      label: `${managedAgentNames[agent]} subscription on the computer`,
                    },
                  ]}
                />
              </Field>
            )}
            {showConnection && (
              <Field label="Connection">
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
              </Field>
            )}
            {showModel && (
              <Field label="Default model">
                {modelOptions.length ? (
                  <Choice
                    className="w-full"
                    label="Default model"
                    value={selection.model}
                    disabled={busy}
                    onChange={(model) => commit({ ...selection, model })}
                    options={[{ value: '', label: 'Choose a model' }, ...modelOptions]}
                  />
                ) : (
                  <Input
                    aria-label="Default model"
                    value={selection.model}
                    disabled={busy}
                    placeholder="Model name, for example gpt-5"
                    onChange={(e) => {
                      touched.current = true;
                      setSelection({ ...selection, model: e.target.value.trim() });
                    }}
                    // A typed name saves when the field loses focus or on Enter.
                    onBlur={() => commit(selection)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commit(selection);
                    }}
                  />
                )}
              </Field>
            )}
            {!showModel && (
              <p className="form-help mt-0">Default model: {modelOptions[0]?.label}</p>
            )}
          </div>
        )}
        {saving && (
          <p role="status" className="form-help mt-0">
            Saving…
          </p>
        )}
      </div>
    </>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="form-label">
      {label}
      {children}
    </label>
  );
}
