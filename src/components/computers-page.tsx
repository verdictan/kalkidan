import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useRefreshTriggers } from '../hooks/use-refresh-triggers';
import { Button } from './ui/button';
import { Switch } from './ui/switch';
import { showToast } from './ui/toast';
import type { API, RemoteHost } from '../types';
import { errorMessage } from '../lib/errors';
import { settingsAnchors } from '../domain/settings-route';
import { agentProgramAnchor } from '../domain/agent-programs';
import { useRemoteHosts } from './remote-host-picker';
import { AddHostRow, HelperDetails, HostRow, useHelperUpdates } from './computers-settings';
import {
  AgentRows,
  OrganizationSetupRow,
  RuntimeHistory,
  ThisComputerRow,
  useRuntimeStatus,
} from './verdictan-settings';
import { SettingsDisclosure, SettingsRow } from './settings-disclosure';
import { ComputerAgentRow } from './computer-agent';
import { localComputer } from '../domain/verdictan';
import { PageHeader, SectionHeader } from './ui/page-header';

const dayMs = 86_400_000;

/** The anchor that the next Computers page should move to. `openComputers` sets it. */
let pendingAnchor: string | undefined;

/**
 * Opens the Computers page, optionally at one row, for example 'computer-local' or
 * 'managed-agent-setup'. The shell handles the event and shows the page.
 */
export function openComputers(anchor?: string) {
  pendingAnchor = anchor;
  window.dispatchEvent(new CustomEvent('kalkidan-open-computers', { detail: { anchor } }));
}

/** One group of the Computers page: a section header and flat rows with dividers. */
function ComputersGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="settings-group" aria-label={label}>
      <SectionHeader title={label} />
      <ul className="settings-rows" aria-label={label}>
        {children}
      </ul>
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
 * The Computers page: where Codex and Claude Code run. "This computer" has the managed agents
 * runtime, the agent of the computer with "Change agent", and one row for each coding agent with
 * its program, model and organization setup. Each SSH host also has its agent. "SSH hosts" has one
 * row for each host with its state and a "…" menu, and an always-visible field to add a host:
 * type the target, press Add, and the new row checks the connection. A Details fold at the end
 * has the install history and the helper builds.
 */
export function ComputersPage({
  api,
  onRefresh,
  anchor,
}: {
  api: API;
  /** Reads the projects again after a host connects. */
  onRefresh?: () => Promise<void>;
  /** The row to move to. Without it, the page uses the anchor of the last `openComputers`. */
  anchor?: string;
}) {
  const runtime = useRuntimeStatus(api, true, 'local');
  const { hosts, setHosts, error } = useRemoteHosts(api, true);
  const helpers = useHelperUpdates(api, true, hosts);
  // The host that was just added. Its row checks the connection once.
  const [added, setAdded] = useState('');
  const [refreshError, setRefreshError] = useState('');
  const [focusId, setFocusId] = useState(() => {
    const value = anchor || pendingAnchor;
    pendingAnchor = undefined;
    return value;
  });
  const root = useRef<HTMLElement>(null);
  // A later request while the page shows moves to its row.
  useEffect(() => {
    const onOpen = (event: Event) => {
      const next = (event as CustomEvent<{ anchor?: string }>).detail?.anchor;
      pendingAnchor = undefined;
      if (next) setFocusId(next);
    };
    window.addEventListener('kalkidan-open-computers', onOpen);
    return () => window.removeEventListener('kalkidan-open-computers', onOpen);
  }, []);
  useEffect(() => {
    if (anchor) setFocusId(anchor);
  }, [anchor]);
  useEffect(() => {
    if (!focusId) return;
    let tries = 0;
    const timer = setInterval(() => {
      // The runtime of a computer is in the row of that computer. The agents start at the
      // Codex row.
      const id =
        focusId === settingsAnchors.agents
          ? agentProgramAnchor('codex')
          : focusId.replace(/^runtime-/, 'computer-');
      const element = root.current?.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
      if (element || ++tries > 40) {
        clearInterval(timer);
        setFocusId(undefined);
        if (!element) return;
        element.scrollIntoView({ block: 'nearest' });
        if (!element.matches('button, a[href], input, [tabindex]'))
          element.setAttribute('tabindex', '-1');
        element.focus({ preventScroll: true });
      }
    }, 50);
    return () => clearInterval(timer);
  }, [focusId]);
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
  const details = !!runtime.status?.history.length || !!runtime.status?.latest || !!hosts.length;
  return (
    <section ref={root} className="page computers-page" aria-label="Computers">
      <PageHeader title="Computers" subtitle="Where Codex and Claude Code run" />
      <div className="computers-groups">
        <ComputersGroup label="This computer">
          <ThisComputerRow api={api} runtime={runtime} />
          <ComputerAgentRow api={api} open computer={localComputer} name="this computer" />
          <AgentRows api={api} open />
          <OrganizationSetupRow api={api} open anchor={focusId} />
        </ComputersGroup>
        <ComputersGroup label="SSH hosts">
          {hosts.map((host) => (
            <HostRow
              key={host.id}
              api={api}
              open
              host={host}
              helper={helpers[host.id]}
              autoStart={host.id === added}
              onHost={store}
              onRemoved={(id) => setHosts((previous) => previous.filter((h) => h.id !== id))}
            />
          ))}
          <AddHostRow
            api={api}
            onAdded={(host) => {
              store(host);
              setAdded(host.id);
            }}
          />
          <SshQuitRow api={api} />
        </ComputersGroup>
        <ProxySignIns api={api} />
        {(error || refreshError) && (
          <p role="alert" className="field-error whitespace-pre-wrap break-words">
            {refreshError || error}
          </p>
        )}
        {details && (
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
              {hosts.map((host) => (
                <HelperDetails key={host.id} host={host} helper={helpers[host.id]} />
              ))}
            </ul>
          </SettingsDisclosure>
        )}
      </div>
    </section>
  );
}
