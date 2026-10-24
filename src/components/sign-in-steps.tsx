import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Clock, Copy, ExternalLink, LoaderCircle, X } from 'lucide-react';
import type { API } from '../api/contracts';
import type { VerdictanAccountPage, VerdictanSetup, VerdictanStatus } from '../domain/verdictan';
import {
  computerAgentLabel,
  isSubscriptionMode,
  localComputer,
  managedErrorCode,
  managedErrorInfo,
} from '../domain/verdictan';
import {
  accountChanging,
  accountNames,
  allowedModels,
  providerName,
  verdictanErrorMessage,
} from '../lib/verdictan-labels';
import {
  otherRegion,
  regionConsoleHosts,
  regionNames,
  regions,
  suggestRegion,
  urlHost,
  type Region,
} from '../lib/region-suggestion';
import { cn } from '../lib/utils';
import {
  runtimeProgress,
  useRuntimeStatus,
  useVerdictanStatus,
} from '../hooks/use-verdictan-status';
import { Button } from './ui/button';
import { EntityIcon } from './ui/entity-icon';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Progress } from './ui/progress';
import { showToast } from './ui/toast';

export type SignInIntent = 'login' | 'register';

/**
 * How the first run ended. `signedIn` is false when the user skipped or closed the sign-in.
 * `groupId` is the project that the Welcome card made, if any. The shell opens it.
 */
export interface SignInResult {
  signedIn: boolean;
  groupId?: string;
}

/**
 * Where the sign-in shows: the full window, a dialog, step 1 of the Welcome card, or the card
 * under a message that waits for the sign-in (gate).
 */
export type SignInMode = 'window' | 'dialog' | 'step' | 'gate';

type View = 'start' | 'waiting' | 'setup' | 'error';

// The runtime waits 310 seconds for the browser. Use it when the status has no end time.
const authorizationWindowMs = 310_000;
// The longest wait for the setup of the organization after the sign-in. It continues after.
const setupWaitMs = 8000;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Opens the one Settings window at a section: 'general', 'computers', 'account',
 * 'project:<id>', or an older name such as 'agents'. The shell handles the event.
 */
export function openSettings(section?: string, anchor?: string) {
  window.dispatchEvent(new CustomEvent('kalkidan-open-settings', { detail: { section, anchor } }));
}

/** Starts the sign-in flow from anywhere in the app. SignInFlow handles the event. */
export function startSignIn(intent: SignInIntent = 'login') {
  window.dispatchEvent(new CustomEvent('kalkidan-sign-in', { detail: { intent } }));
}

/** The visible name of the signed-in person: the name, then the email, then the organization. */
export function signedInName(status: VerdictanStatus | undefined) {
  const names = accountNames(status);
  return names.email || names.user || names.organization || 'your account';
}

const accessNames: Record<string, string> = {
  codex_subscription: 'ChatGPT subscription',
  claude_subscription: 'Claude subscription',
};

/**
 * One line for the saved setup of an agent, for example
 * "Kalkidan agent · Claude subscription · claude-sonnet-5". Undefined when there is no setup.
 */
export function setupSummary(setup: VerdictanSetup | undefined, agent: 'codex' | 'claude') {
  const selection = setup?.selections[agent];
  if (!setup || !selection) return undefined;
  // Codex and Claude Code on this computer both use the agent of this computer.
  const who = computerAgentLabel(setup, localComputer);
  const connection = setup.providerConnections.find(
    (item) => item.provider_connection_id === selection.providerConnectionId,
  );
  const access = isSubscriptionMode(selection.providerAccessMode)
    ? accessNames[selection.providerAccessMode]
    : connection
      ? connection.name || `${providerName(connection.provider)} connection`
      : undefined;
  const model = selection.model || allowedModels(setup, agent)?.[0];
  return [who, access, model].filter(Boolean).join(' · ') || 'Organization default';
}

/** The words and the actions for a sign-in error. */
interface ErrorCopy {
  title: string;
  body: string;
  primary: { label: string; run: () => void };
  secondary?: { label: string; run: () => void };
}

const connectionCode = /^desktop\.(transport_\w+|gateway_\w+|network_\w+|offline)$/;
const billingCodes = new Set([
  'desktop.setup_bootstrap_required',
  'desktop.setup_default_configuration_required',
  'desktop.setup_permission_required',
]);

