import { useState } from 'react';
import { Bot } from 'lucide-react';
import type { API } from '../api/contracts';
import {
  agentConfigurationLabel,
  agentLabels,
  computerAgentId,
  computerAgentIssue,
  findAgent,
  managedErrorText,
  localComputer,
  usesAgentChoice,
  withoutManagedCode,
  type VerdictanSetup,
} from '../domain/verdictan';
import { computerAgentAnchor } from '../domain/settings-route';
import { isMac } from '../lib/platform';
import { useRefreshTriggers } from '../hooks/use-refresh-triggers';
import { Choice } from './choice';
import { ConfirmDialog } from './confirm-dialog';
import { SettingsRow } from './settings-disclosure';
import { Button } from './ui/button';
import { EntityIcon } from './ui/entity-icon';
import { showToast } from './ui/toast';
import { notifyManagedAgentsChanged } from './verdictan-settings';

/** The note that a change of the agent does not move existing chats. */
export const agentChangeNote = 'New chats use the new agent. Existing chats keep their agent.';

/**
 * The agent of one computer: 'local' or an SSH host ID. Codex and Claude Code on the computer
 * both use it for new chats. "Change agent" sets another agent. Existing chats keep their
 * agent. The account must be signed in. With `show="issue"` (the default) the row shows only
 * when the agent of the computer has a problem: only a row that needs the user has a button.
 * With `show="choice"` (the Details fold) it shows when the runtime sends two or more agents
 * and nothing is wrong.
 */
export function ComputerAgentRow({
  api,
  open,
  computer,
  name,
  show = 'issue',
}: {
  api: API;
  open: boolean;
  computer: string;
  show?: 'issue' | 'choice';
  /** The visible name of the computer, for example "this computer" or the host name. */
  name: string;
}) {
  const [setup, setSetup] = useState<VerdictanSetup>();
  const [choosing, setChoosing] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useRefreshTriggers(api, open, () => {
    void Promise.resolve()
      .then(() => api.verdictanSetup())
      .then(setSetup, () => setSetup(undefined));
  });
  if (!setup || !usesAgentChoice(setup) || typeof api.verdictanSetComputerAgent !== 'function')
    return null;
  const agents = setup.agents || [];
  const labels = agentLabels(agents);
  const current = computerAgentId(setup, computer);
  const agent = findAgent(setup, current);
  const issue = computerAgentIssue(setup, computer);
  // A problem shows in the group of the computer. A choice without a problem waits in Details.
  if (show === 'issue' ? !issue : issue || agents.length < 2) return null;
  const label = agent ? labels[agents.indexOf(agent)] : 'No agent';
  const policy = agent && agentConfigurationLabel(agent);
  async function save() {
    if (!value || value === current) return setChoosing(false);
    setBusy(true);
    setError('');
    try {
      setSetup(await api.verdictanSetComputerAgent!(computer, value));
      setChoosing(false);
      notifyManagedAgentsChanged();
      showToast(
        `New chats on ${name} use ${labels[agents.findIndex((a) => a.agent_id === value)]}`,
      );
    } catch {
      setError('Could not change the agent. Try again.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <SettingsRow
        id={computerAgentAnchor(computer)}
        icon={
          <EntityIcon>
            <Bot />
          </EntityIcon>
        }
        // In Details the rows of all computers are together, so each names its computer.
        label={
          show === 'choice'
            ? `${computer === localComputer ? (isMac ? 'This Mac' : 'This computer') : name} runs as ${label}`
            : `Runs as ${label}`
        }
        help={
          issue
            ? withoutManagedCode(managedErrorText(issue))
            : [policy, 'For new chats'].filter(Boolean).join(' · ')
        }
      >
        <Button
          variant="outline"
          size="sm"
          aria-label={`Change agent for ${name}`}
          onClick={() => {
            setValue(agent ? current : '');
            setError('');
            setChoosing(true);
          }}
        >
          Change…
        </Button>
      </SettingsRow>
      <ConfirmDialog
        open={choosing}
        title={`Change the agent for ${name}`}
        description={agentChangeNote}
        confirmLabel="Change agent"
        busy={busy}
        onCancel={() => setChoosing(false)}
        onConfirm={() => void save()}
      >
        <Choice
          className="w-full"
          label="Agent"
          value={value}
          disabled={busy}
          onChange={setValue}
          options={[
            ...(value ? [] : [{ value: '', label: 'Choose an agent' }]),
            ...agents.map((item, index) => ({
              value: item.agent_id,
              label: labels[index],
              description: agentConfigurationLabel(item),
            })),
          ]}
        />
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
      </ConfirmDialog>
    </>
  );
}
