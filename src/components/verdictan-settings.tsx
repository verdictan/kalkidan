import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Info, RefreshCw } from 'lucide-react';
import type { API } from '../api/contracts';
import { isSubscriptionMode, withoutManagedCode } from '../domain/verdictan';
import type { VerdictanSetup, VerdictanStatus } from '../domain/verdictan';
import type { ComponentUpdateStatus } from '../domain/updates';
import { VerdictanSetupForm } from './verdictan-setup';
import { SettingsDisclosure, CopyValue } from './settings-disclosure';
import { Choice } from './choice';
import { Hint } from './hint';
import { Alert, AlertDescription } from './ui/alert';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { SectionHeader } from './ui/page-header';
import { Progress } from './ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { showToast } from './ui/toast';
import { notifyUpdatesChanged } from '../hooks/use-update-status';
import {
  accountNames,
  accountPhaseLabel,
  displayVersion,
  managedSteps,
  runtimeInstallable,
  runtimeNewerNotApproved,
  runtimeOutdated,
  runtimeStatusLabel,
  updatePhaseLabel,
  updateRunning,
  verdictanErrorMessage,
  type StatusLabel,
} from '../lib/verdictan-labels';
import { cn } from '../lib/utils';

/** The account and setup changed. Onboarding listens to check managed agents again. */
export const managedAgentsChangedEvent = 'kalkidan-managed-agents-changed';

function notifyManagedAgentsChanged() {
  window.dispatchEvent(new Event(managedAgentsChangedEvent));
}

// Poll only while an operation runs. Otherwise read the state on focus and on request.
const accountPollMs = 1000;
const runtimePollMs = 1500;

/** A block error inside a settings step. */
export function StepError({ children }: { children: ReactNode }) {
  return (
    <Alert size="sm" variant="destructive">
      <AlertDescription className="text-xs leading-4">{children}</AlertDescription>
    </Alert>
  );
}

function StatusBadge({ status }: { status: StatusLabel }) {
  return (
    <Badge variant={status.tone} size="sm" role="status">
      {status.label}
    </Badge>
  );
}

/** Calls `refresh` when the window gets focus and when the desktop reports a change. */
function useRefreshTriggers(api: API, open: boolean, refresh: () => void) {
  useEffect(() => {
    if (!open) return;
    window.addEventListener('focus', refresh);
    const unsubscribe = api.onVerdictanChanged?.(refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      unsubscribe?.();
    };
  }, [api, open, refresh]);
}

