import { useEffect, useState, type ReactNode } from 'react';
import { Copy, ExternalLink, RefreshCw } from 'lucide-react';
import type { API, GitHubAuthState, GitHubCliStatus } from '../types';
import { trackerAuthPending } from '../domain/tracker';
import { interfaceConfig } from '../config/interface';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { EntityIcon } from './ui/entity-icon';
import { SectionHeader } from './ui/page-header';
import { showToast } from './ui/toast';
import { cn } from '../lib/utils';

/** Opens Settings › Accounts. Every GitHub sign-in outside Settings uses this. */
export function openAccountSettings() {
  window.dispatchEvent(
    new CustomEvent('kalkidan-open-settings', { detail: { section: 'accounts' } }),
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
        size="xs"
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

function GitHubMark() {
  return (
    <span
      className="tracker-provider-mark size-4"
      style={{ maskImage: 'url(./icons/github.svg)' }}
    />
  );
}

/**
 * Settings › Accounts › GitHub. Shows both GitHub permissions in one place: the GitHub CLI
 * sign-in for repositories, and the Projects access for GitHub Projects boards.
 */
export function GitHubAccount({ api, open }: { api: API; open: boolean }) {
  const [revision, setRevision] = useState(0);
  const [gh, setGh] = useState<GitHubCliStatus>();
  const [ghChecking, setGhChecking] = useState(false);
  const [auth, setAuth] = useState<GitHubAuthState>({ status: 'idle' });
  const [authChecking, setAuthChecking] = useState(false);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setGhChecking(true);
    setAuthChecking(true);
    Promise.resolve()
      .then(() => api.githubCliCheck())
      .then((value) => live && setGh(value))
      .catch(() => live && setGh({ status: 'error' }))
      .finally(() => live && setGhChecking(false));
    // Only read the current access. The approval starts when the user asks for it.
    Promise.resolve()
      .then(() => api.githubAuthStatus())
      .then((value) => live && setAuth(value))
      .catch(() => live && setAuth({ status: 'idle' }))
      .finally(() => live && setAuthChecking(false));
    return () => {
      live = false;
    };
  }, [open, api, revision]);
  useEffect(() => {
    if (!open || !trackerAuthPending(auth)) return;
    let live = true;
    const timer = setInterval(() => {
      void Promise.resolve()
        .then(() => api.githubAuthStatus())
        .then((value) => {
          if (!live) return;
          setAuth(value);
          if (value.status === 'ready') {
            setRevision((n) => n + 1);
          }
        })
        .catch(() => live && setAuth({ status: 'error', message: 'Approval stopped. Try again.' }));
    }, interfaceConfig.authPollMs);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [open, api, auth.status]);
  async function allow() {
    setAuth({ status: 'checking' });
    try {
      setAuth(await api.githubAuthStart(auth.status === 'ready'));
    } catch {
      setAuth({
        status: 'error',
        message: 'Could not start the GitHub approval. Restart Kalkidan, then try again.',
      });
    }
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
  const boardStatus = authChecking
    ? 'Checking…'
    : auth.status === 'ready'
      ? 'Allowed'
      : auth.status === 'waiting'
        ? 'Waiting for approval'
        : auth.status === 'verifying'
          ? 'Verifying access…'
          : auth.status === 'checking'
            ? 'Starting…'
            : 'Not allowed';
  return (
    <section aria-label="GitHub account" className="grid gap-2">
      <SectionHeader
        size="sm"
        title="GitHub"
        actions={
          <Button
            variant="outline"
            size="sm"
            disabled={ghChecking || authChecking}
            onClick={() => setRevision((n) => n + 1)}
          >
            <RefreshCw className={ghChecking ? 'animate-spin' : ''} />
            Check again
          </Button>
        }
      />
      <p className="form-help mt-0">
        Kalkidan uses the GitHub CLI (gh) on this computer. Sign in to gh once. Then allow the
        access that you need.
      </p>
      <ul className="mt-2 divide-y rounded-lg border">
        <AccountRow
          label="GitHub CLI status"
          name="Repositories"
          description="Find and clone your repositories, and open pull requests."
          path={gh?.path}
          status={ghStatus}
          ready={gh?.status === 'ready' && !ghChecking}
        >
          {!ghChecking && gh?.status === 'missing' && (
            <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs text-muted-foreground">
              <span>The GitHub CLI is not installed. Install it, then select Check again.</span>
              <HelpLink href="https://cli.github.com">How to install</HelpLink>
            </div>
          )}
          {!ghChecking && gh?.status === 'signed-out' && (
            <CommandHelp command="gh auth login">
              Run <code>gh auth login</code> in a terminal, then select Check again.
            </CommandHelp>
          )}
        </AccountRow>
        <AccountRow
          label="GitHub Projects board access"
          name="GitHub Projects boards"
          description="Show and update the tasks of a project on its GitHub Projects board."
          status={boardStatus}
          ready={auth.status === 'ready' && !authChecking}
          action={
            !trackerAuthPending(auth) && (
              <Button
                variant="outline"
                size="sm"
                disabled={authChecking || auth.status === 'checking'}
                onClick={() => void allow()}
              >
                {auth.status === 'ready'
                  ? 'Allow again'
                  : auth.status === 'error'
                    ? 'Try again'
                    : 'Allow access'}
              </Button>
            )
          }
        >
          {trackerAuthPending(auth) && auth.attemptId && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                void api
                  .githubAuthCancel(auth.attemptId!)
                  .then(setAuth)
                  .catch(() =>
                    setAuth({ ...auth, message: 'Could not cancel approval. Check again.' }),
                  );
              }}
            >
              Cancel approval
            </Button>
          )}
          {auth.status === 'waiting' && (
            <div className="mt-2 grid gap-2" aria-live="polite">
              <p className="text-xs text-muted-foreground">
                {auth.code
                  ? 'Open GitHub and enter this code. This page updates after you approve.'
                  : 'Getting a code…'}
              </p>
              {auth.code && (
                <div className="flex flex-wrap gap-2">
                  <Input
                    size="sm"
                    aria-label="GitHub device code"
                    className="w-32 font-mono"
                    readOnly
                    value={auth.code}
                    onFocus={(event) => event.target.select()}
                  />
                  <Button
                    size="sm"
                    onClick={() =>
                      void Promise.resolve()
                        .then(() => api.githubAuthOpen())
                        .catch(() =>
                          setAuth({
                            ...auth,
                            message:
                              'Could not open your browser. Go to github.com/login/device and enter the code.',
                          }),
                        )
                    }
                  >
                    Open GitHub
                  </Button>
                </div>
              )}
            </div>
          )}
          {auth.message && auth.status !== 'ready' && (
            <p
              role={auth.status === 'error' ? 'alert' : undefined}
              className={cn(
                'mt-1 text-xs',
                auth.status === 'error' ? 'field-error' : 'text-muted-foreground',
              )}
            >
              {auth.message}
            </p>
          )}
        </AccountRow>
      </ul>
      {/* One live region announces the result of both checks together. */}
      <p role="status" className="sr-only">
        {ghChecking || authChecking
          ? 'Checking GitHub…'
          : `GitHub CLI: ${ghStatus}. GitHub Projects boards: ${boardStatus}.`}
      </p>
    </section>
  );
}

function AccountRow({
  label,
  name,
  description,
  path,
  status,
  ready,
  action,
  children,
}: {
  label: string;
  name: string;
  description: string;
  path?: string;
  status: string;
  ready: boolean;
  action?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li
      role="group"
      aria-label={label}
      className="flex min-h-[var(--row-height-2line)] items-start gap-3 px-3 py-3"
    >
      <EntityIcon>
        <GitHubMark />
      </EntityIcon>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{name}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
        {path && (
          <p title={path} className="mt-0.5 truncate font-mono text-2xs text-muted-foreground">
            {path}
          </p>
        )}
        {children}
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <Badge variant={ready ? 'success' : 'muted'} size="sm">
          {status}
        </Badge>
        {action}
      </div>
    </li>
  );
}
