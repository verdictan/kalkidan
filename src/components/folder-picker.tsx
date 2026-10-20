import { useEffect, useRef, useState } from 'react';
import { ArrowUp, File, Folder, FolderOpen, House, Link, RefreshCw } from 'lucide-react';
import type { API } from '../types';
import type { DirectoryListing } from '../domain/project';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { SearchInput } from './ui/search-input';
import { Hint } from './hint';
import { EmptyState } from './ui/empty-state';
import { checkboxClass } from './repository-import';
import {
  Dialog,
  DialogBody,
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
  className,
  onSelect,
}: {
  api: API;
  value: string;
  hostId?: string;
  disabled?: boolean;
  /** Classes for the trigger button, for example to place it inside a path field. */
  className?: string;
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
      if (id === request.current) {
        const message = error instanceof Error ? error.message : String(error);
        setError(
          message.includes("No handler registered for 'directory-list'") ||
            message.includes('api.directoryList is not a function')
            ? 'Restart the Kalkidan desktop app to load folder browsing. Refreshing this page does not update the desktop backend.'
            : message,
        );
      }
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
      <Hint label="Browse folders">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Browse folders"
          className={className}
          disabled={disabled}
          onClick={() => {
            setOpen(true);
            void browse(value.trim() || '~');
          }}
        >
          <FolderOpen />
        </Button>
      </Hint>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) request.current++;
        }}
      >
        {/* A fixed height: only the list of entries scrolls when a folder changes. */}
        <DialogContent size="lg" layout="scroll" className="h-[min(640px,calc(100dvh-2rem))]">
          <DialogHeader>
            <DialogTitle>Choose project folder</DialogTitle>
            <DialogDescription>
              {hostId
                ? 'Browse folders on the selected remote host.'
                : 'Browse folders on this machine.'}{' '}
              Files show only for context. Open a folder, then select Use this folder.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="flex flex-col gap-3 overflow-hidden">
            <form
              className="flex gap-2"
              onSubmit={(event) => {
                event.preventDefault();
                // This dialog can open from a form in another dialog. Keep this submit local.
                event.stopPropagation();
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
            <div className="flex flex-wrap items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                disabled={loading || !listing || listing.path === listing.parent}
                onClick={() => void browse(listing!.parent)}
              >
                <ArrowUp /> Parent folder
              </Button>
              <Button variant="ghost" size="sm" disabled={loading} onClick={() => void browse('~')}>
                <House /> Home
              </Button>
              <Hint label="Refresh folder">
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Refresh folder"
                  disabled={loading}
                  onClick={() => void browse(path)}
                >
                  <RefreshCw />
                </Button>
              </Hint>
              <label className="ml-auto flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                <input
                  type="checkbox"
                  className={checkboxClass}
                  checked={hidden}
                  onChange={(event) => setHidden(event.target.checked)}
                />
                Show hidden
              </label>
            </div>
            <SearchInput
              aria-label="Filter folder entries"
              placeholder="Filter files and folders…"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
            />
            <div
              role="group"
              className="list-box max-h-none min-h-0 flex-1 content-start"
              aria-label="Folder entries"
              aria-busy={loading}
            >
              {loading && (
                <p role="status" className="px-2 py-1.5 text-sm text-muted-foreground">
                  Loading folder…
                </p>
              )}
              {error && (
                <p role="alert" className="field-error px-2 py-1.5">
                  {error}
                </p>
              )}
              {listing && !entries.length && (
                <EmptyState
                  compact
                  title={listing.entries.length ? 'No matching entries' : 'This folder is empty'}
                />
              )}
              {entries.map((entry) => (
                <button
                  type="button"
                  key={entry.path}
                  title={entry.name}
                  className="list-box-row text-sm disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0 [&_svg]:text-muted-foreground"
                  disabled={entry.kind === 'file'}
                  onClick={() => void browse(entry.path)}
                >
                  {entry.kind === 'directory' ? (
                    <Folder />
                  ) : entry.kind === 'symlink' ? (
                    <Link />
                  ) : (
                    <File />
                  )}
                  <span className="truncate">{entry.name}</span>
                </button>
              ))}
            </div>
          </DialogBody>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
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
