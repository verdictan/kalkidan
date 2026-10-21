import { useState } from 'react';
import type { API } from '../api/contracts';
import type { VerdictanSetup, VerdictanSelection } from '../domain/verdictan';
import { Button } from './ui/button';
import { Input } from './ui/input';

export function VerdictanSetupForm({ api }: { api: API }) {
  const [setup, setSetup] = useState<VerdictanSetup>();
  const [agent, setAgent] = useState<'codex' | 'claude'>('codex');
  const [selection, setSelection] = useState<VerdictanSelection>({
    teamId: '',
    configurationId: '',
    configurationVersionId: '',
    providerConnectionId: '',
    model: '',
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function load() {
    setBusy(true);
    setError('');
    try {
      const next = await api.verdictanSetup();
      setSetup(next);
      if (next.selections[agent]) setSelection(next.selections[agent]!);
    } catch {
      setError('Could not load authorized setup. Check your account and organization permissions.');
    } finally {
      setBusy(false);
    }
  }
  async function save() {
    setBusy(true);
    setError('');
    try {
      setSetup(await api.verdictanSelect(agent, selection));
    } catch {
      setError('Could not save setup. Refresh the authorized choices and try again.');
    } finally {
      setBusy(false);
    }
  }
  const selectClass = 'h-9 w-full rounded-md border bg-background px-3 text-sm';
  return (
    <section className="grid gap-3 border-t pt-4" aria-label="Managed agent setup">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium">Managed agent setup</h4>
        <Button variant="outline" disabled={busy} onClick={() => void load()}>
          Load authorized choices
        </Button>
      </div>
      {setup && (
        <>
          <label className="form-label">
            Agent
            <select
              className={selectClass}
              value={agent}
              disabled={busy}
              onChange={(e) => {
                const next = e.target.value as 'codex' | 'claude';
                setAgent(next);
                setSelection(
                  setup.selections[next] || {
                    teamId: '',
                    configurationId: '',
                    configurationVersionId: '',
                    providerConnectionId: '',
                    model: '',
                  },
                );
              }}
            >
              <option value="codex">Codex</option>
              <option value="claude">Claude Code</option>
            </select>
          </label>
          <label className="form-label">
            Team
            <select
              className={selectClass}
              value={selection.teamId}
              disabled={busy}
              onChange={(e) => setSelection({ ...selection, teamId: e.target.value })}
            >
              <option value="">Choose an authorized team</option>
              {setup.teams.map((t) => (
                <option key={t.team_id} value={t.team_id}>
                  {t.team_id}
                </option>
              ))}
            </select>
          </label>
          <label className="form-label">
            Policy
            <select
              className={selectClass}
              value={selection.configurationVersionId}
              disabled={busy}
              onChange={(e) => {
                const policy = setup.policies.find(
                  (p) => p.configuration_version_id === e.target.value,
                );
                setSelection({
                  ...selection,
                  configurationId: policy?.configuration_id || '',
                  configurationVersionId: policy?.configuration_version_id || '',
                });
              }}
            >
              <option value="">Choose an authorized policy</option>
              {setup.policies.map((p) => (
                <option key={p.configuration_version_id} value={p.configuration_version_id}>
                  {p.configuration_id} · {p.configuration_version_id}
                </option>
              ))}
            </select>
          </label>
          {agent === 'codex' && setup.providerAccessModes?.includes('codex_subscription') && (
            <label className="form-label">
              Provider access
              <select
                aria-label="Provider access"
                className={selectClass}
                disabled={busy}
                value={selection.providerAccessMode || 'byok'}
                onChange={(event) =>
                  setSelection({
                    ...selection,
                    providerAccessMode: event.target.value as 'byok' | 'codex_subscription',
                    providerConnectionId: '',
                  })
                }
              >
                <option value="byok">Organization provider connection</option>
                <option value="codex_subscription">
                  Codex subscription on the selected machine
                </option>
              </select>
            </label>
          )}
          {selection.providerAccessMode === 'codex_subscription' ? (
            <p className="help-text">
              Uses the Codex subscription already signed in on the machine where work runs. Sign in
              separately on each SSH host. Refresh tokens are never sent to another host. Verdictan
              policy still applies.
            </p>
          ) : (
            <label className="form-label">
              Provider connection
              <select
                className={selectClass}
                value={selection.providerConnectionId}
                disabled={busy}
                onChange={(e) =>
                  setSelection({ ...selection, providerConnectionId: e.target.value })
                }
              >
                <option value="">Choose an authorized connection</option>
                {setup.providerConnections
                  .filter((p) => p.provider === (agent === 'codex' ? 'openai' : 'anthropic'))
                  .map((p) => (
                    <option key={p.provider_connection_id} value={p.provider_connection_id}>
                      {p.provider} · {p.provider_connection_id}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {agent === 'claude' && (
            <p role="note" className="help-text">
              Claude Code subscription access is not supported by the current Verdictan runtime. A
              Claude login does not authorize an organization provider connection. Subscription
              support must be added to the managed runtime before Kalkidan can use that login.
            </p>
          )}
          <label className="form-label">
            Model
            <Input
              value={selection.model}
              disabled={busy}
              placeholder="Model ID"
              onChange={(e) => setSelection({ ...selection, model: e.target.value })}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            Verdictan checks access, policy, and model availability before each run. Existing
            conversations keep their original account and model binding.
          </p>
          <Button
            disabled={
              busy ||
              !selection.teamId ||
              !selection.configurationVersionId ||
              (selection.providerAccessMode !== 'codex_subscription' &&
                !selection.providerConnectionId) ||
              !selection.model
            }
            onClick={() => void save()}
          >
            Save agent setup
          </Button>
        </>
      )}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
    </section>
  );
}
