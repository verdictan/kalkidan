import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { useRefreshTriggers } from '../hooks/use-refresh-triggers';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { showToast } from './ui/toast';
import type { API, RemoteHost } from '../types';
import { errorMessage } from '../lib/errors';
import { settingsAnchors } from '../domain/settings-route';
import { agentProgramAnchor } from '../domain/agent-programs';
import { useRemoteHosts } from './remote-host-picker';
import { AddHostForm, HelperDetails, HostRow, useHelperUpdates } from './computers-settings';
import {
  AgentRows,
  ComputerSetupRow,
  OrganizationSetupLink,
  RuntimeHistory,
  ThisComputerRow,
  useRuntimeStatus,
} from './verdictan-settings';
import { SettingsDisclosure, SettingsRow } from './settings-disclosure';
import { ComputerAgentRow } from './computer-agent';
import { AgentProgramsDialog } from './agent-programs';
import { publishAgentChecks } from './settings-attention';
import { localComputer, type ManagedAgentKind } from '../domain/verdictan';
import { isMac } from '../lib/platform';

const dayMs = 86_400_000;

/**
 * Opens Settings › Computers, optionally at one row, for example 'computer-local' or
 * 'managed-agent-setup'. The Computers page is now a section of the one Settings window.
 */
export function openComputers(anchor?: string) {
  window.dispatchEvent(
    new CustomEvent('kalkidan-open-settings', { detail: { section: 'computers', anchor } }),
  );
}

/** One group of Settings › Computers: a group label and flat rows with dividers. */
function ComputersGroup({
  label,
  computer,
  children,
}: {
  label: string;
  /** 'local' or the SSH host ID. A link to a computer that has no row moves here. */
  computer?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <section className="settings-group" aria-labelledby={id} data-computer={computer}>
      <h3 id={id} className="group-label">
        {label}
      </h3>
      <ul className="settings-rows">{children}</ul>
    </section>
  );
}

/**
 * Asks before Kalkidan quits while agent runs or shells work on SSH hosts. "Don't ask again" in
 * the question turns it off. This switch turns it on again.
 */
function SshQuitRow({ api }: { api: API }) {
  const [ask, setAsk] = useState<boolean>();
  useEffect(() => {
    if (typeof api.sshQuitPrompt !== 'function') return;
    void Promise.resolve()
      .then(() => api.sshQuitPrompt!())
      .then(setAsk, () => {});
  }, [api]);
  if (ask === undefined || typeof api.setSshQuitPrompt !== 'function') return null;
  async function choose(next: boolean) {
    const before = ask;
    setAsk(next);
    try {
      setAsk(await api.setSshQuitPrompt!(next));
    } catch {
      setAsk(before);
      showToast({ message: 'Could not save the quit question setting.', tone: 'error' });
    }
  }
  return (
    <SettingsRow
      id="ssh-quit-prompt"
      label="Ask before quitting while SSH work runs"
      help="Agent runs and shells on SSH hosts continue after Kalkidan quits."
    >
      <Switch
        aria-label="Ask before quitting while SSH work runs"
        checked={ask}
        onCheckedChange={(next) => void choose(next)}
      />
    </SettingsRow>
  );
}

/**
 * The proxy sign-ins that Kalkidan saved in the secret store of the system, with Remove. The
 * group shows only when a sign-in is saved. The password never comes to the window.
 */
function ProxySignIns({ api }: { api: API }) {
  const [rows, setRows] = useState<{ proxy: string; username: string }[]>([]);
  const [failure, setFailure] = useState('');
  const read = useCallback(() => {
    void api
      .proxySignIns?.()
      .then(setRows)
      .catch(() => setRows([]));
  }, [api]);
  useRefreshTriggers(api, true, read);
  if (!rows.length) return null;
  return (
    <ComputersGroup label="Proxy sign-in">
      {rows.map((row) => (
        <SettingsRow
          key={row.proxy}
          label={row.proxy}
          help={`${row.username} · Saved in the secret store of this computer`}
        >
          <Button
            variant="outline"
            size="sm"
            aria-label={`Remove the proxy sign-in for ${row.proxy}`}
            onClick={() => {
              setFailure('');
              void api
                .proxySignInRemove?.(row.proxy)
                .then(read)
                .catch((error) => setFailure(errorMessage(error)));
            }}
          >
            Remove
          </Button>
        </SettingsRow>
      ))}
      {failure && (
        <p role="alert" className="field-error">
          {failure}
        </p>
      )}
    </ComputersGroup>
  );
}

/**
 * Settings › Computers: where Codex and Claude Code run. "This Mac" has one row for each coding
 * agent with its version, and only a row that needs the user has a button, for example "Update
 * Claude Code". The managed agents service shows only when it needs the user. Each SSH host is
 * a group with its target, the versions of its agents, and a "…" menu. "Add SSH host" opens a
 * field in place. "Organization setup…" is a quiet link. A Details fold at the end has the
 * install history and the helper builds.
 */
