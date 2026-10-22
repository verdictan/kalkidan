import { useEffect, useState } from 'react';
import {
  BookOpen,
  Building2,
  ChevronsUpDown,
  CircleAlert,
  Clock,
  ExternalLink,
  Globe,
  Keyboard,
  LogIn,
  LogOut,
  MessageSquareWarning,
  MoreHorizontal,
  Settings2,
  UserRound,
  X,
} from 'lucide-react';
import type { API } from '../api/contracts';
import type { VerdictanStatus } from '../domain/verdictan';
import { accountNames } from '../lib/verdictan-labels';
import { regionNames } from '../lib/region-suggestion';
import { isMac, shortcutLabel } from '../lib/platform';
import { cn } from '../lib/utils';
import { useFirstRunState, useVerdictanStatus } from '../hooks/use-verdictan-status';
import { Hint } from './hint';
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
import { showToast } from './ui/toast';
import { openSettings, SignInSteps, startSignIn, type SignInIntent } from './sign-in-steps';

export { startSignIn } from './sign-in-steps';

const userGuideUrl = 'https://github.com/verdictan/kalkidan/blob/main/docs/user-guide.md';
const issuesUrl = 'https://github.com/verdictan/kalkidan/issues';
const computerName = isMac ? 'this Mac' : 'this computer';

/** Opens the keyboard shortcuts sheet. The shell handles the event. */
function showShortcuts() {
  window.dispatchEvent(new Event('kalkidan-show-shortcuts'));
}

/** Two letters for the avatar: "Dana Kim" is "DK", "dana.kim@acme.dev" is "DA". */
export function initials(name: string | undefined) {
  const text = (name || '').replace(/@.*$/, '').trim();
  if (!text) return '';
  const words = text.split(/[\s._-]+/).filter(Boolean);
  const letters =
    words.length > 1 ? words[0][0] + words[words.length - 1][0] : words[0].slice(0, 2);
  return letters.toUpperCase();
}

/** "Renews automatically", or the end of the session when it ended. */
function sessionLabel(status: VerdictanStatus | undefined) {
  if (status?.phase === 'expired') return 'Ended';
  return 'Renews automatically';
}

function Avatar({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn('account-menu-avatar', className)} aria-hidden="true">
      {text || <UserRound />}
    </span>
  );
}

/** The help items that every account menu shows. */
function HelpItems({ updateLabel }: { updateLabel?: string }) {
  return (
    <>
      <DropdownMenuItem onSelect={() => openSettings(updateLabel ? 'about' : undefined)}>
        <Settings2 className="size-4" />
        Settings
        {updateLabel && (
          <span className="account-menu-update" title={updateLabel}>
            Update
          </span>
        )}
        <DropdownMenuShortcut>{shortcutLabel(['mod'], ',')}</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={showShortcuts}>
        <Keyboard className="size-4" />
        Keyboard shortcuts
        <DropdownMenuShortcut>{shortcutLabel(['mod'], '/')}</DropdownMenuShortcut>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <a href={userGuideUrl} target="_blank" rel="noreferrer">
          <BookOpen className="size-4" />
          User guide
          <ExternalLink className="ml-auto size-4" aria-label="Opens in the browser" />
        </a>
      </DropdownMenuItem>
      <DropdownMenuItem asChild>
        <a href={issuesUrl} target="_blank" rel="noreferrer">
          <MessageSquareWarning className="size-4" />
          Report an issue
          <ExternalLink className="ml-auto size-4" aria-label="Opens in the browser" />
        </a>
      </DropdownMenuItem>
    </>
  );
}

/**
 * The account button in the sidebar footer, with its menu. Signed in: initials, name and
 * organization. Signed out: a "Sign in" button and a menu for Settings and help. It replaces
 * the Settings and Keyboard shortcuts buttons of the footer; both are in its menu.
 *
 * `updateLabel` is set when a desktop update is ready. Settings then opens About.
 */
