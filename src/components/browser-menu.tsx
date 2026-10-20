import { useState } from 'react';
import { Download, KeyRound, Minus, Plus } from 'lucide-react';
import { Button, buttonVariants } from './ui/button';
import { Input } from './ui/input';
import { MoreButton } from './ui/more-button';
import { Switch } from './ui/switch';
import { EmptyState } from './ui/empty-state';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from './ui/dialog';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from './ui/dropdown-menu';
import { Hint } from './hint';
import { revealLabel } from '../lib/platform';
import { cn } from '../lib/utils';
import { errorMessage } from '../lib/errors';
import type { API, BrowserProfileData } from '../types';

const clearOptions = [
  {
    kind: 'history',
    label: 'History',
    button: 'Clear history',
    warning: 'The list of pages you visited in the Kalkidan browser is deleted.',
  },
  {
    kind: 'cache',
    label: 'Cached files',
    button: 'Clear cached files',
    warning: 'Pages can load more slowly the next time you open them.',
  },
  {
    kind: 'cookies',
    label: 'Cookies and site data',
    button: 'Clear cookies',
    warning: 'This signs you out of all sites in the Kalkidan browser.',
  },
  {
    kind: 'passwords',
    label: 'Saved passwords',
    button: 'Delete passwords',
    warning: 'All saved passwords are permanently deleted. You cannot undo this.',
  },
] as const;
type ClearOption = (typeof clearOptions)[number];
// The zoom controls are menu items with the icon button look, so the menu stays open.
const zoomButtonClass = cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'p-0');
const downloadState: Record<string, string> = {
  progressing: 'Downloading',
  paused: 'Paused',
  completed: 'Complete',
  cancelled: 'Cancelled',
  interrupted: 'Interrupted',
};
const downloadCommand: Record<string, string> = {
  pause: 'Pause',
  resume: 'Resume',
  cancel: 'Cancel',
};
export function BrowserMenu({
  api,
  id,
  ready,
  url,
  zoom,
  findShortcut,
  onFind,
  onDevice,
  onNavigate,
  onError,
}: {
  api: API;
  id: string;
  ready: boolean;
  url: string;
  zoom: number;
  findShortcut?: string;
  onFind: () => void;
  onDevice: () => void;
  onNavigate: (url: string) => void;
  onError: (message: string) => void;
}) {
  const [panel, setPanel] = useState<string | null>(null);
  const [data, setData] = useState<BrowserProfileData>();
  const [busy, setBusy] = useState(false);
  const [home, setHome] = useState('');
  const [remember, setRemember] = useState(true);
  const [filter, setFilter] = useState('');
  const [notice, setNotice] = useState('');
  const [failed, setFailed] = useState(false);
  const [pendingClear, setPendingClear] = useState<ClearOption | null>(null);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; origin: string } | null>(null);
  async function attempt(action: string, value?: unknown) {
    setBusy(true);
    setNotice('');
    setFailed(false);
    try {
      const result = await api.browserAction(id, action, value);
      if (typeof result === 'string') setNotice(result);
      return { ok: true as const, result };
    } catch (e) {
      const message = errorMessage(e);
      setNotice(message);
      setFailed(true);
      onError(message);
      return { ok: false as const };
    } finally {
      setBusy(false);
    }
  }
  async function act(action: string, value?: unknown) {
    const outcome = await attempt(action, value);
    return outcome.ok ? outcome.result : undefined;
  }
  function openPanel(next: string | null) {
    setPendingClear(null);
    setPendingDelete(null);
    setPanel(next);
  }
  async function show(next: string) {
    openPanel(next);
    setFilter('');
    const profile = (await act('profile')) as BrowserProfileData | undefined;
    if (profile) {
      setData(profile);
      setHome(profile.settings.home);
      setRemember(profile.settings.rememberHistory);
    }
  }
  async function refresh() {
    const profile = await act('profile');
    if (profile) setData(profile);
  }
  return (
    <>
      <Hint label="Downloads">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Downloads"
          disabled={!ready}
          onClick={() => void show('Downloads')}
        >
          <Download />
        </Button>
      </Hint>
      <DropdownMenu>
        <Hint label="Browser menu">
          <DropdownMenuTrigger asChild>
            <MoreButton type="button" label="Browser menu" disabled={!ready} />
          </DropdownMenuTrigger>
        </Hint>
        <DropdownMenuContent align="end" className="w-64">
          <DropdownMenuItem onSelect={onFind}>
            Find in page
            {findShortcut && <DropdownMenuShortcut>{findShortcut}</DropdownMenuShortcut>}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void act('print')}>Print…</DropdownMenuItem>
          <DropdownMenuSeparator />
          <div
            className="flex h-7 items-center justify-between pl-2 text-sm"
            role="group"
            aria-label="Zoom"
          >
            <span aria-hidden="true">Zoom</span>
            <div className="flex items-center">
              {/* Menu items keep the zoom controls in the keyboard order. The menu stays open. */}
              <DropdownMenuItem
                className={zoomButtonClass}
                aria-label="Zoom out"
                disabled={busy || zoom <= 0.25}
                onSelect={(e) => {
                  e.preventDefault();
                  void act('zoom', Math.max(0.25, Math.round((zoom - 0.1) * 100) / 100));
                }}
              >
                <Minus aria-hidden="true" />
              </DropdownMenuItem>
              <DropdownMenuItem
                className={cn(
                  buttonVariants({ variant: 'ghost', size: 'sm' }),
                  'min-w-12 justify-center font-normal tabular-nums',
                )}
                aria-label={`Reset zoom (now ${Math.round(zoom * 100)}%)`}
                disabled={busy}
                onSelect={(e) => {
                  e.preventDefault();
                  void act('zoom', 1);
                }}
              >
                {Math.round(zoom * 100)}%
              </DropdownMenuItem>
              <DropdownMenuItem
                className={zoomButtonClass}
                aria-label="Zoom in"
                disabled={busy || zoom >= 3}
                onSelect={(e) => {
                  e.preventDefault();
                  void act('zoom', Math.min(3, Math.round((zoom + 0.1) * 100) / 100));
                }}
              >
                <Plus aria-hidden="true" />
              </DropdownMenuItem>
            </div>
          </div>
          <DropdownMenuItem onSelect={onDevice}>Device toolbar</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void act('screenshot')}>
            Take screenshot…
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void show('Passwords and autofill')}>
            Passwords and autofill
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void show('Downloads')}>Downloads</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void show('History')}>History</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void show('Clear browsing data')}>
            Clear browsing data
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem onSelect={() => void show('Browser settings')}>
            Browser settings
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Dialog open={!!panel} onOpenChange={(open) => !open && openPanel(null)}>
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>{panel}</DialogTitle>
            <DialogDescription>
              {panel === 'Passwords and autofill'
                ? 'Credentials are encrypted with your operating system’s secure storage. Fill only the exact saved origin, then submit the form yourself.'
                : panel === 'Clear browsing data'
                  ? 'Clear data from Kalkidan’s embedded browser. Your external browser is unaffected.'
                  : 'Manage your Kalkidan browser.'}
            </DialogDescription>
          </DialogHeader>
          {notice && (
            <p
              role={failed ? 'alert' : 'status'}
              className={failed ? 'field-error break-words' : 'text-sm break-words'}
            >
              {notice}
            </p>
          )}
          {panel === 'Browser settings' && (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                e.stopPropagation();
                void attempt('settings', { home, rememberHistory: remember }).then(
                  async (outcome) => {
                    if (!outcome.ok) return;
                    await refresh();
                    setNotice('Browser settings saved');
                  },
                );
              }}
            >
              <label className="form-label">
                Home page
                <Input
                  aria-label="Home page"
                  value={home}
                  onChange={(e) => setHome(e.target.value)}
                />
              </label>
              <label className="flex items-center justify-between text-sm">
                Remember browsing history
                <Switch checked={remember} onCheckedChange={setRemember} />
              </label>
              <p className="form-help">
                Browser cookies persist between launches. Camera, microphone, location, and
                notifications remain blocked.
              </p>
              <Button disabled={busy}>Save browser settings</Button>
              <section className="grid gap-2 border-t pt-4" aria-labelledby="browser-import">
                <h3 id="browser-import" className="text-sm font-semibold">
                  Import sign-in data
                </h3>
                <p className="form-help">
                  Import a JSON cookie array, or a password CSV with url, username, and password
                  columns. Direct Chrome profile import is not supported.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void act('import', 'cookies')}
                  >
                    Import cookies from JSON…
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void attempt('import', 'passwords').then((outcome) =>
                        outcome.ok ? refresh() : undefined,
                      )
                    }
                  >
                    Import passwords from CSV…
                  </Button>
                </div>
              </section>
            </form>
          )}
          {panel === 'Clear browsing data' && (
            <div className="space-y-3">
              {clearOptions.map((option) => (
                <div key={option.kind} className="panel space-y-3">
                  <div className="flex items-center justify-between gap-4">
                    <span className="text-sm">{option.label}</span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy || pendingClear?.kind === option.kind}
                      onClick={() => setPendingClear(option)}
                    >
                      {option.button}…
                    </Button>
                  </div>
                  {pendingClear?.kind === option.kind && (
                    <div
                      role="group"
                      aria-label={`Confirm: ${option.button}`}
                      className="space-y-2"
                    >
                      <p className="text-xs text-muted-foreground">{option.warning}</p>
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setPendingClear(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          autoFocus
                          disabled={busy}
                          onClick={() =>
                            void attempt('clear', option.kind).then((outcome) => {
                              setPendingClear(null);
                              if (outcome.ok) setNotice(option.label + ' cleared');
                            })
                          }
                        >
                          {option.button}
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {panel === 'History' && (
            <>
              <Input
                aria-label="Search history"
                placeholder="Search history…"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              <div className="max-h-80 space-y-1 overflow-auto">
                {data?.history
                  .filter((h) => (h.title + h.url).toLowerCase().includes(filter.toLowerCase()))
                  .map((h) => (
                    <Button
                      key={h.url}
                      variant="ghost"
                      className="h-auto w-full justify-start text-left"
                      onClick={() => {
                        onNavigate(h.url);
                        setPanel(null);
                      }}
                    >
                      <span className="min-w-0">
                        <span className="block truncate">{h.title}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {h.url} · {new Date(h.at).toLocaleDateString()}
                        </span>
                      </span>
                    </Button>
                  ))}
                {!data?.history.length && <EmptyState compact title="No browsing history yet" />}
              </div>
            </>
          )}
          {panel === 'Downloads' && (
            <div className="max-h-80 space-y-3 overflow-auto">
              <Button variant="outline" size="sm" disabled={busy} onClick={() => void refresh()}>
                Refresh downloads
              </Button>
              {data?.downloads.map((d) => (
                <div key={d.id} className="panel">
                  <p className="truncate text-sm">{d.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {downloadState[d.state] || d.state} · {Math.round(d.received / 1024)} /{' '}
                    {Math.round(d.total / 1024)} KB
                  </p>
                  <div className="mt-2 flex gap-2">
                    {(d.state === 'completed'
                      ? ['reveal']
                      : ['progressing', 'paused'].includes(d.state)
                        ? [d.state === 'paused' ? 'resume' : 'pause', 'cancel']
                        : []
                    ).map((command) => (
                      <Button
                        key={command}
                        size="sm"
                        variant="outline"
                        disabled={busy}
                        onClick={() =>
                          void attempt('download', { id: d.id, command }).then((outcome) =>
                            outcome.ok ? refresh() : undefined,
                          )
                        }
                      >
                        {command === 'reveal' ? revealLabel() : downloadCommand[command]}
                      </Button>
                    ))}
                  </div>
                </div>
              ))}
              {!data?.downloads.length && (
                <EmptyState compact title="No downloads">
                  Files that you download in the browser show here.
                </EmptyState>
              )}
            </div>
          )}
          {panel === 'Passwords and autofill' && (
            <div className="max-h-80 space-y-3 overflow-auto">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void attempt('import', 'passwords').then((outcome) =>
                    outcome.ok ? refresh() : undefined,
                  )
                }
              >
                <KeyRound size={14} />
                Import password CSV…
              </Button>
              {data?.credentials.map((c) => (
                <div key={c.id} className="panel">
                  <p className="break-all text-sm">{c.origin}</p>
                  <p className="text-xs text-muted-foreground">{c.username}</p>
                  <div className="mt-2 flex gap-2">
                    <Button
                      size="sm"
                      disabled={busy || !url.startsWith(c.origin + '/')}
                      onClick={() => void act('autofill', c.id)}
                    >
                      Fill login
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      disabled={busy || pendingDelete?.id === c.id}
                      onClick={() => setPendingDelete({ id: c.id, origin: c.origin })}
                    >
                      Delete…
                    </Button>
                  </div>
                  {pendingDelete?.id === c.id && (
                    <div
                      role="group"
                      aria-label="Confirm password deletion"
                      className="mt-3 space-y-2"
                    >
                      <p className="text-xs text-muted-foreground">
                        The saved password for {c.username || 'this account'} on {c.origin} is
                        permanently deleted.
                      </p>
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={busy}
                          onClick={() => setPendingDelete(null)}
                        >
                          Cancel
                        </Button>
                        <Button
                          size="sm"
                          variant="destructive"
                          autoFocus
                          disabled={busy}
                          onClick={() =>
                            void attempt('delete-password', c.id).then(async (outcome) => {
                              setPendingDelete(null);
                              if (outcome.ok) await refresh();
                            })
                          }
                        >
                          Delete password
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
              {!data?.credentials.length && <EmptyState compact title="No saved passwords" />}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
