import { useEffect, useState } from 'react';
import { ArrowUp, Folder, RefreshCw } from 'lucide-react';
import type { API, GitHubRepository, ProjectGroup, RemoteFolders } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Choice } from './choice';
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
  async function browse(value: string) {
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      const result = await api.remoteFolders(group.hostId!, value);
      setFolders(result);
      setPath(result.path);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  useEffect(() => {
    void browse('~');
  }, [group.id]);
  async function add() {
    setBusy(true);
    onBusy(true);
    setError('');
    try {
      await api.remoteAddRepository(
        group.id,
        mode === 'existing' ? path : '',
        mode === 'clone' ? repository : undefined,
      );
      await onAdded();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      onBusy(false);
    }
  }
  return (
    <section className="space-y-3" aria-label="Remote repository picker">
      <p className="text-sm font-medium">Repositories on the remote host</p>
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
      <div className="flex gap-2">
        <Input
          aria-label="Remote folder path"
          value={path}
          disabled={busy}
          onChange={(e) => setPath(e.target.value)}
        />
        <Button variant="outline" disabled={busy} onClick={() => void browse(path)}>
          Browse
        </Button>
      </div>
      <div className="max-h-40 overflow-auto rounded-md border p-1">
        <Button
          variant="ghost"
          className="w-full justify-start"
          disabled={busy || !folders || folders.parent === folders.path}
          onClick={() => void browse(folders!.parent)}
        >
          <ArrowUp size={14} />
          Parent folder
        </Button>
        {folders?.folders.map((folder) => (
          <Button
            variant="ghost"
            className="w-full justify-start"
            disabled={busy}
            key={folder.path}
            onClick={() => void browse(folder.path)}
          >
            <Folder size={14} />
            <span className="truncate">{folder.name}</span>
          </Button>
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
            Clones are stored in the project’s repos folder using Git credentials on the host.
          </p>
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <Button
        disabled={busy || !path || (mode === 'clone' && !repository)}
        onClick={() => void add()}
      >
        {busy ? (
          <>
            <RefreshCw className="animate-spin" size={14} />
            Working on host…
          </>
        ) : mode === 'clone' ? (
          'Clone on host'
        ) : (
          'Add remote folder'
        )}
      </Button>
    </section>
  );
}
