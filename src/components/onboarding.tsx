import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { ArrowRight, Check, ChevronDown, FolderOpen, RefreshCw, Sparkles, X } from 'lucide-react';
import type { API, Snapshot, Agent, AgentInstallation, Project } from '../types';
import { agentCatalog, agentLabel } from '../config/agents';
import { CreateProject } from './create-project';
import { AddRepository } from './add-repository';
import { Choice } from './choice';
import { AgentInstallHelp } from './agent-programs';
import { folderName, showFolderImportResult, useFolderImport } from './repository-import';
import { Hint } from './hint';
import { hasPrimaryModifier } from '../lib/platform';
import { Button } from './ui/button';
import { Progress } from './ui/progress';
import { Textarea } from './ui/textarea';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { errorMessage } from '../lib/errors';
import {
  readPreferredAgent,
  savePreferredAgent,
  setAgentInstallations,
} from '../lib/agent-preference';
import { cn } from '../lib/utils';
import { managedErrorCode, managedErrorInfo } from '../domain/verdictan';
import type { VerdictanSetup } from '../domain/verdictan';
import { managedSteps } from '../lib/verdictan-labels';
import {
  runtimeProgress,
  useRuntimeStatus,
  useVerdictanStatus,
} from '../hooks/use-verdictan-status';
import { signedInName, startSignIn } from './sign-in-steps';

/** The draft of the first chat. The user can change it before Send. */
export const firstChatPrompt =
  'Explain this repository: its architecture, main entry points, and how to run and test it. Suggest a useful first task. Do not change files yet.';

/**
 * Opens a new chat in a code folder with the first draft. Use it after the first code folder
 * is added: the user lands in the composer, not on a page. Kalkidan sends nothing.
 */
export function startFirstChat(detail: { groupId: string; repoId?: string; agent?: Agent }) {
  window.dispatchEvent(
    new CustomEvent('kalkidan-new-session', { detail: { ...detail, prompt: firstChatPrompt } }),
  );
}

/** Opens the Get started dialog. The shell handles the event. */
export function openGetStarted() {
  window.dispatchEvent(new CustomEvent('kalkidan-open-get-started'));
}

const storageKey = 'kalkidan:onboarding:v1';
export function onboardingDismissed() {
  try {
    return localStorage.getItem(storageKey) !== null;
  } catch {
    return false;
  }
}
export function dismissOnboarding() {
  try {
    localStorage.setItem(storageKey, 'dismissed');
  } catch {
    /* Setup still works without browser storage. */
  }
}

/**
 * The three setup steps: sign in, a code folder, then a first chat. `signedIn` is true when the
 * build has no managed agents, for example in the browser preview.
 */
export function onboardingProgress(data: Pick<Snapshot, 'projects' | 'sessions'>, signedIn = true) {
  const done =
    (signedIn ? 1 : 0) + (data.projects.length > 0 ? 1 : 0) + (data.sessions.length > 0 ? 1 : 0);
  return { done, total: 3, complete: done === 3 };
}

// True while the setup is not complete. The sidebar footer and the dialog set it. The account
// menu reads it to show "Get started" until the setup is complete.
let setupIncomplete = false;
const setupListeners = new Set<() => void>();
function publishSetupIncomplete(value: boolean) {
  if (setupIncomplete === value) return;
  setupIncomplete = value;
  for (const listener of setupListeners) listener();
}
function subscribeSetup(listener: () => void) {
  setupListeners.add(listener);
  return () => setupListeners.delete(listener);
}
/** True while the setup is not complete. */
export function useSetupIncomplete() {
  return useSyncExternalStore(
    subscribeSetup,
    () => setupIncomplete,
    () => false,
  );
}

/** "Get started" for the account menu. It shows only until the setup is complete. */
export function GetStartedMenuItem() {
  const visible = useSetupIncomplete();
  if (!visible) return null;
  return (
    <DropdownMenuItem onSelect={openGetStarted}>
      <Sparkles className="size-4" />
      Get started
    </DropdownMenuItem>
  );
}

