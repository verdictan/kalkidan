import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, Clock, Copy, ExternalLink, Globe, LoaderCircle, X } from 'lucide-react';
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
  runtimeBusy,
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Progress } from './ui/progress';
import { showToast } from './ui/toast';

export type SignInIntent = 'login' | 'register';

/** How the sign-in ended. `signedIn` is false when the user skipped or closed it. */
export interface SignInResult {
  signedIn: boolean;
}

type View = 'start' | 'waiting' | 'setup' | 'error';

// The runtime waits 310 seconds for the browser. Use it when the status has no end time.
const authorizationWindowMs = 310_000;
const installPollMs = 1500;
// The longest wait for the setup of the organization after the sign-in. It continues after.
const setupWaitMs = 8000;
const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Opens the new Settings dialog at a section. */
export function openSettings(section?: 'general' | 'account' | 'agents' | 'computers' | 'about') {
  window.dispatchEvent(new CustomEvent('kalkidan-open-settings', { detail: { section } }));
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
  /** window: the full-window Welcome screen. dialog: the sign-in dialog of an open app. */
  mode: 'window' | 'dialog';
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
        showToast(`Signed in as ${signedInName(result)}`);
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
    [setAccountStatus],
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
      // The runtime owns the browser sign-in, so it must be installed first.
      let installed = await runtime.read();
      if (installed && !installed.installed) {
        if (!runtimeBusy(installed) && installed.canInstall)
          installed = await api.runtimeUpdateInstall('local');
        while (installed && !installed.installed && runtimeBusy(installed)) {
          await delay(installPollMs);
          if (id !== attempt.current || !live.current) return;
          installed = await runtime.read();
        }
        if (id !== attempt.current) return;
        if (installed && !installed.installed && installed.operation?.phase === 'failed') {
          setRuntimeReason(installed.reason || '');
          setErrorCode('runtime');
          setView('error');
          return;
        }
      }
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

  // After the sign-in: save the recommended setup for both agents, then continue. The setup
  // runs in the background, so a slow answer does not hold the user here.
  useEffect(() => {
    if (view !== 'setup') return;
    let active = true;
    const apply =
      typeof api.verdictanApplyRecommended === 'function'
        ? () => api.verdictanApplyRecommended()
        : () => api.verdictanSetup();
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

  // Try again by itself when the connection comes back.
  useEffect(() => {
    if (view !== 'error' || !isOffline(errorCode)) return;
    const retry = () => void begin(intent);
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [view, errorCode, intent]);

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
          title: `${names.organization || 'Your organization'} cannot use managed agents yet`,
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
      retry: () => void begin(intent),
      copy: () => void copyLink(lastUrl),
      useRegion: (value) => {
        setChosenRegion(value);
        void begin(intent, value);
      },
      cancel: () => setView('start'),
    });
    return <ErrorView api={api} mode={mode} copy={copy} />;
  }

  const waiting = view === 'waiting';
  const settingUp = view === 'setup';
  const progress = runtimeProgress(runtime.status);
  const installing = runtime.busy && !runtime.installed;
  const busyLabel = settingUp
    ? 'Setting up agents…'
    : waiting
      ? 'Waiting for your browser…'
      : preparing
        ? installing && progress !== undefined
          ? `Getting ready… ${progress}%`
          : 'Getting ready…'
        : '';
  const host = urlHost(status?.authorization?.url) || (region ? regionConsoleHosts[region] : '');
  const lead = waiting
    ? status?.authorization
      ? `Kalkidan opened ${host}. This window updates when you finish.`
      : 'Kalkidan opens your browser. This window updates when you finish.'
    : mode === 'window'
      ? 'Run Codex and Claude Code on your code, with the rules of your organization.'
      : 'Chats run as managed agents through your Verdictan account.';
  return (
    <Screen mode={mode} className="sign-in-start">
      {mode === 'window' ? (
        <img
          src="./brand/kalkidan-mark.svg"
          alt=""
          aria-hidden="true"
          className="sign-in-mark"
          width="48"
          height="48"
        />
      ) : (
        <span className="sign-in-icon" aria-hidden="true">
          <img src="./brand/kalkidan-mark.svg" alt="" width="40" height="40" />
        </span>
      )}
      <h1 className="sign-in-title">
        {waiting
          ? 'Finish signing in in your browser'
          : mode === 'window'
            ? 'Welcome to Kalkidan'
            : 'Sign in to Verdictan'}
      </h1>
      <p className="sign-in-lead" role={waiting ? 'status' : undefined}>
        {lead}
      </p>
      <div className="sign-in-actions">
        {busyLabel ? (
          <Button size="lg" className="w-full" disabled aria-live="polite">
            <LoaderCircle className="animate-spin" aria-hidden="true" /> {busyLabel}
          </Button>
        ) : (
          <Button size="lg" className="w-full" onClick={() => void begin('login')}>
            Sign in with Verdictan
          </Button>
        )}
        {mode === 'window' && onSkip && !waiting && !settingUp && (
          <Button
            size="lg"
            variant="ghost"
            className="w-full"
            disabled={!!preparing}
            onClick={onSkip}
          >
            Set up later
          </Button>
        )}
      </div>
      {waiting && (
        <WaitingActions
          expiresAt={status?.authorization?.expiresAt}
          startedAt={startedAt}
          opened={!!status?.authorization}
          canCopy={!!(status?.authorization?.url || lastUrl)}
          onReopen={() => void reopen()}
          onCopy={() => void copyLink()}
          onCancel={() => {
            void cancel();
            if (mode === 'dialog') onFinished({ signedIn: false });
            else setView('start');
          }}
        />
      )}
      {!waiting && !settingUp && (
        <p className="sign-in-note">
          No account?{' '}
          <Button
            type="button"
            variant="link"
            disabled={!!preparing}
            onClick={() => void begin('register')}
          >
            Create one
          </Button>
        </p>
      )}
      {!settingUp && (
        <RegionMenu
          value={region}
          disabled={!!preparing}
          open={regionMenuOpen}
          onOpenChange={(open) => {
            setRegionMenuOpen(open);
            // Closing the menu without a choice drops the waiting sign-in.
            if (!open && !region) pendingIntent.current = undefined;
          }}
          onChange={(value) => void chooseRegion(value)}
        />
      )}
      {!settingUp && <AccountHelp api={api} />}
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
      <Progress value={progress} label="Getting managed agents ready" className="w-16" />
    </div>
  );
}

