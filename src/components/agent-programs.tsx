import { useRef, useState, type FormEvent } from 'react';
import { agentCatalog } from '../config/agents';
import type { API, AgentInstallation, RemoteHost } from '../types';
import {
  agentMinimumVersions,
  agentVersionRequirement,
  checkAgentVersion,
  nativeAgentKind,
} from '../domain/agent-version';
import {
  agentComputerAnchor,
  agentProgramAnchor,
  agentProgramStatus,
} from '../domain/agent-programs';
import { useRefreshTriggers } from '../hooks/use-refresh-triggers';
import { setAgentInstallations } from '../lib/agent-preference';
import { errorMessage } from '../lib/errors';
import { fullTime, relativeTime } from '../lib/relative-time';
import { AgentIcon } from './ui/agent-icon';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { EntityIcon } from './ui/entity-icon';
import { Input } from './ui/input';
import { CommandHelp, HelpLink } from './github-account';
import { ProgramPath } from './program-path';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Hint } from './hint';

/** How to install each agent CLI. */
const agentInstall: Record<string, { command: string; href: string }> = {
  codex: { command: 'npm i -g @openai/codex', href: 'https://github.com/openai/codex' },
  claude: {
    command: 'npm i -g @anthropic-ai/claude-code',
    href: 'https://docs.anthropic.com/en/docs/claude-code/setup',
  },
};

/** Install help for an agent that Kalkidan cannot find: the command, Copy, and a link. */
export function AgentInstallHelp({ agent }: { agent: string }) {
  const name = agentCatalog.find((item) => item.id === agent)?.name || agent;
  const install = agentInstall[agent];
  if (!install)
    return (
      <p className="mt-1 text-xs text-muted-foreground">
        {name} is not installed. Install it. Kalkidan then checks again.
      </p>
    );
  return (
    <div>
      <CommandHelp command={install.command}>
        {name} is not installed. Run <code>{install.command}</code> in a terminal.
      </CommandHelp>
      <HelpLink href={install.href}>How to install</HelpLink>
    </div>
  );
}

const sourceLabel: Record<NonNullable<AgentInstallation['source']>, string> = {
  automatic: 'Found automatically',
  chosen: 'Chosen by you',
  environment: 'Set by an environment variable',
};

/**
 * The agent programs of one computer in a sheet: this computer, or one SSH host. The user can
 * choose the program that launches use. Kalkidan checks again when the sheet opens and when
 * the window gets focus, for example after an install in a terminal.
 */
