import { useEffect, useRef, useState } from 'react';
import { Bot, Download, Plus, RotateCw, Server, Trash2, Unplug } from 'lucide-react';
import type { API, RemoteHost } from '../types';
import type { ComponentUpdateStatus, HelperUpdateStatus } from '../domain/updates';
import { computerAnchor, helperUpdateAnchor } from '../domain/settings-route';
import { displayVersion, helperStatusLabel, shortId } from '../lib/verdictan-labels';
import { errorMessage } from '../lib/errors';
import { useRefreshTriggers } from '../hooks/use-refresh-triggers';
import {
  AddHostForm,
  HostSetup,
  helperSetupText,
  hostStatusLabels,
  useHostSetup,
  useRemoteHosts,
} from './remote-host-picker';
import {
  RuntimeControl,
  RuntimeExtra,
  RuntimeHistory,
  ThisComputerRow,
  runtimeExtraShown,
  runtimeView,
  useRuntimeStatus,
} from './verdictan-settings';
import { AgentProgramsDialog } from './agent-programs';
import { ConfirmDialog } from './confirm-dialog';
import {
  CopyValue,
  SettingsAdvanced,
  SettingsGroup,
  SettingsRow,
  SettingsRows,
  StatusBadge,
} from './settings-disclosure';
import { Button } from './ui/button';
import { CheckboxRow } from './ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { menuDestructiveClass } from './ui/menu-styles';
import { EntityIcon } from './ui/entity-icon';
import { MoreButton } from './ui/more-button';

/**
 * The update state of the helper on each SSH host, by host ID. It reads again when a host
 * changes, when the section opens, and on window focus.
 */
function useHelperUpdates(api: API, open: boolean, hosts: RemoteHost[]) {
  const key = hosts.map((h) => `${h.id}:${h.status}:${h.installedDigest || ''}`).join(',');
  const [helpers, setHelpers] = useState<Record<string, HelperUpdateStatus>>({});
  const read = () => {
    // Some test stubs do not report helper versions.
    if (typeof api.helperUpdates !== 'function') return;
    void Promise.resolve()
      .then(() => api.helperUpdates())
      .then(
        (value) => setHelpers(Object.fromEntries(value.map((h) => [h.hostId, h]))),
        () => setHelpers({}),
      );
  };
  useRefreshTriggers(undefined, open, read);
  useEffect(() => {
    if (open) read();
  }, [key]);
  return helpers;
}

/**
 * Settings › Computers: one row for this computer and one row for each SSH host. A host row
 * has a "…" menu with its actions. The setup checklist shows only while a host is added. The
 * Advanced fold has the install history and the helper builds and digests.
 */
export function ComputersSection({
  api,
  open,
  onRefresh,
}: {
  api: API;
  open: boolean;
  /** Reads the projects again after a host connects. */
  onRefresh?: () => Promise<void>;
}) {
  const runtime = useRuntimeStatus(api, open, 'local');
  const { hosts, setHosts, error } = useRemoteHosts(api, open);
  const helpers = useHelperUpdates(api, open, hosts);
  const [adding, setAdding] = useState(false);
  // The host that was just added. Its checklist shows until it connects or the user closes it.
  const [added, setAdded] = useState('');
  const [refreshError, setRefreshError] = useState('');
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
  const newHost = hosts.find((h) => h.id === added);
  return (
    <>
      <SettingsRows label="Computers">
        <ThisComputerRow api={api} runtime={runtime} />
        {hosts
          .filter((host) => host.id !== added)
          .map((host) => (
            <HostRow
              key={host.id}
              api={api}
              open={open}
              host={host}
              helper={helpers[host.id]}
              onHost={store}
              onRemoved={(id) => setHosts((previous) => previous.filter((h) => h.id !== id))}
            />
          ))}
      </SettingsRows>
      {adding || newHost ? (
        <SettingsGroup title={newHost ? `Set up ${newHost.name}` : 'Add SSH host'}>
          <div className="settings-advanced-box py-3">
            {newHost ? (
              <>
                <HostSetup
                  api={api}
                  host={newHost}
                  autoStart
                  onHost={store}
                  onRemoved={(id) => {
                    setHosts((previous) => previous.filter((h) => h.id !== id));
                    setAdded('');
                  }}
                />
                <div className="mt-3 flex justify-end">
                  <Button
                    size="sm"
                    variant={newHost.status === 'connected' ? 'default' : 'outline'}
                    onClick={() => setAdded('')}
                  >
                    {newHost.status === 'connected' ? 'Done' : 'Close'}
                  </Button>
                </div>
              </>
            ) : (
              <AddHostForm
                api={api}
                onCancel={() => setAdding(false)}
                onAdded={(host) => {
                  store(host);
                  setAdded(host.id);
                  setAdding(false);
                }}
              />
            )}
          </div>
        </SettingsGroup>
      ) : (
        <div className="grid justify-items-start gap-1">
          <Button variant="outline" size="sm" onClick={() => setAdding(true)}>
            <Plus />
            Add SSH host
          </Button>
          {!hosts.length && (
            <p className="form-help mt-0">
              Run projects on a computer that you reach with SSH. Kalkidan uses your SSH keys.
            </p>
          )}
        </div>
      )}
      {(error || refreshError) && (
        <p role="alert" className="field-error whitespace-pre-wrap break-words">
          {refreshError || error}
        </p>
      )}
      <SettingsAdvanced>
        <SettingsRows>
          <RuntimeHistory status={runtime.status} name="this computer" />
          {runtime.status?.latest && (
            <SettingsRow
              label="Managed agents release"
              help={`Latest ${runtime.status.latest.version}${
                runtime.status.lastSuccessAt
                  ? ` · Checked ${new Date(runtime.status.lastSuccessAt).toLocaleString()}`
                  : ''
              }`}
            />
          )}
          {hosts.map((host) => (
            <HelperDetails key={host.id} host={host} helper={helpers[host.id]} />
          ))}
          {!runtime.status?.history.length && !runtime.status?.latest && !hosts.length && (
            <SettingsRow
              label="No details yet"
              help="Install history and helper builds show here."
            />
          )}
        </SettingsRows>
      </SettingsAdvanced>
    </>
  );
}