const hiddenKey = 'kalkidan:get-started-hidden';
function getStartedHidden() {
  try {
    return localStorage.getItem(hiddenKey) !== null;
  } catch {
    return false;
  }
}

// A bridge with no methods, for callers that do not give `api`. The hooks then read nothing.
const noApi = {} as API;

/**
 * The sidebar footer row for the setup. While the managed agents runtime installs, it shows
 * "Setting up agents · 62%" and a bar. Otherwise it shows "Get started 2/3" when one step is
 * left that no other place asks for: it hides while signed out (the session banner asks) and
 * while there is no project (the empty state asks). "Hide" removes the row; the account menu
 * keeps "Get started" until the setup is complete.
 */
export function GetStartedButton({
  api,
  data,
  onOpen,
  className,
}: {
  /** Without `api`, the row does not know the account or the runtime. */
  api?: API;
  data: Pick<Snapshot, 'projects' | 'sessions'>;
  onOpen: () => void;
  className?: string;
}) {
  const [hidden, setHidden] = useState(getStartedHidden);
  const bridge = api || noApi;
  const account = useVerdictanStatus(bridge, !!api);
  const runtime = useRuntimeStatus(bridge, !!api);
  const managed = !!api && account.supported;
  const signedIn = !managed || !account.status || account.status.phase === 'authenticated';
  const progress = onboardingProgress(data, signedIn);
  useEffect(() => publishSetupIncomplete(!progress.complete), [progress.complete]);
  if (runtime.busy && !runtime.installed) {
    const value = runtimeProgress(runtime.status);
    return (
      <div className="onboarding-setup-progress" role="status">
        <span>Setting up agents{value !== undefined ? ` · ${value}%` : ''}</span>
        <Progress value={value} label="Setting up agents" />
      </div>
    );
  }
  if (hidden || progress.complete || !signedIn || !data.projects.length) return null;
  return (
    <div className="onboarding-get-started">
      <Button
        variant="ghost"
        className={cn('min-w-0 flex-1 font-normal', className)}
        aria-label="Get started"
        aria-description={`${progress.done} of ${progress.total} steps done`}
        onClick={onOpen}
      >
        <ArrowRight /> Get started
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          {progress.done}/{progress.total}
        </span>
      </Button>
      <Hint label="Hide">
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-muted-foreground"
          aria-label="Hide Get started"
          onClick={() => {
            try {
              localStorage.setItem(hiddenKey, 'hidden');
            } catch {
              /* It shows again at the next launch. */
            }
            setHidden(true);
          }}
        >
          <X />
        </Button>
      </Hint>
    </div>
  );
}

/**
 * Get started: 1 Sign in, 2 Open a code folder, 3 Say hello. Only the first step that is not
 * done is open. After the user opens a code folder, the first chat opens at once with a draft.
 */
