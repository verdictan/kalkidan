import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Laptop } from 'lucide-react';
import type { API } from '../api/contracts';
import type { AgentInstallation } from '../domain/conversation';
import {
  selectionIssue,
  withoutManagedCode,
  type ManagedAgentKind,
  type VerdictanSetup,
  type VerdictanStatus,
} from '../domain/verdictan';
import type { ComponentUpdateStatus } from '../domain/updates';
import { checkAgentVersion, nativeAgentKind } from '../domain/agent-version';
import { agentProgramAnchor } from '../domain/agent-programs';
import { useRefreshTriggers } from '../hooks/use-refresh-triggers';
import {
  accountChanging,
  displayVersion,
  runtimeBusy,
  runtimeInstallable,
  runtimeOutdated,
  runtimeProgressLabel,
  runtimeStatusLabel,
  updatePhaseLabel,
  updateRunning,
  type StatusLabel,
} from '../lib/verdictan-labels';
import { setAgentInstallations } from '../lib/agent-preference';
import { computerAnchor, settingsAnchors } from '../domain/settings-route';
import {
  VerdictanSetupForm,
  accessLabel,
  managedAgentNames,
  teamPolicyLabel,
} from './verdictan-setup';
import { AgentProgramsDialog } from './agent-programs';
import { startSignIn } from './sign-in-steps';
import { SettingsRow, StatusBadge } from './settings-disclosure';
import { Alert, AlertDescription } from './ui/alert';
import { AgentIcon } from './ui/agent-icon';
import { Button } from './ui/button';
import { CheckboxRow } from './ui/checkbox';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { EntityIcon } from './ui/entity-icon';
import { Progress } from './ui/progress';
import { showToast } from './ui/toast';

/** The account and setup changed. Onboarding and the model chip listen to check again. */
export const managedAgentsChangedEvent = 'kalkidan-managed-agents-changed';

export function notifyManagedAgentsChanged() {
  window.dispatchEvent(new Event(managedAgentsChangedEvent));
}

type Region = NonNullable<VerdictanStatus['region']>;
const regions: Region[] = ['eu', 'us'];
export const regionNames: Record<Region, string> = {
  eu: 'European Union',
  us: 'United States',
};

// Poll only while an operation runs. Otherwise read on focus and when the section opens.
const accountPollMs = 1000;
const runtimePollMs = 1500;
// While the desktop changes the account or the region, read again after this delay.
const changeRetryMs = 1000;

/** A block error inside a Settings section. */
export function StepError({ children }: { children: ReactNode }) {
  return (
    <Alert size="sm" variant="destructive">
      <AlertDescription className="text-xs leading-4">{children}</AlertDescription>
    </Alert>
  );
}

/**
 * Reads the runtime install state of one computer on open, on focus, and on a change. Polls
 * only while an install runs.
 */