/** The helper builds and digests of one host, for the Advanced fold. */
function HelperDetails({ host, helper }: { host: RemoteHost; helper?: HelperUpdateStatus }) {
  const digest = host.installedDigest || host.runningDigest;
  return (
    <SettingsRow
      label={`Helper on ${host.name}`}
      help={
        <span className="grid gap-1 pt-1">
          <span>
            {[
              host.version ? `Version ${host.version}` : 'Not installed',
              digest ? `Build ${shortId(digest)}` : '',
              host.node ? `Node.js ${host.node}` : '',
              helper ? helperStatusLabel(helper).label : '',
            ]
              .filter(Boolean)
              .join(' · ')}
          </span>
          {helper?.installed && <CopyValue value={helper.installed} name="Installed digest" />}
          {helper?.running && helper.running !== helper.installed && (
            <CopyValue value={helper.running} name="Running digest" />
          )}
          {helper?.approved && <CopyValue value={helper.approved} name="Digest in this app" />}
        </span>
      }
    />
  );
}

/**
 * The managed runtime line of a connected host. A host checks its runtime each time it
 * connects, and a newer signed release installs without a chat. Empty when the row shows the
 * runtime below it, for example during an install or after an error.
 */
function hostRuntimeText(status: ComponentUpdateStatus | undefined) {
  if (!status) return '';
  if (status.discovery === 'checking') return 'Checking managed agents for updates…';
  if (!status.installed) return '';
  return `Managed agents ${displayVersion(status.installed.version)} · Checked for updates when it connected`;
}

/** The help line of a host row. A connected host also shows its managed runtime. */
function hostHelp(host: RemoteHost, busy: string, runtime = '') {
  if (busy) return busy;
  if (host.setup && !['ready', 'failed'].includes(host.setup.phase))
    return helperSetupText(host.setup);
  switch (host.status) {
    case 'connected': {
      const line = [host.target, host.platform, host.node ? `Node.js ${host.node}` : '']
        .filter(Boolean)
        .join(' · ');
      if (!runtime) return line;
      return (
        <span className="grid">
          <span>{line}</span>
          <span>{runtime}</span>
        </span>
      );
    }
    case 'retry-wait':
      return host.retryAt
        ? `Connection lost. Kalkidan tries again at ${new Date(host.retryAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`
        : 'Connection lost. Kalkidan tries again soon.';
    case 'error':
      return host.setup?.phase === 'failed'
        ? helperSetupText(host.setup)
        : host.error || 'Connection failed.';
    default:
      return host.target;
  }
}

