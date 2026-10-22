import { useEffect, useState } from 'react';
import { agentCatalog, agentLabel } from '../config/agents';
import { forkFolder, packageForkHistory, type ForkHistory } from '../domain/chat-fork';
import { computerAgentLabel, localComputer, usesAgentChoice } from '../domain/verdictan';
import { sessionAPI } from '../lib/remote-api';
import { sessionRepo } from '../lib/session-repository';
import { errorMessage } from '../lib/errors';
import type { Agent, API, Project, ProjectGroup, RemoteHost, Session } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { SegmentedControl } from './ui/segmented-control';
import { Alert, AlertDescription } from './ui/alert';
import { Choice } from './choice';
import { sessionTitle } from './session-actions';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

/** The choices of the fork dialog. The app opens a new chat with them. */
export interface ForkChoice {
  agent: Agent;
  folder: Project;
  /** The last message of the chat now. A chat that runs can have more messages later. */
  lastMessageId?: string;
}

const thisComputer = 'local';

/** Where the fork goes. */
type Destination = 'here' | 'branch' | 'other';
const destinations: { value: Destination; label: string }[] = [
  { value: 'here', label: 'This folder' },
  { value: 'branch', label: 'New branch' },
  { value: 'other', label: 'Another agent or computer' },
];

/**
 * The name of the current Verdictan agent of a computer, or undefined when Kalkidan cannot read
 * it. The fork uses the same agent as any new chat on the computer. Older runtimes have no agent
 * choice, so the dialog shows no name.
 */
async function currentAgentName(api: API, hostId: string | undefined) {
  if (typeof api.verdictanSetup !== 'function') return undefined;
  const setup = await api.verdictanSetup();
  return usesAgentChoice(setup) ? computerAgentLabel(setup, hostId ?? localComputer) : undefined;
}

/** A sentence about the history that the fork gives to the agent. */
export function forkHistoryText(history: ForkHistory) {
  if (!history.total) return 'This chat has no messages yet. The fork starts without history.';
  if (!history.shortened)
    return history.total === 1
      ? 'The fork gets the 1 message of this chat as context.'
      : `The fork gets all ${history.total} messages of this chat as context.`;
  return `The history is too long for the agent. The fork gets the most recent ${history.included} of ${history.total} messages as context, with a note that earlier messages are missing.`;
}

/**
 * Forks a chat: the one way to copy a chat. The fork is a new chat with the full history of the
 * source as context. It goes to this folder, to a new branch copy of the folder, or to another
 * coding agent or computer. The source chat does not change.
 */
