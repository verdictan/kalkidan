import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import type { API, GitHubAuthState, GitHubCliStatus } from '../types';
import { trackerAuthPending } from '../domain/tracker';
import { interfaceConfig } from '../config/interface';
import { useRefreshTriggers } from '../hooks/use-refresh-triggers';
import { settingsAnchors } from '../domain/settings-route';
import { SettingsRow, SettingsRows, StatusBadge } from './settings-disclosure';
import { Button } from './ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Input } from './ui/input';
import { showToast } from './ui/toast';
import type { StatusLabel } from '../lib/verdictan-labels';

/** Opens Preferences at the GitHub row. Every GitHub sign-in outside Preferences uses this. */
export function openAccountSettings() {
  window.dispatchEvent(
    new CustomEvent('kalkidan-open-settings', {
      detail: { section: 'account', anchor: settingsAnchors.github },
    }),
  );
}

/** Copies a command and confirms it with a toast. */
export function copyCommand(command: string) {
  void navigator.clipboard
    ?.writeText(command)
    .then(() => showToast('Command copied'))
    .catch(() => showToast({ message: 'Could not copy the command.', tone: 'error' }));
}

/** A command in a line of help text, with a Copy button. */
export function CommandHelp({ command, children }: { command: string; children: ReactNode }) {
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
      <span>{children}</span>
      <Button
        variant="ghost"
        size="sm"
        aria-label={`Copy ${command}`}
        onClick={() => copyCommand(command)}
      >
        <Copy /> Copy
      </Button>
    </div>
  );
}

/** A small external link, for example "How to install". */
export function HelpLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 rounded-sm text-xs text-link outline-none hover:underline focus-visible:shadow-[var(--focus-ring)]"
    >
      {children}
      <ExternalLink className="size-3" aria-hidden="true" />
    </a>
  );
}

/**
 * The GitHub state for Preferences: the GitHub CLI sign-in for repositories, and the
 * Projects access for boards. It reads again when the section opens and on window focus.
 */
