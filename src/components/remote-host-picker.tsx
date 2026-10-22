import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Check, Circle, LoaderCircle, Server, X } from 'lucide-react';
import type { API, RemoteHost } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Choice } from './choice';
import { ConfirmDialog } from './confirm-dialog';
import { Hint } from './hint';
import { errorMessage } from '../lib/errors';
import { cn } from '../lib/utils';

type StepState = 'done' | 'active' | 'error' | 'pending';
type SetupStepName = 'check' | 'install' | 'connect' | '';

/** The connection state of a host in plain words, with the Badge tone. */
export const hostStatusLabels: Record<
  RemoteHost['status'],
  { label: string; tone: 'success' | 'secondary' | 'warning' | 'destructive' | 'muted' }
> = {
  connected: { label: 'Connected', tone: 'success' },
  connecting: { label: 'Connecting…', tone: 'secondary' },
  queued: { label: 'Waiting to connect', tone: 'secondary' },
  'retry-wait': { label: 'Offline', tone: 'warning' },
  error: { label: 'Connection failed', tone: 'destructive' },
  checked: { label: 'Not connected', tone: 'muted' },
  disconnected: { label: 'Disconnected', tone: 'muted' },
};

const helperPhaseText: Record<NonNullable<RemoteHost['setup']>['phase'], string> = {
  checking: 'Checking the helper…',
  installing: 'Installing the helper…',
  verifying: 'Verifying the helper…',
  ready: 'The helper is ready.',
  failed: 'Helper install failed.',
  canceled: 'Helper install canceled.',
  interrupted: 'The helper install stopped before it finished.',
  'rolled-back': 'Kalkidan restored the earlier helper.',
};

/**
 * The helper setup of a host in plain words, for example "Installing the helper…" or "Helper
 * install failed: Node.js 22 or later is necessary."
 */
export function helperSetupText(setup: NonNullable<RemoteHost['setup']>) {
  const text = helperPhaseText[setup.phase] || 'Setting up the helper…';
  if (setup.error && (setup.phase === 'failed' || setup.phase === 'interrupted'))
    return `${text.replace(/\.$/, '')}: ${setup.error}`;
  return text;
}

/** Reads the SSH hosts and reads them again when the desktop reports a change. */
export function useRemoteHosts(api: API, open = true) {
  const [hosts, setHosts] = useState<RemoteHost[]>([]);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    let active = true;
    let request = 0;
    const refresh = () => {
      const current = ++request;
      void Promise.resolve()
        .then(() => api.remoteHosts?.() ?? [])
        .then((value) => {
          if (active && current === request) {
            setHosts(value);
            setError('');
          }
        })
        .catch((e) => {
          if (active && current === request) setError(errorMessage(e));
        });
    };
    refresh();
    const unsubscribe = api.onRemoteHostsChange?.(refresh);
    return () => {
      active = false;
      unsubscribe?.();
    };
  }, [api, open]);
  return { hosts, setHosts, error };
}

/**
 * The setup actions of one SSH host: check SSH access, install the helper, connect,
 * disconnect, update the helper, and remove the host. Each host row keeps its own state.
 */
export function useHostSetup(
  api: API,
  {
    onHost,
    onRemoved,
    onBusy,
  }: {
    onHost: (host: RemoteHost) => void;
    onRemoved: (hostId: string) => void;
    onBusy?: (busy: boolean) => void;
  },
) {
  const [busy, setBusy] = useState('');
  // The setup step that runs now or that failed last.
  const [step, setStep] = useState<SetupStepName>('');
  const [error, setError] = useState('');
  const [removeError, setRemoveError] = useState('');
  /** Runs one setup action. Returns the updated host, or undefined after an error. */
  async function act(
    label: string,
    fn: () => Promise<RemoteHost>,
    kind: SetupStepName = '',
  ): Promise<RemoteHost | undefined> {
    setBusy(label);
    setStep(kind);
    onBusy?.(true);
    setError('');
    try {
      const host = await fn();
      onHost(host);
      setStep('');
      return host;
    } catch (e) {
      setError(errorMessage(e));
      return undefined;
    } finally {
      setBusy('');
      onBusy?.(false);
    }
  }
  /**
   * The guided setup: check SSH access, then connect. When the helper is missing, stop and
   * let the user agree to install it.
   */
  async function guide(start: RemoteHost) {
    let host: RemoteHost | undefined = start;
    if (host.status === 'connected') return;
    host = await act('Checking SSH access…', () => api.remoteCheck(start.id), 'check');
    if (!host || !host.version || host.status === 'connected') return;
    await act('Connecting…', () => api.remoteConnect(start.id), 'connect');
  }
  async function install(start: RemoteHost) {
    const host = await act(
      'Installing the Kalkidan helper…',
      () => api.remoteInstall(start.id),
      'install',
    );
    if (host && host.status !== 'connected')
      await act('Connecting…', () => api.remoteConnect(start.id), 'connect');
  }
  async function remove(host: RemoteHost, options?: { deleteHostData?: boolean }) {
    setBusy('Removing host…');
    onBusy?.(true);
    setRemoveError('');
    try {
      await api.remoteRemove(host.id, options);
      onRemoved(host.id);
      return true;
    } catch (e) {
      setRemoveError(errorMessage(e));
      return false;
    } finally {
      setBusy('');
      onBusy?.(false);
    }
  }
  return {
    busy,
    step,
    error,
    removeError,
    setRemoveError,
    act,
    guide,
    install,
    remove,
    reset() {
      setError('');
      setStep('');
    },
  };
}

