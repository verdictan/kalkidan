import { useEffect, useRef, useState } from 'react';
import {
  BookOpen,
  ChevronsUpDown,
  CircleAlert,
  ExternalLink,
  LogOut,
  Settings,
  UserRound,
} from 'lucide-react';
import type { API } from '../api/contracts';
import { keychainHostsMessage, keychainRefusedCode } from '../domain/verdictan';
import { accountNames, rejectedSessionText, verdictanErrorMessage } from '../lib/verdictan-labels';
import { regionNames } from '../lib/region-suggestion';
import { isMac, shortcutLabel } from '../lib/platform';
import { cn } from '../lib/utils';
import { useVerdictanStatus } from '../hooks/use-verdictan-status';
import { userGuideUrl } from './about-section';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { menuShortcutClass } from './ui/menu-styles';
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

/** The 24px avatar: the initials, or a person icon when nobody is signed in. */
function Avatar({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn('st-avatar st-avatar-sm', className)} aria-hidden="true">
      {text || <UserRound />}
    </span>
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

/** The Settings item of the account menu. Settings also opens with ⌘,. */
function SettingsItem() {
  return (
    <DropdownMenuItem
      aria-keyshortcuts={isMac ? 'Meta+,' : 'Control+,'}
      onSelect={() => openSettings()}
    >
      <Settings className="size-4" />
      <span className="flex-1">Settings…</span>
      <span className={menuShortcutClass} aria-hidden="true">
        {shortcutLabel(['mod'], ',')}
      </span>
    </DropdownMenuItem>
  );
}

/**
 * The account row in the sidebar footer: the avatar, the name and the organization on two
 * lines, then a chevron. The row opens the account menu: the email and the region, Settings…
 * (⌘,), Manage account, Help and feedback, and Sign out. Signed out, the row is one "Sign in"
 * button (one click starts the sign-in); Settings then opens with ⌘, and the app menu.
 */
export function AccountMenu({ api }: { api: API }) {
  const { status, supported } = useVerdictanStatus(api);
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
  const help = (
    <DropdownMenuItem asChild>
      <a href={userGuideUrl} target="_blank" rel="noreferrer">
        <BookOpen className="size-4" />
        Help and feedback
        <ExternalLink className="ml-auto size-4" aria-label="Opens in the browser" />
      </a>
    </DropdownMenuItem>
  );
  // The menu stays inside the sidebar: as wide as the footer row.
  const menuClass = 'account-menu-content w-[calc(var(--navigation-width)-var(--space-4))]';
  if (!signedIn) {
    const authorizing = status?.phase === 'authorizing';
    const label = supported
      ? authorizing
        ? 'Finish signing in…'
        : status?.phase === 'expired'
          ? 'Sign in again'
          : 'Sign in'
      : 'Kalkidan';
    return (
      <div className="account-menu st-account-row" data-state="signed-out">
        {supported ? (
          <button
            type="button"
            className="st-account-trigger row-focus"
            onClick={() => startSignIn('login')}
          >
            <Avatar text="" className="st-avatar-empty" />
            <span className="st-account-label">{label}</span>
          </button>
        ) : (
          <span className="st-account-trigger">
            <Avatar text="" className="st-avatar-empty" />
            <span className="st-account-label">{label}</span>
          </span>
        )}
      </div>
    );
  }
  const name = names.user || names.email || 'Signed in';
  const avatar = initials(names.user || names.email);
  const region = status?.region ? regionNames[status.region] : '';
  const header = [
    names.email !== name ? names.email : '',
    [names.organization, region].filter(Boolean).join(' · '),
  ].filter(Boolean);
  return (
    <div className="account-menu st-account-row" data-state="signed-in">
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="st-account-trigger row-focus"
            aria-label={`Account: ${name}${names.organization ? `, ${names.organization}` : ''}`}
          >
            <Avatar text={avatar} />
            <span className="st-account-who">
              <span className="st-account-label">{name}</span>
              {names.organization && <span className="st-account-org">{names.organization}</span>}
            </span>
            <ChevronsUpDown className="st-account-chevron-icon" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className={menuClass}>
          {header.length > 0 && (
            <DropdownMenuLabel className="account-menu-header">
              <span className="min-w-0">
                {header.map((line) => (
                  <span key={line} className="block truncate text-xs font-normal">
                    {line}
                  </span>
                ))}
              </span>
            </DropdownMenuLabel>
          )}
          {header.length > 0 && <DropdownMenuSeparator />}
          <SettingsItem />
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
          {help}
          <DropdownMenuSeparator />
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
        showToast('Verdictan is ready. Try again.');
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
