import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Bot, Download, RotateCw, Server, Trash2, Unplug } from 'lucide-react';
import { agentCatalog } from '../config/agents';
import type { API, RemoteHost } from '../types';
import type { ComponentUpdateStatus, HelperUpdateStatus } from '../domain/updates';
import { computerAnchor, helperUpdateAnchor } from '../domain/settings-route';
import { helperStatusLabel, shortId } from '../lib/verdictan-labels';
import { errorMessage } from '../lib/errors';
import { useRefreshTriggers } from '../hooks/use-refresh-triggers';
import { helperSetupText, hostStatusLabels, useHostSetup } from './remote-host-picker';
import {
  RuntimeControl,
  RuntimeExtra,
  runtimeExtraShown,
  runtimeView,
  useRuntimeStatus,
} from './verdictan-settings';
import { AgentProgramsDialog } from './agent-programs';
import { ComputerAgentRow } from './computer-agent';
import { ConfirmDialog } from './confirm-dialog';
import { CopyValue, SettingsDisclosure, SettingsRow, StatusText } from './settings-disclosure';
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
import { Input } from './ui/input';
import { MoreButton } from './ui/more-button';

/**
 * The update state of the helper on each SSH host, by host ID. It reads again when a host
 * changes, when the section opens, and on window focus.
 */
export function useHelperUpdates(api: API, open: boolean, hosts: RemoteHost[]) {
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
 * The inline form of "Add SSH host": one field for the SSH target, Add, and Cancel. The new host
 * shows as a row at once and checks its connection in the row. Escape cancels.
 */
export function AddHostForm({
  api,
  onAdded,
  onCancel,
}: {
  api: API;
  onAdded: (host: RemoteHost) => void;
  onCancel: () => void;
}) {
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    const value = target.trim();
    if (busy || !value) return;
    setBusy(true);
    setError('');
    try {
      onAdded(await api.remoteAdd(value, value));
      setTarget('');
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="computers-add">
      <form
        className="computers-add-form"
        aria-label="Add SSH host"
        onSubmit={(event) => void submit(event)}
        onKeyDown={(event) => {
          if (event.key !== 'Escape' || busy) return;
          // Escape closes the form, not the Settings window.
          event.stopPropagation();
          onCancel();
        }}
      >
        <Input
          aria-label="SSH target"
          placeholder="user@host or a name from ~/.ssh/config"
          value={target}
          disabled={busy}
          autoFocus
          aria-invalid={!!error || undefined}
          onChange={(event) => {
            setTarget(event.target.value);
            setError('');
          }}
        />
        <Button type="submit" size="sm" variant="outline" disabled={busy || !target.trim()}>
          {busy ? 'Adding…' : 'Add'}
        </Button>
        <Button type="button" size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </form>
      {error && (
        <p role="alert" className="field-error whitespace-pre-wrap break-words">
          {error}
        </p>
      )}
    </div>
  );
}

/** @deprecated Use `AddHostForm` behind an "Add SSH host" button. */
export function AddHostRow({ api, onAdded }: { api: API; onAdded: (host: RemoteHost) => void }) {
  return (
    <li>
      <AddHostForm api={api} onAdded={onAdded} onCancel={() => {}} />
    </li>
  );
}

/** "Codex 0.164.0 · Claude Code 2.1.301": the coding agents that the last check found on a host. */
export function hostAgentsText(host: RemoteHost) {
  const agents = host.agentCheck?.agents || [];
  return agents
    .filter((item) => item.status === 'installed')
    .map((item) =>
      [agentCatalog.find((entry) => entry.id === item.agent)?.name || item.agent, item.version]
        .filter(Boolean)
        .join(' '),
    )
    .join(' · ');
}

/** The helper builds and digests of one host, for the Details fold. */
export function HelperDetails({ host, helper }: { host: RemoteHost; helper?: HelperUpdateStatus }) {
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
 * The managed runtime line of a connected host, only while the host checks for an update. A
 * host checks its runtime each time it connects, and a newer signed release installs without a
 * chat. A ready runtime needs no line. The row shows a problem below it.
 */
function hostRuntimeText(status: ComponentUpdateStatus | undefined) {
  return status?.discovery === 'checking' ? 'Checking managed agents for updates…' : '';
}

/** The help line of a host row. A connected host also shows its managed runtime. */
function hostHelp(host: RemoteHost, busy: string, runtime = '') {
  if (busy) return busy;
  if (host.setup && !['ready', 'failed'].includes(host.setup.phase))
    return helperSetupText(host.setup);
  switch (host.status) {
    case 'connected': {
      // The versions of the coding agents, as on the rows of this computer. Without an agent
      // check, the system of the host.
      const line =
        hostAgentsText(host) ||
        [host.platform, host.node ? `Node.js ${host.node}` : ''].filter(Boolean).join(' · ');
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
      // One short line. The full error is in Details under the row.
      return host.setup?.phase === 'failed' ? 'The helper setup failed.' : 'Connection failed.';
    default:
      return '';
  }
}

/**
 * One SSH host: the SSH target, the versions of its coding agents, the status, and a "…" menu
 * with its actions. The group label above it is the name of the host. `autoStart` checks the
 * connection once, for a host that was just added.
 */
export function HostRow({
  api,
  open,
  host,
  helper,
  autoStart = false,
  onHost,
  onRemoved,
}: {
  api: API;
  open: boolean;
  host: RemoteHost;
  helper?: HelperUpdateStatus;
  autoStart?: boolean;
  onHost: (host: RemoteHost) => void;
  onRemoved: (hostId: string) => void;
}) {
  const setup = useHostSetup(api, { onHost, onRemoved });
  const started = useRef(false);
  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    void setup.guide(host);
  }, [autoStart]);
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
  // The full reason of a failed connection, when the row does not already show it.
  const reason =
    host.status === 'error'
      ? host.setup?.phase === 'failed'
        ? helperSetupText(host.setup)
        : host.error || ''
      : '';
  const details = reason && reason !== setup.error ? reason : '';
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
        label={host.target || host.name}
        help={hostHelp(host, setup.busy, runtimeNeedsUser ? '' : hostRuntimeText(runtime.status))}
        extra={
          setup.error ||
          details ||
          runtimeNeedsUser ||
          (host.status === 'checked' && !host.version) ? (
            <div className="grid gap-2">
              {host.status === 'checked' && !host.version && !setup.busy && (
                <div className="flex flex-wrap items-center gap-2">
                  <p className="form-help mt-0 flex-1">
                    SSH works. Install the Kalkidan helper to connect. It needs Node.js 22 or later.
                  </p>
                  <Button variant="outline" size="sm" onClick={() => void setup.install(host)}>
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
              {details && (
                <SettingsDisclosure title="Details">
                  <p className="form-help mt-0 whitespace-pre-wrap break-words">{details}</p>
                </SettingsDisclosure>
              )}
            </div>
          ) : undefined
        }
      >
        <StatusText status={status} />
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
          <DropdownMenuContent align="end">
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
              Coding agent programs…
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
      <ComputerAgentRow api={api} open={open} computer={host.id} name={host.name} />
      <ConfirmDialog
        open={confirm === 'disconnect'}
        title={`Disconnect ${host.name}?`}
        description="Disconnecting stops all active work on this host. Running chats stop."
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
        description="The update stops all active work on this host. Running chats stop."
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