export type HostSetupState = ReturnType<typeof useHostSetup>;

/**
 * The "Update Kalkidan helper" button and its confirmation. The update uses the setup state of
 * the host, so the busy text and the error show in the setup of that host.
 */
export function HelperUpdateButton({
  api,
  host,
  setup,
  id,
  available = false,
}: {
  api: API;
  host: RemoteHost;
  setup: HostSetupState;
  /** The element ID. A link to Settings › Computers can move the focus to it. */
  id?: string;
  /** An update is available. The button is the primary action. */
  available?: boolean;
}) {
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <Hint label="Updating the Kalkidan helper stops active work on this host">
        <Button
          id={id}
          variant={available ? 'default' : 'outline'}
          size="sm"
          disabled={!!setup.busy}
          onClick={() => setConfirm(true)}
        >
          Update Kalkidan helper
        </Button>
      </Hint>
      <ConfirmDialog
        open={confirm}
        title={`Update the Kalkidan helper on ${host.name}?`}
        description="The update stops all active work on this host. Running agent sessions stop."
        confirmLabel="Update Kalkidan helper"
        destructive
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          void setup.act('Updating the Kalkidan helper…', () => api.remoteInstall(host.id));
        }}
      />
    </>
  );
}

/**
 * The setup of one SSH host: the steps, the install prompt, the actions, the details, and the
 * connection state. `autoStart` runs the guided setup once, for a host that was just added.
 * When the parent gives `setup`, the parent shows the helper update, and the details do not.
 */