/** The code in a failure: a managed code in the message, or a general one. */
function failureCode(error: unknown) {
  const text = error instanceof Error ? error.message : String(error ?? '');
  return managedErrorCode(text) || 'desktop.operation_failed';
}

/**
 * The Verdictan sign-in in one card: sign in, wait for the browser, then get the setup of the
 * organization. The Welcome screen shows it in the full window. SignInFlow shows it in a dialog.
 * The region is an inline menu on the card. After the sign-in, the card saves the recommended
 * setup and finishes at once. Only a setup that blocks managed agents stops on the card.
 */
export function SignInSteps({
  api,
  mode,
  intent: requestedIntent,
  autoStart = false,
  onFinished,
  onSkip,
}: {
  api: API;
  /**
   * window: a full-window screen. dialog: the sign-in dialog of an open app. step: step 1 of
   * the Welcome card, with no title of its own.
   */
  mode: SignInMode;
  intent?: SignInIntent;
  /** Starts the sign-in at once when the region is already saved. */
  autoStart?: boolean;
  onFinished: (result: SignInResult) => void;
  /** Shows "Set up later" under the main button. */
  onSkip?: () => void;
}) {
  const account = useVerdictanStatus(api);
  const runtime = useRuntimeStatus(api);
  const status = account.status;
  const suggestion = useMemo(() => suggestRegion(), []);
  const [chosenRegion, setChosenRegion] = useState<Region>();
  const region: Region | undefined = chosenRegion ?? status?.region ?? suggestion;
  const [view, setView] = useState<View>('start');
  // The intent of the sign-in that runs now.
  const [intent, setIntent] = useState<SignInIntent>(requestedIntent || 'login');
  // The button that shows "Getting ready…" while the runtime installs.
  const [preparing, setPreparing] = useState<SignInIntent>();
  const [errorCode, setErrorCode] = useState('');
  const [signingOut, setSigningOut] = useState(false);
  const [recoveryLabel, setRecoveryLabel] = useState('Signing out…');
  const signOutPending = useRef(false);
  const [runtimeReason, setRuntimeReason] = useState('');
  // A setup error that stops managed agents for the organization, for example billing.
  const [setupError, setSetupError] = useState('');
  // The last sign-in link. It stays for "Copy link" after the browser did not open.
  const [lastUrl, setLastUrl] = useState('');
  const [startedAt, setStartedAt] = useState(0);
  const [regionMenuOpen, setRegionMenuOpen] = useState(false);
  // The sign-in to start after the user chooses a region in the menu.
  const pendingIntent = useRef<SignInIntent | undefined>(undefined);
  // Each attempt has a number. A cancel or a new attempt makes the old result stale.
  const attempt = useRef(0);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      attempt.current++;
    };
  }, []);
  useEffect(() => {
    if (status?.authorization?.url) setLastUrl(status.authorization.url);
  }, [status?.authorization?.url]);

  const setAccountStatus = account.setStatus;
  // True after Cancel until the status leaves "authorizing", so the view does not jump back.
  const cancelling = useRef(false);
  const finishSignIn = useCallback(
    (result: VerdictanStatus, id: number) => {
      if (!live.current || id !== attempt.current) return;
      setAccountStatus(result);
      if (result.phase === 'authenticated') {
        attempt.current++;
        // The Welcome card shows the name in step 1 at once. A toast would say it twice.
        if (mode !== 'step') showToast(`Signed in as ${signedInName(result)}`);
        setView('setup');
        return;
      }
      if (result.error) {
        setErrorCode(result.error);
        setView('error');
        return;
      }
      if (result.phase === 'missing') {
        setErrorCode('runtime');
        setView('error');
        return;
      }
      // The sign-in stopped with no error, for example after a cancel in the runtime.
      if (result.phase !== 'authorizing') setView('start');
    },
    [setAccountStatus, mode],
  );

  /** Saves the region, waits for the runtime, and opens the browser. */
  async function begin(next: SignInIntent, chosen: Region | undefined = region) {
    if (!chosen) {
      // No region yet: the user chooses one in the menu, then the sign-in continues.
      pendingIntent.current = next;
      setIntent(next);
      setRegionMenuOpen(true);
      return;
    }
    pendingIntent.current = undefined;
    const id = ++attempt.current;
    setIntent(next);
    setPreparing(next);
    setErrorCode('');
    setRuntimeReason('');
    try {
      // The region is saved here, on the user's click, and never before.
      let current = status;
      if (current?.region !== chosen) {
        current = await api.verdictanSetRegion(chosen);
        if (id !== attempt.current) return;
        account.setStatus(current);
      }
      // The desktop installs or repairs the gateway runtime by itself. A runtime that is not
      // there comes back as the phase 'missing', and the error view offers Try again.
      setPreparing(undefined);
      setStartedAt(Date.now());
      setView('waiting');
      const result = await api.verdictanAuthorize(next);
      finishSignIn(result, id);
    } catch (error) {
      if (id !== attempt.current || !live.current) return;
      if (accountChanging(error)) {
        // The region change is still running. Try once more after it.
        await delay(1000);
        if (id === attempt.current) void begin(next, chosen);
        return;
      }
      setErrorCode(failureCode(error));
      setView('error');
    } finally {
      if (id === attempt.current) setPreparing(undefined);
    }
  }

  // A sign-in that started somewhere else, for example in Settings, shows the waiting state.
  useEffect(() => {
    if (status?.phase !== 'authorizing') cancelling.current = false;
    if (
      status?.phase === 'authorizing' &&
      !cancelling.current &&
      !preparing &&
      (view === 'start' || view === 'error')
    ) {
      setStartedAt((value) => value || Date.now());
      setView('waiting');
    }
    // The broadcast can arrive before the request returns.
    if (status?.phase === 'authenticated' && view === 'waiting')
      finishSignIn(status, attempt.current);
  }, [status, view, preparing, finishSignIn]);

  // The dialog starts at once when the user already chose a region.
  const started = useRef(false);
  useEffect(() => {
    if (!autoStart || started.current || !status) return;
    started.current = true;
    if (status.phase === 'authorizing') return;
    if (status.region) void begin(requestedIntent || 'login', status.region);
  }, [autoStart, status]);

  // After the sign-in: read the setup of the organization, then continue. The desktop applies
  // the organization default by itself. Only a setup that stops managed agents (for example
  // billing) stops here. A slow answer does not hold the user.
  useEffect(() => {
    if (view !== 'setup') return;
    let active = true;
    const apply = () => api.verdictanSetup();
    void Promise.race([Promise.resolve().then(apply), delay(setupWaitMs)]).then(
      () => active && onFinished({ signedIn: true }),
      (error) => {
        if (!active) return;
        const code = failureCode(error);
        if (billingCodes.has(code)) setSetupError(code);
        else onFinished({ signedIn: true });
      },
    );
    return () => {
      active = false;
    };
  }, [view]);

  async function cancel() {
    attempt.current++;
    cancelling.current = true;
    setPreparing(undefined);
    try {
      account.setStatus(await api.verdictanCancel());
    } catch {
      showToast({
        message: 'Could not stop the sign-in. Try again from the account menu.',
        tone: 'error',
      });
    }
  }

  /** Clear a saved identity only after the user selects the sign-out action. */
  async function signOutSavedAccount() {
    if (signOutPending.current) return;
    signOutPending.current = true;
    setRecoveryLabel('Signing out…');
    setSigningOut(true);
    const id = ++attempt.current;
    try {
      const result = await api.verdictanLogout();
      if (!live.current || id !== attempt.current) return;
      account.setStatus(result);
      if (result.phase !== 'signed-out') {
        showToast({
          message: 'The saved account was not signed out. Try again when ready.',
          tone: 'error',
        });
        return;
      }
      setLastUrl('');
      setErrorCode('');
      setView('start');
      if (result.remoteRevocationPending)
        showToast({
          message: 'Signed out on this computer. The service has not confirmed access removal.',
          tone: 'error',
        });
    } catch {
      if (live.current && id === attempt.current)
        showToast({
          message: 'Could not sign out of the saved account. Try again.',
          tone: 'error',
        });
    } finally {
      signOutPending.current = false;
      if (live.current) setSigningOut(false);
    }
  }

  async function addSavedAccount() {
    if (signOutPending.current || !api.verdictanAddAccount) return;
    signOutPending.current = true;
    setRecoveryLabel('Adding account…');
    setSigningOut(true);
    const id = ++attempt.current;
    try {
      const result = await api.verdictanAddAccount();
      if (!live.current || id !== attempt.current) return;
      if (result.activeAccountId === status?.activeAccountId) return;
      account.setStatus(result);
      setLastUrl('');
      setErrorCode('');
      setView('start');
    } catch {
      if (live.current && id === attempt.current)
        showToast({ message: 'Could not add an account. Try again.', tone: 'error' });
    } finally {
      signOutPending.current = false;
      if (live.current) setSigningOut(false);
    }
  }

  async function copyLink(url = status?.authorization?.url || lastUrl) {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      showToast('Link copied. Open it in your browser.');
    } catch {
      showToast({ message: 'Could not copy the link.', tone: 'error' });
    }
  }

  async function reopen() {
    try {
      if (typeof api.verdictanReopenBrowser === 'function') await api.verdictanReopenBrowser();
      else throw new Error('desktop.browser_failed');
    } catch {
      showToast({
        message: 'The browser did not open. Copy the link and open it in your browser.',
        tone: 'error',
      });
    }
  }

  /** The user chose a region in the menu. Kalkidan saves it now, on this click. */
  async function chooseRegion(next: Region) {
    setChosenRegion(next);
    const continueWith = view === 'waiting' ? intent : pendingIntent.current;
    if (view === 'waiting') {
      // A sign-in in the wrong region stops. A new one starts in the chosen region.
      await cancel();
      setView('start');
    }
    if (continueWith) return void begin(continueWith, next);
    // Nobody is signed in, so the change stops nothing that runs.
    try {
      account.setStatus(await api.verdictanSetRegion(next));
    } catch (error) {
      if (!accountChanging(error)) {
        setErrorCode(failureCode(error));
        setView('error');
      }
    }
  }

  // In the dialog, the close button is the Cancel of the browser sign-in.
  const waitingNow = useRef(false);
  waitingNow.current = view === 'waiting' || !!preparing;
  useEffect(
    () => () => {
      if (mode === 'dialog' && waitingNow.current)
        void Promise.resolve()
          .then(() => api.verdictanCancel())
          .catch(() => {});
    },
    [],
  );

  // Try again by itself when the connection comes back.
  useEffect(() => {
    if (view !== 'error' || !isOffline(errorCode)) return;
    const retry = () => void begin(intent);
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [view, errorCode, intent]);

  if (mode === 'gate')
    return (
      <GateCard
        status={status}
        region={region}
        regionMenuOpen={regionMenuOpen}
        onRegionMenuOpenChange={(open) => {
          setRegionMenuOpen(open);
          if (!open && !region) pendingIntent.current = undefined;
        }}
        onRegion={(value) => void chooseRegion(value)}
        view={view}
        preparing={!!preparing}
        error={
          setupError
            ? managedErrorInfo(setupError).message
            : view === 'error'
              ? errorCopy(errorCode, {
                  region: status?.region || region,
                  runtimeReason,
                  canCopy: !!lastUrl,
                  signOut: () => void signOutSavedAccount(),
                  addAccount: api.verdictanAddAccount ? () => void addSavedAccount() : undefined,
                  retry: () => void begin(intent),
                  copy: () => void copyLink(lastUrl),
                  useRegion: (value) => {
                    setChosenRegion(value);
                    void begin(intent, value);
                  },
                  cancel: () => setView('start'),
                })
              : undefined
        }
        canCopy={!!(status?.authorization?.url || lastUrl)}
        onSignIn={() => {
          setSetupError('');
          void begin('login');
        }}
        onCopy={() => void copyLink()}
        onCancel={() => {
          void cancel();
          setView('start');
        }}
        onContinue={() => onFinished({ signedIn: true })}
      />
    );

  if (setupError) {
    const names = accountNames(status);
    const done = { label: 'Continue', run: () => onFinished({ signedIn: true }) };
    const manage =
      typeof api.verdictanOpenConsole === 'function'
        ? { label: 'Manage account', run: () => void api.verdictanOpenConsole().catch(() => {}) }
        : undefined;
    return (
      <ErrorView
        mode={mode}
        copy={{
          title: `${names.organization || 'Your organization'} cannot run agents through Verdictan yet`,
          body: managedErrorInfo(setupError).message,
          primary: manage || done,
          secondary: manage ? done : undefined,
        }}
      />
    );
  }

  if (view === 'error') {
    const copy = errorCopy(errorCode, {
      region: status?.region || region,
      runtimeReason,
      canCopy: !!lastUrl,
      signOut: () => void signOutSavedAccount(),
      addAccount: api.verdictanAddAccount ? () => void addSavedAccount() : undefined,
      retry: () => void begin(intent),
      copy: () => void copyLink(lastUrl),
      useRegion: (value) => {
        setChosenRegion(value);
        void begin(intent, value);
      },
      cancel: () => setView('start'),
    });
    return (
      <ErrorView api={api} mode={mode} copy={copy} busy={signingOut} busyLabel={recoveryLabel} />
    );
  }

  const waiting = view === 'waiting';
  const settingUp = view === 'setup';
  const progress = runtimeProgress(runtime.status);
  const installing = runtime.busy && !runtime.installed;
  // A wait shows a spinner and a line of text, never a disabled button.
  const statusLine = settingUp
    ? 'Setting up agents…'
    : waiting
      ? 'Waiting for your browser…'
      : preparing
        ? installing && progress !== undefined
          ? `Getting ready… ${progress}%`
          : 'Getting ready…'
        : '';
  const idle = !statusLine;
  const step = mode === 'step';
  const host = urlHost(status?.authorization?.url) || (region ? regionConsoleHosts[region] : '');
  const lead = waiting
    ? status?.authorization
      ? `Kalkidan opened ${host}. This window updates when you finish.`
      : 'Kalkidan opens your browser. This window updates when you finish.'
    : mode === 'window'
      ? 'Run Codex and Claude Code on your code.'
      : mode === 'step'
        ? ''
        : 'Chats run your agent CLI through the Verdictan gateway of your account.';
  /** Stops the preparation or the browser sign-in, and shows the start again. */
  function stop() {
    void cancel();
    setView('start');
  }
  /** "Set up later" saves the region that the Welcome screen shows, then continues. */
  async function skip() {
    if (region && status?.region !== region) {
      try {
        account.setStatus(await api.verdictanSetRegion(region));
      } catch {
        /* Settings › Account shows "Not chosen". The user can choose the region there. */
      }
    }
    onSkip?.();
  }
  return (
    <Screen mode={mode} className="sign-in-start">
      {mode === 'step' ? null : mode === 'window' ? (
        <img
          src="./brand/kalkidan-mark.svg"
          alt=""
          aria-hidden="true"
          className="sign-in-mark"
          width="48"
          height="48"
        />
      ) : (
        <EntityIcon size="lg" className="sign-in-icon">
          <img src="./brand/kalkidan-mark.svg" alt="" width="28" height="28" />
        </EntityIcon>
      )}
      {(mode !== 'step' || waiting) && (
        <h1 className="sign-in-title">
          {waiting
            ? 'Finish signing in in your browser'
            : mode === 'window'
              ? 'Welcome to Kalkidan'
              : 'Sign in to Verdictan'}
        </h1>
      )}
      {lead && (
        <p className="sign-in-lead" role={waiting ? 'status' : undefined}>
          {lead}
        </p>
      )}
      {statusLine && (
        <p className="sign-in-status" role="status" aria-live="polite">
          <LoaderCircle className="animate-spin" aria-hidden="true" />
          {statusLine}
        </p>
      )}
      <div className="sign-in-actions">
        {idle && (
          <Button
            size="lg"
            className={step ? undefined : 'w-full'}
            onClick={() => void begin('login')}
          >
            Sign in with Verdictan
          </Button>
        )}
        {waiting && !!status?.authorization && (
          <Button size="lg" className={step ? undefined : 'w-full'} onClick={() => void reopen()}>
            <ExternalLink /> Open browser again
          </Button>
        )}
        {idle && mode !== 'dialog' && onSkip && (
          <Button
            size="lg"
            variant="ghost"
            className={step ? undefined : 'w-full'}
            onClick={() => void skip()}
          >
            {step ? 'Later' : 'Set up later'}
          </Button>
        )}
        {/* Every wait can be cancelled. In the dialog, the close button also cancels. */}
        {(preparing || (waiting && mode !== 'dialog')) && (
          <Button size="lg" variant="ghost" className={step ? undefined : 'w-full'} onClick={stop}>
            Cancel
          </Button>
        )}
      </div>
      {waiting && (
        <WaitingActions
          expiresAt={status?.authorization?.expiresAt}
          startedAt={startedAt}
          canCopy={!!(status?.authorization?.url || lastUrl)}
          onCopy={() => void copyLink()}
        />
      )}
      {idle && (
        <p className="sign-in-note sign-in-region" role="group" aria-label="Account and region">
          <span>
            No account?{' '}
            <Button
              type="button"
              variant="link"
              className="text-foreground underline"
              onClick={() => void begin('register')}
            >
              Create one
            </Button>
          </span>
          <span aria-hidden="true">·</span>
          <RegionMenu
            value={region}
            open={regionMenuOpen}
            onOpenChange={(open) => {
              setRegionMenuOpen(open);
              // Closing the menu without a choice drops the waiting sign-in.
              if (!open && !region) pendingIntent.current = undefined;
            }}
            onChange={(value) => void chooseRegion(value)}
          />
        </p>
      )}
    </Screen>
  );
}

