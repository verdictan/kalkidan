import { useEffect, useRef, useState } from 'react';
import { Check, Circle, LoaderCircle, Plus, Server, X } from 'lucide-react';
import type { API, RemoteHost } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { EmptyState } from './ui/empty-state';
import { Choice } from './choice';
import { ConfirmDialog } from './confirm-dialog';
import { Hint } from './hint';
import { errorMessage } from '../lib/errors';
import { cn } from '../lib/utils';

type StepState = 'done' | 'active' | 'error' | 'pending';

export function RemoteHostPicker({
  compact = false,
  api,
  value,
  onChange,
  onReady,
  onBusy,
}: {
  compact?: boolean;
  api: API;
  value: string;
  onChange: (id: string) => void;
  /** Called when the selected host becomes ready or stops being ready. */
  onReady: (ready: boolean) => void;
  onBusy?: (busy: boolean) => void;
}) {
  const [hosts, setHosts] = useState<RemoteHost[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState('');
  // The setup step that runs now or that failed last.
  const [step, setStep] = useState<'check' | 'install' | 'connect' | ''>('');
  const [error, setError] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [removeError, setRemoveError] = useState('');
  const selected = hosts.find((h) => h.id === value);
  useEffect(() => {
    let active = true;
    void api
      .remoteHosts?.()
      .then((value) => {
        if (active) setHosts(value);
      })
      .catch((e) => setError(errorMessage(e)));
    return () => {
      active = false;
    };
  }, [api]);
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
  /** Runs one setup action. Returns the updated host, or undefined after an error. */
  async function act(
    label: string,
    fn: () => Promise<RemoteHost>,
    kind: typeof step = '',
  ): Promise<RemoteHost | undefined> {
    setBusy(label);
    setStep(kind);
    onBusy?.(true);
    setError('');
    try {
      const host = await fn();
      store(host);
      setAdding(false);
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
  async function remove(host: RemoteHost) {
    setBusy('Removing host…');
    onBusy?.(true);
    setRemoveError('');
    try {
      await api.remoteRemove(host.id);
      setHosts((previous) => previous.filter((h) => h.id !== host.id));
      onChange('');
      setConfirmRemove(false);
    } catch (e) {
      setRemoveError(errorMessage(e));
    } finally {
      setBusy('');
      onBusy?.(false);
    }
  }
  // The helper is missing after a successful check. The user must agree to install it.
  const needsInstall = selected?.status === 'checked' && !selected.version;
  function stepState(name: 'check' | 'install' | 'connect'): StepState {
    if (!selected) return 'pending';
    if (step === name) return busy ? 'active' : error ? 'error' : 'pending';
    const connected = selected.status === 'connected';
    if (name === 'check')
      return connected || selected.status === 'checked' || selected.version ? 'done' : 'pending';
    if (name === 'install') return connected || selected.version ? 'done' : 'pending';
    return connected ? 'done' : 'pending';
  }
  const addButton = (
    <Button variant="outline" size="sm" disabled={!!busy} onClick={() => setAdding(true)}>
      <Plus />
      Add host
    </Button>
  );
  return (
    <section aria-label="Remote host setup" className={compact ? 'space-y-3' : 'panel space-y-3'}>
      {compact ? (
        <div className="flex items-center justify-between gap-4">
          <p className="text-xs text-muted-foreground">
            Run projects on another computer over SSH. Kalkidan installs a small helper on the host.
          </p>
          {!!hosts.length && !adding && addButton}
        </div>
      ) : (
        <span className="flex items-center gap-2 text-sm font-medium">
          <Server size={16} />
          Remote SSH host
        </span>
      )}
      {!hosts.length && !adding && compact && (
        <EmptyState
          compact
          className="rounded-lg border"
          title="No remote hosts"
          action={addButton}
        >
          Add a host that you can reach with SSH.
        </EmptyState>
      )}
      {!!hosts.length && !adding && (
        <Choice
          className="w-full"
          label="Remote host"
          value={value}
          disabled={!!busy}
          onChange={(id) => {
            setError('');
            setStep('');
            onChange(id);
          }}
          options={[
            { value: '', label: 'Choose a host' },
            ...hosts.map((h) => ({ value: h.id, label: `${h.name} · ${h.status}` })),
          ]}
        />
      )}
      {(!hosts.length && !compact) || adding ? (
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            // The parent dialog can hold another form. Keep this submit local.
            event.stopPropagation();
            if (busy || !target.trim()) return;
            void act('Saving host…', () =>
              api.remoteAdd(name.trim() || target.trim(), target.trim()),
            ).then((host) => host && guide(host));
          }}
        >
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
            {(!!hosts.length || compact) && (
              <Button
                type="button"
                variant="ghost"
                disabled={!!busy}
                onClick={() => setAdding(false)}
              >
                Cancel
              </Button>
            )}
          </div>
        </form>
      ) : (
        !compact && (
          <Button
            variant="link"
            size="sm"
            className="px-0"
            disabled={!!busy}
            onClick={() => setAdding(true)}
          >
            Add another host
          </Button>
        )
      )}
      {selected && !adding && (
        <>
          <ol aria-label="Setup steps" className="grid gap-1">
            <SetupStep state={stepState('check')}>Check SSH access</SetupStep>
            <SetupStep state={stepState('install')}>Install the Kalkidan helper</SetupStep>
            <SetupStep state={stepState('connect')}>Connect</SetupStep>
          </ol>
          {needsInstall && !busy && (
            <div className="panel space-y-3">
              <p className="text-sm">
                SSH works. To continue, Kalkidan installs a small helper in
                ~/.local/share/kalkidan/agents on {selected.target}. The helper needs Node.js 22 or
                later.
              </p>
              <Button disabled={!!busy} onClick={() => void install(selected)}>
                Install the Kalkidan helper and connect
              </Button>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {selected.status !== 'connected' && !needsInstall && (
              <Button variant="outline" disabled={!!busy} onClick={() => void guide(selected)}>
                Check connection
              </Button>
            )}
            {selected.status === 'connected' && (
              <Button variant="ghost" disabled={!!busy} onClick={() => setConfirmDisconnect(true)}>
                Disconnect
              </Button>
            )}
            <Button
              variant="ghost"
              disabled={!!busy}
              onClick={() => {
                setRemoveError('');
                setConfirmRemove(true);
              }}
            >
              Remove host…
            </Button>
          </div>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Manual setup and details</summary>
            <p className="mt-2">
              {selected.target} · Requires Node.js 22 or later. Installs in
              ~/.local/share/kalkidan/agents.
            </p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={!!busy}
                onClick={() =>
                  void act('Checking SSH access…', () => api.remoteCheck(selected.id), 'check')
                }
              >
                Check SSH access
              </Button>
              {selected.version && selected.status !== 'connected' && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={!!busy}
                  onClick={() =>
                    void act('Connecting…', () => api.remoteConnect(selected.id), 'connect')
                  }
                >
                  Connect host
                </Button>
              )}
              {selected.version && (
                <Hint label="Updating the Kalkidan helper stops active work on this host">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={!!busy}
                    onClick={() => setConfirmUpdate(true)}
                  >
                    Update Kalkidan helper
                  </Button>
                </Hint>
              )}
            </div>
          </details>
          {selected.status === 'connected' && (
            <p role="status" className="text-xs text-success">
              Connected · {selected.platform} · {selected.node}
            </p>
          )}
        </>
      )}
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
      {selected && (
        <ConfirmDialog
          open={confirmUpdate}
          title={`Update the Kalkidan helper on ${selected.name}?`}
          description="The update stops all active work on this host. Running agent sessions stop."
          confirmLabel="Update Kalkidan helper"
          destructive
          onCancel={() => setConfirmUpdate(false)}
          onConfirm={() => {
            setConfirmUpdate(false);
            void act('Updating the Kalkidan helper…', () => api.remoteInstall(selected.id));
          }}
        />
      )}
      {selected && (
        <ConfirmDialog
          open={confirmDisconnect}
          title={`Disconnect ${selected.name}?`}
          description="Disconnecting stops all active work on this host. Running agent sessions stop."
          confirmLabel="Disconnect"
          destructive
          onCancel={() => setConfirmDisconnect(false)}
          onConfirm={() => {
            setConfirmDisconnect(false);
            void act('Disconnecting…', async () => {
              await api.remoteDisconnect(selected.id);
              return { ...selected, status: 'disconnected' };
            });
          }}
        />
      )}
      {selected && (
        <ConfirmDialog
          open={confirmRemove}
          title={`Remove ${selected.name}?`}
          description="Kalkidan forgets this host. Files on the host do not change. You cannot remove a host while a project uses it."
          confirmLabel="Remove host"
          destructive
          busy={busy === 'Removing host…'}
          onCancel={() => setConfirmRemove(false)}
          onConfirm={() => void remove(selected)}
        >
          {removeError && (
            <p role="alert" className="field-error whitespace-pre-wrap break-words">
              {removeError}
            </p>
          )}
        </ConfirmDialog>
      )}
    </section>
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