export function HostSetup({
  api,
  host,
  onHost,
  onRemoved,
  onBusy,
  setup: shared,
  autoStart = false,
  className,
}: {
  api: API;
  host: RemoteHost;
  onHost: (host: RemoteHost) => void;
  onRemoved: (hostId: string) => void;
  onBusy?: (busy: boolean) => void;
  /** The setup state from the parent, from `useHostSetup`. */
  setup?: HostSetupState;
  autoStart?: boolean;
  className?: string;
}) {
  const own = useHostSetup(api, { onHost, onRemoved, onBusy });
  const setup = shared ?? own;
  const { busy, step, error, removeError } = setup;
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const started = useRef(false);
  useEffect(() => {
    if (!autoStart || started.current) return;
    started.current = true;
    void setup.guide(host);
  }, [autoStart]);
  // The helper is missing after a successful check. The user must agree to install it.
  const needsInstall = host.status === 'checked' && !host.version;
  function stepState(name: 'check' | 'install' | 'connect'): StepState {
    if (step === name) return busy ? 'active' : error ? 'error' : 'pending';
    const connected = host.status === 'connected';
    if (name === 'check')
      return connected || host.status === 'checked' || host.version ? 'done' : 'pending';
    if (name === 'install') return connected || host.version ? 'done' : 'pending';
    return connected ? 'done' : 'pending';
  }
  return (
    <div className={cn('space-y-3', className)}>
      <ol aria-label="Setup steps" className="grid gap-1">
        <SetupStep state={stepState('check')}>Check SSH access</SetupStep>
        <SetupStep state={stepState('install')}>Install the Kalkidan helper</SetupStep>
        <SetupStep state={stepState('connect')}>Connect</SetupStep>
      </ol>
      {host.setup && host.setup.phase !== 'ready' && (
        <p
          role={host.setup.phase === 'failed' ? 'alert' : 'status'}
          className={cn(
            'text-xs',
            host.setup.phase === 'failed' ? 'field-error' : 'text-muted-foreground',
          )}
        >
          {helperSetupText(host.setup)}
        </p>
      )}
      {needsInstall && !busy && (
        <div className="panel space-y-3">
          <p className="text-sm">
            SSH works. To continue, Kalkidan installs a small helper in
            ~/.local/share/kalkidan/agents on {host.target}. The helper needs Node.js 22 or later.
          </p>
          <Button disabled={!!busy} onClick={() => void setup.install(host)}>
            Install the Kalkidan helper and connect
          </Button>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        {host.status !== 'connected' && !needsInstall && (
          <Button variant="outline" disabled={!!busy} onClick={() => void setup.guide(host)}>
            Check connection
          </Button>
        )}
        {['connected', 'connecting', 'queued', 'retry-wait'].includes(host.status) && (
          <Button variant="ghost" disabled={!!busy} onClick={() => setConfirmDisconnect(true)}>
            Disconnect
          </Button>
        )}
        <Button
          variant="ghost"
          disabled={!!busy}
          onClick={() => {
            setup.setRemoveError('');
            setConfirmRemove(true);
          }}
        >
          Remove host…
        </Button>
      </div>
      <details className="text-xs text-muted-foreground">
        <summary className="cursor-pointer">Manual setup and details</summary>
        <p className="mt-2 break-words">
          {host.target} · Requires Node.js 22 or later. Installs in ~/.local/share/kalkidan/agents.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!!busy}
            onClick={() =>
              void setup.act('Checking SSH access…', () => api.remoteCheck(host.id), 'check')
            }
          >
            Check SSH access
          </Button>
          {host.version && host.status !== 'connected' && (
            <Button
              variant="outline"
              size="sm"
              disabled={!!busy}
              onClick={() =>
                void setup.act('Connecting…', () => api.remoteConnect(host.id), 'connect')
              }
            >
              Connect host
            </Button>
          )}
          {host.version && !shared && <HelperUpdateButton api={api} host={host} setup={setup} />}
        </div>
      </details>
      {host.status === 'connected' && (
        <p role="status" className="text-xs text-success">
          Connected · {host.platform} · {host.node}
        </p>
      )}
      {host.status === 'retry-wait' && (
        <p role="status" className="text-xs text-muted-foreground">
          Connection lost. Retry {Math.min(8, (host.attempt || 0) + 1)} of 8
          {host.retryAt ? ` at ${new Date(host.retryAt).toLocaleTimeString()}` : ''}. Local projects
          remain available.
        </p>
      )}
      {host.status === 'error' && host.error && !error && (
        <p role="alert" className="field-error">
          {host.error}
        </p>
      )}
      <BusyAndError busy={busy} error={error} />
      <ConfirmDialog
        open={confirmDisconnect}
        title={`Disconnect ${host.name}?`}
        description="Disconnecting stops all active work on this host. Running agent sessions stop."
        confirmLabel="Disconnect"
        destructive
        onCancel={() => setConfirmDisconnect(false)}
        onConfirm={() => {
          setConfirmDisconnect(false);
          void setup.act('Disconnecting…', async () => {
            await api.remoteDisconnect(host.id);
            return { ...host, status: 'disconnected' };
          });
        }}
      />
      <ConfirmDialog
        open={confirmRemove}
        title={`Remove ${host.name}?`}
        description="Kalkidan forgets this host. Files on the host do not change. You cannot remove a host while a project uses it."
        confirmLabel="Remove host"
        destructive
        busy={busy === 'Removing host…'}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() =>
          void setup.remove(host).then((removed) => removed && setConfirmRemove(false))
        }
      >
        {removeError && (
          <p role="alert" className="field-error whitespace-pre-wrap break-words">
            {removeError}
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}

/** The form that adds an SSH host. It saves the host and gives it to `onAdded`. */
export function AddHostForm({
  api,
  onAdded,
  onCancel,
  onBusy,
}: {
  api: API;
  onAdded: (host: RemoteHost) => void;
  /** Shows a Cancel button. */
  onCancel?: () => void;
  onBusy?: (busy: boolean) => void;
}) {
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    // The parent dialog can hold another form. Keep this submit local.
    event.stopPropagation();
    if (busy || !target.trim()) return;
    setBusy('Saving host…');
    onBusy?.(true);
    setError('');
    try {
      onAdded(await api.remoteAdd(name.trim() || target.trim(), target.trim()));
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy('');
      onBusy?.(false);
    }
  }
  return (
    <form className="space-y-3" aria-label="Add host" onSubmit={(event) => void submit(event)}>
      <label className="form-label">
        Name (optional)
        <Input
          aria-label="Host name"
          placeholder="Development server"
          value={name}
          disabled={!!busy}
          onChange={(e) => setName(e.target.value)}
        />
      </label>
      <label className="form-label">
        SSH target
        <Input
          aria-label="SSH target"
          placeholder="dev-server or user@example.com"
          value={target}
          disabled={!!busy}
          onChange={(e) => setTarget(e.target.value)}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        Uses your SSH keys and ~/.ssh/config. After you save, Kalkidan checks the connection.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="outline" disabled={!!busy || !target.trim()}>
          Save host
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" disabled={!!busy} onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
      <BusyAndError busy={busy} error={error} />
    </form>
  );
}

/** The host chooser of Create project: choose or add a host, then set it up. */
export function RemoteHostPicker({
  api,
  value,
  onChange,
  onReady,
  onBusy,
}: {
  api: API;
  value: string;
  onChange: (id: string) => void;
  /** Called when the selected host becomes ready or stops being ready. */
  onReady: (ready: boolean) => void;
  onBusy?: (busy: boolean) => void;
}) {
  const { hosts, setHosts, error } = useRemoteHosts(api);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);
  // The host that was just added. Its setup starts at once.
  const [added, setAdded] = useState('');
  const selected = hosts.find((h) => h.id === value);
  // Report only changes, so that the parent does not do work when nothing changed.
  const reported = useRef<boolean>(undefined);
  const ready = selected?.status === 'connected';
  useEffect(() => {
    if (reported.current === ready) return;
    reported.current = ready;
    onReady(ready);
  }, [ready]);
  function store(host: RemoteHost) {
    setHosts((previous) => [...previous.filter((h) => h.id !== host.id), host]);
    onChange(host.id);
  }
  function busyChange(next: boolean) {
    setBusy(next);
    onBusy?.(next);
  }
  return (
    <section aria-label="Remote host setup" className="panel space-y-3">
      <span className="flex items-center gap-2 text-sm font-medium">
        <Server size={16} />
        Remote SSH host
      </span>
      {!!hosts.length && !adding && (
        <Choice
          className="w-full"
          label="Remote host"
          value={value}
          disabled={busy}
          onChange={(id) => {
            setAdded('');
            onChange(id);
          }}
          options={[
            { value: '', label: 'Choose a host' },
            ...hosts.map((h) => ({
              value: h.id,
              label: `${h.name} · ${hostStatusLabels[h.status].label}`,
            })),
          ]}
        />
      )}
      {!hosts.length || adding ? (
        <AddHostForm
          api={api}
          onBusy={busyChange}
          onCancel={hosts.length ? () => setAdding(false) : undefined}
          onAdded={(host) => {
            store(host);
            setAdded(host.id);
            setAdding(false);
          }}
        />
      ) : (
        <Button
          variant="link"
          size="sm"
          className="px-0"
          disabled={busy}
          onClick={() => setAdding(true)}
        >
          Add another host
        </Button>
      )}
      {selected && !adding && (
        <HostSetup
          key={selected.id}
          api={api}
          host={selected}
          autoStart={added === selected.id}
          onHost={store}
          onBusy={busyChange}
          onRemoved={(id) => {
            setHosts((previous) => previous.filter((h) => h.id !== id));
            onChange('');
          }}
        />
      )}
      {error && (
        <p role="alert" className="field-error whitespace-pre-wrap break-words">
          {error}
        </p>
      )}
    </section>
  );
}

function BusyAndError({ busy, error }: { busy: string; error: string }) {
  return (
    <>
      {!!busy && (
        <p role="status" className="flex items-center gap-2 text-xs">
          <LoaderCircle size={14} className="animate-spin" />
          {busy}
        </p>
      )}
      {error && (
        <p role="alert" className="field-error whitespace-pre-wrap break-words">
          {error}
        </p>
      )}
    </>
  );
}

/** One step of the guided host setup, with its state. */
function SetupStep({ state, children }: { state: StepState; children: string }) {
  const label = { done: 'Done', active: 'In progress', error: 'Failed', pending: 'Not started' };
  return (
    <li
      className={cn(
        'flex items-center gap-2 text-xs',
        state === 'pending' ? 'text-muted-foreground' : 'text-foreground',
      )}
    >
      <span aria-hidden="true" className="flex size-4 items-center justify-center">
        {state === 'done' ? (
          <Check className="size-3.5 text-success" />
        ) : state === 'active' ? (
          <LoaderCircle className="size-3.5 animate-spin" />
        ) : state === 'error' ? (
          <X className="size-3.5 text-destructive" />
        ) : (
          <Circle className="size-3" />
        )}
      </span>
      {children}
      <span className="sr-only">: {label[state]}</span>
    </li>
  );
}