export function useRuntimeStatus(api: API, open: boolean, host: string) {
  const [status, setStatus] = useState<ComponentUpdateStatus>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  // True while the desktop changes the account or the region. The read tries again later.
  const [changing, setChanging] = useState(false);
  const generation = useRef(0);
  const pending = useRef(false);
  const reading = useRef(false);
  const retry = useRef<ReturnType<typeof setTimeout>>(undefined);
  const read = useCallback(
    function readRuntime() {
      if (reading.current) return;
      reading.current = true;
      const id = generation.current;
      clearTimeout(retry.current);
      void Promise.resolve()
        .then(() => api.runtimeUpdateStatus(host))
        .then(
          (next) => {
            if (generation.current !== id) return;
            setStatus(next);
            setError('');
            setChanging(false);
          },
          (failure) => {
            if (generation.current !== id) return;
            if (accountChanging(failure)) {
              setChanging(true);
              retry.current = setTimeout(readRuntime, changeRetryMs);
            } else setError('Kalkidan cannot read this computer now. Connect it, then try again.');
          },
        )
        .finally(() => {
          reading.current = false;
        });
    },
    [api, host],
  );
  useEffect(() => {
    if (!open) return;
    generation.current++;
    reading.current = false;
    return () => {
      generation.current++;
      clearTimeout(retry.current);
    };
  }, [open, read]);
  useRefreshTriggers(api, open, read);
  // An install that starts has no journal entry yet. `installing` keeps the poll until it ends.
  const running = runtimeBusy(status) || status?.discovery === 'checking';
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
    } catch (failure) {
      if (id === generation.current)
        if (accountChanging(failure)) {
          setChanging(true);
          retry.current = setTimeout(read, changeRetryMs);
        } else setError('The install did not finish. Try again.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return { status, error, busy, changing, action, read };
}

export type RuntimeState = ReturnType<typeof useRuntimeStatus>;

/**
 * The runtime line of one computer: one line of help, a status, and an action only when there
 * is a problem. "Managed agents 0.6.9 · Updates automatically — Ready".
 */
export function runtimeView(runtime: RuntimeState) {
  const { status, error, changing } = runtime;
  const operation = status?.operation;
  const running = updateRunning(status);
  const starting = !!status?.installing && !running;
  const waitingForIdle = operation?.phase === 'waiting-for-idle';
  const percent =
    operation?.phase === 'downloading' && operation.totalBytes > 0
      ? (operation.receivedBytes / operation.totalBytes) * 100
      : undefined;
  const failure =
    error ||
    (status?.error ? withoutManagedCode(status.error) : '') ||
    (operation?.error && !running && !starting ? withoutManagedCode(operation.error) : '');
  let help: string;
  if (changing) help = 'Kalkidan changes the account now.';
  else if (operation && running)
    help = runtimeProgressLabel(operation.phase, operation.target.version, percent);
  else if (starting && status?.latest)
    help = runtimeProgressLabel('requested', status.latest.version);
  else if (status?.installed)
    help = `Managed agents ${displayVersion(status.installed.version)} · Updates automatically`;
  else if (!status) help = 'Checking managed agents…';
  else help = 'Managed agents are not installed.';
  const label: StatusLabel = failure
    ? { label: 'Needs attention', tone: 'destructive' }
    : changing
      ? { label: 'Waiting…', tone: 'secondary' }
      : running || starting
        ? { label: waitingForIdle ? 'Waiting' : 'Installing…', tone: 'secondary' }
        : runtimeStatusLabel(status);
  return {
    help,
    label,
    failure,
    percent,
    progress: (running && !waitingForIdle) || starting,
    waitingForIdle,
    running: running || starting,
    // An install only when Kalkidan does not do it by itself, or after a failure.
    installable: runtimeInstallable(status) && !running && !starting,
    outdated: runtimeOutdated(status),
    reason: runtimeOutdated(status) && !runtimeInstallable(status) ? status?.reason : undefined,
  };
}

/** The control of a runtime row: the status, then Install, Finish install, or Retry. */
export function RuntimeControl({ runtime, name }: { runtime: RuntimeState; name: string }) {
  const view = runtimeView(runtime);
  const { status, busy, action } = runtime;
  // An install that waits for the active work to stop can also be canceled.
  const cancel = (
    <Button
      variant="ghost"
      size="sm"
      aria-label={`Cancel the install on ${name}`}
      disabled={
        busy ||
        ['activating', 'validating', 'rolling-back'].includes(status?.operation?.phase || '')
      }
      onClick={() => void action('runtimeUpdateCancel')}
    >
      Cancel
    </Button>
  );
  return (
    <>
      <StatusBadge status={view.label} />
      {view.waitingForIdle ? (
        <>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() => void action('runtimeUpdateInstall')}
          >
            Finish install
          </Button>
          {cancel}
        </>
      ) : view.running ? (
        cancel
      ) : view.failure ? (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() =>
            void action(view.installable ? 'runtimeUpdateInstall' : 'runtimeUpdateCheck')
          }
        >
          Retry
        </Button>
      ) : view.installable && (!status?.installed || view.outdated) ? (
        <Button
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => void action('runtimeUpdateInstall')}
        >
          {status?.installed ? 'Update now' : 'Install'}
        </Button>
      ) : null}
    </>
  );
}

/** The content under a runtime row: the progress bar, the reason, or the error. */
export function RuntimeExtra({ runtime }: { runtime: RuntimeState }) {
  const view = runtimeView(runtime);
  if (!view.progress && !view.failure && !view.waitingForIdle && !view.reason) return null;
  return (
    <div className="grid gap-2" aria-live="polite">
      {view.progress && <Progress label="Managed agents install" value={view.percent} />}
      {view.waitingForIdle && (
        <p className="form-help mt-0">Stop the agents that run now. Then select Finish install.</p>
      )}
      {view.reason && <p className="form-help mt-0">{view.reason}</p>}
      {view.failure && <StepError>{view.failure}</StepError>}
    </div>
  );
}