export function AgentProgramsDialog({
  api,
  host,
  agent,
  open,
  onOpenChange,
  onChecked,
}: {
  api: API;
  /** The SSH host. No host means this computer. */
  host?: RemoteHost;
  /** Shows only this agent, for example from the Codex row. Without it, both agents show. */
  agent?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The result of each check, for the Settings rows. */
  onChecked?: (agents: AgentInstallation[]) => void;
}) {
  const [agents, setAgents] = useState<AgentInstallation[] | undefined>(host?.agentCheck?.agents);
  const [checkedAt, setCheckedAt] = useState<number | undefined>(host?.agentCheck?.checkedAt);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const connected = !host || host.status === 'connected';
  const where = host ? host.name : 'this computer';
  const onCheckedRef = useRef(onChecked);
  onCheckedRef.current = onChecked;
  function accept(list: AgentInstallation[]) {
    setAgents(list);
    setCheckedAt(Date.now());
    setError('');
    // The default agent depends on the agents of this computer.
    if (!host) setAgentInstallations(list);
    onCheckedRef.current?.(list);
  }
  function check() {
    if (!connected) return;
    const id = ++request.current;
    setChecking(true);
    void Promise.resolve()
      .then(() => (host ? api.agentInstallations(host.id) : api.agentInstallations()))
      .then(
        (list) => id === request.current && accept(list),
        (failure) => {
          if (id !== request.current) return;
          setError(
            host
              ? errorMessage(failure) ||
                  'Could not check the coding agents on this host. Try again.'
              : 'Could not check the coding agents. Try again.',
          );
        },
      )
      .finally(() => id === request.current && setChecking(false));
  }
  useRefreshTriggers(undefined, open, check);
  const checkedText = checking
    ? 'Checking…'
    : checkedAt
      ? `Checked ${relativeTime(new Date(checkedAt).toISOString())}`
      : '';
  const shown = agent ? agentCatalog.filter((item) => item.id === agent) : agentCatalog;
  const only = agent ? shown[0] : undefined;
  const minimum = (id: string) =>
    id === 'codex' ? agentMinimumVersions.codex : agentMinimumVersions.claude_code;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" layout="scroll">
        <DialogHeader>
          <DialogTitle>
            {only ? `${only.name} on ${where}` : `Coding agent programs on ${where}`}
          </DialogTitle>
          <DialogDescription>
            {only
              ? `Kalkidan needs ${only.name} ${minimum(only.id)} or later.`
              : `Kalkidan needs Codex ${agentMinimumVersions.codex} or later and Claude Code ${agentMinimumVersions.claude_code} or later.`}
          </DialogDescription>
        </DialogHeader>
        <DialogBody
          id={agentComputerAnchor(host?.id)}
          className="grid content-start gap-3"
          aria-busy={checking}
        >
          {host && !connected && (
            <p className="form-help mt-0">
              {agents
                ? 'This host is not connected. This is the last result.'
                : 'Connect the host to check its coding agents.'}
            </p>
          )}
          {(agents || !host) && (
            <ul className="settings-rows" aria-label={`Coding agents on ${where}`}>
              {shown.map(({ id, name, vendor }) => (
                <ProgramRow
                  key={id}
                  api={api}
                  agent={id}
                  name={name}
                  vendor={vendor}
                  hostId={host?.id}
                  where={where}
                  installation={agents?.find((item) => item.agent === id)}
                  checking={checking && !agents}
                  // A program can change only on a computer that answers.
                  editable={connected && !!api.chooseAgentExecutable}
                  onChosen={accept}
                />
              ))}
            </ul>
          )}
          {error && (
            <p role="alert" className="field-error">
              {error}
            </p>
          )}
          {checkedText && (
            <p role="status" className="form-help mt-0">
              {checkedAt && !checking ? (
                <Hint label={fullTime(new Date(checkedAt).toISOString())}>
                  <span tabIndex={0}>{checkedText}</span>
                </Hint>
              ) : (
                checkedText
              )}
            </p>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}

/** The subscription that the native login of each coding agent uses. */
const subscriptionName: Record<string, string> = {
  codex: 'ChatGPT',
  claude: 'the Claude subscription',
};
/** One agent on one computer: the program, its version, the status, and the other programs. */
function ProgramRow({
  api,
  agent,
  name,
  vendor,
  hostId,
  where,
  installation,
  checking,
  editable,
  onChosen,
}: {
  api: API;
  agent: (typeof agentCatalog)[number]['id'];
  name: string;
  vendor: string;
  hostId?: string;
  where: string;
  installation?: AgentInstallation;
  checking: boolean;
  editable: boolean;
  onChosen: (agents: AgentInstallation[]) => void;
}) {
  const [choosing, setChoosing] = useState(false);
  const [path, setPath] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const status = checking
    ? { label: 'Checking…', ready: false }
    : installation
      ? agentProgramStatus(installation)
      : { label: 'Check failed', ready: false };
  const kind = nativeAgentKind(agent);
  const version =
    installation?.status === 'installed' && kind
      ? checkAgentVersion(kind, installation.version)
      : undefined;
  const install = agentInstall[agent];
  const fixedByEnvironment = installation?.source === 'environment';
  async function choose(value: string | null) {
    if (!api.chooseAgentExecutable) return;
    setBusy(true);
    setError('');
    try {
      const agents = await api.chooseAgentExecutable(agent, value, hostId);
      onChosen(agents);
      setChoosing(false);
      setPath('');
    } catch (reason) {
      setError(errorMessage(reason) || 'Could not use this program. Try again.');
    } finally {
      setBusy(false);
    }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    if (path.trim()) void choose(path.trim());
  }
  return (
    <li
      id={agentProgramAnchor(agent, hostId)}
      tabIndex={-1}
      aria-label={`${name} on ${where}`}
      className="flex min-h-[52px] items-start gap-3 border-b py-3 outline-none focus-visible:shadow-[var(--focus-ring)]"
    >
      <EntityIcon>
        <AgentIcon agent={agent} />
      </EntityIcon>
      <div className="grid min-w-0 flex-1 gap-1">
        <div className="flex min-w-0 items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium break-words">{name}</p>
            <p className="text-xs break-words text-muted-foreground">{vendor}</p>
          </div>
          <Badge variant={status.ready ? 'success' : 'muted'} size="sm" className="shrink-0">
            {status.label}
          </Badge>
        </div>
        <ProgramPath path={installation?.path} />
        {installation?.status === 'installed' && (
          <p className="text-xs text-muted-foreground" data-testid={`agent-version-${agent}`}>
            {installation.version
              ? `Version ${installation.version}`
              : 'Kalkidan cannot read the version'}
            {installation.source && ` · ${sourceLabel[installation.source]}`}
          </p>
        )}
        {installation?.status === 'installed' && installation.subscriptionLogin && (
          <p className="text-xs text-muted-foreground" data-testid={`agent-login-${agent}`}>
            {installation.subscriptionLogin === 'signed-in'
              ? `Signed in to ${subscriptionName[agent] ?? 'the subscription'} on ${where}`
              : `Not signed in to ${subscriptionName[agent] ?? 'the subscription'} on ${where}. Kalkidan needs this sign-in for subscription access.`}
          </p>
        )}
        {!checking &&
          installation?.status !== 'installed' &&
          (installation?.source === 'chosen' || fixedByEnvironment) &&
          installation.chosenPath && (
            <p className="text-xs text-muted-foreground">
              Kalkidan cannot run the chosen program at{' '}
              <code className="break-all">{installation.chosenPath}</code>.
            </p>
          )}
        {!checking &&
          installation?.status === 'missing' &&
          installation.source !== 'chosen' &&
          !fixedByEnvironment &&
          !installation.candidates?.length && <AgentInstallHelp agent={agent} />}
        {!checking && version && version.status !== 'supported' && (
          <>
            <p className="text-xs text-muted-foreground">{agentVersionRequirement(version.kind)}</p>
            {editable &&
              installation?.candidates?.some(
                (item) => checkAgentVersion(version.kind, item.version).status === 'supported',
              ) && (
                <p className="text-xs text-muted-foreground">
                  A different {name} program on {where} meets the minimum. Select Use next to it.
                </p>
              )}
            {install && (
              <CommandHelp command={install.command}>
                To update, run <code>{install.command}</code> in a terminal.
              </CommandHelp>
            )}
          </>
        )}
        {!checking && !!installation?.candidates?.length && (
          <div className="grid gap-1">
            <p className="text-xs text-muted-foreground">Also found:</p>
            <ul className="grid gap-1" aria-label={`Other ${name} programs on ${where}`}>
              {installation.candidates.map((candidate) => (
                <li key={candidate.path} className="flex min-w-0 items-center gap-2">
                  <ProgramPath path={candidate.path} className="mt-0 flex-1" />
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {candidate.version || 'Version not known'}
                  </span>
                  {editable && !fixedByEnvironment && (
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      aria-label={`Use ${candidate.path}`}
                      onClick={() => void choose(candidate.path)}
                    >
                      Use
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        {fixedByEnvironment && !checking && (
          <p className="text-xs text-muted-foreground">
            KALKIDAN_{agent.toUpperCase()}_PATH sets this program. Remove it to choose a program
            here.
          </p>
        )}
        {editable && !fixedByEnvironment && !checking && installation && (
          <div className="flex flex-wrap items-center gap-2">
            {!choosing && (
              <Button variant="outline" size="sm" onClick={() => setChoosing(true)}>
                Choose program…
              </Button>
            )}
            {installation.source === 'chosen' && (
              <Button variant="ghost" size="sm" disabled={busy} onClick={() => void choose(null)}>
                Use automatic detection
              </Button>
            )}
          </div>
        )}
        {choosing && (
          <form className="flex flex-wrap items-center gap-2" onSubmit={submit}>
            <Input
              size="sm"
              className="min-w-0 flex-1 font-mono"
              aria-label={`Path of the ${name} program on ${where}`}
              placeholder={agent === 'claude' ? '~/.local/bin/claude' : '~/.local/bin/codex'}
              value={path}
              autoFocus
              onChange={(event) => setPath(event.target.value)}
            />
            <Button type="submit" size="sm" disabled={busy || !path.trim()}>
              {busy ? 'Checking…' : 'Use program'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => {
                setChoosing(false);
                setError('');
              }}
            >
              Cancel
            </Button>
          </form>
        )}
        {error && (
          <p role="alert" className="field-error">
            {error}
          </p>
        )}
      </div>
    </li>
  );
}
