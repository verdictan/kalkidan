import { interfaceConfig } from '../config/interface';
import { useTracker } from '../hooks/use-tracker';
import { RemoteHostPicker } from './remote-host-picker';
import { Choice } from './choice';
import { useEffect, useState } from 'react';
import type { API, TrackerAuthState, ProjectGroup } from '../types';
import { TrackerProjectPicker } from './tracker-project-picker';
import { Button } from './ui/button';
import { Input } from './ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';

export function CreateProject({
  api,
  open,
  onOpenChange,
  onCreated,
}: {
  api: API;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (group: ProjectGroup) => Promise<void>;
}) {
  const [chosenProvider, setProvider] = useState('');
  const {
    client,
    providers,
    provider,
    ready,
    error: providerError,
    name: providerName,
  } = useTracker(api, chosenProvider);
  const [location, setLocation] = useState('local');
  const [hostId, setHostId] = useState('');
  const [hostReady, setHostReady] = useState(false);
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [creating, setCreating] = useState(false);
  const [hostBusy, setHostBusy] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
  const busy = creating || hostBusy || pickerBusy;
  const [error, setError] = useState('');
  const [auth, setAuth] = useState<TrackerAuthState>({ status: 'idle' });
  async function authorize() {
    setAuth({ status: 'checking' });
    try {
      setAuth(await client.authorize());
    } catch (e) {
      setAuth({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }
  useEffect(() => {
    if (open) {
      setName('');
      setLocation('local');
      setHostId('');
      setHostReady(false);
    }
  }, [open]);
  useEffect(() => {
    if (!open || !ready) return;
    setUrl('');
    setError('');
    let active = true;
    setAuth({ status: 'checking' });
    void client
      .authorize()
      .then((value) => {
        if (active) setAuth(value);
      })
      .catch((e) => {
        if (active) setAuth({ status: 'error', message: e.message });
      });
    return () => {
      active = false;
      void client.cancelAuth();
    };
  }, [open, client, ready]);
  useEffect(() => {
    if (!open || !['checking', 'waiting'].includes(auth.status)) return;
    let active = true;
    const timer = setInterval(() => {
      void client
        .authStatus()
        .then((value) => {
          if (active) setAuth(value);
        })
        .catch((e) => {
          if (active) setAuth({ status: 'error', message: e.message });
        });
    }, interfaceConfig.authPollMs);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [open, auth.status, client]);
  async function create() {
    setCreating(true);
    setError('');
    try {
      const id = await api.createGroup(
        name.trim(),
        url,
        location === 'remote' ? hostId : undefined,
        provider,
      );
      const snapshot = await api.snapshot();
      const group = snapshot.groups?.find((g) => g.id === id);
      if (!group) throw new Error('Project created. Refresh the project list to open it.');
      onOpenChange(false);
      await onCreated(group);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(value) => !busy && onOpenChange(value)}>
      <DialogContent className="max-h-[calc(100dvh-48px)] overflow-y-auto sm:max-w-xl">
        <DialogHeader className="pr-6">
          <DialogTitle>Create project</DialogTitle>
          <DialogDescription>
            Choose or create a {providerName} project, then bring its repositories and conversations
            together.
          </DialogDescription>
        </DialogHeader>
        {providers.length > 1 && (
          <Choice
            label="Project tracker"
            value={provider}
            disabled={busy}
            onChange={setProvider}
            options={providers.map((p) => ({ value: p.id, label: p.name }))}
          />
        )}
        <label className="form-label">
          Project name
          <Input
            autoFocus
            aria-label="Project name"
            maxLength={150}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Customer platform"
          />
        </label>
        <div className="space-y-2">
          <p className="text-sm font-medium">Where work runs</p>
          <Choice
            className="w-full"
            label="Project execution host"
            disabled={busy}
            value={location}
            onChange={setLocation}
            options={[
              { value: 'local', label: 'This Mac' },
              { value: 'remote', label: 'Remote SSH host' },
            ]}
          />
          <p className="text-xs text-muted-foreground">
            Repositories and agent sessions stay on the selected machine.
          </p>
        </div>
        {location === 'remote' && (
          <RemoteHostPicker
            api={api}
            value={hostId}
            onChange={setHostId}
            onReady={setHostReady}
            onBusy={setHostBusy}
          />
        )}
        {auth.status === 'ready' ? (
          <TrackerProjectPicker
            key={provider}
            provider={provider}
            api={api}
            defaultTitle={name || 'New project'}
            value={url}
            onChange={setUrl}
            onBusy={setPickerBusy}
          />
        ) : (
          <div className="space-y-3 rounded-lg border p-4" aria-live="polite">
            <p className="text-sm">
              {auth.status === 'checking'
                ? `Checking ${providerName} access…`
                : auth.status === 'waiting'
                  ? 'Approve Projects access in your browser to continue.'
                  : auth.message || `Connect ${providerName} to choose a project.`}
            </p>
            {auth.code && (
              <Input aria-label="Authorization device code" readOnly value={auth.code} />
            )}
            <Button
              variant="outline"
              disabled={auth.status === 'checking'}
              onClick={() =>
                void (auth.status === 'waiting'
                  ? client.openAuth().catch((e) => setError(e.message))
                  : authorize())
              }
            >
              {auth.status === 'waiting'
                ? `Open ${providerName}`
                : `Retry ${providerName} authorization`}
            </Button>
          </div>
        )}
        {(error || providerError) && (
          <p role="alert" className="text-sm text-destructive">
            {error || providerError}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={
              busy ||
              !name.trim() ||
              !url ||
              auth.status !== 'ready' ||
              (location === 'remote' && (!hostId || !hostReady))
            }
            onClick={() => void create()}
          >
            {creating ? 'Creating…' : 'Create project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