export function Onboarding({
  api,
  data,
  open,
  preview,
  onOpenChange,
  onRefresh,
  onStart,
}: {
  api: API;
  data: Snapshot;
  open: boolean;
  preview: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => Promise<void>;
  /** Not used any more: onboarding never leaves for Settings. Kept for the shell. */
  onSettings?: () => void;
  onStart: (agent: Agent, repo: Project, prompt: string) => void;
  /** Not used any more: the project page connects a board. Kept for the shell. */
  onConnectBoard?: (groupId: string) => void;
}) {
  const [groupId, setGroupId] = useState('');
  const [repoId, setRepoId] = useState('');
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [setupError, setSetupError] = useState('');
  // The repository list shows inside step 2. It does not replace this dialog.
  const folderImport = useFolderImport(api, `${open}:${groupId}`, { inline: true });
  const [agent, setAgent] = useState<Agent>(readPreferredAgent);
  const [installations, setInstallations] = useState<AgentInstallation[]>([]);
  const pendingCheck = useRef<Promise<AgentInstallation[]> | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [checkRevision, setCheckRevision] = useState(0);
  const [prompt, setPrompt] = useState(firstChatPrompt);
  // The step that the user opened. Without it, the first step that is not done is open.
  const [openStep, setOpenStep] = useState<1 | 2 | 3>();
  const groups = data.groups || [];
  const group = groups.find((g) => g.id === groupId) || groups[0];
  const repos = data.projects.filter((repo) => group?.repoIds.includes(repo.id));
  const repo = repos.find((r) => r.id === repoId) || repos[0];
  const installation = installations.find((item) => item.agent === agent);
  const agentName = agentLabel(agent);
  // Agents run through managed agents. The account state and the runtime install state are
  // separate sources: the runtime is ready only when the installer says that it is installed.
  const managedSupported = !preview && typeof api.verdictanStatus === 'function';
  const account = useVerdictanStatus(api, open && managedSupported);
  const runtime = useRuntimeStatus(api, open && managedSupported);
  const status = account.status;
  const signedIn = status?.phase === 'authenticated';
  // Without a managed-agent check (browser preview, older builds), sign-in is not a step.
  const signInDone = !managedSupported || !status || signedIn;
  const current = openStep ?? (!signInDone ? 1 : repo ? 3 : 2);
  const progress = onboardingProgress(data, signInDone);
  useEffect(() => {
    if (open) publishSetupIncomplete(!progress.complete);
  }, [open, progress.complete]);
  // The repositories of the project before an add. After the refresh, select the new one.
  const before = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!before.current) return;
    const added = repos.find((r) => !before.current!.has(r.id));
    if (!added) return;
    before.current = null;
    setRepoId(added.id);
    setOpenStep(undefined);
  }, [repos]);
  async function refreshAfterAdd() {
    before.current = new Set(repos.map((r) => r.id));
    await onRefresh();
  }
  /**
   * Chooses a folder, makes a project with its name, and adds the repositories in it. When the
   * user is signed in, the first chat then opens at once with the draft.
   */
  async function chooseCodeFolder() {
    if (!folderImport.supported) {
      setCreating(true);
      return;
    }
    setSetupError('');
    setImporting(true);
    try {
      const result = await folderImport.choose('Choose your code folder', 'Choose');
      if (!result) return;
      const name = folderName(result.root);
      const key = `kalkidan-onboarding-create:${result.root}`;
      const operationId = localStorage.getItem(key) || crypto.randomUUID();
      localStorage.setItem(key, operationId);
      const id = await api.createGroup(
        name,
        '',
        undefined,
        'github',
        undefined,
        operationId,
        result.paths,
      );
      const snapshot = await api.snapshot();
      const created = snapshot.groups?.find((g) => g.id === id);
      const added = created?.repoIds.length ?? 0;
      setGroupId(id);
      setRepoId('');
      setOpenStep(undefined);
      await onRefresh();
      localStorage.removeItem(key);
      showFolderImportResult(name, added);
      const first = snapshot.projects.find((p) => created?.repoIds.includes(p.id));
      if (first && signInDone) {
        onStart(agent, first, prompt.trim() || firstChatPrompt);
        onOpenChange(false);
      }
    } catch (error) {
      setSetupError(errorMessage(error));
    } finally {
      setImporting(false);
    }
  }
  useEffect(() => {
    if (open) setAgent(readPreferredAgent());
  }, [open]);
  useEffect(() => {
    if (!open || repo?.hostId || preview) return;
    let active = true;
    setChecking(true);
    setCheckError('');
    setInstallations([]);
    // A synchronous error from the bridge becomes a rejected check, not an unhandled error.
    const request = pendingCheck.current || Promise.resolve().then(() => api.agentInstallations());
    pendingCheck.current = request;
    void request
      .then((value) => {
        if (!active) return;
        setInstallations(value);
        setAgentInstallations(value);
        setAgent((current) =>
          value.some((item) => item.agent === current && item.status === 'installed')
            ? current
            : value.find((item) => item.status === 'installed')?.agent || current,
        );
      })
      .catch((error) => {
        if (active) setCheckError(errorMessage(error));
      })
      .finally(() => {
        if (pendingCheck.current === request) pendingCheck.current = null;
        if (active) setChecking(false);
      });
    return () => {
      active = false;
    };
  }, [api, open, repo?.hostId, preview, checkRevision]);
  const [setup, setSetup] = useState<VerdictanSetup>();
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState('');
  useEffect(() => {
    if (!open || !signedIn) {
      setSetup(undefined);
      return;
    }
    let live = true;
    void Promise.resolve()
      .then(() => api.verdictanSetup())
      .then(
        (value) => live && setSetup(value),
        () => {},
      );
    return () => {
      live = false;
    };
  }, [api, open, signedIn, status?.account?.organizationId]);
  async function applyRecommended() {
    setApplying(true);
    setApplyError('');
    try {
      setSetup(
        typeof api.verdictanApplyRecommended === 'function'
          ? await api.verdictanApplyRecommended()
          : await api.verdictanSetup(),
      );
    } catch (error) {
      const code = managedErrorCode(errorMessage(error));
      setApplyError(code ? managedErrorInfo(code).message : errorMessage(error));
    } finally {
      setApplying(false);
    }
  }
  const managedAgent = agent === 'claude' ? 'claude' : 'codex';
  // One status source: the installer status decides if the runtime is ready.
  const steps = managedSteps(status, setup, runtime.status);
  const agentSetupReady = steps[managedAgent];
  const runtimeReady = runtime.supported ? steps.runtime : true;
  // Without a managed-agent check (browser preview, older builds), do not block the draft.
  const managedReady =
    !managedSupported || !status || (signedIn && runtimeReady && agentSetupReady);
  const missing = !preview && !repo?.hostId && !checking && installation?.status === 'missing';
  // The chat opens with a draft and sends nothing, so a missing program does not block it. A
  // send fails without managed agents, so their setup does block it.
  const canStart = !!repo && !!prompt.trim() && managedReady;
  function start() {
    if (!canStart || !repo) return;
    onStart(agent, repo, prompt.trim());
    onOpenChange(false);
  }
  const folderSummary = group
    ? [group.name, repo?.name && repo.name !== group.name ? repo.name : '']
        .filter(Boolean)
        .join(' · ')
    : '';
  const phase = status?.phase;
  return (
    <>
      <Dialog open={open && !creating} onOpenChange={onOpenChange}>
        <DialogContent size="lg" layout="scroll" className="onboarding">
          <DialogHeader>
            <DialogTitle>Get started</DialogTitle>
            <DialogDescription className="sr-only">
              Sign in, open a code folder, and say hello to an agent.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="pb-2">
            <ol className="onboarding-steps" aria-label={`${progress.done} of 3 steps done`}>
              <Step
                number={1}
                done={signInDone}
                open={current === 1}
                title="Sign in"
                summary={signedIn ? signedInName(status) : undefined}
                disabled={signInDone}
                onOpen={() => setOpenStep(1)}
              >
                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={() => startSignIn('login')}>
                    {phase === 'authorizing'
                      ? 'Show sign-in'
                      : phase === 'expired'
                        ? 'Sign in again'
                        : 'Sign in'}
                  </Button>
                  {phase !== 'authorizing' && phase !== 'expired' && (
                    <span className="text-xs leading-4 text-muted-foreground">
                      No account?{' '}
                      <button
                        type="button"
                        className="text-link"
                        onClick={() => startSignIn('register')}
                      >
                        Create one
                      </button>
                    </span>
                  )}
                </div>
              </Step>
              <Step
                number={2}
                done={!!repo}
                open={current === 2}
                title="Open a code folder"
                summary={folderSummary}
                onOpen={() => setOpenStep(2)}
              >
                {folderImport.panel ? (
                  folderImport.panel
                ) : !group ? (
                  <div className="flex flex-wrap items-center gap-3">
                    <Button disabled={importing} onClick={() => void chooseCodeFolder()}>
                      <FolderOpen /> {importing ? 'Adding code folders…' : 'Open a code folder…'}
                    </Button>
                    <button
                      type="button"
                      className="text-link text-xs"
                      disabled={importing}
                      onClick={() => setCreating(true)}
                    >
                      Start with an empty project
                    </button>
                  </div>
                ) : (
                  <div className="flex flex-wrap items-center gap-2">
                    <AddRepository
                      api={api}
                      groupId={group.id}
                      variant={repos.length ? 'outline' : 'default'}
                      onRefresh={refreshAfterAdd}
                      onProjectCreated={(created) => {
                        // Setup continues with the new project.
                        setGroupId(created.id);
                        setRepoId('');
                      }}
                    >
                      Add code folder
                    </AddRepository>
                    <Button
                      variant="ghost"
                      disabled={importing}
                      onClick={() => void chooseCodeFolder()}
                    >
                      <FolderOpen /> Open another folder…
                    </Button>
                  </div>
                )}
                {setupError && (
                  <p role="alert" className="field-error">
                    {setupError}
                  </p>
                )}
              </Step>
              <Step
                number={3}
                done={data.sessions.length > 0}
                open={current === 3}
                disabled={!repo}
                title="Say hello"
                onOpen={() => setOpenStep(3)}
              >
                <div className="flex min-w-0 flex-wrap items-center gap-1">
                  <FolderMenu
                    data={data}
                    value={repo}
                    onChange={(nextGroup, nextRepo) => {
                      setGroupId(nextGroup);
                      setRepoId(nextRepo);
                    }}
                  />
                  <Choice
                    label="Agent"
                    size="sm"
                    variant="ghost"
                    value={agent}
                    options={agentCatalog.map((a) => ({ value: a.id, label: a.name }))}
                    onChange={(value) => {
                      setAgent(value as Agent);
                      savePreferredAgent(value as Agent);
                    }}
                  />
                </div>
                {(missing || checkError) && (
                  <div
                    role="status"
                    className="flex flex-wrap items-start gap-2 text-xs leading-4 text-muted-foreground"
                  >
                    <div className="min-w-0 flex-1">
                      {checkError ? (
                        `Could not check agents: ${checkError}`
                      ) : (
                        <AgentInstallHelp agent={agent} />
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={checking}
                      onClick={() => setCheckRevision((r) => r + 1)}
                    >
                      <RefreshCw className={checking ? 'animate-spin' : ''} /> Check again
                    </Button>
                  </div>
                )}
                {managedSupported && signedIn && (
                  <ManagedLine
                    runtimeReady={runtimeReady}
                    runtimeProgress={runtimeProgress(runtime.status)}
                    agentName={agentName}
                    agentSetupReady={agentSetupReady}
                    applying={applying}
                    applyError={applyError}
                    onApply={() => void applyRecommended()}
                  />
                )}
                <Textarea
                  aria-label="First message"
                  className="max-h-40 min-h-24 resize-none"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && hasPrimaryModifier(event.nativeEvent)) {
                      event.preventDefault();
                      start();
                    }
                  }}
                  rows={4}
                />
              </Step>
            </ol>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Set up later
            </Button>
            {current === 3 && (
              <Button disabled={!canStart} onClick={start}>
                Open first chat
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {creating && (
        <CreateProject
          api={api}
          open={creating}
          onOpenChange={setCreating}
          onCreated={async (group) => {
            setGroupId(group.id);
            setRepoId('');
            await onRefresh();
          }}
        />
      )}
    </>
  );
}

