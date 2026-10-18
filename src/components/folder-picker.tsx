import { useEffect, useRef, useState } from 'react';
import { ArrowUp, File, Folder, Link, RefreshCw } from 'lucide-react';
import type { API } from '../types';
import type { DirectoryListing } from '../domain/project';
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

export function FolderPicker({
  api,
  value,
  hostId,
  disabled,
  onSelect,
}: {
  api: API;
  value: string;
  hostId?: string;
  disabled?: boolean;
  onSelect: (path: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState('~');
  const [listing, setListing] = useState<DirectoryListing>();
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [filter, setFilter] = useState('');
  const request = useRef(0);
  async function browse(target: string) {
    const id = ++request.current;
    setLoading(true);
    setError('');
    setListing(undefined);
    setPath(target);
    try {
      const result = await api.directoryList(target, hostId);
      if (id !== request.current) return;
      setListing(result);
      setPath(result.path);
      setFilter('');
    } catch (error) {
      if (id === request.current) setError(error instanceof Error ? error.message : String(error));
    } finally {
      if (id === request.current) setLoading(false);
    }
  }
  useEffect(() => {
    setOpen(false);
    request.current++;
  }, [hostId]);
  const entries =
    listing?.entries.filter(
      (entry) =>
        (hidden || !entry.name.startsWith('.')) &&
        entry.name.toLowerCase().includes(filter.toLowerCase()),
    ) || [];
  return (
    <>
      <Button
        variant="outline"
        disabled={disabled}
        onClick={() => {
          setOpen(true);
          void browse(value.trim() || '~');
        }}
      >
        Browse folders
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) request.current++;
        }}
      >
        <DialogContent className="sm:max-w-xl max-h-[90dvh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Choose project folder</DialogTitle>
            <DialogDescription>
              {hostId
                ? 'Browse folders on the selected remote host.'
                : 'Browse folders on this machine.'}{' '}
              Files are shown for context; choose a folder for your project.
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              void browse(path);
            }}
          >
            <Input
              aria-label="Browse folder path"
              value={path}
              onChange={(event) => setPath(event.target.value)}
            />
            <Button type="submit" variant="outline" disabled={loading || !path.trim()}>
              Go
            </Button>
          </form>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="ghost"
              disabled={loading || !listing || listing.path === listing.parent}
              onClick={() => void browse(listing!.parent)}
            >
              <ArrowUp size={16} /> Parent folder
            </Button>
            <Button variant="ghost" disabled={loading} onClick={() => void browse('~')}>
              Home
            </Button>
            <Button
              variant="ghost"
              aria-label="Refresh folder"
              disabled={loading}
              onClick={() => void browse(path)}
            >
              <RefreshCw size={16} />
            </Button>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={hidden}
                onChange={(event) => setHidden(event.target.checked)}
              />{' '}
              Show hidden
            </label>
          </div>
          <Input
            aria-label="Filter folder entries"
            placeholder="Filter files and folders…"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
          />
          <div
            className="h-64 overflow-auto rounded-md border p-1"
            aria-label="Folder entries"
            aria-busy={loading}
          >
            {loading && (
              <p role="status" className="p-3 text-sm text-muted-foreground">
                Loading folder…
              </p>
            )}
            {error && (
              <p role="alert" className="p-3 text-sm text-destructive">
                {error}
              </p>
            )}
            {listing && !entries.length && (
              <p className="p-3 text-sm text-muted-foreground">
                {listing.entries.length ? 'No matching entries.' : 'This folder is empty.'}
              </p>
            )}
            {entries.map((entry) => (
              <Button
                key={entry.path}
                variant="ghost"
                className="w-full justify-start"
                disabled={entry.kind === 'file'}
                onClick={() => void browse(entry.path)}
              >
                {entry.kind === 'directory' ? (
                  <Folder size={16} />
                ) : entry.kind === 'symlink' ? (
                  <Link size={16} />
                ) : (
                  <File size={16} />
                )}
                <span className="truncate">{entry.name}</span>
              </Button>
            ))}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              disabled={loading || !listing || path !== listing.path}
              onClick={() => {
                if (listing) {
                  onSelect(listing.path);
                  setOpen(false);
                }
              }}
            >
              Use this folder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