export function ComputersPanel({
  api,
  open = true,
  onRefresh,
  anchor,
}: {
  api: API;
  /** False while the section is hidden. The rows then do not read. */
  open?: boolean;
  /** Reads the projects again after a host connects. */
  onRefresh?: () => Promise<void>;
  /** The row to move to, for example 'computer-local' or 'managed-agent-setup'. */
  anchor?: string;
}) {
  const runtime = useRuntimeStatus(api, open, 'local');
  const { hosts, setHosts, error } = useRemoteHosts(api, open);
  const helpers = useHelperUpdates(api, open, hosts);
  // The host that was just added. Its row checks the connection once.
  const [added, setAdded] = useState('');
  const [adding, setAdding] = useState(false);
  const [setupAgent, setSetupAgent] = useState<ManagedAgentKind>();
  const [refreshError, setRefreshError] = useState('');
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open || !anchor) return;
    let tries = 0;
    const timer = setInterval(() => {
      // The runtime of a computer is in the row of that computer. The agents start at the
      // Codex row. A computer without a row of its own opens at its group.
      const id =
        anchor === settingsAnchors.agents
          ? agentProgramAnchor('codex')
          : anchor.replace(/^runtime-/, 'computer-');
      const computer = /^computer-(.+)$/.exec(id)?.[1];
      const element =
        root.current?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`) ||
        (computer
          ? root.current?.querySelector<HTMLElement>(
              `[data-computer="${CSS.escape(computer)}"] .group-label`,
            )
          : null);
      if (element || ++tries > 40) {
        clearInterval(timer);
        if (!element) return;
        element.scrollIntoView({ block: 'nearest' });
        if (!element.matches('button, a[href], input, [tabindex]'))
          element.setAttribute('tabindex', '-1');
        element.focus({ preventScroll: true });
      }
    }, 50);
    return () => clearInterval(timer);
  }, [open, anchor]);
  // Read the projects again only when a host becomes connected, not on each render.
  const connected = useRef<Set<string>>(undefined);
  useEffect(() => {
    const now = new Set(hosts.filter((h) => h.status === 'connected').map((h) => h.id));
    const before = connected.current;
    connected.current = now;
    if (!onRefresh || !before || ![...now].some((id) => !before.has(id))) return;
    setRefreshError('');
    void onRefresh().catch((failure) =>
      setRefreshError(`Could not refresh projects: ${errorMessage(failure)}`),
    );
  }, [hosts]);
  function store(host: RemoteHost) {
    setHosts((previous) =>
      previous.some((h) => h.id === host.id)
        ? previous.map((h) => (h.id === host.id ? host : h))
        : [...previous, host],
    );
  }
  const [programs, setPrograms] = useState(false);
  return (
    <div ref={root} className="computers-groups">
      <ComputersGroup label={isMac ? 'This Mac' : 'This computer'} computer="local">
        <ThisComputerRow api={api} runtime={runtime} quiet />
        <AgentRows api={api} open={open} onSetup={setSetupAgent} />
        <ComputerAgentRow api={api} open={open} computer={localComputer} name="this computer" />
      </ComputersGroup>
      {hosts.map((host) => (
        <ComputersGroup key={host.id} label={host.name} computer={host.id}>
          <HostRow
            api={api}
            open={open}
            host={host}
            helper={helpers[host.id]}
            autoStart={host.id === added}
            onHost={store}
            onRemoved={(id) => setHosts((previous) => previous.filter((h) => h.id !== id))}
          />
        </ComputersGroup>
      ))}
      {adding ? (
        <AddHostForm
          api={api}
          onCancel={() => setAdding(false)}
          onAdded={(host) => {
            store(host);
            setAdded(host.id);
            setAdding(false);
          }}
        />
      ) : (
        <div className="computers-actions">
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus />
            Add SSH host
          </Button>
          <OrganizationSetupLink
            api={api}
            open={open}
            anchor={anchor}
            agent={setupAgent}
            onAgentChange={setSetupAgent}
          />
        </div>
      )}
      {hosts.length > 0 && (
        <ul className="settings-rows">
          <SshQuitRow api={api} />
        </ul>
      )}
      <ProxySignIns api={api} />
      {(error || refreshError) && (
        <p role="alert" className="field-error whitespace-pre-wrap break-words">
          {refreshError || error}
        </p>
      )}
      <SettingsDisclosure title="Details">
        <ul className="settings-rows">
          <RuntimeHistory status={runtime.status} name="this computer" />
          {runtime.status?.latest && (
            <SettingsRow
              label="Managed agents release"
              help={`Latest ${runtime.status.latest.version}${
                // A time near 0 means that no check finished yet, so it does not show.
                (runtime.status.lastSuccessAt || 0) > dayMs
                  ? ` · Checked ${new Date(runtime.status.lastSuccessAt!).toLocaleString()}`
                  : ''
              }`}
            />
          )}
          <ComputerSetupRow api={api} open={open} />
          <SettingsRow label="Coding agent programs">
            <Button variant="outline" size="sm" onClick={() => setPrograms(true)}>
              Programs…
            </Button>
          </SettingsRow>
          {hosts.map((host) => (
            <HelperDetails key={host.id} host={host} helper={helpers[host.id]} />
          ))}
        </ul>
      </SettingsDisclosure>
      <AgentProgramsDialog
        api={api}
        open={programs}
        onOpenChange={setPrograms}
        onChecked={publishAgentChecks}
      />
    </div>
  );
}
