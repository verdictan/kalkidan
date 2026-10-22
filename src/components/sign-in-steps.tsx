import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  AppWindow,
  Check,
  ChevronLeft,
  Circle,
  Clock,
  Copy,
  ExternalLink,
  FolderOpen,
  Globe,
  LoaderCircle,
  X,
} from 'lucide-react';
import type { API } from '../api/contracts';
import type { AgentInstallation } from '../types';
import type { VerdictanAccountPage, VerdictanSetup, VerdictanStatus } from '../domain/verdictan';
import {
  isSubscriptionMode,
  kalkidanAgentLabel,
  managedErrorCode,
  managedErrorInfo,
} from '../domain/verdictan';
import { checkAgentVersion, nativeAgentKind } from '../domain/agent-version';
import { agentCatalog } from '../config/agents';
import {
  accountChanging,
  accountNames,
  allowedModels,
  providerName,
  runtimeBusy,
  updatePhaseLabel,
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
import { isMac } from '../lib/platform';
import { cn } from '../lib/utils';
import {
  runtimeProgress,
  useRuntimeStatus,
  useVerdictanStatus,
} from '../hooks/use-verdictan-status';
import { Alert, AlertDescription, AlertTitle } from './ui/alert';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Progress } from './ui/progress';
import { Radio } from './ui/checkbox';
import { showToast } from './ui/toast';

export type SignInIntent = 'login' | 'register';

/** How the sign-in ended. `signedIn` is false when the user skipped or closed it. */
export interface SignInResult {
  signedIn: boolean;
}

type View = 'start' | 'region' | 'waiting' | 'error' | 'setup';