/** One SSH host: name, "target · OS · Node.js", status, and a "…" menu with its actions. */
function HostRow({
  api,
  open,
  host,
  helper,
  onHost,
  onRemoved,
}: {
  api: API;
  open: boolean;
  host: RemoteHost;
  helper?: HelperUpdateStatus;
  onHost: (host: RemoteHost) => void;
  onRemoved: (hostId: string) => void;
}) {
  const setup = useHostSetup(api, { onHost, onRemoved });
  const ready = host.status === 'connected';
  const runtime = useRuntimeStatus(api, open && ready, host.id);
  const view = runtimeView(runtime);
  const [confirm, setConfirm] = useState<'disconnect' | 'update' | 'remove'>();
  const [deleteHostData, setDeleteHostData] = useState(false);
  const [programs, setPrograms] = useState(false);
  const offline = ['retry-wait', 'error', 'disconnected', 'checked'].includes(host.status);
  const helperUpdate = helper?.discovery === 'available';
  const status = setup.busy
    ? { label: 'Working…', tone: 'secondary' as const }
    : helperUpdate
      ? helperStatusLabel(helper)
      : hostStatusLabels[host.status];
  // The runtime of a connected host shows only when it needs something or installs.
  const runtimeNeedsUser =
    ready && runtime.status && (runtimeExtraShown(runtime) || view.label.label !== 'Ready');
  function reconnect() {
    if (host.version) void setup.act('Connecting…', () => api.remoteConnect(host.id), 'connect');
    else void setup.guide(host);
  }
  return (
    <>
      <SettingsRow
        id={computerAnchor(host.id)}
        icon={
          <EntityIcon>
            <Server />
          </EntityIcon>
        }
        label={host.name}
        help={hostHelp(host, setup.busy, runtimeNeedsUser ? '' : hostRuntimeText(runtime.status))}
        extra={
          setup.error || runtimeNeedsUser || (host.status === 'checked' && !host.version) ? (
            <div className="grid gap-2">
              {host.status === 'checked' && !host.version && !setup.busy && (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="form-help mt-0 flex-1">
                    SSH works. Kalkidan installs a small helper on {host.target}. It needs Node.js
                    22 or later.
                  </p>
                  <Button size="sm" onClick={() => void setup.install(host)}>
                    Install helper
                  </Button>
                </div>
              )}
              {runtimeNeedsUser && (
                <div className="grid gap-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="form-help mt-0 flex-1">{view.help}</p>
                    <RuntimeControl runtime={runtime} name={host.name} />
                  </div>
                  <RuntimeExtra runtime={runtime} />
                </div>
              )}
              {setup.error && (
                <p role="alert" className="field-error whitespace-pre-wrap break-words">
                  {setup.error}
                </p>
              )}
            </div>
          ) : undefined
        }
      >
        <StatusBadge status={status} />
        {offline && host.status !== 'checked' && (
          <Button variant="outline" size="sm" disabled={!!setup.busy} onClick={reconnect}>
            Reconnect
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <MoreButton
              id={helperUpdateAnchor(host.id)}
              label={`Actions for ${host.name}`}
              disabled={!!setup.busy}
            />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-52">
            <DropdownMenuItem onSelect={reconnect}>
              <RotateCw />
              Reconnect
            </DropdownMenuItem>
            {['connected', 'connecting', 'queued', 'retry-wait'].includes(host.status) && (
              <DropdownMenuItem onSelect={() => setConfirm('disconnect')}>
                <Unplug />
                Disconnect…
              </DropdownMenuItem>
            )}
            {host.version && (
              <DropdownMenuItem onSelect={() => setConfirm('update')}>
                <Download />
                {helperUpdate ? 'Update helper (new version)…' : 'Update helper…'}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onSelect={() => setPrograms(true)}>
              <Bot />
              Agent programs…
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className={menuDestructiveClass}
              onSelect={() => {
                setup.setRemoveError('');
                setDeleteHostData(false);
                setConfirm('remove');
              }}
            >
              <Trash2 />
              Remove host…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SettingsRow>
      <ConfirmDialog
        open={confirm === 'disconnect'}
        title={`Disconnect ${host.name}?`}
        description="Disconnecting stops all active work on this host. Running agent chats stop."
        confirmLabel="Disconnect"
        destructive
        onCancel={() => setConfirm(undefined)}
        onConfirm={() => {
          setConfirm(undefined);
          void setup.act('Disconnecting…', async () => {
            await api.remoteDisconnect(host.id);
            return { ...host, status: 'disconnected' };
          });
        }}
      />
      <ConfirmDialog
        open={confirm === 'update'}
        title={`Update the helper on ${host.name}?`}
        description="The update stops all active work on this host. Running agent chats stop."
        confirmLabel="Update helper"
        destructive
        onCancel={() => setConfirm(undefined)}
        onConfirm={() => {
          setConfirm(undefined);
          void setup.act('Updating the helper…', () => api.remoteInstall(host.id));
        }}
      />
      <ConfirmDialog
        open={confirm === 'remove'}
        title={`Remove ${host.name}?`}
        description="Kalkidan revokes this host in Verdictan and forgets it. You cannot remove a host while a project uses it."
        confirmLabel="Remove host"
        destructive
        busy={setup.busy === 'Removing host…'}
        onCancel={() => setConfirm(undefined)}
        onConfirm={() =>
          void setup
            .remove(host, { deleteHostData })
            .then((removed) => removed && setConfirm(undefined))
        }
      >
        <CheckboxRow
          label="Also delete the Kalkidan data on this host"
          description={
            host.status === 'connected'
              ? 'Deletes the helper, the runtime, and the agent conversations that Kalkidan saved on the host. Project folders stay.'
              : 'Connect the host first. Without a connection, the files on the host do not change.'
          }
          disabled={host.status !== 'connected'}
          checked={deleteHostData && host.status === 'connected'}
          onChange={(event) => setDeleteHostData(event.target.checked)}
        />
        {setup.removeError && (
          <p role="alert" className="field-error whitespace-pre-wrap break-words">
            {setup.removeError}
          </p>
        )}
      </ConfirmDialog>
      <AgentProgramsDialog api={api} host={host} open={programs} onOpenChange={setPrograms} />
    </>
  );
}
