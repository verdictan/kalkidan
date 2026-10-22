import { FolderPicker } from './folder-picker';
import { interfaceConfig } from '../config/interface';
import { useTracker } from '../hooks/use-tracker';
import { RemoteHostPicker } from './remote-host-picker';
import { Choice } from './choice';
import { useEffect, useId, useState, useRef } from 'react';
import { ChevronRight, FolderOpen, X } from 'lucide-react';
import type { API, TrackerAuthState, ProjectGroup } from '../types';
import { trackerAuthPending } from '../domain/tracker';
import { TrackerProjectPicker, boardLabel } from './tracker-project-picker';
import {
  codeFolders,
  folderName,
  showFolderImportResult,
  useFolderImport,
  type FolderImport,
} from './repository-import';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { SectionHeader } from './ui/page-header';
import { SegmentedControl } from './ui/segmented-control';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';
import { Hint } from './hint';
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
  const creation = useRef<{ id: string; args: Parameters<API['createGroup']> } | null>(null);
  const [recovering, setRecovering] = useState(false);
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
  const [more, setMore] = useState(false);
  // The code folders to add after the project is created.
  const [folders, setFolders] = useState<FolderImport | null>(null);
  const folderImport = useFolderImport(api, `${open}:${location}:${hostId}`);
  const board = boardLabel(providerName);
  // The tracker is optional. "later" creates the project without one.
  const [tracker, setTracker] = useState<'later' | 'connect'>('later');
  const connecting = tracker === 'connect';
  const formId = useId();
  const nameErrorId = useId();
  // The name error shows after the user leaves the field or tries to create the project.
  const [nameTouched, setNameTouched] = useState(false);
  // True after a try to create the project while something else blocks it.
  const [tried, setTried] = useState(false);
  const [creating, setCreating] = useState(false);
  const [hostBusy, setHostBusy] = useState(false);
  const [pickerBusy, setPickerBusy] = useState(false);
  const busy = creating || hostBusy || pickerBusy;
  const [error, setError] = useState('');
  const [auth, setAuth] = useState<TrackerAuthState>({ status: 'idle' });
  useEffect(() => {
    if (open) {
      setName('');
      setRootPath('');
      setLocation('local');
      setHostId('');
      setHostReady(false);
      setTracker('later');
      setMore(false);
      setFolders(null);
      setNameTouched(false);
      setTried(false);
      setError('');
    }
  }, [open]);
  useEffect(() => {
    if (!open) return;
    try {
      const saved = localStorage.getItem('kalkidan-create-project');
      if (!saved) return;
      const value = JSON.parse(saved);
      if (!Array.isArray(value.args) || typeof value.id !== 'string')
        throw new Error('Invalid project recovery request.');
      for (const index of [2, 4, 6]) if (value.args[index] === null) value.args[index] = undefined;
      creation.current = value;
      setRecovering(true);
      const [title, reference, host, trackerProvider, root] = value.args;
      setName(title);
      setUrl(reference || '');
      setHostId(host || '');
      setLocation(host ? 'remote' : 'local');
      setProvider(trackerProvider || 'github');
      setRootPath(root || '');
      setTracker(reference ? 'connect' : 'later');
      setError('A project setup is unfinished. Submit to resume the original request.');
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    }
  }, [open]);
  // True after the user starts sign-in here. Closing the dialog then cancels it.
  async function authorize() {
    setAuth({ status: 'checking' });
    try {
      setAuth(await client.authorize());
    } catch (e) {
      setAuth({ status: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }
  async function chooseFolder() {
    setError('');
    try {
      const result = await folderImport.choose('Choose a code folder', 'Choose');
      if (!result) return;
      setFolders(result);
      setName((current) => current || folderName(result.root));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }
  useEffect(() => {
    if (!open || !ready || !connecting) return;
    if (!creation.current) {
      setUrl('');
      setError('');
    }
    let active = true;
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
    };
  }, [open, client, ready, connecting]);
  useEffect(() => {
    if (!open || !connecting || !trackerAuthPending(auth)) return;
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
    if (busy) return;
    if (!creation.current && blocked) {
      // Show why the project cannot be created yet, next to the field that needs a change.
      setNameTouched(true);
      setTried(true);
      return;
    }
    setCreating(true);
    setError('');
    try {
      if (!creation.current) {
        const saved = localStorage.getItem('kalkidan-create-project');
        creation.current = saved
          ? JSON.parse(saved)
          : {
              id: crypto.randomUUID(),
              args: [
                name.trim(),
                connecting ? url : '',
                location === 'remote' ? hostId : undefined,
                provider,
                rootPath.trim() || undefined,
              ],
            };
        if (!creation.current || !Array.isArray(creation.current.args))
          throw new Error('Invalid project recovery request.');
        creation.current.args[5] = creation.current.id;
        if (!saved) creation.current.args[6] = location === 'local' ? folders?.paths : undefined;
        localStorage.setItem('kalkidan-create-project', JSON.stringify(creation.current));
        setRecovering(true);
      }
      const id = await api.createGroup(...creation.current.args);
      const snapshot = await api.snapshot();
      const group = snapshot.groups?.find((g) => g.id === id);
      if (!group) throw new Error('Project created. Refresh the project list to open it.');
      const requested = creation.current.args[6];
      await onCreated(group);
      if (requested?.length) showFolderImportResult(group.name, group.repoIds.length);
      localStorage.removeItem('kalkidan-create-project');
      creation.current = null;
      setRecovering(false);
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCreating(false);
    }
  }
  // Why the project cannot be created yet. It shows only after a try or after the name field.
  const blocked = !name.trim()
    ? 'Enter a project name.'
    : location === 'remote' && (!hostId || !hostReady)
      ? 'Connect the remote host first.'
      : connecting && auth.status !== 'ready'
        ? `Connect ${providerName}, or choose Connect later.`
        : connecting && !url
          ? `Choose a ${board}, or choose Connect later.`
          : '';
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" layout="scroll">
        <DialogHeader>
          <DialogTitle>New project</DialogTitle>
          <DialogDescription className="sr-only">
            A project keeps your code folders, docs, and agent chats together.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid content-start gap-4">
          {recovering && (
            <div className="grid gap-2 rounded border p-3">
              <p>
                Resume setup for <strong>{creation.current?.args[0]}</strong>. Completed steps are
                not repeated.
              </p>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  try {
                    localStorage.removeItem('kalkidan-create-project');
                    creation.current = null;
                    setRecovering(false);
                    setError('');
                  } catch {
                    setError('Could not clear the local recovery request.');
                  }
                }}
              >
                Start a different request (keep existing files)
              </Button>
            </div>
          )}
          <fieldset disabled={busy || recovering} className="contents">
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
                aria-invalid={nameTouched && !name.trim() ? true : undefined}
                aria-describedby={nameTouched && !name.trim() ? nameErrorId : undefined}
                onBlur={() => setNameTouched(true)}
                onChange={(e) => setName(e.target.value)}
                placeholder="Customer platform"
              />
              {nameTouched && !name.trim() && (
                <span id={nameErrorId} className="field-error">
                  Enter a project name.
                </span>
              )}
            </label>
            {folderImport.supported && location === 'local' && (
              <div className="form-label">
                <span id={`${formId}-folder`}>Code folder</span>
                {folders ? (
                  <div className="flex min-w-0 items-center gap-2 rounded-md border px-3 py-1.5">
                    <FolderOpen
                      className="size-4 shrink-0 text-muted-foreground"
                      aria-hidden="true"
                    />
                    <Hint label={folders.root}>
                      <span
                        tabIndex={0}
                        className="min-w-0 flex-1 truncate text-sm text-foreground"
                      >
                        {codeFolders(folders.paths.length)} from {folderName(folders.root)}
                      </span>
                    </Hint>
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={busy}
                      onClick={() => void chooseFolder()}
                    >
                      Change
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="Remove code folder"
                      disabled={busy}
                      onClick={() => setFolders(null)}
                    >
                      <X />
                    </Button>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    className="justify-self-start"
                    aria-describedby={`${formId}-folder`}
                    disabled={busy}
                    onClick={() => void chooseFolder()}
                  >
                    <FolderOpen /> Add code folder…
                  </Button>
                )}
              </div>
            )}
            <Collapsible open={more} onOpenChange={setMore} className="grid gap-4">
              <CollapsibleTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="-ml-2 justify-self-start text-muted-foreground [&[data-state=open]>svg]:rotate-90"
                >
                  <ChevronRight className="transition-transform" />
                  More options
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent className="grid gap-4">
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
                </div>
                <section aria-label={board} className="grid gap-3">
                  <SectionHeader size="sm" title={`${board} (optional)`} />
                  <SegmentedControl
                    className="justify-self-start"
                    label={`${board} connection`}
                    value={tracker}
                    onChange={(value) => {
                      setTracker(value);
                      setUrl('');
                    }}
                    options={[
                      { value: 'later', label: 'Connect later', disabled: busy },
                      { value: 'connect', label: 'Connect now', disabled: busy },
                    ]}
                  />
                  {connecting && (
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
                            {['checking', 'verifying'].includes(auth.status)
                              ? `Checking ${providerName} access…`
                              : auth.status === 'waiting'
                                ? 'Approve the access in your browser to continue.'
                                : auth.message ||
                                  `Connect ${providerName} to choose a ${board}. Your browser opens to approve the access.`}
                          </p>
                          {auth.code && (
                            <Input
                              aria-label="Authorization device code"
                              readOnly
                              value={auth.code}
                            />
                          )}
                          <Button
                            variant="outline"
                            disabled={['checking', 'verifying'].includes(auth.status)}
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
              </CollapsibleContent>
            </Collapsible>
          </fieldset>
          {(error || (connecting && providerError) || (tried && name.trim() && blocked)) && (
            <p role="alert" className="field-error">
              {error || (connecting && providerError) || blocked}
            </p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="submit" form={formId} disabled={busy}>
            {creating ? 'Creating…' : recovering ? 'Resume setup' : 'Create project'}
          </Button>
        </DialogFooter>
      </DialogContent>
      {folderImport.dialog}
    </Dialog>
  );
}
