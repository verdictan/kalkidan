import { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronsUpDown,
  CircleAlert,
  ExternalLink,
  LogIn,
  LogOut,
  Settings2,
  UserRound,
} from 'lucide-react';
import type { API } from '../api/contracts';
import { keychainHostsMessage, keychainRefusedCode } from '../domain/verdictan';
import { accountNames, rejectedSessionText, verdictanErrorMessage } from '../lib/verdictan-labels';
import { regionNames } from '../lib/region-suggestion';
import { shortcutLabel } from '../lib/platform';
import { cn } from '../lib/utils';
import { useVerdictanStatus } from '../hooks/use-verdictan-status';
import { userGuideUrl } from './about-section';
import { useComputersAttention } from './settings-attention';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { StatusDot } from './ui/status-dot';
import { showToast } from './ui/toast';
import { openSettings, SignInSteps, startSignIn, type SignInIntent } from './sign-in-steps';
import { checkStatusEvent } from './chat-links';

export { startSignIn } from './sign-in-steps';

/** Two letters for the avatar: "Dana Kim" is "DK", "dana.kim@acme.dev" is "DA". */
export function initials(name: string | undefined) {
  const text = (name || '').replace(/@.*$/, '').trim();
  if (!text) return '';
  const words = text.split(/[\s._-]+/).filter(Boolean);
  const letters =
    words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0].slice(0, 2);
  return letters.toUpperCase();
}

/** The avatar. `attention` adds an amber dot: something in Settings needs the user. */
function Avatar({
  text,
  className,
  attention = false,
}: {
  text: string;
  className?: string;
  attention?: boolean;
}) {
  return (
    <span className={cn('account-menu-avatar', className)} aria-hidden="true">
      {text || <UserRound />}
      {attention && <span className="account-menu-attention" />}
    </span>
  );
}

/**
 * The items that every account menu shows: Settings and help. The menu holds only
 * actions. The settings, also notifications and Computers, are in Settings.
 */
function AppItems({ attention }: { attention: boolean }) {
  return (
    <>
      <DropdownMenuItem onSelect={() => openSettings(attention ? 'computers' : undefined)}>
        <Settings2 className="size-4" />
        Settings…
        {attention && <StatusDot tone="warning" size="sm" label="Needs attention" />}
        <DropdownMenuShortcut>{shortcutLabel(['mod'], ',')}</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <a href={userGuideUrl} target="_blank" rel="noreferrer">
          <BookOpen className="size-4" />
          Help and feedback
          <ExternalLink className="ml-auto size-4" aria-label="Opens in the browser" />
        </a>
      </DropdownMenuItem>
    </>
  );
}

/** Opens and closes the account menu. Other places open it with `kalkidan-open-account-menu`. */
function useMenuOpen() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener('kalkidan-open-account-menu', show);
    return () => window.removeEventListener('kalkidan-open-account-menu', show);
  }, []);
  return [open, setOpen] as const;
}

/**
 * The account row in the sidebar footer: one 48px trigger that fills the row, in both states.
 * Signed in, it shows the initials, the name and the organization, and opens the account menu:
 * Settings…, help, and Sign out. Signed out, it shows "Sign in", and the same menu
 * starts with "Sign in". When something in Settings › Computers needs the user, for example an
 * old Claude Code, the avatar and "Settings…" show an amber dot.
 */