function Screen({
  mode,
  className,
  children,
}: {
  mode: 'window' | 'dialog';
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={cn('sign-in-screen', className)} data-mode={mode}>
      {children}
    </section>
  );
}

/** "Region European Union ▾": the region as plain text with an inline menu. */
function RegionMenu({
  value,
  disabled,
  open,
  onOpenChange,
  onChange,
}: {
  value?: Region;
  disabled: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChange: (region: Region) => void;
}) {
  return (
    <p className="sign-in-region" role="group" aria-label="Region">
      <Globe aria-hidden="true" />
      <span>Region</span>
      <DropdownMenu open={open} onOpenChange={onOpenChange}>
        <DropdownMenuTrigger asChild>
          <button type="button" className="sign-in-region-trigger" disabled={disabled}>
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
    </p>
  );
}

/** The quiet actions under the waiting button, and the time that the link stays valid. */
function WaitingActions({
  expiresAt,
  startedAt,
  opened,
  canCopy,
  onReopen,
  onCopy,
  onCancel,
}: {
  expiresAt?: string;
  startedAt: number;
  opened: boolean;
  canCopy: boolean;
  onReopen: () => void;
  onCopy: () => void;
  onCancel: () => void;
}) {
  const [shownAt] = useState(() => Date.now());
  const left = useCountdown(
    expiresAt ? Date.parse(expiresAt) : (startedAt || shownAt) + authorizationWindowMs,
  );
  return (
    <>
      <div className="sign-in-row">
        <Button variant="ghost" size="sm" disabled={!opened} onClick={onReopen}>
          <ExternalLink /> Open browser again
        </Button>
        <Button variant="ghost" size="sm" disabled={!canCopy} onClick={onCopy}>
          <Copy /> Copy link
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p className="sign-in-note sign-in-meta">
        <Clock aria-hidden="true" />
        The link stops working in {formatCountdown(left)}
      </p>
    </>
  );
}

function ErrorView({
  api,
  mode,
  copy,
}: {
  /** Shows the account help. The setup error of a signed-in account has none. */
  api?: API;
  mode: 'window' | 'dialog';
  copy: ErrorCopy;
}) {
  return (
    <Screen mode={mode} className="sign-in-error">
      <span className="sign-in-icon" data-tone="warning" aria-hidden="true">
        <X />
      </span>
      <h1 className="sign-in-title" role="alert">
        {copy.title}
      </h1>
      <p className="sign-in-lead">{copy.body}</p>
      <div className="sign-in-row">
        <Button onClick={copy.primary.run}>{copy.primary.label}</Button>
        {copy.secondary && (
          <Button variant="ghost" onClick={copy.secondary.run}>
            {copy.secondary.label}
          </Button>
        )}
      </div>
      {api && <AccountHelp api={api} />}
    </Screen>
  );
}

/**
 * Help for an account that cannot finish the sign-in: a new verification email, or account
 * recovery. The Verdictan console does the work in the browser. Kalkidan never sees a password.
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
    <p className="sign-in-note sign-in-help" role="group" aria-label="Account help">
      <span>Did not get the verification email?</span>{' '}
      <Button type="button" variant="link" onClick={() => open('verify')}>
        Send it again
      </Button>
      <span aria-hidden="true"> · </span>
      <span>Cannot sign in?</span>{' '}
      <Button type="button" variant="link" onClick={() => open('recover')}>
        Recover your account
      </Button>
    </p>
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
    retry: () => void;
    copy: () => void;
    useRegion: (region: Region) => void;
    cancel: () => void;
  },
): ErrorCopy {
  const retry = { label: 'Try again', run: context.retry };
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
      title: 'Kalkidan could not get managed agents ready',
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
