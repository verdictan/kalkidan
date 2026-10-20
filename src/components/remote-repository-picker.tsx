import { useEffect, useRef, useState } from 'react';
import { ArrowUp, Folder, House, RefreshCw } from 'lucide-react';
import type { API, GitHubRepository, ProjectGroup, RemoteFolders } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Choice } from './choice';
import { SectionHeader } from './ui/page-header';
import { EmptyState } from './ui/empty-state';
import { useFolderImport } from './repository-import';

export function RemoteRepositoryPicker({
  api,
  group,
  repos,
  onAdded,
  onBusy,
}: {
  api: API;
  group: ProjectGroup;
  repos: GitHubRepository[];
  onAdded: () => Promise<void>;
  onBusy: (busy: boolean) => void;
}) {
  const [mode, setMode] = useState('existing');
  const [path, setPath] = useState('~');
  const [folders, setFolders] = useState<RemoteFolders>();
  const [repository, setRepository] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  const folderImport = useFolderImport(api);
  const parent =
    error && path.startsWith('/')
      ? path.replace(/\/+$/, '').replace(/\/[^/]*$/, '') || '/'
      : folders?.parent;
  async function browse(value: string) {
    const id = ++request.current;
    setPath(value);
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      const result = await api.remoteFolders(group.hostId!, value);
      if (id !== request.current) return;
      setFolders(result);
      setPath(result.path);
    } catch (e) {
      if (id === request.current) {
        const message = e instanceof Error ? e.message : String(e);
        setError(
          /\b(ENOENT|ENOTDIR)\b/.test(message)
            ? `Folder not found: ${value}. Check the spelling and letter case, or open the parent folder.`
            : message,
        );
      }
    } finally {
      if (id === request.current) {
        setBusy(false);
        onBusy(false);
      }
    }
  }
  useEffect(() => {
    setFolders(undefined);
    void browse('~');
    return () => {
      request.current++;
    };
  }, [group.id, group.hostId]);
  async function add() {
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      if (mode === 'clone') await api.remoteAddRepository(group.id, '', repository);
      else {
        // Find the Git repositories in the folder. A host without the scan adds the folder.
        const result = await folderImport
          .scanFolder(path, group.hostId)
          .catch(() => ({ root: path, paths: [path] }));
        if (!result) return;
        for (const folder of result.paths) await api.remoteAddRepository(group.id, folder);
      }
      await onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <section className="grid gap-3" aria-label="Remote repository picker">
      <SectionHeader size="sm" title="Code folders on the remote host" />
      <Choice
        label="Remote repository source"
        className="w-full"
        disabled={busy}
        value={mode}
        onChange={setMode}
        options={[
          { value: 'existing', label: 'Use an existing remote folder' },
          { value: 'clone', label: 'Clone GitHub repository on host' },
        ]}
      />
      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          event.stopPropagation();
          if (!busy) void browse(path);
        }}
      >
        <Input
          aria-label="Remote folder path"
          value={path}
          disabled={busy}
          onChange={(e) => setPath(e.target.value)}
        />
        <Button type="submit" variant="outline" disabled={busy}>
          Browse
        </Button>
      </form>
      <div
        role="group"
        aria-label="Remote folders"
        aria-busy={busy}
        className="list-box content-start [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
      >
        <button
          type="button"
          className="list-box-row text-sm disabled:opacity-50"
          disabled={busy || !parent || parent === path}
          onClick={() => parent && void browse(parent)}
        >
          <ArrowUp />
          Parent folder
        </button>
        <button
          type="button"
          className="list-box-row text-sm disabled:opacity-50"
          disabled={busy}
          onClick={() => void browse('~')}
        >
          <House /> Home
        </button>
        {busy && !folders && (
          <p role="status" className="px-2 py-1.5 text-sm text-muted-foreground">
            Loading folders…
          </p>
        )}
        {!error && folders && !folders.folders.length && <EmptyState compact title="No folders" />}
        {!error &&
          folders?.folders.map((folder) => (
            <button
              type="button"
              className="list-box-row text-sm disabled:opacity-50"
              disabled={busy}
              key={folder.path}
              title={folder.name}
              onClick={() => void browse(folder.path)}
            >
              <Folder />
              <span className="truncate">{folder.name}</span>
            </button>
          ))}
      </div>
      {mode === 'clone' && (
        <>
          <Choice
            label="Remote GitHub repository"
            className="w-full"
            value={repository}
            disabled={busy}
            onChange={(value) => {
              setRepository(value);
            }}
            options={[
              { value: '', label: 'Choose a GitHub repository' },
              ...repos.map((repo) => ({ value: repo.nameWithOwner, label: repo.nameWithOwner })),
            ]}
          />
          <Input
            aria-label="Remote repository name"
            placeholder="Or enter owner/repository"
            value={repository}
            disabled={busy}
            onChange={(e) => setRepository(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Kalkidan clones into the project folder on the host. The clone uses the Git sign-in of
            the host.
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="field-error">
          {error}
        </p>
      )}
      <Button
        className="justify-self-start"
        disabled={
          busy || (mode === 'existing' ? !folders || path !== folders.path || !!error : !repository)
        }
        onClick={() => void add()}
      >
        {busy ? (
          <>
            <RefreshCw className="animate-spin" />
            Working on host…
          </>
        ) : mode === 'clone' ? (
          'Clone on host'
        ) : (
          'Add remote folder'
        )}
      </Button>
      {folderImport.dialog}
    </section>
  );
}
