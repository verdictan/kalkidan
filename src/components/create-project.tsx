import { FolderPicker } from './folder-picker';
import { interfaceConfig } from '../config/interface';
import { useTracker } from '../hooks/use-tracker';
import { RemoteHostPicker } from './remote-host-picker';
import { Choice } from './choice';
import { useEffect, useId, useRef, useState } from 'react';
import type { API, TrackerAuthState, ProjectGroup } from '../types';
import { TrackerProjectPicker } from './tracker-project-picker';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { SectionHeader } from './ui/page-header';
import { SegmentedControl } from './ui/segmented-control';
import {
  Dialog,
  DialogBody,
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
  const [rootPath, setRootPath] = useState('');
  const [url, setUrl] = useState('');
  // The tracker is optional. "later" creates the project without one.
  const [tracker, setTracker] = useState<'later' | 'connect'>('later');
  const connecting = tracker === 'connect';
  const formId = useId();
  const reasonId = useId();
  const [creating, setCreating] = useState(false);
  const [hostBusy, setHostBusy] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
  const busy = creating || hostBusy || pickerBusy;
  const [error, setError] = useState('');
  const [auth, setAuth] = useState<TrackerAuthState>({ status: 'idle' });
  // True after the user starts sign-in here. Closing the dialog then cancels it.
  const started = useRef(false);
  async function authorize() {
    started.current = true;
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
      setRootPath('');
      setLocation('local');
      setHostId('');
      setHostReady(false);
      setTracker('later');
    }
  }, [open]);
  useEffect(() => {
    if (!open || !ready || !connecting) return;
    setUrl('');
    setError('');
    let active = true;
    started.current = false;
    // Only read the current access. Sign-in starts when the user asks for it.
    setAuth({ status: 'checking' });
    void Promise.resolve()
      .then(() => client.authStatus())
      .then((value) => {
        if (active) setAuth(value);
      })
      .catch(() => {
        if (active) setAuth({ status: 'idle' });
      });
    return () => {
      active = false;
      if (started.current) void client.cancelAuth();
    };
  }, [open, client, ready, connecting]);
  useEffect(() => {
    if (!open || !connecting || !started.current || !['checking', 'waiting'].includes(auth.status))
      return;
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
  }, [open, connecting, auth.status, client]);
  async function create() {
    if (busy || blocked) return;
    setCreating(true);
    setError('');
    try {
      const id = await api.createGroup(
        name.trim(),
        connecting ? url : '',
        location === 'remote' ? hostId : undefined,
        provider,
        rootPath.trim() || undefined,
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
  // Tells the user why Create project is not available yet.
  const blocked = !name.trim()
    ? 'Enter a project name.'
    : location === 'remote' && (!hostId || !hostReady)
      ? 'Connect the remote host first.'
      : connecting && auth.status !== 'ready'
        ? `Connect ${providerName}, or choose Connect later.`
        : connecting && !url
          ? `Choose a ${providerName} project, or choose Connect later.`
          : '';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" layout="scroll">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription>
            A project keeps repositories, docs, and agent sessions together. You can connect a
            tracker now or later.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid content-start gap-4">
          {/* The fields use the form attribute, so that the remote host form is not nested. */}
          <form
            id={formId}
            hidden
            onSubmit={(event) => {
              event.preventDefault();
              void create();
            }}
          />
          <label className="form-label">
            Project name
            <Input
              autoFocus
              form={formId}
              aria-label="Project name"
              maxLength={150}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Customer platform"
            />
          </label>
          <div className="form-label">
            <span>Where work runs</span>
            <Choice
              className="w-full"
              label="Project execution host"
              disabled={busy}
              value={location}
              onChange={setLocation}
              options={[
                { value: 'local', label: 'This computer' },
                { value: 'remote', label: 'Remote SSH host' },
              ]}
            />
            <span className="text-xs font-normal">
              Repositories and agent sessions stay on the selected machine.
            </span>
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
          <div className="form-label">
            <label htmlFor="project-root-folder">Project folder</label>
            <div className="relative">
              <Input
                id="project-root-folder"
                form={formId}
                aria-label="Project folder"
                className="pr-9"
                value={rootPath}
                disabled={busy}
                onChange={(e) => setRootPath(e.target.value)}
                placeholder="~/.kalkidan/projects/ (automatic)"
              />
              <FolderPicker
                api={api}
                value={rootPath}
                hostId={location === 'remote' ? hostId : undefined}
                className="absolute top-0.5 right-0.5"
                disabled={busy || (location === 'remote' && (!hostId || !hostReady))}
                onSelect={setRootPath}
              />
            </div>
            <span className="text-xs font-normal">
              Docs, cloned repositories, and worktrees are stored here on the selected machine.
              Leave blank to create a dedicated folder automatically.
            </span>
          </div>
          <section aria-label="Tracker" className="grid gap-3">
            <SectionHeader className="mb-0 min-h-0" title="Tracker (optional)" />
            <SegmentedControl
              className="justify-self-start"
              label="Tracker connection"
              value={tracker}
              onChange={(value) => {
                setTracker(value);
                setUrl('');
              }}
              options={[
                { value: 'later', label: 'Connect later', disabled: busy },
                { value: 'connect', label: `Use ${providerName}`, disabled: busy },
              ]}
            />
            {!connecting ? (
              <p className="text-xs text-muted-foreground">
                The project has no task board yet. Connect a {providerName} project from the project
                page when you need one.
              </p>
            ) : (
              <>
                {providers.length > 1 && (
                  <label className="form-label">
                    Project tracker
                    <Choice
                      label="Project tracker"
                      value={provider}
                      disabled={busy}
                      onChange={setProvider}
                      options={providers.map((p) => ({ value: p.id, label: p.name }))}
                    />
                  </label>
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
                  <div className="panel space-y-3" aria-live="polite">
                    <p className="text-sm">
                      {auth.status === 'checking'
                        ? `Checking ${providerName} access…`
                        : auth.status === 'waiting'
                          ? 'Approve Projects access in your browser to continue.'
                          : auth.message ||
                            `Connect ${providerName} to choose a project for tasks. Your browser opens to approve access.`}
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
                        : auth.status === 'error'
                          ? `Try ${providerName} again`
                          : `Connect ${providerName}`}
                    </Button>
                  </div>
                )}
              </>
            )}
          </section>
          {(error || (connecting && providerError)) && (
            <p role="alert" className="field-error">
              {error || providerError}
            </p>
          )}
        </DialogBody>
        <DialogFooter className="sm:items-center">
          <p id={reasonId} aria-live="polite" className="text-xs text-muted-foreground sm:mr-auto">
            {blocked}
          </p>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            aria-describedby={blocked ? reasonId : undefined}
            disabled={busy || !!blocked}
          >
            {creating ? 'Creating…' : 'Create project'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