/** The row of this computer in Settings › Computers. */
export function ThisComputerRow({ api, runtime }: { api: API; runtime: RuntimeState }) {
  const view = runtimeView(runtime);
  // After an install finishes, the account check finds the new runtime.
  const busy = runtimeBusy(runtime.status);
  const operation = runtime.status?.operation;
  const wasBusy = useRef(false);
  const before = useRef<string>(undefined);
  useEffect(() => {
    if (wasBusy.current && !busy && operation?.phase === 'completed') {
      if (operation.id !== before.current) {
        showToast(`Installed managed agents ${displayVersion(operation.target.version)}`);
        void Promise.resolve()
          .then(() => api.verdictanCheck())
          .then(notifyManagedAgentsChanged, () => {});
      }
    }
    if (!busy) before.current = operation?.id;
    wasBusy.current = busy;
  }, [busy]);
  return (
    <SettingsRow
      id={computerAnchor()}
      icon={
        <EntityIcon>
          <Laptop />
        </EntityIcon>
      }
      label="This computer"
      help={view.help}
      extra={runtimeExtraShown(runtime) ? <RuntimeExtra runtime={runtime} /> : undefined}
    >
      <RuntimeControl runtime={runtime} name="this computer" />
    </SettingsRow>
  );
}

/** True when the runtime has a progress bar, a reason, or an error to show under its row. */
export function runtimeExtraShown(runtime: RuntimeState) {
  const view = runtimeView(runtime);
  return view.progress || !!view.failure || view.waitingForIdle || !!view.reason;
}

/** The install history of a runtime, for the Advanced fold of Settings › Computers. */
export function RuntimeHistory({ status, name }: { status?: ComponentUpdateStatus; name: string }) {
  if (!status?.history.length) return null;
  return (
    <SettingsRow
      label={`Install history on ${name}`}
      help={
        <ul className="grid gap-1 pt-1">
          {status.history
            .slice()
            .reverse()
            .slice(0, 6)
            .map((item) => (
              <li key={item.id}>
                Version {displayVersion(item.target.version)} · {updatePhaseLabel(item.phase)} ·{' '}
                {new Date(item.updatedAt).toLocaleString()}
                {item.error ? ` · ${withoutManagedCode(item.error)}` : ''}
              </li>
            ))}
        </ul>
      }
    />
  );
}

