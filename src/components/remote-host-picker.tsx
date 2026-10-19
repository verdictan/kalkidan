import { useEffect, useState } from 'react';
import { LoaderCircle, Server, Plus } from 'lucide-react';
import type { API, RemoteHost } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Choice } from './choice';
import { ConfirmDialog } from './confirm-dialog';
import { Hint } from './hint';
import { SectionHeader } from './ui/page-header';
import { errorMessage } from '../lib/errors';
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
  onReady: (ready: boolean) => void;
  onBusy?: (busy: boolean) => void;
}) {
  const [hosts, setHosts] = useState<RemoteHost[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [target, setTarget] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [confirmUpdate, setConfirmUpdate] = useState(false);
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
  useEffect(() => onReady(selected?.status === 'connected'), [selected?.status, selected?.id]);
  async function act(label: string, fn: () => Promise<RemoteHost>) {
    setBusy(label);
    onBusy?.(true);
    setError('');
    try {
      const host = await fn();
      setHosts((previous) => [...previous.filter((h) => h.id !== host.id), host]);
      onChange(host.id);
      setAdding(false);
    } catch (e) {
      setError(errorMessage(e));
      onReady(false);
    } finally {
      setBusy('');
      onBusy?.(false);
    }
  }
  return (
    <section aria-label="Remote host setup" className={compact ? 'space-y-3' : 'panel space-y-3'}>
      {compact ? (
        <SectionHeader
          className="mb-0"
          title="Remote hosts"
          actions={
            !adding && (
              <Button variant="ghost" disabled={!!busy} onClick={() => setAdding(true)}>
                <Plus />
                Add host
              </Button>
            )
          }
        />
      ) : (
        <span className="flex items-center gap-2 text-sm font-medium">
          <Server size={16} />
          Remote SSH host
        </span>
      )}
      {compact && (
        <p className="text-xs text-muted-foreground">
          Run projects on another computer over SSH. Kalkidan installs a small helper on the host.
        </p>
      )}
      {!hosts.length && !adding && compact && (
        <p className="text-xs text-muted-foreground">No remote hosts connected.</p>
      )}
      {!!hosts.length && !adding && (
        <Choice
          className="w-full"
          label="Remote host"
          value={value}
          disabled={!!busy}
          onChange={onChange}
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
            );
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
          <p className="text-xs text-muted-foreground">Uses your SSH keys and ~/.ssh/config.</p>
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
            className="h-auto px-0"
            disabled={!!busy}
            onClick={() => setAdding(true)}
          >
            Add another host
          </Button>
        )
      )}
      {selected && !adding && (
        <>
          <p className="text-xs text-muted-foreground">
            {selected.status === 'connected'
              ? 'Connected'
              : selected.version
                ? 'Kalkidan helper installed · Ready to connect'
                : selected.status === 'checked'
                  ? 'SSH ready · Install the Kalkidan helper to continue'
                  : 'Check SSH access to continue'}
          </p>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Connection details</summary>
            <p className="mt-2">
              {selected.target} · Requires Node.js 22+. Installs in ~/.local/share/kalkidan/agents.
            </p>
          </details>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={!!busy}
              onClick={() => void act('Checking SSH…', () => api.remoteCheck(selected.id))}
            >
              Check connection
            </Button>
            {selected.status === 'checked' && !selected.version && (
              <Button
                disabled={!!busy}
                onClick={() =>
                  void act('Installing Kalkidan helper…', () => api.remoteInstall(selected.id))
                }
              >
                Install Kalkidan helper and connect
              </Button>
            )}
            {selected.version && selected.status !== 'connected' && (
              <Button
                disabled={!!busy}
                onClick={() => void act('Connecting…', () => api.remoteConnect(selected.id))}
              >
                Connect host
              </Button>
            )}
            {selected.version && (
              <Hint label="Updating the Kalkidan helper stops active work on this host">
                <Button variant="ghost" disabled={!!busy} onClick={() => setConfirmUpdate(true)}>
                  Update Kalkidan helper
                </Button>
              </Hint>
            )}
            {selected.status === 'connected' && (
              <Button variant="ghost" disabled={!!busy} onClick={() => setConfirmDisconnect(true)}>
                Disconnect
              </Button>
            )}
          </div>
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
        <p role="alert" className="whitespace-pre-wrap break-words text-xs text-destructive">
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
            void act('Updating Kalkidan helper…', () => api.remoteInstall(selected.id));
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
    </section>
  );
}
