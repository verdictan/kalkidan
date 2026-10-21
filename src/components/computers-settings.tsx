import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Laptop, Plus, Server } from 'lucide-react';
import type { API, RemoteHost } from '../types';
import type { HelperUpdateStatus } from '../domain/updates';
import { agentComputerAnchor } from '../domain/agent-programs';
import { computerAnchor, helperUpdateAnchor } from '../domain/settings-route';
import { helperStatusLabel, shortId } from '../lib/verdictan-labels';
import { errorMessage } from '../lib/errors';
import {
  AddHostForm,
  HelperUpdateButton,
  HostSetup,
  useHostSetup,
  useRemoteHosts,
} from './remote-host-picker';
import { ManagedRuntime, type SettingsNavigate } from './verdictan-settings';
import { SettingsGroup } from './settings-disclosure';
import { Badge } from './ui/badge';
import { Button } from './ui/button';

const hostStatus: Record<
  RemoteHost['status'],
  { label: string; tone: 'success' | 'secondary' | 'warning' | 'destructive' | 'muted' }
> = {
  connected: { label: 'Connected', tone: 'success' },
  connecting: { label: 'Connecting…', tone: 'secondary' },
  queued: { label: 'Waiting to connect', tone: 'secondary' },
  'retry-wait': { label: 'Connection lost', tone: 'warning' },
  error: { label: 'Connection failed', tone: 'destructive' },
  checked: { label: 'Not connected', tone: 'muted' },
  disconnected: { label: 'Disconnected', tone: 'muted' },
};

/**
 * The update state of the helper on each SSH host, by host ID. It reads the state again when
 * a host changes, for example after a helper update. A failed read shows no update state.
 */
function useHelperUpdates(api: API, open: boolean, hosts: RemoteHost[]) {
  const [helpers, setHelpers] = useState<Record<string, HelperUpdateStatus>>({});
  const key = hosts.map((h) => `${h.id}:${h.status}:${h.installedDigest || ''}`).join(',');
  useEffect(() => {
    // Older desktop builds do not report component versions.
    if (!open || typeof api.componentUpdates !== 'function') return;
    let live = true;
    void Promise.resolve()
      .then(() => api.componentUpdates(false))
      .then(
        (value) => {
          if (live) setHelpers(Object.fromEntries(value.helpers.map((h) => [h.hostId, h])));
        },
        () => {
          if (live) setHelpers({});
        },
      );
    return () => {
      live = false;
    };
  }, [api, open, key]);
  return helpers;
}

/**
 * Settings › Computers: one card for this computer and one for each SSH host. Each card shows
 * the connection, the managed agents runtime, the helper, and a link to its agent programs.
 */
