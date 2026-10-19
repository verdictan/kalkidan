import type { GitHubCliStatus } from '../domain/conversation';
import { agentCatalog } from '../config/agents';
import { RemoteHostPicker } from './remote-host-picker';
import { useEffect, useRef, useState } from 'react';
import { Terminal, RefreshCw, GitBranch } from 'lucide-react';
import type { API, AgentInstallation } from '../types';
import { Button } from './ui/button';
import { Hint } from './hint';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { errorMessage } from '../lib/errors';

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
  const [checkRevision, setCheckRevision] = useState(0);
  const [gh, setGh] = useState<GitHubCliStatus>();
  const [ghChecking, setGhChecking] = useState(false);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setGhChecking(true);
    Promise.resolve()
      .then(() => api.githubCliCheck())
      .then((value) => {
        if (live) setGh(value);
      })
      .catch(() => {
        if (live) setGh({ status: 'error' });
      })
      .finally(() => {
        if (live) setGhChecking(false);
      });
    return () => {
      live = false;
    };
  }, [open, api, checkRevision]);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
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
  const [refreshError, setRefreshError] = useState('');
  const heading = useRef<HTMLHeadingElement>(null);
  function agentStatus(agent: string) {
    if (checking) return 'Checking…';
    const status = installations.find((item) => item.agent === agent)?.status;
    if (status === 'installed') return 'Installed';
    if (status === 'missing') return 'Not found';
    if (status === 'unavailable') return 'Desktop only';
    return 'Check failed';
  }
  const ghStatus = ghChecking
    ? 'Checking…'
    : gh?.status === 'ready'
      ? 'Signed in'
      : gh?.status === 'signed-out'
        ? 'Sign-in required'
        : gh?.status === 'missing'
          ? 'Not found'
          : gh?.status === 'unavailable'
            ? 'Desktop only'
            : 'Check failed';
  // Remote host work continues on the host after this dialog closes.
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          heading.current?.focus();
        }}
      >
        <DialogHeader className="border-b px-6 py-5 pr-12 text-left">
          <DialogTitle ref={heading} tabIndex={-1} className="outline-none">
            Settings
          </DialogTitle>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto px-6 py-5">
          <section aria-labelledby="settings-agents-title" className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 id="settings-agents-title" className="text-sm font-medium">
                Local agents and tools
              </h3>
              <Button
                variant="ghost"
                size="sm"
                disabled={checking || ghChecking}
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
                    <InstalledPath path={installations.find((item) => item.agent === id)?.path} />
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">{agentStatus(id)}</span>
                </div>
              ))}
              <div
                className="flex items-center gap-3 p-3"
                role="group"
                aria-label="GitHub CLI status"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                  <GitBranch size={17} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">GitHub CLI</p>
                  <p className="text-xs text-muted-foreground">gh · github.com</p>
                  <InstalledPath path={gh?.path} />
                  {!ghChecking && gh?.status === 'missing' && (
                    <p className="text-xs text-muted-foreground">Install gh, then check again.</p>
                  )}
                  {!ghChecking && gh?.status === 'signed-out' && (
                    <p className="text-xs text-muted-foreground">
                      Run <code>gh auth login</code>, then check again.
                    </p>
                  )}
                </div>
                <span className="shrink-0 text-xs text-muted-foreground">{ghStatus}</span>
              </div>
            </div>
            {/* One live region announces the result of all checks together. */}
            <p role="status" className="sr-only">
              {checking || ghChecking
                ? 'Checking agents and tools…'
                : [
                    ...agentCatalog.map(({ id, name }) => `${name}: ${agentStatus(id)}.`),
                    `GitHub CLI: ${ghStatus}.`,
                  ].join(' ')}
            </p>
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
                setRefreshError('');
                void onRefresh().catch((error) =>
                  setRefreshError(`Could not refresh projects: ${errorMessage(error)}`),
                );
              }}
            />
            {refreshError && (
              <p role="alert" className="mt-2 text-xs text-destructive">
                {refreshError}
              </p>
            )}
          </div>
        </div>
        <DialogFooter className="shrink-0 border-t px-6 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The installed binary path, truncated, with the full path in a tooltip. */
function InstalledPath({ path }: { path?: string }) {
  if (!path) return null;
  return (
    <Hint label={path}>
      <p tabIndex={0} className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">
        {path}
      </p>
    </Hint>
  );
}