/** Reads the account state on open, on focus, and on a change. Polls while a sign-in runs. */
export function useAccountStatus(api: API, open: boolean) {
  const [status, setStatus] = useState<VerdictanStatus>();
  const [busy, setBusy] = useState(false);
  // An action error stays until the next action. A read error goes after a read that works.
  const [error, setError] = useState('');
  const [readError, setReadError] = useState('');
  // True while the desktop changes the account or the region. The read tries again later.
  const [changing, setChanging] = useState(false);
  const active = useRef(false);
  const generation = useRef(0);
  const retry = useRef<ReturnType<typeof setTimeout>>(undefined);
  const read = useCallback(
    function readAccount() {
      const id = generation.current;
      clearTimeout(retry.current);
      void Promise.resolve()
        .then(() => api.verdictanStatus())
        .then(
          (next) => {
            if (generation.current !== id) return;
            setStatus(next);
            setReadError('');
            setChanging(false);
          },
          (failure) => {
            if (generation.current !== id) return;
            if (accountChanging(failure)) {
              setChanging(true);
              retry.current = setTimeout(readAccount, changeRetryMs);
            } else setReadError('Could not read the account status.');
          },
        );
    },
    [api],
  );
  useEffect(() => {
    if (!open) return;
    generation.current++;
    return () => {
      generation.current++;
      clearTimeout(retry.current);
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
    if (active.current) return false;
    active.current = true;
    setBusy(true);
    setError('');
    const id = generation.current;
    try {
      const result = await action();
      if (generation.current === id) {
        setStatus(result);
        setReadError('');
        setChanging(false);
        if (done && !result.error) showToast(done);
      }
      notifyManagedAgentsChanged();
      return !result.error;
    } catch (failure) {
      if (generation.current === id)
        if (accountChanging(failure)) {
          setChanging(true);
          retry.current = setTimeout(read, changeRetryMs);
        } else setError('The account operation did not finish. Try again.');
      return false;
    } finally {
      active.current = false;
      setBusy(false);
    }
  }
  return { status, setStatus, busy, error: error || readError, changing, run, read };
}

/** Asks for the region. A change stops the agents that run, so it needs a confirmation. */
export function RegionDialog({
  open,
  current,
  signedIn,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  current?: Region;
  signedIn: boolean;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (region: Region) => void;
}) {
  const [choice, setChoice] = useState<Region | undefined>(current);
  useEffect(() => {
    if (open) setChoice(current);
  }, [open, current]);
  const changes = !!current && !!choice && choice !== current;
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onCancel()}>
      <DialogContent size="sm" layout="scroll">
        <DialogHeader>
          <DialogTitle>{current ? 'Change region' : 'Choose a region'}</DialogTitle>
          <DialogDescription>
            Use the region of your organization. Each region keeps a separate sign-in.
          </DialogDescription>
        </DialogHeader>
        <DialogBody className="grid gap-3">
          <fieldset className="grid gap-2">
            <legend className="sr-only">Region</legend>
            {regions.map((region) => (
              <CheckboxRow
                key={region}
                type="radio"
                name="settings-region"
                checked={choice === region}
                onChange={() => setChoice(region)}
                label={regionNames[region]}
                description={region === current ? 'The region now' : undefined}
              />
            ))}
          </fieldset>
          {changes && (
            <Alert size="sm" role="note">
              <AlertDescription className="text-xs leading-4">
                Changing the region stops running agents and disconnects SSH hosts.
                {signedIn ? ' You sign in again in the new region.' : ''}
              </AlertDescription>
            </Alert>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant={changes ? 'destructive' : 'default'}
            disabled={busy || !choice || choice === current}
            onClick={() => choice && onConfirm(choice)}
          >
            {busy ? 'Changing…' : changes ? 'Stop work and change' : 'Use this region'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The state of one agent on the Computers page, with the help line and the action. */
interface AgentRowState {
  status: StatusLabel;
  help: string;
  /** The one action of the row. 'setup' opens the organization setup under the row. */
  action: 'sign-in' | 'programs' | 'setup' | 'none';
}

/** "Version 0.160.2", or empty when Kalkidan cannot read the version. */
function programVersion(program: AgentInstallation | undefined) {
  return program?.status === 'installed' && program.version ? `Version ${program.version}` : '';
}

export function agentRowState(
  agent: ManagedAgentKind,
  account: VerdictanStatus | undefined,
  setup: VerdictanSetup | undefined,
  program: AgentInstallation | undefined,
  /** True when the account read failed. The row then does not stay at "Checking…". */
  readFailed = false,
  /** True when the setup read failed. The row then does not stay at "Checking…". */
  setupFailed = false,
): AgentRowState {
  const kind = nativeAgentKind(agent)!;
  const version = programVersion(program);
  if (program?.status === 'missing')
    return {
      status: { label: 'Not installed', tone: 'warning' },
      help: 'Not found on this computer',
      action: 'programs',
    };
  if (program?.status === 'installed') {
    const check = checkAgentVersion(kind, program.version);
    if (check.status === 'outdated')
      return {
        status: { label: 'Needs update', tone: 'warning' },
        help: `${version} · Needs ${check.minimum} or later`,
        action: 'programs',
      };
  }
  if (!account && readFailed)
    return {
      status: { label: 'Not known', tone: 'muted' },
      help: 'Kalkidan could not read the account.',
      action: 'none',
    };
  if (!account)
    return { status: { label: 'Checking…', tone: 'secondary' }, help: version, action: 'none' };
  if (account.phase !== 'authenticated')
    return {
      status: { label: 'Needs sign-in', tone: 'warning' },
      help: version,
      action: 'sign-in',
    };
  if (!setup && setupFailed)
    return {
      status: { label: 'Not known', tone: 'muted' },
      help: 'Kalkidan could not read the setup of your organization.',
      action: 'none',
    };
  if (!setup)
    return { status: { label: 'Checking…', tone: 'secondary' }, help: version, action: 'none' };
  const saved = setup.selections[agent];
  if (!saved || selectionIssue(setup, saved))
    return {
      status: { label: 'Needs setup', tone: 'warning' },
      help: version,
      action: 'setup',
    };
  return {
    status: { label: 'Ready', tone: 'success' },
    help: [version, saved.model].filter(Boolean).join(' · '),
    action: 'none',
  };
}

/** The organization setup of a saved selection in one line: "Platform team · Kalkidan default". */
function setupLine(setup: VerdictanSetup, agent: ManagedAgentKind) {
  const saved = setup.selections[agent];
  return [teamPolicyLabel(setup, saved), saved ? accessLabel(agent, saved) : '']
    .filter(Boolean)
    .join(' · ');
}

/**
 * The agent rows of the Computers page: one row for Codex and one for Claude Code with the
 * program version, the default model, and the state. A warning shows only when the agent
 * cannot run, with one outline action. "Choose…" picks the program on this computer. Under
 * each row, "Organization setup" opens the team, policy and connection choices in place.
 */
export function AgentRows({ api, open, anchor }: { api: API; open: boolean; anchor?: string }) {
  const account = useAccountStatus(api, open);
  const status = account.status;
  const signedIn = status?.phase === 'authenticated';
  const [setup, setSetup] = useState<VerdictanSetup>();
  const [setupFailed, setSetupFailed] = useState(false);
  const [programs, setPrograms] = useState<AgentInstallation[]>();
  const [expanded, setExpanded] = useState<ManagedAgentKind>();
  const [programsOpen, setProgramsOpen] = useState(false);
  const readSetup = useCallback(() => {
    if (!signedIn) return;
    void Promise.resolve()
      .then(() => api.verdictanSetup())
      .then(
        (value) => {
          setSetup(value);
          setSetupFailed(false);
        },
        () => setSetupFailed(true),
      );
  }, [api, signedIn]);
  const readPrograms = useCallback(() => {
    void Promise.resolve()
      .then(() => api.agentInstallations())
      .then(
        (list) => {
          setPrograms(list);
          setAgentInstallations(list);
        },
        () => {},
      );
  }, [api]);
  useRefreshTriggers(api, open && signedIn, readSetup);
  useRefreshTriggers(undefined, open, readPrograms);
  // A link to the managed setup opens the setup of the first agent that needs it.
  const linked = useRef(false);
  useEffect(() => {
    if (linked.current || anchor !== settingsAnchors.managedSetup || !setup) return;
    linked.current = true;
    const first = (['codex', 'claude'] as const).find(
      (agent) => !setup.selections[agent] || selectionIssue(setup, setup.selections[agent]),
    );
    if (first) setExpanded(first);
  }, [anchor, setup]);
  const agents: ManagedAgentKind[] = ['codex', 'claude'];
  return (
    <>
      {agents.map((agent) => {
        const program = programs?.find((item) => item.agent === agent);
        const state = agentRowState(agent, status, setup, program, !!account.error, setupFailed);
        const name = managedAgentNames[agent];
        const editing = expanded === agent;
        return (
          <SettingsRow
            key={agent}
            id={agent === 'codex' ? settingsAnchors.managedSetup : agentProgramAnchor(agent)}
            icon={
              <EntityIcon>
                <AgentIcon agent={agent} />
              </EntityIcon>
            }
            label={name}
            help={state.help || undefined}
            extra={
              signedIn && setup ? (
                <div className="grid gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="settings-row-label block">Organization setup</span>
                      <span className="settings-row-help block">
                        {setupLine(setup, agent) || 'Not chosen'}
                      </span>
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      aria-expanded={editing}
                      aria-label={`${editing ? 'Hide' : 'Change'} the organization setup of ${name}`}
                      onClick={() => setExpanded(editing ? undefined : agent)}
                    >
                      {editing ? 'Done' : state.action === 'setup' ? 'Set up…' : 'Change…'}
                    </Button>
                  </div>
                  {editing && (
                    <VerdictanSetupForm
                      api={api}
                      agent={agent}
                      onSetup={(value) => {
                        setSetup(value);
                        notifyManagedAgentsChanged();
                      }}
                    />
                  )}
                </div>
              ) : undefined
            }
          >
            <StatusBadge status={state.status} />
            {state.action === 'sign-in' ? (
              <Button variant="outline" size="sm" onClick={() => startSignIn('login')}>
                Sign in
              </Button>
            ) : (
              <Button
                variant="outline"
                size="sm"
                aria-label={`Choose the ${name} program`}
                onClick={() => setProgramsOpen(true)}
              >
                Choose…
              </Button>
            )}
          </SettingsRow>
        );
      })}
      <AgentProgramsDialog
        api={api}
        open={programsOpen}
        onOpenChange={setProgramsOpen}
        onChecked={(list) => setPrograms(list)}
      />
    </>
  );
}

/** The program details of each agent, for the Details fold of the Computers page. */
export function programText(program: AgentInstallation | undefined) {
  if (!program) return 'Checking…';
  if (program.status === 'unavailable') return 'Only in the desktop app.';
  if (program.status !== 'installed') return 'Not found.';
  const source =
    program.source === 'chosen'
      ? 'Chosen by you'
      : program.source === 'environment'
        ? 'Set by an environment variable'
        : 'Found automatically';
  return [program.path, program.version, source].filter(Boolean).join(' · ');
}
