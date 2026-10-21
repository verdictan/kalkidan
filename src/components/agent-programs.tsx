import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Laptop, RefreshCw, Server } from 'lucide-react';
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
import { computerAnchor, type SettingsTab } from '../domain/settings-route';

/** Moves Settings to a tab, and to an element in it. */
type Navigate = (tab: SettingsTab, anchor?: string) => void;

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
        {name} is not installed. Install it, then select Check again.
      </p>
    );
  return (
    <div>
      <CommandHelp command={install.command}>
        {name} is not installed. Run <code>{install.command}</code>, then select Check again.
      </CommandHelp>
      <HelpLink href={install.href}>How to install</HelpLink>
    </div>
  );
}

/** The result of the agent check on one computer. */
interface ComputerCheck {
  agents?: AgentInstallation[];
  checkedAt?: number;
  checking: boolean;
  error?: string;
}

const sourceLabel: Record<NonNullable<AgentInstallation['source']>, string> = {
  automatic: 'Automatic detection',
  chosen: 'Chosen in Settings',
  environment: 'Set by an environment variable',
};

/**
 * Settings › Agents: the agent programs on this computer and on each SSH host. The user can
 * choose the program that launches use on each computer.
 */
export function AgentProgramsSettings({
  api,
  open,
  onNavigate,
}: {
  api: API;
  open: boolean;
  /** Opens a different Settings tab, for example one host in Computers. */
  onNavigate?: Navigate;
}) {
  const [hosts, setHosts] = useState<RemoteHost[]>([]);
  const [checks, setChecks] = useState<Record<string, ComputerCheck>>({});
  const [revision, setRevision] = useState(0);
  const requests = useRef<Record<string, number>>({});
  useEffect(() => {
    if (!open) return;
    let active = true;
    const refresh = () => {
      void Promise.resolve()
        .then(() => api.remoteHosts?.() ?? [])
        .then((value) => {
          if (active) setHosts(value);
        })
        .catch(() => {
          /* Without the list, only this computer shows. */
        });
    };
    refresh();
    const unsubscribe = api.onRemoteHostsChange?.(refresh);
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [api, open]);

  function update(key: string, change: Partial<ComputerCheck>) {
    setChecks((previous) => ({
      ...previous,
      [key]: { ...(previous[key] || { checking: false }), ...change },
    }));
  }
  function accept(key: string, hostId: string | undefined, agents: AgentInstallation[]) {
    update(key, { agents, checkedAt: Date.now(), checking: false, error: undefined });
    // The default agent depends on the agents of this computer.
    if (!hostId) setAgentInstallations(agents);
  }
  function check(hostId?: string) {
    const key = hostId || 'local';
    const request = (requests.current[key] || 0) + 1;
    requests.current[key] = request;
    update(key, { checking: true, error: undefined });
    void Promise.resolve()
      .then(() => (hostId ? api.agentInstallations(hostId) : api.agentInstallations()))
      .then((agents) => {
        if (requests.current[key] === request) accept(key, hostId, agents);
      })
      .catch((error) => {
        if (requests.current[key] !== request) return;
        update(key, {
          checking: false,
          error: hostId
            ? errorMessage(error) || 'Could not check the agents on this host. Try again.'
            : 'Could not check agents. Try again.',
        });
      });
  }
  const connected = hosts
    .filter((host) => host.status === 'connected')
    .map((host) => host.id)
    .join(',');
  useEffect(() => {
    if (open) check();
  }, [open, api, revision]);
  useEffect(() => {
    if (!open) return;
    for (const id of connected.split(',').filter(Boolean)) check(id);
  }, [open, api, revision, connected]);
  const checking = Object.values(checks).some((item) => item.checking);

  return (
    <div className="grid min-w-0 grid-cols-1 gap-5">
      <div className="flex items-center justify-between gap-4">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          Kalkidan needs Codex {agentMinimumVersions.codex} or later and Claude Code{' '}
          {agentMinimumVersions.claude_code} or later on each computer.
        </p>
        <Button
          variant="outline"
          size="sm"
          disabled={checking}
          onClick={() => setRevision((n) => n + 1)}
        >
          <RefreshCw className={checking ? 'animate-spin' : ''} />
          Check again
        </Button>
      </div>
      <ComputerPrograms
        api={api}
        title="This computer"
        check={checks.local || { checking: open }}
        connected
        onChosen={(agents) => accept('local', undefined, agents)}
      />
      {hosts.map((host) => {
        const live = checks[host.id];
        const ready = host.status === 'connected';
        // A host that is not connected shows the last result that the desktop kept.
        const check: ComputerCheck =
          ready && live
            ? {
                ...live,
                agents: live.agents ?? host.agentCheck?.agents,
                checkedAt: live.checkedAt ?? host.agentCheck?.checkedAt,
              }
            : {
                checking: false,
                agents: host.agentCheck?.agents,
                checkedAt: host.agentCheck?.checkedAt,
              };
        return (
          <ComputerPrograms
            key={host.id}
            api={api}
            host={host}
            title={host.name}
            check={check}
            connected={ready}
            onChosen={(agents) => accept(host.id, host.id, agents)}
            onNavigate={onNavigate}
          />
        );
      })}
    </div>
  );
}

/** The agent programs of one computer. */
function ComputerPrograms({
  api,
  host,
  title,
  check,
  connected,
  onChosen,
  onNavigate,
}: {
  api: API;
  host?: RemoteHost;
  title: string;
  check: ComputerCheck;
  connected: boolean;
  onChosen: (agents: AgentInstallation[]) => void;
  onNavigate?: Navigate;
}) {
  const where = host ? title : 'this computer';
  const checkedAt = check.checkedAt ? new Date(check.checkedAt).toISOString() : undefined;
  const statuses = agentCatalog.map(({ id, name }) => {
    const item = check.agents?.find((entry) => entry.agent === id);
    return `${name}: ${check.checking ? 'Checking…' : agentProgramStatus(item).label}.`;
  });
  return (
    <section
      id={agentComputerAnchor(host?.id)}
      tabIndex={-1}
      aria-label={`Agents on ${where}`}
      className="grid min-w-0 gap-2 outline-none"
    >
      <header className="flex min-w-0 items-center gap-2">
        {host ? (
          <Server className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <Laptop className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <h3 className="min-w-0 truncate text-sm font-medium">{title}</h3>
        {host && <span className="truncate text-xs text-muted-foreground">{host.target}</span>}
        <span className="ml-auto shrink-0 text-xs text-muted-foreground">
          {check.checking ? (
            'Checking…'
          ) : checkedAt ? (
            <span title={fullTime(checkedAt)}>Last checked {relativeTime(checkedAt)}</span>
          ) : null}
        </span>
      </header>
      {host && !connected && (
        <p className="text-xs text-muted-foreground">
          {check.agents
            ? 'This host is not connected. This is the last result.'
            : 'Connect the host to check its agents.'}{' '}
          {onNavigate && (
            <button
              type="button"
              className="text-link"
              onClick={() => onNavigate('computers', computerAnchor(host.id))}
            >
              Open in Computers
            </button>
          )}
        </p>
      )}
      {(check.agents || !host) && (
        <ul className="divide-y rounded-lg border">
          {agentCatalog.map(({ id, name, vendor }) => (
            <ProgramRow
              key={id}
              api={api}
              agent={id}
              name={name}
              vendor={vendor}
              hostId={host?.id}
              where={where}
              installation={check.agents?.find((item) => item.agent === id)}
              checking={check.checking && !check.agents}
              // A program can change only on a computer that answers.
              editable={connected && !!api.chooseAgentExecutable}
              onChosen={onChosen}
            />
          ))}
        </ul>
      )}
      {/* One live region announces the result of all checks on this computer together. */}
      <p role="status" className="sr-only">
        {statuses.join(' ')}
      </p>
      {check.error && (
        <p role="alert" className="field-error">
          {check.error}
        </p>
      )}
    </section>
  );
}

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
      className="flex min-h-[var(--row-height-2line)] items-start gap-3 px-3 py-2 outline-none focus-visible:shadow-[var(--focus-ring)]"
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
                To update, run <code>{install.command}</code>, then select Check again.
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
                      size="xs"
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
              <Button variant="outline" size="xs" onClick={() => setChoosing(true)}>
                Choose program…
              </Button>
            )}
            {installation.source === 'chosen' && (
              <Button variant="ghost" size="xs" disabled={busy} onClick={() => void choose(null)}>
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
            <Button type="submit" size="xs" disabled={busy || !path.trim()}>
              {busy ? 'Checking…' : 'Use program'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="xs"
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