export function AccountMenu({ api }: { api: API }) {
  const { status, supported } = useVerdictanStatus(api);
  const attention = useComputersAttention(api);
  const attentionText = attention ? ', something needs your attention' : '';
  const names = accountNames(status);
  const signedIn = status?.phase === 'authenticated';
  const [signingOut, setSigningOut] = useState(false);
  const [open, setOpen] = useMenuOpen();
  async function signOut() {
    setSigningOut(true);
    try {
      const result = await api.verdictanLogout();
      if (result.phase === 'authenticated') return;
      if (result.remoteRevocationPending)
        showToast({
          message:
            'You are signed out on this computer. Kalkidan could not confirm that the service removed the access.',
          tone: 'error',
        });
      else showToast('Signed out');
    } catch {
      showToast({ message: 'Kalkidan could not sign out. Try again.', tone: 'error' });
    } finally {
      setSigningOut(false);
    }
  }
  if (!signedIn) {
    const authorizing = status?.phase === 'authorizing';
    // An ended or refused session needs a new sign-in. The account is not signed in then.
    const label = supported
      ? authorizing
        ? 'Finish signing in…'
        : status?.phase === 'expired'
          ? 'Sign in again'
          : 'Sign in'
      : 'Kalkidan';
    // The same trigger as when signed in. "Sign in" is the first item of the menu.
    return (
      <div className="account-menu" data-state="signed-out">
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className="account-menu-trigger row-focus"
              aria-label={
                (supported ? `${label}, Settings and help` : 'Settings and help') + attentionText
              }
            >
              <Avatar text="" className="account-menu-avatar-empty" attention={attention} />
              <span className="min-w-0 flex-1 truncate text-left text-sm font-medium">{label}</span>
              <ChevronsUpDown
                className="size-4 shrink-0 text-muted-foreground"
                aria-hidden="true"
              />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            side="top"
            align="start"
            // The menu stays inside the sidebar: as wide as the footer row.
            className="account-menu-content w-[calc(var(--navigation-width)-var(--space-6))]"
          >
            {supported && (
              <>
                <DropdownMenuItem onSelect={() => startSignIn('login')}>
                  <LogIn className="size-4" />
                  {label}
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <AppItems attention={attention} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }
  const name = names.user || names.email || 'Signed in';
  const avatar = initials(names.user || names.email);
  const region = status?.region ? regionNames[status.region] : '';
  const subtitle = [names.organization, region].filter(Boolean).join(' · ');
  return (
    <div className="account-menu" data-state="signed-in">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="account-menu-trigger row-focus"
            aria-label={`Account: ${name}${names.organization ? `, ${names.organization}` : ''}${attentionText}`}
          >
            <Avatar text={avatar} attention={attention} />
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-sm leading-4 font-medium">{name}</span>
              <span className="block truncate text-xs leading-4 text-muted-foreground">
                {names.organization || 'Verdictan'}
              </span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          side="top"
          align="start"
          // The menu stays inside the sidebar: as wide as the footer row.
          className="account-menu-content w-[calc(var(--navigation-width)-var(--space-6))]"
        >
          <DropdownMenuLabel className="account-menu-header">
            <Avatar text={avatar} className="size-8" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-foreground">{name}</span>
              {names.email && names.email !== name && (
                <span className="block truncate text-xs font-normal">{names.email}</span>
              )}
              {subtitle && <span className="block truncate text-xs font-normal">{subtitle}</span>}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <AppItems attention={attention} />
          <DropdownMenuSeparator />
          {typeof api.verdictanOpenConsole === 'function' && (
            <DropdownMenuItem
              onSelect={() =>
                void api
                  .verdictanOpenConsole()
                  .catch(() =>
                    showToast({ message: 'The browser did not open. Try again.', tone: 'error' }),
                  )
              }
            >
              <UserRound className="size-4" />
              Manage account
              <ExternalLink className="ml-auto size-4" aria-label="Opens in the browser" />
            </DropdownMenuItem>
          )}
          <DropdownMenuItem disabled={signingOut} onSelect={() => void signOut()}>
            <LogOut className="size-4" />
            Sign out
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/**
 * The strip above the page when the Verdictan session ended, or when the system keychain
 * refused access. It is not a modal: projects and chats stay usable. A user who never signed
 * in, or who signed out, sees no strip: the "Sign in" row in the sidebar footer is the one
 * sign-in prompt.
 *
 * After a refused keychain prompt, Kalkidan does not try again by itself. "Check status" here,
 * or in a chat error, checks the account again on this computer and on each SSH host. This
 * starts the runtime again, so the system asks again.
 */
export function SessionBanner({ api }: { api: API }) {
  const { status, setStatus } = useVerdictanStatus(api);
  const [hosts, setHosts] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const running = useRef(false);
  async function check() {
    if (running.current || typeof api.verdictanCheck !== 'function') return;
    running.current = true;
    setChecking(true);
    try {
      const next = await api.verdictanCheck();
      setStatus(next);
      setHosts(next.keychainHosts ?? []);
      if (next.phase === 'authenticated' && !next.keychainHosts?.length)
        showToast('Managed agents are ready. Try again.');
    } catch {
      showToast({ message: 'Kalkidan could not check the status. Try again.', tone: 'error' });
    } finally {
      running.current = false;
      setChecking(false);
    }
  }
  const latest = useRef(check);
  latest.current = check;
  useEffect(() => {
    const run = () => void latest.current();
    window.addEventListener(checkStatusEvent, run);
    return () => window.removeEventListener(checkStatusEvent, run);
  }, []);
  const refused = status?.error === keychainRefusedCode;
  if (refused || hosts.length)
    return (
      <div className="session-banner" role="status" data-testid="keychain-banner">
        <CircleAlert className="session-banner-icon" aria-hidden="true" />
        <p className="min-w-0 flex-1 text-sm">
          {refused ? verdictanErrorMessage(keychainRefusedCode) : keychainHostsMessage(hosts)}
        </p>
        <Button variant="outline" size="sm" disabled={checking} onClick={() => void check()}>
          {checking ? 'Checking…' : 'Check status'}
        </Button>
      </div>
    );
  if (status?.phase !== 'expired') return null;
  return (
    <div className="session-banner" role="status" data-testid="session-banner">
      <CircleAlert className="session-banner-icon" aria-hidden="true" />
      <p className="min-w-0 flex-1 truncate text-sm font-medium">
        {rejectedSessionText(status) || 'Your session ended'}
      </p>
      <Button variant="outline" size="sm" onClick={() => startSignIn('login')}>
        Sign in again
      </Button>
    </div>
  );
}

/**
 * The sign-in dialog of an open app. Mount it once. It opens on the window event
 * `kalkidan-sign-in` {intent?: 'login' | 'register'} and shows the same steps as the Welcome
 * screen: region, browser, setup.
 */
export function SignInFlow({ api }: { api: API }) {
  const [request, setRequest] = useState<{ intent: SignInIntent; key: number }>();
  useEffect(() => {
    const open = (event: Event) => {
      const intent = (event as CustomEvent<{ intent?: SignInIntent }>).detail?.intent;
      setRequest({ intent: intent === 'register' ? 'register' : 'login', key: Date.now() });
    };
    window.addEventListener('kalkidan-sign-in', open);
    return () => window.removeEventListener('kalkidan-sign-in', open);
  }, []);
  if (typeof api.verdictanStatus !== 'function') return null;
  return (
    <Dialog open={!!request} onOpenChange={(open) => !open && setRequest(undefined)}>
      <DialogContent size="sm">
        <DialogTitle className="sr-only">
          {request?.intent === 'register' ? 'Create a Verdictan account' : 'Sign in to Verdictan'}
        </DialogTitle>
        <DialogDescription className="sr-only">
          Kalkidan opens your browser to sign in. Kalkidan never sees your password.
        </DialogDescription>
        {request && (
          <SignInSteps
            key={request.key}
            api={api}
            mode="dialog"
            intent={request.intent}
            autoStart
            onFinished={() => setRequest(undefined)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
