import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Copy, ExternalLink } from 'lucide-react';
import type { API, GitHubAuthState, GitHubCliStatus } from '../types';
import { trackerAuthPending } from '../domain/tracker';
import { interfaceConfig } from '../config/interface';
import { useRefreshTriggers } from '../hooks/use-refresh-triggers';
import { settingsAnchors } from '../domain/settings-route';
import { SettingsRow, StatusBadge } from './settings-disclosure';
import { Button } from './ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
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
 * The GitHub CLI part of the help line of the GitHub row. Empty when the badge already says it.
 */
function ghText(gh: GitHubCliStatus | undefined) {
  if (gh?.status === 'ready') return ghLogin(gh) ? `@${ghLogin(gh)}` : '';
  if (gh?.status === 'signed-out') return 'Run gh auth login';
  return '';
}

/**
 * The GitHub row of Preferences: the GitHub CLI for repositories and the Projects access for
 * boards in one row. It shows "Connected" when both work. Otherwise it shows the one action
 * that each part needs.
 */
export function GitHubRow({ services }: { services: GitHubServices }) {
  const { gh, auth, authChecked, allow } = services;
  const [sheet, setSheet] = useState(false);
  const pending = trackerAuthPending(auth);
  const boardsReady = auth.status === 'ready';
  const boardText = !authChecked
    ? ''
    : boardsReady
      ? 'Boards allowed'
      : pending
        ? 'Waiting for approval'
        : 'Boards not allowed';
  const connected = gh?.status === 'ready' && boardsReady;
  const status: StatusLabel | undefined =
    !gh || !authChecked
      ? { label: 'Checking…', tone: 'secondary' }
      : connected
        ? { label: 'Connected', tone: 'success' }
        : gh.status !== 'ready'
          ? ghStatus[gh.status]
          : undefined;
  function start() {
    setSheet(true);
    if (!pending) void allow();
  }
  return (
    <>
      <SettingsRow
        id={settingsAnchors.github}
        label="GitHub and boards"
        help={[ghText(gh), boardText].filter(Boolean).join(' · ')}
      >
        {status && <StatusBadge status={status} />}
        {gh?.status === 'signed-out' && (
          <Button variant="outline" size="sm" onClick={() => copyCommand('gh auth login')}>
            Copy command
          </Button>
        )}
        {gh?.status === 'missing' && (
          <Button asChild variant="ghost" size="sm">
            <a href="https://cli.github.com" target="_blank" rel="noreferrer">
              How to install
              <ExternalLink aria-label="Opens in the browser" />
            </a>
          </Button>
        )}
        {authChecked && !boardsReady && (
          <Button size="sm" variant="outline" onClick={start}>
            {pending ? 'Continue…' : auth.status === 'error' ? 'Try again…' : 'Allow access…'}
          </Button>
        )}
      </SettingsRow>
      <BoardAccessDialog services={services} open={sheet} onOpenChange={setSheet} />
      {/* One live region announces the result of both checks together. */}
      <p role="status" className="sr-only">
        {gh && authChecked
          ? `GitHub: ${ghStatus[gh.status].label}. GitHub Projects boards: ${boardText}.`
          : ''}
      </p>
    </>
  );
}

/** The GitHub device approval for Projects access: the code, Open GitHub, and Cancel. */
function BoardAccessDialog({
  services,
  open,
  onOpenChange,
}: {
  services: GitHubServices;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { auth, cancel, openGitHub, allow } = services;
  const pending = trackerAuthPending(auth);
  // Close the sheet when the approval is complete.
  useEffect(() => {
    if (open && auth.status === 'ready') onOpenChange(false);
  }, [open, auth.status]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="sm" layout="scroll">
        <DialogHeader>
          <DialogTitle>Allow access to GitHub Projects</DialogTitle>
          <DialogDescription>
            Kalkidan reads and updates the tasks on your boards. Approve it on GitHub.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-3" aria-live="polite">
          {auth.status === 'waiting' && auth.code ? (
            <>
              <p className="text-xs leading-4 text-muted-foreground">
                1. Copy this code. 2. Open GitHub and enter it. This window updates after you
                approve.
              </p>
              <Input
                aria-label="GitHub device code"
                className="w-40 font-mono"
                readOnly
                value={auth.code}
                onFocus={(event) => event.target.select()}
              />
            </>
          ) : auth.status === 'verifying' ? (
            <p role="status" className="text-xs leading-4">
              Checking the access…
            </p>
          ) : auth.status === 'error' ? (
            <p role="alert" className="field-error">
              {auth.message || 'The approval did not finish. Try again.'}
            </p>
          ) : (
            <p role="status" className="text-xs leading-4 text-muted-foreground">
              Getting a code…
            </p>
          )}
          {auth.message && auth.status !== 'error' && auth.status !== 'ready' && (
            <p className="text-xs leading-4 text-muted-foreground">{auth.message}</p>
          )}
        </DialogBody>
        <DialogFooter>
          <Button
            variant="outline"
            onClick={() => {
              if (pending) void cancel();
              onOpenChange(false);
            }}
          >
            Cancel
          </Button>
          {auth.status === 'error' ? (
            <Button onClick={() => void allow()}>Try again</Button>
          ) : (
            <Button disabled={auth.status !== 'waiting' || !auth.code} onClick={openGitHub}>
              Open GitHub
              <ExternalLink aria-hidden="true" />
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
