import { agentCatalog } from '../config/agents';
import { RemoteHostPicker } from './remote-host-picker';
import { useEffect, useState } from 'react';
import { Terminal, RefreshCw } from 'lucide-react';
import type { API, AgentInstallation } from '../types';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';

export function SettingsDialog({
  open,
  onOpenChange,
  api,
  onRefresh,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  api: API;
  onRefresh: () => Promise<void>;
}) {
  const [installations, setInstallations] = useState<AgentInstallation[]>([]);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [checkRevision, setCheckRevision] = useState(0);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setChecking(true);
    setCheckError('');
    Promise.resolve()
      .then(() => api.agentInstallations())
      .then((value) => {
        if (live) setInstallations(value);
      })
      .catch(() => {
        if (live) {
          setInstallations([]);
          setCheckError('Could not check agents. Try again.');
        }
      })
      .finally(() => {
        if (live) setChecking(false);
      });
    return () => {
      live = false;
    };
  }, [open, api, checkRevision]);
  const [remoteId, setRemoteId] = useState('');
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(value) => {
        if (!busy) {
          onOpenChange(value);
        }
      }}
    >
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
        showCloseButton={!busy}
      >
        <DialogHeader className="border-b px-6 py-5 pr-12 text-left">
          <DialogTitle>Settings</DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto px-6 py-5">
          <section aria-labelledby="settings-agents-title" className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 id="settings-agents-title" className="text-sm font-medium">
                Local agents
              </h3>
              <Button
                variant="ghost"
                size="sm"
                disabled={checking}
                onClick={() => setCheckRevision((n) => n + 1)}
              >
                <RefreshCw size={14} className={checking ? 'animate-spin' : ''} />
                Check again
              </Button>
            </div>
            <div className="divide-y rounded-lg border">
              {agentCatalog.map(({ id, name, vendor }) => (
                <div key={name} className="flex items-center gap-3 p-3">
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
                    aria-hidden="true"
                  >
                    {id === 'codex' ? <Terminal size={17} /> : '✳'}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium">{name}</p>
                    <p className="text-xs text-muted-foreground">{vendor}</p>
                  </div>
                  <span
                    role="status"
                    className="text-xs text-muted-foreground"
                    title={installations.find((item) => item.agent === id)?.path}
                  >
                    {checking
                      ? 'Checking…'
                      : installations.find((item) => item.agent === id)?.status === 'installed'
                        ? 'Installed'
                        : installations.find((item) => item.agent === id)?.status === 'missing'
                          ? 'Not found'
                          : installations.find((item) => item.agent === id)?.status ===
                              'unavailable'
                            ? 'Desktop only'
                            : 'Check failed'}
                  </span>
                </div>
              ))}
            </div>
            {checkError && (
              <p role="alert" className="text-xs text-destructive">
                {checkError}
              </p>
            )}
          </section>
          <div className="mt-6">
            <RemoteHostPicker
              compact
              api={api}
              value={remoteId}
              onChange={setRemoteId}
              onReady={() => {
                void onRefresh().catch(() => {});
              }}
              onBusy={setBusy}
            />
          </div>
        </div>
        <DialogFooter className="shrink-0 border-t px-6 py-4">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => {
              onOpenChange(false);
            }}
          >
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