/** Reads the runtime install state of one computer. Polls only while an install runs. */
function useRuntimeStatus(api: API, open: boolean, host: string) {
  const [status, setStatus] = useState<ComponentUpdateStatus>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const generation = useRef(0);
  const pending = useRef(false);
  const reading = useRef(false);
  const read = useCallback(() => {
    if (reading.current) return;
    reading.current = true;
    const id = generation.current;
    void Promise.resolve()
      .then(() => api.runtimeUpdateStatus(host))
      .then(
        (next) => {
          if (generation.current !== id) return;
          setStatus(next);
          setError('');
        },
        () => {
          if (generation.current === id)
            setError('This computer is not available. Connect it, then check again.');
        },
      )
      .finally(() => {
        reading.current = false;
      });
  }, [api, host]);
  useEffect(() => {
    if (!open) return;
    generation.current++;
    reading.current = false;
    setStatus(undefined);
    setError('');
    read();
    return () => {
      generation.current++;
    };
  }, [open, read]);
  useRefreshTriggers(api, open, read);
  const running = updateRunning(status) || status?.discovery === 'checking';
  useEffect(() => {
    if (!open || !running) return;
    const timer = setInterval(read, runtimePollMs);
    return () => clearInterval(timer);
  }, [open, running, read]);
  async function action(
    method: 'runtimeUpdateCheck' | 'runtimeUpdateInstall' | 'runtimeUpdateCancel',
  ) {
    if (pending.current && method !== 'runtimeUpdateCancel') return;
    pending.current = true;
    setBusy(true);
    setError('');
    const id = generation.current;
    try {
      const result = await api[method](host);
      if (id === generation.current) setStatus(result);
      notifyUpdatesChanged();
    } catch {
      if (id === generation.current)
        setError('The runtime operation did not finish. Check for updates, then try again.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return { status, error, busy, action };
}

/** Reads the account state. Polls only while a sign-in or a check runs. */
function useAccountStatus(api: API, open: boolean) {
  const [status, setStatus] = useState<VerdictanStatus>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const active = useRef(false);
  const generation = useRef(0);
  const read = useCallback(() => {
    const id = generation.current;
    void Promise.resolve()
      .then(() => api.verdictanStatus())
      .then(
        (next) => {
          if (generation.current === id) setStatus(next);
        },
        () => {
          if (generation.current === id) setError('Could not read the account status.');
        },
      );
  }, [api]);
  useEffect(() => {
    if (!open) return;
    generation.current++;
    read();
    return () => {
      generation.current++;
    };
  }, [open, read]);
  useRefreshTriggers(api, open, read);
  const waiting = status?.phase === 'authorizing' || status?.phase === 'checking';
  useEffect(() => {
    if (!open || !waiting) return;
    const timer = setInterval(read, accountPollMs);
    return () => clearInterval(timer);
  }, [open, waiting, read]);
  async function run(action: () => Promise<VerdictanStatus>, done?: string) {
    if (active.current) return;
    active.current = true;
    setBusy(true);
    setError('');
    const id = generation.current;
    try {
      const result = await action();
      if (generation.current === id) {
        setStatus(result);
        if (done && !result.error) showToast(done);
      }
      notifyManagedAgentsChanged();
    } catch {
      if (generation.current === id)
        setError('The account operation did not finish. Check the status, then try again.');
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  return { status, setStatus, busy, error, setError, run };
}

/**
 * Settings › Managed agents. Three steps in order: install the runtime, sign in, and choose
 * the setup for each agent.
 */
export function ManagedAgentsSettings({ api, open }: { api: API; open: boolean }) {
  const [hosts, setHosts] = useState<{ value: string; label: string }[]>([
    { value: 'local', label: 'This computer' },
  ]);
  const [host, setHost] = useState('local');
  const [setup, setSetup] = useState<VerdictanSetup>();
  useEffect(() => {
    if (!open) return;
    let live = true;
    void Promise.resolve()
      .then(() => api.remoteHosts())
      .then((list) => {
        if (live)
          setHosts([
            { value: 'local', label: 'This computer' },
            ...list.map((item) => ({ value: item.id, label: item.name })),
          ]);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [api, open]);
  const runtime = useRuntimeStatus(api, open, host);
  const account = useAccountStatus(api, open);
  // After an install finishes, the account check finds the new runtime.
  const wasRunning = useRef(false);
  const running = updateRunning(runtime.status);
  useEffect(() => {
    if (wasRunning.current && !running) {
      if (runtime.status?.operation?.phase === 'completed') {
        showToast(`Installed managed agents runtime ${runtime.status.operation.target.version}`);
        void account.run(() => api.verdictanCheck());
      }
    }
    wasRunning.current = running;
  }, [running]);
  const steps = managedSteps(account.status, setup);
  const signedIn = steps.signedIn;
  // One primary button: the action of the first step that is not done.
  const next = !runtime.status?.installed && !steps.runtime ? 1 : !signedIn ? 2 : 3;
  return (
    <section aria-label="Managed agents" className="managed-agents grid gap-5">
      <div className="grid gap-2">
        <p className="form-help">
          Kalkidan runs Codex and Claude Code through managed agents. Your organization controls the
          policy and the model access. Do these 3 steps once on each computer.
        </p>
        <ul className="flex flex-wrap gap-2" aria-label="Agent readiness">
          <ReadyChip
            name="Codex"
            ready={steps.codex}
            subscription={isSubscriptionMode(setup?.selections.codex?.providerAccessMode)}
          />
          <ReadyChip
            name="Claude Code"
            ready={steps.claude}
            subscription={isSubscriptionMode(setup?.selections.claude?.providerAccessMode)}
          />
        </ul>
      </div>
      <ol className="managed-steps">
        <RuntimeStep
          primary={next === 1}
          hosts={hosts}
          host={host}
          onHost={setHost}
          runtime={runtime}
        />
        <AccountStep
          api={api}
          primary={next === 2}
          runtimeMissing={account.status?.phase === 'missing'}
          account={account}
        />
        <Step
          number={3}
          done={steps.codex || steps.claude}
          title="Choose setup"
          disabled={!signedIn}
        >
          {signedIn ? (
            <VerdictanSetupForm
              key={`${account.status?.region}:${account.status?.account?.organizationId}:${account.status?.account?.userId}`}
              api={api}
              open={open}
              primary={next === 3}
              onSetup={(value) => {
                setSetup(value);
                notifyManagedAgentsChanged();
              }}
            />
          ) : (
            <p className="form-help">
              Sign in first. Then choose the team, policy, and model for each agent.
            </p>
          )}
        </Step>
      </ol>
    </section>
  );
}

function ReadyChip({
  name,
  ready,
  subscription,
}: {
  name: string;
  ready: boolean;
  /** True when the agent uses the user's own subscription. */
  subscription: boolean;
}) {
  return (
    <li>
      <Badge variant={ready ? 'success' : 'muted'} size="md">
        {ready ? <Check aria-hidden="true" /> : null}
        {ready
          ? `Ready for ${name}${subscription ? ' · Your subscription' : ''}`
          : `${name} not set up`}
      </Badge>
    </li>
  );
}

/** One numbered step. The number changes to a check mark when the step is done. */
function Step({
  number,
  done,
  title,
  actions,
  disabled,
  children,
}: {
  number: number;
  done: boolean;
  title: string;
  actions?: ReactNode;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <li className="managed-step" data-disabled={disabled || undefined}>
      <span className="managed-step-number" data-done={done || undefined}>
        {done ? <Check className="size-3.5" aria-label="Done" /> : number}
      </span>
      <section aria-label={title} className="grid min-w-0 gap-3">
        <SectionHeader size="sm" className="mb-0 flex-wrap" title={title} actions={actions} />
        {children}
      </section>
    </li>
  );
}

function RuntimeStep({
  primary,
  hosts,
  host,
  onHost,
  runtime,
}: {
  primary: boolean;
  hosts: { value: string; label: string }[];
  host: string;
  onHost: (host: string) => void;
  runtime: ReturnType<typeof useRuntimeStatus>;
}) {
  const { status, busy, error, action } = runtime;
  const operation = status?.operation;
  const running = updateRunning(status);
  const waitingForIdle = operation?.phase === 'waiting-for-idle';
  const installable = runtimeInstallable(status);
  const label = runtimeStatusLabel(status);
  const percent =
    operation?.phase === 'downloading' && operation.totalBytes > 0
      ? (operation.receivedBytes / operation.totalBytes) * 100
      : undefined;
  const statusError = status?.error ? withoutManagedCode(status.error) : '';
  return (
    <Step
      number={1}
      done={!!status?.installed && !runtimeOutdated(status)}
      title="Install runtime"
      actions={
        <>
          <span className="flex items-center gap-2 text-xs text-muted-foreground">
            Computer
            <Choice
              size="sm"
              className="max-w-44"
              label="Computer"
              value={host}
              onChange={onHost}
              options={hosts}
            />
          </span>
          <Hint label="Check for updates">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Check for updates"
              disabled={busy || status?.discovery === 'checking'}
              onClick={() => void action('runtimeUpdateCheck')}
            >
              <RefreshCw className={status?.discovery === 'checking' ? 'animate-spin' : ''} />
            </Button>
          </Hint>
          {((installable && !running) || (waitingForIdle && runtimeOutdated(status))) && (
            <Button
              size="sm"
              variant={primary || waitingForIdle ? 'default' : 'outline'}
              disabled={busy}
              onClick={() => void action('runtimeUpdateInstall')}
            >
              {waitingForIdle
                ? 'Finish install'
                : `${status?.installed ? 'Update to' : 'Install'} version ${status!.approved!.version}`}
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge status={label} />
        {status?.stale && status.lastSuccessAt && (
          <span className="text-xs leading-4 text-muted-foreground">
            The last check may be out of date.
          </span>
        )}
      </div>
      <dl className="meta-list">
        {status?.installed && (
          <>
            <dt>Installed</dt>
            <dd>{status.installed.version}</dd>
          </>
        )}
        {status?.running && status.running.version !== status.installed?.version && (
          <>
            <dt>Running</dt>
            <dd>{status.running.version}</dd>
          </>
        )}
        <dt>Approved</dt>
        <dd>{status?.approved?.version || 'No approved version'}</dd>
        {status?.lastSuccessAt && (
          <>
            <dt>Last checked</dt>
            <dd>{new Date(status.lastSuccessAt).toLocaleString()}</dd>
          </>
        )}
      </dl>
      {/* A newer release that is not approved is information only. It never blocks the install. */}
      {(status?.notice || runtimeNewerNotApproved(status)) && (
        <p className="flex items-start gap-2 text-xs leading-4 text-muted-foreground">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          {status!.notice ||
            `Version ${status!.discovered!.version} is out. Your desktop policy has not approved it yet, so Kalkidan installs version ${status!.approved!.version}.`}
        </p>
      )}
      {runtimeOutdated(status) && !installable && !running && status?.reason && (
        <p className="form-help">{status.reason}</p>
      )}
      {!status?.approved && status && status.discovery !== 'checking' && !error && (
        <p className="form-help">
          No approved version is available. Check for updates later, or ask your administrator.
        </p>
      )}
      {operation && running && (
        <div className="grid gap-2" aria-live="polite">
          <div className="flex items-center justify-between gap-2 text-xs leading-4">
            <span>
              {updatePhaseLabel(operation.phase)} version {operation.target.version}
              {percent !== undefined && ` · ${Math.round(percent)}%`}
            </span>
            <Button
              variant="ghost"
              size="xs"
              disabled={
                busy || ['activating', 'validating', 'rolling-back'].includes(operation.phase)
              }
              onClick={() => void action('runtimeUpdateCancel')}
            >
              Cancel
            </Button>
          </div>
          {!waitingForIdle && <Progress label="Runtime install" value={percent} />}
          {operation.phase === 'waiting-for-idle' && (
            <p className="form-help">Stop the agents that run now. Then select Finish install.</p>
          )}
        </div>
      )}
      {operation?.error && !running && <StepError>{withoutManagedCode(operation.error)}</StepError>}
      {(error || statusError) && <StepError>{error || statusError}</StepError>}
      {!!status?.history.length && (
        <SettingsDisclosure title="Install history">
          <ul className="grid gap-2 text-xs leading-4">
            {status.history
              .slice()
              .reverse()
              .map((item) => (
                <li key={item.id} className="grid gap-0.5">
                  <span>
                    Version {displayVersion(item.target.version)} · {updatePhaseLabel(item.phase)} ·{' '}
                    {new Date(item.updatedAt).toLocaleString()}
                  </span>
                  {item.error && <span className="text-muted-foreground">{item.error}</span>}
                </li>
              ))}
          </ul>
        </SettingsDisclosure>
      )}
    </Step>
  );
}

type Region = NonNullable<VerdictanStatus['region']>;
const regions: Region[] = ['eu', 'us'];
const regionNames: Record<Region, string> = { eu: 'European Union', us: 'United States' };

function AccountStep({
  api,
  primary,
  runtimeMissing,
  account,
}: {
  api: API;
  primary: boolean;
  runtimeMissing: boolean;
  account: ReturnType<typeof useAccountStatus>;
}) {
  const { status, setStatus, busy, error, setError, run } = account;
  const [pendingRegion, setPendingRegion] = useState<Region>();
  const details = status?.account;
  // A status without a region needs an explicit EU or US choice before sign-in.
  const regionRequired = !!status && !status.region;
  const names = accountNames(status);
  const signedIn = status?.phase === 'authenticated';
  const canRenew = signedIn || status?.phase === 'expired';
  const authorizing = status?.phase === 'authorizing';
  return (
    <Step
      number={2}
      done={signedIn}
      title="Sign in"
      disabled={runtimeMissing}
      actions={
        <>
          <Hint label="Check status">
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Check status"
              disabled={busy}
              onClick={() => void run(() => api.verdictanCheck())}
            >
              <RefreshCw className={status?.phase === 'checking' ? 'animate-spin' : ''} />
            </Button>
          </Hint>
          {authorizing ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                void api
                  .verdictanCancel()
                  .then(setStatus, () =>
                    setError('Could not cancel the sign-in. Check the status.'),
                  )
              }
            >
              Cancel sign-in
            </Button>
          ) : canRenew ? (
            <>
              <Button
                variant={status?.phase === 'expired' && primary ? 'default' : 'outline'}
                size="sm"
                disabled={busy}
                onClick={() => void run(() => api.verdictanRenew(), 'Session renewed')}
              >
                Renew session
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => void run(() => api.verdictanLogout(), 'Signed out')}
              >
                Sign out
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                disabled={busy || runtimeMissing || regionRequired}
                onClick={() => void run(() => api.verdictanAuthorize('register'))}
              >
                Create account
              </Button>
              <Button
                variant={primary ? 'default' : 'outline'}
                size="sm"
                disabled={busy || runtimeMissing || regionRequired}
                onClick={() => void run(() => api.verdictanAuthorize('login'))}
              >
                Sign in
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge
          status={
            regionRequired
              ? { label: 'Region not selected', tone: 'warning' }
              : accountPhaseLabel(status?.phase)
          }
        />
        {authorizing && (
          <span className="text-xs leading-4 text-muted-foreground">
            Finish the sign-in in your browser. This page updates after you finish.
          </span>
        )}
      </div>
      {runtimeMissing && <p className="form-help">Install the runtime in step 1 first.</p>}
      {details?.organizationId && (
        <dl className="meta-list">
          <dt>Organization</dt>
          <dd>{names.organization || 'Your organization'}</dd>
          {names.email && (
            <>
              <dt>Email</dt>
              <dd>{names.email}</dd>
            </>
          )}
          {details.expiresAt && (
            <>
              <dt>Session ends</dt>
              <dd>{new Date(details.expiresAt).toLocaleString()}</dd>
            </>
          )}
        </dl>
      )}
      <div className="form-label">
        <span id="managed-region-label">Account region</span>
        <Select
          value={pendingRegion || status?.region || ''}
          disabled={busy || authorizing}
          onValueChange={(value) => {
            const region = value as Region;
            // The first choice changes nothing that runs. Apply it at once.
            if (regionRequired)
              void run(
                () => api.verdictanSetRegion(region),
                `Region set to ${regionNames[region]}`,
              );
            else setPendingRegion(region);
          }}
        >
          <SelectTrigger aria-labelledby="managed-region-label" className="w-56">
            <SelectValue placeholder="Select a region" />
          </SelectTrigger>
          <SelectContent>
            {regions.map((region) => (
              <SelectItem key={region} value={region}>
                {regionNames[region]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span className="form-help">
          {regionRequired
            ? 'Select the region of your organization before you sign in. Each region keeps a separate sign-in.'
            : 'Each region keeps a separate sign-in.'}
        </span>
      </div>
      {pendingRegion && status?.region && pendingRegion !== status.region && (
        <Alert size="sm" role="group" aria-label="Confirm region change" className="gap-y-2">
          <AlertDescription className="text-xs leading-4 text-foreground">
            A region change stops the agents that run now and disconnects SSH hosts. The app stays
            open.
          </AlertDescription>
          <div className="col-start-2 flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => setPendingRegion(undefined)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await api.verdictanSetRegion(pendingRegion);
                  setPendingRegion(undefined);
                  return result;
                }, 'Region changed')
              }
            >
              Stop work and change region
            </Button>
          </div>
        </Alert>
      )}
      {details?.organizationId && (
        <SettingsDisclosure title="Details">
          <dl className="meta-list">
            <dt>Organization ID</dt>
            <dd>
              <CopyValue value={details.organizationId} name="Organization ID" />
            </dd>
            {details.userId && (
              <>
                <dt>User ID</dt>
                <dd>
                  <CopyValue value={details.userId} name="User ID" />
                </dd>
              </>
            )}
            <dt>Service</dt>
            <dd>
              <CopyValue value={details.apiUrl} name="Service address" />
            </dd>
          </dl>
        </SettingsDisclosure>
      )}
      {status?.remoteRevocationPending && (
        <StepError>
          You are signed out on this computer. Kalkidan could not confirm that the service removed
          the access.
        </StepError>
      )}
      {(error || (status?.error && !regionRequired)) && (
        <StepError>{error || verdictanErrorMessage(status!.error!)}</StepError>
      )}
    </Step>
  );
}

/**
 * The runtime card in Settings › Updates. Install and update the runtime in
 * Settings › Managed agents.
 */
export function RuntimeUpdateCard({
  api,
  open,
  onManage,
}: {
  api: API;
  open: boolean;
  onManage: () => void;
}) {
  const [status, setStatus] = useState<ComponentUpdateStatus>();
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!open) return;
    let live = true;
    void Promise.resolve()
      .then(() => api.runtimeUpdateStatus('local'))
      .then(
        (value) => live && (setStatus(value), setFailed(false)),
        () => live && setFailed(true),
      );
    return () => {
      live = false;
    };
  }, [api, open]);
  const label: StatusLabel = failed
    ? { label: 'Check failed', tone: 'destructive' }
    : runtimeStatusLabel(status);
  return (
    <UpdateCard
      name="Managed agents runtime"
      version={status?.installed?.version}
      status={label}
      action={
        <Button
          variant={runtimeInstallable(status) ? 'default' : 'outline'}
          size="sm"
          onClick={onManage}
        >
          {runtimeInstallable(status) ? 'Open managed agents' : 'Manage'}
        </Button>
      }
    >
      Kalkidan runs agents through this runtime. Install and update it in Managed agents.
    </UpdateCard>
  );
}

/** One component in Settings › Updates: name, version, status, and one action. */
export function UpdateCard({
  name,
  version,
  subtitle,
  status,
  action,
  children,
  className,
}: {
  name: string;
  version?: string;
  /** Replaces the version line, for example "Build 4a1a9a9". */
  subtitle?: string;
  status: StatusLabel;
  action?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <li className={cn('update-card', className)} role="group" aria-label={name}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="text-[13px] leading-5 font-semibold">{name}</p>
          <p className="text-xs leading-4 text-muted-foreground">
            {subtitle || (version ? `Version ${version}` : 'Version not known')}
          </p>
        </div>
        <StatusBadge status={status} />
        {action}
      </div>
      {children && (
        <div className="grid justify-items-start gap-2 text-xs leading-4 text-muted-foreground">
          {children}
        </div>
      )}
    </li>
  );
}