/** "Getting ready" and a small bar, while the runtime downloads. For the Welcome title bar. */
export function RuntimeReadiness({ api }: { api: API }) {
  const runtime = useRuntimeStatus(api);
  if (!runtime.busy || runtime.installed) return null;
  const progress = runtimeProgress(runtime.status);
  return (
    <div className="sign-in-readiness" role="status">
      <span>Getting ready</span>
      <Progress value={progress} label="Getting agents ready" className="w-16" />
    </div>
  );
}

function Screen({
  mode,
  className,
  children,
}: {
  mode: SignInMode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn('sign-in-screen', className)} data-mode={mode}>
      {children}
    </section>
  );
}

/** "Region: European Union ▾": the region as plain text with an inline menu. */
function RegionMenu({
  value,
  open,
  onOpenChange,
  onChange,
  bare = false,
}: {
  value?: Region;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (region: Region) => void;
  /** Only the value and the chevron, with no "Region:" label. */
  bare?: boolean;
}) {
  return (
    <span className="sign-in-region-group">
      {!bare && <span>Region:</span>}
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className="sign-in-region-trigger"
            aria-label={`Region: ${value ? regionNames[value] : 'Choose'}`}
          >
            {value ? regionNames[value] : 'Choose'}
            <ChevronDown aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="center" width="wide">
          <DropdownMenuRadioGroup
            value={value || ''}
            onValueChange={(next) => onChange(next as Region)}
          >
            {regions.map((item) => (
              <DropdownMenuRadioItem key={item} value={item}>
                {regionNames[item]}
                <DropdownMenuShortcut>{regionConsoleHosts[item]}</DropdownMenuShortcut>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  );
}

/** "Copy link" and the time that the link stays valid, under the waiting actions. */
function WaitingActions({
  expiresAt,
  startedAt,
  canCopy,
  onCopy,
}: {
  expiresAt?: string;
  startedAt: number;
  canCopy: boolean;
  onCopy: () => void;
}) {
  const [shownAt] = useState(() => Date.now());
  const left = useCountdown(
    expiresAt ? Date.parse(expiresAt) : (startedAt || shownAt) + authorizationWindowMs,
  );
  return (
    <p className="sign-in-note sign-in-meta">
      <Clock aria-hidden="true" />
      The link stops working in {formatCountdown(left)}
      {canCopy && (
        <>
          <span aria-hidden="true">·</span>
          <Button type="button" variant="ghost" size="xs" onClick={onCopy}>
            <Copy /> Copy link
          </Button>
        </>
      )}
    </p>
  );
}

function ErrorView({
  api,
  mode,
  copy,
  busy = false,
  busyLabel = 'Signing out…',
}: {
  /** Shows the account help. The setup error of a signed-in account has none. */
  api?: API;
  mode: SignInMode;
  copy: ErrorCopy;
  busy?: boolean;
  busyLabel?: string;
}) {
  return (
    <Screen mode={mode} className="sign-in-error">
      {mode !== 'step' && (
        <EntityIcon size="lg" color="var(--warning)" className="sign-in-icon">
          <X />
        </EntityIcon>
      )}
      <h1 className="sign-in-title" role="alert">
        {copy.title}
      </h1>
      <p className="sign-in-lead">{copy.body}</p>
      <div className="sign-in-row">
        {copy.secondary && (
          <Button variant="outline" disabled={busy} onClick={copy.secondary.run}>
            {copy.secondary.label}
          </Button>
        )}
        <Button disabled={busy} onClick={copy.primary.run}>
          {busy ? busyLabel : copy.primary.label}
        </Button>
      </div>
      {api && <AccountHelp api={api} />}
    </Screen>
  );
}

/**
 * Help for an account that cannot finish the sign-in, after a failure: one "Trouble signing
 * in?" menu with a new verification email and account recovery. The Verdictan console does the
 * work in the browser. Kalkidan never sees a password.
 */
function AccountHelp({ api }: { api: API }) {
  if (typeof api.verdictanOpenAccountPage !== 'function') return null;
  const open = (page: VerdictanAccountPage) =>
    void api.verdictanOpenAccountPage(page).then(
      () => showToast('Kalkidan opened your browser. Continue there.'),
      () =>
        showToast({
          message: 'The browser did not open. Choose a region, then try again.',
          tone: 'error',
        }),
    );
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="text-muted-foreground">
          Trouble signing in?
          <ChevronDown aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="center" width="wide">
        <DropdownMenuItem onSelect={() => open('verify')}>
          Send the verification email again
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => open('recover')}>Recover your account</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function isOffline(code: string) {
  return (
    connectionCode.test(code) ||
    (typeof navigator !== 'undefined' && navigator.onLine === false && code !== 'runtime')
  );
}

/** Each error says what happened, what did not change, and gives one primary action. */
function errorCopy(
  code: string,
  context: {
    region?: Region;
    runtimeReason: string;
    canCopy: boolean;
    signOut: () => void;
    addAccount?: () => void;
    retry: () => void;
    copy: () => void;
    useRegion: (region: Region) => void;
    cancel: () => void;
  },
): ErrorCopy {
  const retry = { label: 'Try again', run: context.retry };
  if (code === 'desktop.identity_mismatch')
    return {
      title: 'The account or organization does not match',
      body: context.addAccount
        ? 'The browser selected a different Verdictan account or organization. Retry with the saved account and organization, or add a separate account. Adding an account keeps the existing sign-in but stops managed work and disconnects SSH hosts.'
        : 'The browser selected a different Verdictan account or organization from the one saved in Kalkidan. Choose the saved account and organization in your browser, then try again. To use a different one, sign out of the saved account first. Signing out stops managed work and disconnects SSH hosts.',
      primary: context.addAccount
        ? { label: 'Add account', run: context.addAccount }
        : { label: 'Sign out of saved account', run: context.signOut },
      secondary: { label: 'Retry with saved account', run: context.retry },
    };
  if (code === 'desktop.authorization_timeout' || code === 'desktop.request_timeout')
    return {
      title: 'The sign-in did not finish',
      body: 'The sign-in link expired after 5 minutes. Nothing changed on your account. Start the sign-in again to get a new link.',
      primary: { label: 'Start again', run: context.retry },
    };
  if (code === 'desktop.browser_failed')
    return {
      title: 'The browser did not open',
      body: context.canCopy
        ? 'Copy the sign-in link and open it in your browser, or try again.'
        : 'Make sure that a default browser is set, then try again.',
      primary: retry,
      secondary: context.canCopy ? { label: 'Copy link', run: context.copy } : undefined,
    };
  if (code === 'desktop.region_mismatch' && context.region) {
    const other = otherRegion(context.region);
    return {
      title: `This account is in the ${regionNames[other]} region`,
      body: `Your organization uses ${regionConsoleHosts[other]}. Switch to that region to continue.`,
      primary: { label: `Use ${regionNames[other]}`, run: () => context.useRegion(other) },
      secondary: { label: 'Cancel', run: context.cancel },
    };
  }
  if (isOffline(code))
    return {
      title: 'Kalkidan cannot reach Verdictan',
      body: 'Check the internet connection. Kalkidan tries again when the connection comes back.',
      primary: retry,
    };
  if (code === 'runtime')
    return {
      title: 'Kalkidan could not get the Verdictan gateway ready',
      body:
        context.runtimeReason ||
        'The download did not finish. Check the internet connection, then try again.',
      primary: retry,
    };
  return {
    title: 'The sign-in did not finish',
    body: verdictanErrorMessage(code),
    primary: retry,
  };
}

function useCountdown(end: number) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  return Math.max(0, end - now);
}

function formatCountdown(ms: number) {
  const seconds = Math.ceil(ms / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/**
 * The sign-in card under a message that waits for the sign-in (ST-C3): "Sign in to run agents",
 * the account or the region, and one brown "Sign in". While the browser is open, the card shows
 * one line: a spinner, "Waiting for browser", Copy link and Cancel. A failure shows in the card
 * with its one action. No dialog opens.
 */
function GateCard({
  status,
  region,
  regionMenuOpen,
  onRegionMenuOpenChange,
  onRegion,
  view,
  preparing,
  error,
  canCopy,
  onSignIn,
  onCopy,
  onCancel,
  onContinue,
}: {
  status: VerdictanStatus | undefined;
  region: Region | undefined;
  regionMenuOpen: boolean;
  onRegionMenuOpenChange: (open: boolean) => void;
  onRegion: (region: Region) => void;
  view: View;
  preparing: boolean;
  /** The words of a failure, or the message of a setup that stops managed agents. */
  error: ErrorCopy | string | undefined;
  canCopy: boolean;
  onSignIn: () => void;
  onCopy: () => void;
  onCancel: () => void;
  onContinue: () => void;
}) {
  const organization = accountNames(status).organization;
  const waiting = view === 'waiting' || preparing;
  const settingUp = view === 'setup' && !error;
  const mark = (
    <img
      src="./brand/kalkidan-mark.svg"
      alt=""
      aria-hidden="true"
      width="28"
      height="28"
      className="sign-in-gate-mark"
    />
  );
  if (error) {
    const copy: ErrorCopy =
      typeof error === 'string'
        ? {
            title: `${organization || 'Your organization'} cannot run agents through Verdictan yet`,
            body: error,
            primary: { label: 'Continue', run: onContinue },
          }
        : error;
    return (
      <section className="sign-in-gate" aria-label="Sign in" data-state="error">
        {mark}
        <span className="sign-in-gate-text">
          <span className="sign-in-gate-title" role="alert">
            {copy.title}
          </span>
          <span className="sign-in-gate-detail">{copy.body}</span>
        </span>
        {copy.secondary && (
          <Button variant="ghost" onClick={copy.secondary.run}>
            {copy.secondary.label}
          </Button>
        )}
        <Button onClick={copy.primary.run}>{copy.primary.label}</Button>
      </section>
    );
  }
  return (
    <section className="sign-in-gate" aria-label="Sign in" data-state={waiting ? 'waiting' : view}>
      {mark}
      <span className="sign-in-gate-text">
        <span className="sign-in-gate-title">Sign in to run agents</span>
        {waiting || settingUp ? (
          <span className="sign-in-gate-detail sign-in-gate-wait" role="status">
            <LoaderCircle className="animate-spin" aria-hidden="true" />
            {settingUp ? 'Getting agents ready' : 'Waiting for browser'}
          </span>
        ) : (
          <span className="sign-in-gate-detail">
            Verdictan ·{' '}
            {organization || (
              <RegionMenu
                value={region}
                open={regionMenuOpen}
                onOpenChange={onRegionMenuOpenChange}
                onChange={onRegion}
                bare
              />
            )}
          </span>
        )}
      </span>
      {waiting ? (
        <>
          {canCopy && (
            <Button variant="ghost" size="sm" onClick={onCopy}>
              <Copy /> Copy link
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Cancel
          </Button>
        </>
      ) : (
        !settingUp && <Button onClick={onSignIn}>Sign in</Button>
      )}
    </section>
  );
}