/** "in api ▾": the code folder of the first chat, as a menu of every project's folders. */
function FolderMenu({
  data,
  value,
  onChange,
}: {
  data: Snapshot;
  value?: Project;
  onChange: (groupId: string, repoId: string) => void;
}) {
  const groups = (data.groups || []).filter((g) => g.repoIds.length > 0);
  const many = groups.length > 1;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="chip" aria-label={`Code folder: ${value?.name || 'none'}`}>
          <FolderOpen />
          in {value?.name || 'a code folder'}
          <ChevronDown />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-72 min-w-48">
        {groups.map((group, index) => (
          <DropdownMenuRadioGroup
            key={group.id}
            value={value?.id || ''}
            onValueChange={(repoId) => onChange(group.id, repoId)}
          >
            {many && index > 0 && <DropdownMenuSeparator />}
            {many && <DropdownMenuLabel>{group.name}</DropdownMenuLabel>}
            {data.projects
              .filter((repo) => group.repoIds.includes(repo.id))
              .map((repo) => (
                <DropdownMenuRadioItem key={repo.id} value={repo.id}>
                  {repo.name}
                </DropdownMenuRadioItem>
              ))}
          </DropdownMenuRadioGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * One line about managed agents while they are not ready, with one action. It shows nothing
 * when they are ready. The sign-in is step 1, so it is not here.
 */
function ManagedLine({
  runtimeReady,
  runtimeProgress: progress,
  agentName,
  agentSetupReady,
  applying,
  applyError,
  onApply,
}: {
  runtimeReady: boolean;
  runtimeProgress?: number;
  agentName: string;
  agentSetupReady: boolean;
  applying: boolean;
  applyError: string;
  onApply: () => void;
}) {
  if (runtimeReady && agentSetupReady) return null;
  if (!runtimeReady)
    return (
      <div className="grid gap-1.5 text-xs leading-4 text-muted-foreground" role="status">
        <span>Setting up agents{progress !== undefined ? ` · ${progress}%` : '…'}</span>
        <Progress value={progress} label="Setting up agents" className="max-w-64" />
      </div>
    );
  return (
    <div className="onboarding-managed" role="group" aria-label="Managed agents">
      <p>{applyError || `Your organization has no setup for ${agentName} yet.`}</p>
      <Button size="xs" variant="outline" disabled={applying} onClick={onApply}>
        {applying ? 'Saving…' : 'Use the recommended setup'}
      </Button>
    </div>
  );
}

/**
 * One setup step. Only the current step is open. A closed step shows its summary, and the user
 * can open it again.
 */
function Step({
  number,
  done,
  open,
  disabled,
  title,
  summary,
  onOpen,
  children,
}: {
  number: number;
  done: boolean;
  open: boolean;
  disabled?: boolean;
  title: string;
  summary?: string;
  onOpen: () => void;
  children: ReactNode;
}) {
  return (
    <li className="onboarding-step" data-open={open || undefined}>
      <span className="onboarding-step-number" data-done={done || undefined}>
        {done ? <Check className="size-3.5" aria-label="Done" /> : number}
      </span>
      <div className="min-w-0 flex-1">
        {open ? (
          <h3 className="text-sm leading-6 font-semibold">{title}</h3>
        ) : (
          <button
            type="button"
            className="onboarding-step-toggle"
            disabled={disabled}
            aria-expanded={false}
            onClick={onOpen}
          >
            <span className="text-sm leading-6 font-semibold">{title}</span>
            {summary && (
              <span className="min-w-0 truncate text-xs text-muted-foreground">{summary}</span>
            )}
            {!disabled && (
              <ChevronDown className="ml-auto size-4 text-muted-foreground" aria-hidden="true" />
            )}
          </button>
        )}
        {open && <div className="mt-3 grid gap-3">{children}</div>}
      </div>
    </li>
  );
}