export function useGitHubServices(api: API, open: boolean) {
  const [gh, setGh] = useState<GitHubCliStatus>();
  const [auth, setAuth] = useState<GitHubAuthState>({ status: 'idle' });
  const [authChecked, setAuthChecked] = useState(false);
  const read = useCallback(() => {
    void Promise.resolve()
      .then(() => api.githubCliCheck())
      .then(setGh, () => setGh({ status: 'error' }));
    // Only read the current access. The approval starts when the user asks for it.
    void Promise.resolve()
      .then(() => api.githubAuthStatus())
      .then(
        (value) => {
          setAuth((current) => (trackerAuthPending(current) ? current : value));
          setAuthChecked(true);
        },
        () => setAuthChecked(true),
      );
  }, [api]);
  useRefreshTriggers(undefined, open, read);
  useEffect(() => {
    if (!open || !trackerAuthPending(auth)) return;
    let live = true;
    const timer = setInterval(() => {
      void Promise.resolve()
        .then(() => api.githubAuthStatus())
        .then((value) => {
          if (!live) return;
          setAuth(value);
          if (value.status === 'ready') showToast('GitHub Projects access allowed');
        })
        .catch(() => live && setAuth({ status: 'error', message: 'Approval stopped. Try again.' }));
    }, interfaceConfig.authPollMs);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [open, api, auth.status]);
  async function allow() {
    const force = auth.status === 'ready';
    setAuth({ status: 'checking' });
    try {
      setAuth(await api.githubAuthStart(force));
    } catch {
      setAuth({
        status: 'error',
        message: 'Could not start the GitHub approval. Restart Kalkidan, then try again.',
      });
    }
  }
  async function cancel() {
    if (!auth.attemptId) return;
    try {
      setAuth(await api.githubAuthCancel(auth.attemptId));
    } catch {
      setAuth({ ...auth, message: 'Could not cancel the approval. Try again.' });
    }
  }
  function openGitHub() {
    void Promise.resolve()
      .then(() => api.githubAuthOpen())
      .catch(() =>
        setAuth({
          ...auth,
          message: 'Could not open your browser. Go to github.com/login/device and enter the code.',
        }),
      );
  }
  return { gh, auth, authChecked, allow, cancel, openGitHub };
}

export type GitHubServices = ReturnType<typeof useGitHubServices>;

const ghStatus: Record<GitHubCliStatus['status'], StatusLabel> = {
  ready: { label: 'Connected', tone: 'success' },
  'signed-out': { label: 'Signed out', tone: 'warning' },
  missing: { label: 'Not installed', tone: 'warning' },
  unavailable: { label: 'Desktop only', tone: 'muted' },
  error: { label: 'Check failed', tone: 'destructive' },
};

/** The GitHub user name, when the desktop sends it. */
function ghLogin(gh: GitHubCliStatus | undefined) {
  const login = (gh as (GitHubCliStatus & { login?: unknown }) | undefined)?.login;
  return typeof login === 'string' && /^[A-Za-z0-9-]{1,39}$/.test(login) ? login : undefined;
}

/**
 * The GitHub row of Preferences: one status and one button. The GitHub CLI gives the
 * repositories, and the Projects access gives the boards. The row shows "Connected" when both
 * work. Otherwise "Connect…" opens the Connect GitHub dialog with the step that each part needs.
 */
export function GitHubRow({ services }: { services: GitHubServices }) {
  const { gh, auth, authChecked, allow } = services;
  const [sheet, setSheet] = useState(false);
  const pending = trackerAuthPending(auth);
  const boardsReady = auth.status === 'ready';
  const connected = gh?.status === 'ready' && boardsReady;
  const checking = !gh || !authChecked;
  const status: StatusLabel = checking
    ? { label: 'Checking…', tone: 'secondary' }
    : connected
      ? { label: 'Connected', tone: 'success' }
      : gh.status !== 'ready'
        ? ghStatus[gh.status]
        : pending
          ? { label: 'Waiting for approval', tone: 'warning' }
          : { label: 'Boards not allowed', tone: 'warning' };
  const login = ghLogin(gh);
  function start() {
    setSheet(true);
    // With the GitHub CLI ready, only the board access is missing. Start its approval.
    if (gh?.status === 'ready' && !boardsReady && !pending) void allow();
  }
  return (
    <>
      <SettingsRow
        id={settingsAnchors.github}
        label="GitHub and boards"
        help={connected && login ? `@${login}` : 'Repositories and boards'}
      >
        <StatusBadge status={status} />
        {!checking && !connected && gh?.status !== 'unavailable' && (
          <Button size="sm" variant="outline" onClick={start}>
            Connect…
          </Button>
        )}
      </SettingsRow>
      <GitHubConnectDialog services={services} open={sheet} onOpenChange={setSheet} />
      {/* One live region announces the result of both checks together. */}
      <p role="status" className="sr-only">
        {gh && authChecked
          ? `GitHub: ${ghStatus[gh.status].label}. GitHub Projects boards: ${
              boardsReady ? 'allowed' : 'not allowed'
            }.`
          : ''}
      </p>
    </>
  );
}

/**
 * Connect GitHub: the GitHub CLI sign-in for repositories, then the device approval for the
 * Projects access of boards. Each part shows its state and its one action.
 */
function GitHubConnectDialog({
  services,
  open,
  onOpenChange,
}: {
  services: GitHubServices;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { gh, auth, cancel, openGitHub, allow } = services;
  const pending = trackerAuthPending(auth);
  const boardsReady = auth.status === 'ready';
  // Close the dialog when both parts work.
  useEffect(() => {
    if (open && boardsReady && gh?.status === 'ready') onOpenChange(false);
  }, [open, boardsReady, gh?.status]);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending) void cancel();
        onOpenChange(next);
      }}
    >
      <DialogContent size="sm" layout="scroll">
        <DialogHeader>
          <DialogTitle>Connect GitHub</DialogTitle>
          <DialogDescription>
            Kalkidan clones your repositories and reads and updates the tasks on your boards.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-3" aria-live="polite">
          <SettingsRows label="GitHub">
            <SettingsRow
              label="Repositories"
              help={
                gh?.status === 'signed-out'
                  ? 'Run gh auth login in a terminal.'
                  : gh?.status === 'missing'
                    ? 'Install the GitHub CLI.'
                    : 'The GitHub CLI on this computer'
              }
            >
              {gh && <StatusBadge status={ghStatus[gh.status]} />}
              {gh?.status === 'signed-out' && (
                <Button variant="outline" size="sm" onClick={() => copyCommand('gh auth login')}>
                  <Copy /> Copy command
                </Button>
              )}
              {gh?.status === 'missing' && (
                <Button asChild variant="outline" size="sm">
                  <a href="https://cli.github.com" target="_blank" rel="noreferrer">
                    How to install
                    <ExternalLink aria-label="Opens in the browser" />
                  </a>
                </Button>
              )}
            </SettingsRow>
            <SettingsRow
              label="Boards"
              help={
                boardsReady
                  ? 'GitHub Projects access is allowed.'
                  : auth.status === 'waiting' && auth.code
                    ? 'Copy the code, open GitHub, and enter it. This updates after you approve.'
                    : auth.status === 'verifying'
                      ? 'Checking the access…'
                      : pending
                        ? 'Getting a code…'
                        : 'Allow the access to GitHub Projects.'
              }
            >
              {boardsReady ? (
                <StatusBadge status={{ label: 'Allowed', tone: 'success' }} />
              ) : auth.status === 'waiting' && auth.code ? (
                <Button size="sm" onClick={openGitHub}>
                  Open GitHub
                  <ExternalLink aria-hidden="true" />
                </Button>
              ) : (
                !pending && (
                  <Button size="sm" variant="outline" onClick={() => void allow()}>
                    {auth.status === 'error' ? 'Try again' : 'Allow access…'}
                  </Button>
                )
              )}
            </SettingsRow>
          </SettingsRows>
          {auth.status === 'waiting' && auth.code && (
            <Input
              aria-label="GitHub device code"
              className="w-40 font-mono"
              readOnly
              value={auth.code}
              onFocus={(event) => event.target.select()}
            />
          )}
          {auth.status === 'error' && (
            <p role="alert" className="field-error">
              {auth.message || 'The approval did not finish. Try again.'}
            </p>
          )}
          {auth.message && auth.status !== 'error' && auth.status !== 'ready' && (
            <p className="form-help mt-0">{auth.message}</p>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