export function ForkChatDialog({
  api,
  session,
  projects,
  groups,
  hosts,
  onOpenChange,
  onFork,
}: {
  api: API;
  /** The source chat. Null closes the dialog. */
  session: Session | null;
  projects: Project[];
  groups: ProjectGroup[];
  hosts: RemoteHost[];
  onOpenChange: (open: boolean) => void;
  onFork: (choice: ForkChoice) => void;
}) {
  const [agent, setAgent] = useState<Agent>('codex');
  const [computer, setComputer] = useState(thisComputer);
  const [history, setHistory] = useState<ForkHistory | null>(null);
  const [lastMessageId, setLastMessageId] = useState<string>();
  const [historyError, setHistoryError] = useState('');
  const [agentName, setAgentName] = useState<string>();
  const [destination, setDestination] = useState<Destination>('here');
  const [branchName, setBranchName] = useState('');
  const [creating, setCreating] = useState(false);
  const [branchError, setBranchError] = useState('');
  const sourceId = session ? `${session.agent}:${session.id}` : '';
  useEffect(() => {
    if (!session) return;
    setAgent(session.agent);
    setComputer(session.hostId || thisComputer);
    setDestination('here');
    setBranchName('');
    setBranchError('');
    setHistory(null);
    setLastMessageId(undefined);
    setHistoryError('');
    let live = true;
    sessionAPI(api, session)
      .transcript(session.agent, session.id)
      .then(
        (transcript) => {
          if (!live) return;
          setLastMessageId(transcript.messages.at(-1)?.id);
          setHistory(
            packageForkHistory(
              { title: sessionTitle(session), agent: session.agent },
              transcript.messages,
              transcript.truncated,
            ),
          );
        },
        (error) =>
          live &&
          setHistoryError(`Kalkidan cannot read the history of this chat. ${errorMessage(error)}`),
      );
    return () => {
      live = false;
    };
  }, [sourceId]);
  const other = destination === 'other';
  // This folder and New branch keep the agent and the computer of the chat.
  const forkAgent = other ? agent : (session?.agent as Agent);
  const hostId = other ? (computer === thisComputer ? undefined : computer) : session?.hostId;
  useEffect(() => {
    if (!session) return;
    setAgentName(undefined);
    let live = true;
    currentAgentName(api, hostId).then(
      (name) => live && setAgentName(name),
      () => {
        /* The dialog shows the general text. */
      },
    );
    return () => {
      live = false;
    };
  }, [sourceId, hostId]);
  if (!session) return null;
  const source = sessionRepo(session, projects);
  const folder = forkFolder(source, hostId, projects, groups);
  const host = hosts.find((item) => item.id === hostId);
  const computerName = host ? host.name : 'this Mac';
  const connected = !host || host.status === 'connected';
  const group = source && groups.find((item) => item.repoIds.includes(source.id));
  const missing = !source
    ? 'Add the code folder of this chat to Kalkidan first.'
    : !folder
      ? `The ${group ? `project "${group.name}"` : `code folder "${source.name}"`} is not on ${computerName}. Add its code folder on ${computerName}, then fork again.`
      : '';
  const ready =
    !!folder &&
    connected &&
    !!history &&
    !historyError &&
    !creating &&
    (destination !== 'branch' || !!branchName.trim());
  /** Makes the branch copy first when the fork goes to a new branch. */
  async function submit() {
    if (!ready || !folder) return;
    if (destination !== 'branch') {
      onFork({ agent: forkAgent, folder, lastMessageId });
      return;
    }
    setCreating(true);
    setBranchError('');
    try {
      const copy = await sessionAPI(api, session!).taskWorktree(folder.id, branchName.trim());
      if (copy) onFork({ agent: forkAgent, folder: copy, lastMessageId });
    } catch (error) {
      setBranchError(errorMessage(error));
    } finally {
      setCreating(false);
    }
  }
  const computers = [
    { value: thisComputer, label: 'This Mac' },
    ...hosts.map((item) => ({
      value: item.id,
      label: item.name,
      description: item.status === 'connected' ? item.target : 'Not connected',
    })),
  ];
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="sm" aria-label="Fork chat">
        <DialogHeader>
          <DialogTitle>Fork chat</DialogTitle>
          <DialogDescription>
            The fork is a new chat with the history of “{sessionTitle(session)}”. This chat does not
            change.
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <SegmentedControl<Destination>
            label="Fork to"
            value={destination}
            onChange={setDestination}
            options={destinations}
          />
          {destination === 'branch' && (
            <label className="form-label">
              Branch name
              <Input
                autoFocus
                placeholder="feature/new-direction"
                spellCheck={false}
                value={branchName}
                disabled={creating}
                onChange={(event) => setBranchName(event.target.value)}
              />
            </label>
          )}
          {other && (
            <>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">Coding agent</span>
                <Choice
                  label="Coding agent"
                  value={agent}
                  onChange={(value) => setAgent(value as Agent)}
                  options={agentCatalog.map((item) => ({
                    value: item.id,
                    label: item.name + (item.id === session.agent ? ' (this chat)' : ''),
                  }))}
                />
              </label>
              <label className="grid gap-1.5 text-sm">
                <span className="font-medium">Computer</span>
                <Choice
                  label="Computer"
                  value={computer}
                  onChange={setComputer}
                  options={computers.map((item) =>
                    item.value === (session.hostId || thisComputer)
                      ? { ...item, label: item.label + ' (this chat)' }
                      : item,
                  )}
                />
              </label>
            </>
          )}
          <p className="text-sm text-muted-foreground" data-testid="fork-agent">
            {agentName
              ? `Verdictan agent: ${agentName}. The fork uses the current agent of ${computerName}.`
              : `The fork uses the current Verdictan agent of ${computerName}.`}
            {forkAgent !== session.agent &&
              ` ${agentLabel(agent)} gets the history of the ${agentLabel(session.agent)} chat as context.`}
          </p>
          <p className="text-sm text-muted-foreground" role="status">
            {historyError ||
              (history ? forkHistoryText(history) : 'Kalkidan reads the history of this chat…')}
          </p>
          {missing && (
            <Alert variant="destructive">
              <AlertDescription>{missing}</AlertDescription>
            </Alert>
          )}
          {branchError && (
            <p role="alert" className="field-error">
              {branchError}
            </p>
          )}
          {creating && (
            <p role="status" className="text-sm text-muted-foreground">
              Kalkidan makes the branch copy…
            </p>
          )}
          {!missing && !connected && (
            <Alert variant="destructive">
              <AlertDescription>Connect {computerName} first, then fork again.</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!ready}>
              Fork chat
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