export function AccountMenu({ api, updateLabel }: { api: API; updateLabel?: string }) {
  const { status, supported } = useVerdictanStatus(api);
  const names = accountNames(status);
  const signedIn = status?.phase === 'authenticated';
  const [signingOut, setSigningOut] = useState(false);
  async function signOut() {
    setSigningOut(true);
    try {
      const result = await api.verdictanLogout();
      if (result.phase !== 'authenticated') showToast('Signed out');
    } catch {
      showToast({ message: 'Kalkidan could not sign out. Try again.', tone: 'error' });
    } finally {
      setSigningOut(false);
    }
  }
  if (!signedIn) {
    const authorizing = status?.phase === 'authorizing';
    return (
      <div className="account-menu" data-state="signed-out">
        {supported && (
          <Button
            variant="outline"
            size="sm"
            className="min-w-0 flex-1 justify-start"
            onClick={() => startSignIn('login')}
          >
            <LogIn />
            {authorizing ? 'Finish signing in…' : 'Sign in'}
          </Button>
        )}
        <DropdownMenu>
          <Hint label="Settings and help">
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className={cn('text-muted-foreground', !supported && 'ml-auto')}
                aria-label="Settings and help"
              >
                {updateLabel ? <Settings2 /> : <MoreHorizontal />}
                {updateLabel && <span className="sidebar-update-dot" aria-hidden="true" />}
              </Button>
            </DropdownMenuTrigger>
          </Hint>
          <DropdownMenuContent side="top" align="end" className="w-64">
            {supported && (
              <>
                <DropdownMenuItem onSelect={() => startSignIn('login')}>
                  <LogIn className="size-4" />
                  Sign in
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => startSignIn('register')}>
                  <UserRound className="size-4" />
                  Create account
                </DropdownMenuItem>
                <DropdownMenuSeparator />
              </>
            )}
            <HelpItems updateLabel={updateLabel} />
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }
  const name = names.user || names.email || 'Signed in';
  const avatar = initials(names.user || names.email);
  return (
    <div className="account-menu" data-state="signed-in">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="account-menu-trigger row-focus"
            aria-label={`Account: ${name}${names.organization ? `, ${names.organization}` : ''}`}
          >
            <Avatar text={avatar} />
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-sm leading-4 font-medium">{name}</span>
              <span className="block truncate text-xs leading-4 text-muted-foreground">
                {names.organization || 'Verdictan'}
              </span>
            </span>
            {updateLabel && <span className="sidebar-update-dot" aria-hidden="true" />}
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="start" className="account-menu-content w-72">
          <DropdownMenuLabel className="account-menu-header">
            <Avatar text={avatar} className="size-8" />
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium text-foreground">{name}</span>
              {names.email && names.email !== name && (
                <span className="block truncate text-xs font-normal">{names.email}</span>
              )}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <dl className="account-menu-facts">
            <div title="To use another organization, sign out and sign in again.">
              <dt>
                <Building2 className="size-4" aria-hidden="true" />
                Organization
              </dt>
              <dd>{names.organization || 'Not known'}</dd>
            </div>
            <div>
              <dt>
                <Globe className="size-4" aria-hidden="true" />
                Region
              </dt>
              <dd>{status?.region ? regionNames[status.region] : 'Not chosen'}</dd>
            </div>
            <div>
              <dt>
                <Clock className="size-4" aria-hidden="true" />
                Session
              </dt>
              <dd>{sessionLabel(status)}</dd>
            </div>
          </dl>
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
          <HelpItems updateLabel={updateLabel} />
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
 * The inline banner above the page content when the Verdictan session ended, or when the user
 * skipped the sign-in. It is not a modal: projects and chats stay usable.
 */
export function SessionBanner({ api }: { api: API }) {
  const { status } = useVerdictanStatus(api);
  const { state } = useFirstRunState(api);
  const [hidden, setHidden] = useState(false);
  const phase = status?.phase;
  // A missing region or a missing runtime also means that nobody is signed in.
  const signedOut =
    phase === 'signed-out' ||
    phase === 'missing' ||
    (phase === 'error' && status?.error === 'desktop.region_required');
  const ended = phase === 'expired' || (signedOut && !!state?.everSignedIn);
  const never = signedOut && !!state && !state.everSignedIn && state.welcomeDone;
  useEffect(() => {
    if (phase === 'authenticated') setHidden(false);
  }, [phase]);
  if (!state || hidden || (!ended && !never)) return null;
  return (
    <div className="session-banner" role="status" data-testid="session-banner">
      <CircleAlert className="session-banner-icon" aria-hidden="true" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {ended ? 'Your session ended' : 'Sign in to start chats'}
        </p>
        <p className="text-xs leading-4 text-muted-foreground">
          {ended
            ? `Sign in again to start new chats. Your projects and chats stay on ${computerName}.`
            : 'Chats run as managed agents through your Verdictan account. Your projects stay on this computer.'}
        </p>
      </div>
      {never && (
        <Button variant="ghost" size="sm" onClick={() => startSignIn('register')}>
          Create account
        </Button>
      )}
      <Button size="sm" onClick={() => startSignIn('login')}>
        {ended ? 'Sign in again' : 'Sign in'}
      </Button>
      {never && (
        <Hint label="Hide until the next launch">
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Hide sign-in banner"
            onClick={() => setHidden(true)}
          >
            <X />
          </Button>
        </Hint>
      )}
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
      <DialogContent size="md" className="sign-in-dialog">
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