export function ComputersSettings({
  api,
  open,
  onNavigate,
  onRefresh,
}: {
  api: API;
  open: boolean;
  onNavigate: SettingsNavigate;
  /** Reads the projects again after a host connects. */
  onRefresh: () => Promise<void>;
}) {
  const { hosts, setHosts, error } = useRemoteHosts(api, open);
  const helpers = useHelperUpdates(api, open, hosts);
  const [adding, setAdding] = useState(false);
  // The host that was just added. Its setup starts at once.
  const [added, setAdded] = useState('');
  const [refreshError, setRefreshError] = useState('');
  // Read the projects again only when a host becomes connected, not on each render.
  const connected = useRef<Set<string>>(undefined);
  useEffect(() => {
    const now = new Set(hosts.filter((h) => h.status === 'connected').map((h) => h.id));
    const before = connected.current;
    connected.current = now;
    if (!before || ![...now].some((id) => !before.has(id))) return;
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
  return (
    <div className="grid min-w-0 gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="min-w-0 flex-1 text-xs text-muted-foreground">
          This computer and the SSH hosts that run your projects. Kalkidan installs a small helper
          on each host.
        </p>
        {!adding && (
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus />
            Add host
          </Button>
        )}
      </div>
      {adding && (
        <SettingsGroup title="Add host" className="computer-card">
          <AddHostForm
            api={api}
            onCancel={() => setAdding(false)}
            onAdded={(host) => {
              store(host);
              setAdded(host.id);
              setAdding(false);
            }}
          />
        </SettingsGroup>
      )}
      <ul className="grid min-w-0 gap-3" aria-label="Computers">
        <ComputerCard api={api} open={open} onNavigate={onNavigate} />
        {hosts.map((host) => (
          <HostCard
            key={host.id}
            api={api}
            open={open}
            host={host}
            helper={helpers[host.id]}
            autoStart={added === host.id}
            onHost={store}
            onRemoved={(id) => setHosts((previous) => previous.filter((h) => h.id !== id))}
            onNavigate={onNavigate}
          />
        ))}
      </ul>
      {!hosts.length && !adding && (
        <p className="text-xs text-muted-foreground">
          No SSH hosts. Select Add host to run projects on a computer that you can reach with SSH.
        </p>
      )}
      {(error || refreshError) && (
        <p role="alert" className="field-error whitespace-pre-wrap break-words">
          {refreshError || error}
        </p>
      )}
    </div>
  );
}

/** The card of one SSH host: the connection, the runtime, and the helper with its update. */
function HostCard({
  api,
  open,
  host,
  helper,
  autoStart,
  onHost,
  onRemoved,
  onNavigate,
}: {
  api: API;
  open: boolean;
  host: RemoteHost;
  helper?: HelperUpdateStatus;
  autoStart: boolean;
  onHost: (host: RemoteHost) => void;
  onRemoved: (hostId: string) => void;
  onNavigate: SettingsNavigate;
}) {
  // The connection and the helper update share one state, so one action runs at a time.
  const setup = useHostSetup(api, { onHost, onRemoved });
  const digest = host.installedDigest || host.runningDigest;
  const available = helper?.discovery === 'available';
  const status =
    helper && ['available', 'waiting-for-idle'].includes(helper.discovery)
      ? helperStatusLabel(helper)
      : undefined;
  return (
    <ComputerCard
      api={api}
      open={open}
      host={host}
      onNavigate={onNavigate}
      connection={
        <HostSetup
          api={api}
          host={host}
          setup={setup}
          autoStart={autoStart}
          onHost={onHost}
          onRemoved={onRemoved}
        />
      }
    >
      <section aria-label="Kalkidan helper" className="computer-card-section grid gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h4 className="text-[13px] leading-5 font-semibold">Kalkidan helper</h4>
          {status && (
            <Badge variant={status.tone} size="sm">
              {status.label}
            </Badge>
          )}
        </div>
        <dl className="meta-list">
          <dt>Version</dt>
          <dd>{host.version || 'Not installed'}</dd>
          {digest && (
            <>
              <dt>Build</dt>
              <dd>{shortId(digest)}</dd>
            </>
          )}
          {host.node && (
            <>
              <dt>Node.js</dt>
              <dd>{host.node}</dd>
            </>
          )}
        </dl>
        {available && (
          <p className="text-xs text-muted-foreground">
            This app has a new version of the helper. The update stops active work on this host.
          </p>
        )}
        {host.version && (
          <div>
            <HelperUpdateButton
              api={api}
              host={host}
              setup={setup}
              id={helperUpdateAnchor(host.id)}
              available={available}
            />
          </div>
        )}
      </section>
    </ComputerCard>
  );
}

/**
 * One computer: this computer when `host` is not set, else one SSH host. `connection` and
 * `children` are the sections of an SSH host.
 */
function ComputerCard({
  api,
  open,
  host,
  connection,
  children,
  onNavigate,
}: {
  api: API;
  open: boolean;
  host?: RemoteHost;
  connection?: ReactNode;
  children?: ReactNode;
  onNavigate: SettingsNavigate;
}) {
  const name = host ? host.name : 'This computer';
  const ready = !host || host.status === 'connected';
  const status = host ? hostStatus[host.status] : undefined;
  return (
    <li
      id={computerAnchor(host?.id)}
      tabIndex={-1}
      role="group"
      aria-label={name}
      className="computer-card outline-none"
    >
      <header className="flex min-w-0 flex-wrap items-center gap-2">
        {host ? (
          <Server className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        ) : (
          <Laptop className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        )}
        <h3 className="min-w-0 truncate text-sm font-semibold">{name}</h3>
        {host && (
          <span className="min-w-0 truncate text-xs text-muted-foreground">{host.target}</span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-2">
          {status && (
            <Badge variant={status.tone} size="sm">
              {status.label}
            </Badge>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onNavigate('agents', agentComputerAnchor(host?.id))}
          >
            Agent programs
          </Button>
        </span>
      </header>
      {connection && (
        <section aria-label="Connection" className="computer-card-section">
          <h4 className="text-[13px] leading-5 font-semibold">Connection</h4>
          {connection}
        </section>
      )}
      <div className="computer-card-section">
        {ready ? (
          <ManagedRuntime api={api} open={open} hostId={host?.id || 'local'} />
        ) : (
          <section aria-label="Managed agents runtime" className="grid gap-1">
            <h4 className="text-[13px] leading-5 font-semibold">Managed agents runtime</h4>
            <p className="text-xs text-muted-foreground">
              Connect the host to see and install its runtime.
            </p>
          </section>
        )}
      </div>
      {children}
    </li>
  );
}