const computerName = isMac ? 'this Mac' : 'this computer';
// The runtime waits 310 seconds for the browser. Use it when the status has no end time.
const authorizationWindowMs = 310_000;
const installPollMs = 1500;
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
  const named = selection.agentId
    ? setup.agents?.find((item) => item.agent_id === selection.agentId)
    : undefined;
  const who = named?.name || (selection.agentId ? kalkidanAgentLabel : undefined);
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
 * The steps of the Verdictan sign-in: region, browser hand-off, then setup. The Welcome screen
 * shows them in the full window. SignInFlow shows them in a dialog.
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
  /** Shows "Set up later" on the start view. */
  onSkip?: () => void;
}) {
  const account = useVerdictanStatus(api);
  const runtime = useRuntimeStatus(api);
  const status = account.status;
  const suggestion = useMemo(() => suggestRegion(), []);
  const [chosenRegion, setChosenRegion] = useState<Region>();
  const region: Region | undefined = chosenRegion ?? status?.region ?? suggestion;
  const [view, setView] = useState<View>('start');
  // The intent of the sign-in that runs now, or that the region screen continues.
  const [intent, setIntent] = useState<SignInIntent>(requestedIntent || 'login');
  // The button that shows "Getting ready…" while the runtime installs.
  const [preparing, setPreparing] = useState<SignInIntent>();
  const [errorCode, setErrorCode] = useState('');
  const [runtimeReason, setRuntimeReason] = useState('');
  // The last sign-in link. It stays for "Copy link" after the browser did not open.
  const [lastUrl, setLastUrl] = useState('');
  const [startedAt, setStartedAt] = useState(0);
  const [returnToStart, setReturnToStart] = useState(false);
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
      setIntent(next);
      setReturnToStart(false);
      setView('region');
      return;
    }
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

  // A sign-in that started somewhere else, for example in Settings, shows the waiting view.
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

  async function cancel() {
    attempt.current++;
    cancelling.current = true;
    setPreparing(undefined);
    try {
      account.setStatus(await api.verdictanCancel());
    } catch {
      showToast({
        message: 'Could not stop the sign-in. Check the status in Settings.',
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

  async function saveRegion(next: Region) {
    setChosenRegion(next);
    const intentToRun = intent;
    if (returnToStart) {
      setView('start');
      // Save the confirmed choice now. It changes nothing that runs: no one is signed in.
      try {
        account.setStatus(await api.verdictanSetRegion(next));
      } catch (error) {
        if (!accountChanging(error)) {
          setErrorCode(failureCode(error));
          setView('error');
        }
      }
      return;
    }
    setView('start');
    void begin(intentToRun, next);
  }

  // Try again by itself when the connection comes back.
  useEffect(() => {
    if (view !== 'error' || !isOffline(errorCode)) return;
    const retry = () => void begin(intent);
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [view, errorCode, intent]);

  const progress = runtimeProgress(runtime.status);
  const installing = runtime.busy && !runtime.installed;

  if (view === 'region')
    return (
      <RegionView
        mode={mode}
        value={region}
        suggestion={suggestion}
        onBack={() => setView('start')}
        onContinue={(value) => void saveRegion(value)}
      />
    );

  if (view === 'waiting')
    return (
      <WaitingView
        api={api}
        mode={mode}
        status={status}
        region={status?.region || region}
        startedAt={startedAt}
        canCopy={!!(status?.authorization?.url || lastUrl)}
        onReopen={() => void reopen()}
        onCopy={() => void copyLink()}
        onCancel={() => {
          void cancel();
          if (mode === 'dialog') onFinished({ signedIn: false });
          else setView('start');
        }}
        onChangeRegion={() => {
          void cancel();
          setReturnToStart(false);
          setView('region');
        }}
      />
    );

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

  if (view === 'setup')
    return (
      <SetupView
        api={api}
        mode={mode}
        status={status}
        runtime={runtime}
        onDone={() => onFinished({ signedIn: true })}
      />
    );

  // The start view: the Welcome screen, or the first view of the sign-in dialog.
  const preparingLabel =
    installing && progress !== undefined ? `Getting ready… ${progress}%` : 'Getting ready…';
  return (
    <Screen mode={mode} className="sign-in-start">
      {mode === 'window' ? (
        <img
          src="./brand/kalkidan-icon.svg"
          alt=""
          aria-hidden="true"
          className="sign-in-mark"
          width="48"
          height="48"
        />
      ) : (
        <span className="sign-in-icon" aria-hidden="true">
          <img src="./brand/kalkidan-icon.svg" alt="" width="40" height="40" />
        </span>
      )}
      <h1 className="sign-in-title">
        {mode === 'window' ? 'Welcome to Kalkidan' : 'Sign in to Verdictan'}
      </h1>
      <p className="sign-in-lead">
        {mode === 'window'
          ? 'Run Codex and Claude Code on your code, with the rules of your organization.'
          : 'Chats run as managed agents through your Verdictan account. Kalkidan opens your browser to sign in.'}
      </p>
      <div className="sign-in-actions">
        <Button
          size="lg"
          className="w-full"
          disabled={!!preparing}
          onClick={() => void begin('login')}
        >
          {preparing === 'login' ? (
            <>
              <LoaderCircle className="animate-spin" aria-hidden="true" /> {preparingLabel}
            </>
          ) : (
            'Continue with Verdictan'
          )}
        </Button>
        <Button
          size="lg"
          variant="outline"
          className="w-full"
          disabled={!!preparing}
          onClick={() => void begin('register')}
        >
          {preparing === 'register' ? (
            <>
              <LoaderCircle className="animate-spin" aria-hidden="true" /> {preparingLabel}
            </>
          ) : (
            'Create account'
          )}
        </Button>
      </div>
      <p className="sign-in-region" role="group" aria-label="Region">
        <Globe aria-hidden="true" />
        {region ? (
          <>
            <span className="text-muted-foreground">Region</span>
            <span className="font-medium">{regionNames[region]}</span>
          </>
        ) : (
          <span className="text-muted-foreground">No region chosen</span>
        )}
        <button
          type="button"
          className="text-link"
          disabled={!!preparing}
          aria-label={region ? 'Change the region' : 'Choose a region'}
          onClick={() => {
            setReturnToStart(true);
            setView('region');
          }}
        >
          {region ? 'Change' : 'Choose a region'}
        </button>
      </p>
      {mode === 'window' && (
        <div className="sign-in-footer">
          <p>Kalkidan opens your browser to sign in. Kalkidan never sees your password.</p>
          {onSkip && (
            <button type="button" className="text-link" onClick={onSkip}>
              Set up later
            </button>
          )}
        </div>
      )}
      {mode === 'dialog' && <p className="sign-in-note">Kalkidan never sees your password.</p>}
      <AccountHelp api={api} />
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

function RegionView({
  mode,
  value,
  suggestion,
  onBack,
  onContinue,
}: {
  mode: 'window' | 'dialog';
  value?: Region;
  suggestion?: Region;
  onBack: () => void;
  onContinue: (region: Region) => void;
}) {
  const [selected, setSelected] = useState<Region | undefined>(value);
  return (
    <Screen mode={mode} className="sign-in-region-view">
      <Button variant="ghost" size="sm" className="sign-in-back" onClick={onBack}>
        <ChevronLeft /> Back
      </Button>
      <h1 className="sign-in-title">Where is your organization?</h1>
      <p className="sign-in-lead">
        Each region has its own accounts and data. Choose the region where your organization signed
        up.
      </p>
      <div className="sign-in-region-cards" role="radiogroup" aria-label="Region">
        {regions.map((item) => (
          <label key={item} className="sign-in-region-card" data-selected={selected === item}>
            <span className="flex items-center justify-between">
              <span className="text-xs font-medium text-muted-foreground uppercase">{item}</span>
              <Radio
                name="verdictan-region"
                value={item}
                checked={selected === item}
                onChange={() => setSelected(item)}
              />
            </span>
            <span className="text-sm font-medium">{regionNames[item]}</span>
            <span className="font-mono text-xs text-muted-foreground">
              {regionConsoleHosts[item]}
            </span>
            {suggestion === item && (
              <Badge size="sm" variant="muted" className="justify-self-start">
                Suggested
              </Badge>
            )}
          </label>
        ))}
      </div>
      <p className="sign-in-note">
        Not sure? Use the address that you sign in to in your browser. You can change the region
        later in Settings.
      </p>
      <Button
        size="lg"
        className="sign-in-wide"
        disabled={!selected}
        onClick={() => selected && onContinue(selected)}
      >
        Continue
      </Button>
    </Screen>
  );
}

function WaitingView({
  api,
  mode,
  status,
  region,
  startedAt,
  canCopy,
  onReopen,
  onCopy,
  onCancel,
  onChangeRegion,
}: {
  api: API;
  mode: 'window' | 'dialog';
  status?: VerdictanStatus;
  region?: Region;
  startedAt: number;
  canCopy: boolean;
  onReopen: () => void;
  onCopy: () => void;
  onCancel: () => void;
  onChangeRegion: () => void;
}) {
  const authorization = status?.authorization;
  const [shownAt] = useState(() => Date.now());
  const host = urlHost(authorization?.url) || (region ? regionConsoleHosts[region] : '');
  const end = authorization?.expiresAt
    ? Date.parse(authorization.expiresAt)
    : (startedAt || shownAt) + authorizationWindowMs;
  const left = useCountdown(end);
  // The browser opens a moment after the request. Until the link is known, say so.
  const opened = !!authorization;
  return (
    <Screen mode={mode} className="sign-in-waiting">
      <span className="sign-in-icon" aria-hidden="true">
        <AppWindow />
      </span>
      <h1 className="sign-in-title">Finish signing in in your browser</h1>
      <p className="sign-in-lead" role="status">
        {opened
          ? `Kalkidan opened ${host}. When you finish, come back here. This window updates automatically.`
          : 'Kalkidan opens your browser. When you finish, come back here. This window updates automatically.'}
      </p>
      <div className="sign-in-row">
        <Button variant="outline" disabled={!opened} onClick={onReopen}>
          <ExternalLink /> Open browser again
        </Button>
        <Button variant="outline" disabled={!canCopy} onClick={onCopy}>
          <Copy /> Copy link
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p className="sign-in-note sign-in-meta">
        <Clock aria-hidden="true" />
        <span>The link stops working in {formatCountdown(left)}</span>
        <span aria-hidden="true">·</span>
        <span>
          Wrong region?{' '}
          <button type="button" className="text-link" onClick={onChangeRegion}>
            Change
          </button>
        </span>
      </p>
      <AccountHelp api={api} />
    </Screen>
  );
}

function ErrorView({ api, mode, copy }: { api: API; mode: 'window' | 'dialog'; copy: ErrorCopy }) {
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
      <AccountHelp api={api} />
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
      <button type="button" className="text-link" onClick={() => open('verify')}>
        Send it again
      </button>
      <span aria-hidden="true"> · </span>
      <span>Cannot sign in?</span>{' '}
      <button type="button" className="text-link" onClick={() => open('recover')}>
        Recover your account
      </button>
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

type StepState = 'done' | 'running' | 'waiting' | 'failed';

/** Frame 5: the setup after the sign-in. The user can continue at any time. */
function SetupView({
  api,
  mode,
  status,
  runtime,
  onDone,
}: {
  api: API;
  mode: 'window' | 'dialog';
  status?: VerdictanStatus;
  runtime: ReturnType<typeof useRuntimeStatus>;
  onDone: () => void;
}) {
  const names = accountNames(status);
  const [setup, setSetup] = useState<VerdictanSetup>();
  const [setupError, setSetupError] = useState('');
  const [installations, setInstallations] = useState<AgentInstallation[]>();
  const [installError, setInstallError] = useState(false);
  useEffect(() => {
    let active = true;
    // R6-37: save the recommended setup for both agents. Settings can change it later.
    const apply =
      typeof api.verdictanApplyRecommended === 'function'
        ? () => api.verdictanApplyRecommended()
        : () => api.verdictanSetup();
    void Promise.resolve()
      .then(apply)
      .then(
        (value) => active && setSetup(value),
        (error) => active && setSetupError(failureCode(error)),
      );
    void Promise.resolve()
      .then(() => api.agentInstallations())
      .then(
        (value) => active && setInstallations(value),
        () => active && setInstallError(true),
      );
    return () => {
      active = false;
    };
  }, [api]);
  const runtimeState: StepState = runtime.installed
    ? 'done'
    : runtime.busy
      ? 'running'
      : runtime.status?.operation?.phase === 'failed'
        ? 'failed'
        : 'running';
  const runtimeDetail = runtime.installed
    ? `Version ${runtime.status!.installed!.version}`
    : runtime.status?.operation
      ? `${updatePhaseLabel(runtime.status.operation.phase)} · version ${runtime.status.operation.target.version}`
      : 'Starting';
  const setupState: StepState = setup ? 'done' : setupError ? 'failed' : 'running';
  const lines = setup
    ? agentCatalog
        .map((agent) => {
          const summary = setupSummary(setup, agent.id);
          return `${agent.name}: ${summary || 'choose a setup in Settings'}`;
        })
        .join('\n')
    : '';
  const programsState: StepState = installations ? 'done' : installError ? 'failed' : 'running';
  const programs = installations
    ? agentCatalog
        .map((agent) => {
          const item = installations.find((entry) => entry.agent === agent.id);
          if (item?.status !== 'installed') return `${agent.name} not found`;
          const check = checkAgentVersion(nativeAgentKind(agent.id)!, item.version);
          if (check.status === 'outdated') return `${agent.name} ${item.version} · update required`;
          return item.version ? `${agent.name} ${item.version}` : agent.name;
        })
        .join(' · ')
    : installError
      ? 'Kalkidan could not check the agents. Check them later in Settings.'
      : '';
  const billing = billingCodes.has(setupError);
  return (
    <Screen mode={mode} className="sign-in-setup">
      <h1 className="sign-in-title">Setting up Kalkidan</h1>
      <p className="sign-in-lead">This takes about 20 seconds. You can choose a code folder now.</p>
      <ol className="sign-in-checklist" aria-label="Setup steps">
        <SetupStep
          state="done"
          title={`Signed in to ${names.organization || 'Verdictan'}`}
          detail={[names.email || names.user, status?.region && regionNames[status.region]]
            .filter(Boolean)
            .join(' · ')}
        />
        <SetupStep
          state={runtimeState}
          title={
            runtime.installed
              ? 'Managed agents runtime is ready'
              : 'Installing the managed agents runtime'
          }
          detail={runtimeDetail}
        >
          {!runtime.installed && runtimeState === 'running' && (
            <Progress
              value={runtimeProgress(runtime.status)}
              label="Managed agents runtime install"
              className="mt-2"
            />
          )}
        </SetupStep>
        <SetupStep
          state={setupState}
          title="Getting the agent setup of your organization"
          detail={
            setup
              ? lines
              : setupError && !billing
                ? managedErrorInfo(setupError).message
                : undefined
          }
        >
          {setup && (
            <p className="sign-in-step-detail">
              {mode === 'dialog' ? (
                <button type="button" className="text-link" onClick={() => openSettings('agents')}>
                  Change in Settings
                </button>
              ) : (
                'You can change this in Settings.'
              )}
            </p>
          )}
          {billing && (
            <Alert size="sm" className="mt-2">
              <AlertTitle>
                {names.organization || 'Your organization'} cannot use managed agents yet
              </AlertTitle>
              <AlertDescription className="text-xs leading-4">
                {managedErrorInfo(setupError).message}
                {typeof api.verdictanOpenConsole === 'function' && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-1"
                    onClick={() => void api.verdictanOpenConsole().catch(() => {})}
                  >
                    Manage account <ExternalLink />
                  </Button>
                )}
              </AlertDescription>
            </Alert>
          )}
        </SetupStep>
        <SetupStep
          state={programsState}
          title={`Checking Codex and Claude Code on ${computerName}`}
          detail={programs}
        />
      </ol>
      <Button size="lg" className="sign-in-wide" onClick={onDone}>
        {mode === 'window' ? (
          <>
            <FolderOpen /> Choose a code folder
          </>
        ) : (
          'Done'
        )}
      </Button>
    </Screen>
  );
}

function SetupStep({
  state,
  title,
  detail,
  children,
}: {
  state: StepState;
  title: string;
  detail?: string;
  children?: ReactNode;
}) {
  const label = { done: 'Done', running: 'In progress', waiting: 'Not started', failed: 'Failed' }[
    state
  ];
  return (
    <li className="sign-in-step" data-state={state}>
      <span className="sign-in-step-mark" aria-label={label} role="img">
        {state === 'done' ? (
          <Check />
        ) : state === 'running' ? (
          <LoaderCircle className="animate-spin" />
        ) : state === 'failed' ? (
          <X />
        ) : (
          <Circle />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        {detail && <p className="sign-in-step-detail whitespace-pre-line">{detail}</p>}
        {children}
      </div>
    </li>
  );
}
