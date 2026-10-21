import { useEffect, useRef, useState } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import type { API } from '../api/contracts';
import type { ModelOption } from '../domain/conversation';
import {
  isSubscriptionMode,
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
import {
  allowedModels,
  connectionLabel,
  policyLabel,
  providerName,
  teamLabel,
} from '../lib/verdictan-labels';

type ManagedAgent = 'codex' | 'claude';

const agentNames: Record<ManagedAgent, string> = { codex: 'Codex', claude: 'Claude Code' };
const agentProvider: Record<ManagedAgent, string> = { codex: 'openai', claude: 'anthropic' };

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
  if (saved) return saved;
  const connections = setup.providerConnections.filter((p) => p.provider === agentProvider[agent]);
  const [policy] = setup.policies.length === 1 ? setup.policies : [];
  return {
    ...emptySelection,
    teamId: setup.teams.length === 1 ? setup.teams[0].team_id : '',
    configurationId: policy?.configuration_id || '',
    configurationVersionId: policy?.configuration_version_id || '',
    providerConnectionId: connections.length === 1 ? connections[0].provider_connection_id : '',
  };
}

/** Settings › Managed agents › Choose setup. The choices load when the step shows. */
export function VerdictanSetupForm({
  api,
  open = true,
  primary = true,
  onSetup,
}: {
  api: API;
  /** False while Settings is closed. The choices load again when it opens. */
  open?: boolean;
  /** True when Save is the main action of the page. */
  primary?: boolean;
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
  async function save() {
    setSaving(true);
    setError('');
    try {
      const next = await api.verdictanSelect(agent, selection);
      setSetup(next);
      onSetup?.(next);
      showToast(`Saved the ${agentNames[agent]} setup`);
    } catch {
      setError('Could not save the setup. Select Refresh choices, then try again.');
    } finally {
      setSaving(false);
    }
  }
  const busy = loading || saving;
  const connections =
    setup?.providerConnections.filter((p) => p.provider === agentProvider[agent]) || [];
  // Each agent can use only its own subscription mode, and only when the runtime offers it.
  const subscriptionMode: ProviderAccessMode =
    agent === 'codex' ? 'codex_subscription' : 'claude_subscription';
  const subscriptionOffered = !!setup?.providerAccessModes?.includes(subscriptionMode);
  const subscription = isSubscriptionMode(selection.providerAccessMode);
  const allowed = allowedModels(setup, agent);
  const modelOptions = (
    allowed
      ? allowed.map((id) => ({ value: id, label: models.find((m) => m.id === id)?.name || id }))
      : models.map((m) => ({ value: m.id, label: m.name }))
  ).concat(
    selection.model && !(allowed || models.map((m) => m.id)).includes(selection.model)
      ? [{ value: selection.model, label: selection.model }]
      : [],
  );
  const saved = setup?.selections[agent];
  const changed =
    !saved ||
    (Object.keys({ ...saved, ...selection }) as (keyof VerdictanSelection)[]).some(
      (key) => (saved[key] || '') !== (selection[key] || ''),
    );
  const complete =
    !!selection.teamId &&
    !!selection.configurationVersionId &&
    (subscription || !!selection.providerConnectionId) &&
    !!selection.model;
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
            <label className="form-label">
              Team
              <Choice
                className="w-full"
                label="Team"
                value={selection.teamId}
                disabled={busy}
                onChange={(teamId) => setSelection({ ...selection, teamId })}
                options={[
                  { value: '', label: 'Choose a team' },
                  ...setup.teams.map((team, index) => ({
                    value: team.team_id,
                    label: teamLabel(team, index),
                  })),
                ]}
              />
            </label>
            <label className="form-label">
              Policy
              <Choice
                className="w-full"
                label="Policy"
                value={selection.configurationVersionId}
                disabled={busy}
                onChange={(value) => {
                  const policy = setup.policies.find((p) => p.configuration_version_id === value);
                  setSelection({
                    ...selection,
                    configurationId: policy?.configuration_id || '',
                    configurationVersionId: policy?.configuration_version_id || '',
                  });
                }}
                options={[
                  { value: '', label: 'Choose a policy' },
                  ...setup.policies.map((policy, index) => ({
                    value: policy.configuration_version_id,
                    label: policyLabel(policy, index),
                  })),
                ]}
              />
            </label>
            {(subscriptionOffered || subscription) && (
              <label className="form-label">
                Model access
                <Choice
                  className="w-full"
                  label="Model access"
                  disabled={busy}
                  value={selection.providerAccessMode || 'byok'}
                  onChange={(value) =>
                    setSelection({
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
                    setSelection({ ...selection, providerConnectionId })
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
                      label: connectionLabel(connection, index, connections.length),
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
                  onChange={(model) => setSelection({ ...selection, model })}
                  options={[{ value: '', label: 'Choose a model' }, ...modelOptions]}
                />
              ) : (
                <Input
                  value={selection.model}
                  disabled={busy}
                  placeholder="Model name, for example gpt-5"
                  onChange={(e) => setSelection({ ...selection, model: e.target.value.trim() })}
                />
              )}
            </label>
          </div>
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
          <p className="form-help">
            Before each run, the service checks your access, the policy, and the model. Chats that
            started before a change keep their first setup.
          </p>
          <div className="flex items-center justify-end gap-2">
            {saved && !changed && (
              <span className="flex items-center gap-1 text-xs leading-4 text-success">
                <Check className="size-3.5" aria-hidden="true" />
                Ready for {agentNames[agent]}
              </span>
            )}
            <Button
              variant={primary ? 'default' : 'outline'}
              disabled={busy || !complete || !changed}
              onClick={() => void save()}
            >
              {saving ? 'Saving…' : `Save ${agentNames[agent]} setup`}
            </Button>
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
