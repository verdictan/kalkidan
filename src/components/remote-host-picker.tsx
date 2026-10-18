import { useEffect, useState } from 'react';
import { LoaderCircle, Server, Plus } from 'lucide-react';
import type { API, RemoteHost } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Choice } from './choice';
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
  const selected = hosts.find((h) => h.id === value);
  useEffect(() => {
    let active = true;
    void api
      .remoteHosts?.()
      .then((value) => {
        if (active) setHosts(value);
      })
      .catch((e) => setError(e.message));
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
      setError(e instanceof Error ? e.message : String(e));
      onReady(false);
    } finally {
      setBusy('');
      onBusy?.(false);
    }
  }
  return (
    <section aria-label="Remote host setup" className="space-y-3 rounded-lg border p-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-sm font-medium">
          <Server size={16} />
          Remote SSH host
        </span>
        {compact && !adding && (
          <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setAdding(true)}>
            <Plus size={14} />
            Add host
          </Button>
        )}
      </div>
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
        <>
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
          <Button
            variant="outline"
            size="sm"
            disabled={!!busy || !target.trim()}
            onClick={() =>
              void act('Saving host…', () =>
                api.remoteAdd(name.trim() || target.trim(), target.trim()),
              )
            }
          >
            Save host
          </Button>
          {(!!hosts.length || compact) && (
            <Button variant="ghost" size="sm" disabled={!!busy} onClick={() => setAdding(false)}>
              Cancel host
            </Button>
          )}
        </>
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
          <p className="text-xs text-muted-foreground">
            {selected.status === 'connected'
              ? 'Connected'
              : selected.version
                ? 'Agent installed · Ready to connect'
                : selected.status === 'checked'
                  ? 'SSH ready · Install the agent to continue'
                  : 'Check SSH access to continue'}
          </p>
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Connection details</summary>
            <p className="mt-2">
              {selected.target} · Requires Node.js 22+. Installs in ~/.local/share/kalkidan/agents.
              Disconnecting or updating stops active work.
            </p>
          </details>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={!!busy}
              onClick={() => void act('Checking SSH…', () => api.remoteCheck(selected.id))}
            >
              Check connection
            </Button>
            {selected.status === 'checked' && !selected.version && (
              <Button
                size="sm"
                disabled={!!busy}
                onClick={() => void act('Installing agent…', () => api.remoteInstall(selected.id))}
              >
                Install agent & connect
              </Button>
            )}
            {selected.version && selected.status !== 'connected' && (
              <Button
                size="sm"
                disabled={!!busy}
                onClick={() => void act('Connecting…', () => api.remoteConnect(selected.id))}
              >
                Connect host
              </Button>
            )}
            {selected.version && (
              <Button
                variant="ghost"
                size="sm"
                disabled={!!busy}
                onClick={() => void act('Updating agent…', () => api.remoteInstall(selected.id))}
              >
                Update agent
              </Button>
            )}
            {selected.status === 'connected' && (
              <Button
                variant="ghost"
                size="sm"
                disabled={!!busy}
                onClick={() =>
                  void act('Disconnecting…', async () => {
                    await api.remoteDisconnect(selected.id);
                    return { ...selected, status: 'disconnected' };
                  })
                }
              >
                Disconnect
              </Button>
            )}
          </div>
          {selected.status === 'connected' && (
            <p role="status" className="text-xs text-emerald-400">
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
    </section>
  );
}
