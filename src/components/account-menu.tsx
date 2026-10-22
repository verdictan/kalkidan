import { useEffect, useState } from 'react';
import {
  BookOpen,
  ChevronsUpDown,
  CircleAlert,
  ExternalLink,
  Laptop,
  LogIn,
  LogOut,
  MoreHorizontal,
  Settings2,
  UserRound,
  BellRing,
} from 'lucide-react';
import type { API } from '../api/contracts';
import type { NotificationPreferences } from '../domain/verdictan';
import { accountNames } from '../lib/verdictan-labels';
import { regionNames } from '../lib/region-suggestion';
import { shortcutLabel } from '../lib/platform';
import { cn } from '../lib/utils';
import { useVerdictanStatus } from '../hooks/use-verdictan-status';
import { userGuideUrl } from './about-section';
import { openComputers } from './computers-page';
import { GetStartedMenuItem } from './onboarding';
import { Hint } from './hint';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './ui/dialog';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Switch } from './ui/switch';
import { showToast } from './ui/toast';
import { openSettings, SignInSteps, startSignIn, type SignInIntent } from './sign-in-steps';

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

function Avatar({ text, className }: { text: string; className?: string }) {
  return (
    <span className={cn('account-menu-avatar', className)} aria-hidden="true">
      {text || <UserRound />}
    </span>
  );
}

/**
 * The one notification switch: "Tell me when an agent finishes or needs me". The desktop keeps
 * two flags (finished and needs input). The switch sets both.
 */
function NotificationItem({ api, open }: { api: API; open: boolean }) {
  const [preferences, setPreferences] = useState<NotificationPreferences>();
  useEffect(() => {
    if (!open || typeof api.notificationPreferences !== 'function') return;
    void Promise.resolve()
      .then(() => api.notificationPreferences())
      .then(setPreferences, () => {});
  }, [api, open]);
  if (!preferences) return null;
  const on = preferences.finished || preferences.needsInput;
  async function toggle() {
    if (!preferences) return;
    const before = preferences;
    const next = { ...preferences, finished: !on, needsInput: !on };
    setPreferences(next);
    try {
      setPreferences(await api.setNotificationPreferences(next));
    } catch {
      setPreferences(before);
      showToast({ message: 'Could not save the notification setting.', tone: 'error' });
    }
  }
  return (
    <DropdownMenuCheckboxItem
      checked={on}
      // The switch shows the state. The check mark of the item does not show.
      className="account-menu-switch-item pl-2"
      aria-label="Tell me when an agent finishes or needs me"
      title="Tell me when an agent finishes or needs me. Only when Kalkidan is in the background."
      onSelect={(event) => {
        event.preventDefault();
        void toggle();
      }}
    >
      <BellRing className="size-4" />
      Notifications
      <Switch
        checked={on}
        tabIndex={-1}
        aria-hidden="true"
        className="pointer-events-none ml-auto"
      />
    </DropdownMenuCheckboxItem>
  );
}

/** The items that every account menu shows: Computers, Preferences, shortcuts and help. */
function AppItems() {
  return (
    <>
      <GetStartedMenuItem />
      <DropdownMenuItem onSelect={() => openComputers()}>
        <Laptop className="size-4" />
        Computers
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={() => openSettings()}>
        <Settings2 className="size-4" />
        Preferences…
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
 * The account row in the sidebar footer: one 48px trigger that fills the row. Signed in, it
 * shows the initials, the name and the organization, and opens the account menu:
 * notifications, Computers, Preferences, help, and Sign out. Signed out, it is the
 * one "Sign in" of the app, with a "…" menu for the same app items.
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
  if (!signedIn) {
    const authorizing = status?.phase === 'authorizing';
    return (
      <div className="account-menu" data-state="signed-out">
        {supported ? (
          <button
            type="button"
            className="account-menu-trigger row-focus"
            onClick={() => startSignIn('login')}
          >
            <Avatar text="" className="account-menu-avatar-empty" />
            <span className="min-w-0 flex-1 truncate text-left text-sm font-medium">
              {authorizing ? 'Finish signing in…' : 'Sign in'}
            </span>
            <LogIn className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
          </button>
        ) : (
          <span className="flex-1" />
        )}
        <DropdownMenu open={open} onOpenChange={setOpen}>
          <Hint label="Preferences and help">
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                aria-label="Preferences and help"
              >
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
          </Hint>
          <DropdownMenuContent side="top" align="end" className="account-menu-content w-72">
            <NotificationItem api={api} open={open} />
            <DropdownMenuSeparator />
            <AppItems />
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
            aria-label={`Account: ${name}${names.organization ? `, ${names.organization}` : ''}`}
          >
            <Avatar text={avatar} />
            <span className="min-w-0 flex-1 text-left">
              <span className="block truncate text-sm leading-4 font-medium">{name}</span>
              <span className="block truncate text-xs leading-4 text-muted-foreground">
                {names.organization || 'Verdictan'}
              </span>
            </span>
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
              {subtitle && <span className="block truncate text-xs font-normal">{subtitle}</span>}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          <NotificationItem api={api} open={open} />
          <DropdownMenuSeparator />
          <AppItems />
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
 * The strip above the page when the Verdictan session ended. It is not a modal: projects and
 * chats stay usable. A user who never signed in, or who signed out, sees no strip: the
 * "Sign in" row in the sidebar footer is the one sign-in prompt.
 */
export function SessionBanner({ api }: { api: API }) {
  const { status } = useVerdictanStatus(api);
  if (status?.phase !== 'expired') return null;
  return (
    <div className="session-banner" role="status" data-testid="session-banner">
      <CircleAlert className="session-banner-icon" aria-hidden="true" />
      <p className="min-w-0 flex-1 truncate text-sm font-medium">Your session ended</p>
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
