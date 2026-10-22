import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowRight, Check, ChevronDown, FolderOpen, RefreshCw, X } from 'lucide-react';
import type { API, Snapshot, Agent, AgentInstallation, Project } from '../types';
import { agentCatalog, agentLabel } from '../config/agents';
import { CreateProject } from './create-project';
import { AddRepository } from './add-repository';
import { Choice } from './choice';
import { AgentInstallHelp } from './agent-programs';
import { folderName, showFolderImportResult, useFolderImport } from './repository-import';
import { Hint } from './hint';
import { hasPrimaryModifier, shortcutLabel } from '../lib/platform';
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
import { setupSummary, startSignIn } from './sign-in-steps';

// The composer has starter chips. Onboarding starts with one useful draft that the user edits.
const firstPrompt =
  'Explore this repository and explain its architecture, main entry points, and how to run and test it. Identify a useful first task. Do not change files yet.';

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

/** The two setup steps: a code folder, then a first chat. */
export function onboardingProgress(data: Pick<Snapshot, 'projects' | 'sessions'>) {
  const done = (data.projects.length > 0 ? 1 : 0) + (data.sessions.length > 0 ? 1 : 0);
  return { done, total: 2, complete: done === 2 };
}

const hiddenKey = 'kalkidan:get-started-hidden';
function getStartedHidden() {
  try {
    return localStorage.getItem(hiddenKey) !== null;
  } catch {
    return false;
  }
}

/**
 * The "Get started" row in the sidebar footer, with the setup progress ("Setup 1/2") and a
 * button that hides it. It shows nothing when the setup is complete or hidden.
 */
export function GetStartedButton({
  data,
  onOpen,
  className,
}: {
  data: Pick<Snapshot, 'projects' | 'sessions'>;
  onOpen: () => void;
  className?: string;
}) {
  const [hidden, setHidden] = useState(getStartedHidden);
  const progress = onboardingProgress(data);
  if (hidden || progress.complete) return null;
  return (
    <div className="onboarding-get-started">
      <Button
        variant="ghost"
        className={cn('min-w-0 flex-1 font-normal', className)}
        aria-label="Get started"
        aria-description={`Setup ${progress.done} of ${progress.total} done`}
        onClick={onOpen}
      >
        <ArrowRight /> Get started
        <span className="ml-auto text-xs text-muted-foreground tabular-nums">
          Setup {progress.done}/{progress.total}
        </span>
      </Button>
      <Hint label="Hide Get started. Open it again from the Help menu.">
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
  // The repository list shows inside step 1. It does not replace this dialog.
  const folderImport = useFolderImport(api, `${open}:${groupId}`, { inline: true });
  const [agent, setAgent] = useState<Agent>(readPreferredAgent);
  const [installations, setInstallations] = useState<AgentInstallation[]>([]);
  const pendingCheck = useRef<Promise<AgentInstallation[]> | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [checkRevision, setCheckRevision] = useState(0);
  const [prompt, setPrompt] = useState(firstPrompt);
  // The step that the user opened. Without it, the first step that is not done is open.
  const [openStep, setOpenStep] = useState<1 | 2>();
  const groups = data.groups || [];
  const group = groups.find((g) => g.id === groupId) || groups[0];
  const repos = data.projects.filter((repo) => group?.repoIds.includes(repo.id));
  const repo = repos.find((r) => r.id === repoId) || repos[0];
  const host = data.hosts?.find((h) => h.id === repo?.hostId);
  const installation = installations.find((item) => item.agent === agent);
  const agentName = agentLabel(agent);
  const current = openStep ?? (repo ? 2 : 1);
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
  /** Chooses a folder, makes a project with its name, and adds the repositories in it. */
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
      const added = snapshot.groups?.find((g) => g.id === id)?.repoIds.length ?? 0;
      setGroupId(id);
      setRepoId('');
      setOpenStep(undefined);
      await onRefresh();
      localStorage.removeItem(key);
      showFolderImportResult(name, added);
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
  // Agents run through managed agents. The account state and the runtime install state are
  // separate sources: the runtime is ready only when the installer says that it is installed.
  const managedSupported = !preview && typeof api.verdictanStatus === 'function';
  const account = useVerdictanStatus(api, open && managedSupported);
  const runtime = useRuntimeStatus(api, open && managedSupported);
  const status = account.status;
  const signedIn = status?.phase === 'authenticated';
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
  const agentReady =
    preview ||
    (repo?.hostId
      ? host?.status === 'connected'
      : installation?.status === 'installed' && !checking && !checkError);
  const missing = !preview && !repo?.hostId && !checking && installation?.status === 'missing';
  // The chat opens with a draft and sends nothing, so a missing CLI does not block it. A send
  // fails without managed agents, so their setup does block it.
  const canStart = !!repo && !!prompt.trim() && managedReady;
  const agentStatus = preview
    ? 'Browser preview: prepare a draft here. Run agents in the desktop app.'
    : repo?.hostId
      ? `${host?.name || 'Remote host'} · ${host?.status || 'disconnected'}. Kalkidan checks the agent on the host when you send your first message.`
      : checking
        ? 'Checking installed agents…'
        : checkError
          ? `Could not check agents: ${checkError}`
          : installation?.status === 'installed'
            ? `${agentName} is installed on this computer.`
            : `Kalkidan cannot find ${agentName} on this computer.`;
  const progress = onboardingProgress(data);
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
  return (
    <>
      <Dialog open={open && !creating} onOpenChange={onOpenChange}>
        <DialogContent size="lg" layout="scroll" className="onboarding">
          <DialogHeader>
            <DialogTitle>Set up your first chat</DialogTitle>
            <DialogDescription>
              Choose your code and write a first message. Kalkidan sends nothing until you select
              Send.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="pb-2">
            <ol className="onboarding-steps">
              <Step
                number={1}
                done={!!repo}
                open={current === 1}
                title="Choose your code folder"
                summary={folderSummary}
                onOpen={() => setOpenStep(1)}
              >
                {folderImport.panel ? (
                  folderImport.panel
                ) : !group ? (
                  <>
                    <p className="text-sm text-muted-foreground">
                      Kalkidan makes a project with the name of the folder. If the folder holds more
                      than one Git repository, Kalkidan adds each one.
                    </p>
                    <div className="grid justify-items-start gap-2">
                      <Button disabled={importing} onClick={() => void chooseCodeFolder()}>
                        <FolderOpen /> {importing ? 'Adding code folders…' : 'Open a code folder…'}
                      </Button>
                      <button
                        type="button"
                        className="text-link text-sm"
                        disabled={importing}
                        onClick={() => setCreating(true)}
                      >
                        Start with an empty project
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="grid gap-2">
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      <Choice
                        label="Setup project"
                        value={group.id}
                        options={groups.map((g) => ({ value: g.id, label: g.name }))}
                        onChange={(value) => {
                          setGroupId(value);
                          setRepoId('');
                        }}
                      />
                      {repos.length > 0 && (
                        <Choice
                          label="Setup repository"
                          value={repo?.id || ''}
                          options={repos.map((r) => ({ value: r.id, label: r.name }))}
                          onChange={(value) => {
                            setRepoId(value);
                            setOpenStep(undefined);
                          }}
                        />
                      )}
                    </div>
                    {repos.length === 0 && (
                      <p className="text-xs leading-4 text-muted-foreground">
                        This project has no code folder yet.
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2">
                      <AddRepository
                        api={api}
                        groupId={group.id}
                        variant={repos.length ? 'ghost' : 'default'}
                        size="sm"
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
                        size="sm"
                        disabled={importing}
                        onClick={() => void chooseCodeFolder()}
                      >
                        <FolderOpen /> Open another folder…
                      </Button>
                    </div>
                  </div>
                )}
                {setupError && (
                  <p role="alert" className="field-error">
                    {setupError}
                  </p>
                )}
              </Step>
              <Step
                number={2}
                done={false}
                open={current === 2}
                disabled={!repo}
                title="Write your first message"
                summary={repo ? undefined : 'Choose a code folder first.'}
                onOpen={() => setOpenStep(2)}
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Choice
                    label="Agent"
                    size="sm"
                    value={agent}
                    options={agentCatalog.map((a) => ({ value: a.id, label: a.name }))}
                    onChange={(value) => {
                      setAgent(value as Agent);
                      savePreferredAgent(value as Agent);
                    }}
                  />
                  <span role="status" className="min-w-0 text-xs leading-4 text-muted-foreground">
                    {missing ? '' : agentStatus}
                  </span>
                  {(missing || checkError) && (
                    <Button
                      variant="ghost"
                      size="xs"
                      disabled={checking}
                      onClick={() => setCheckRevision((r) => r + 1)}
                    >
                      <RefreshCw className={checking ? 'animate-spin' : ''} /> Check again
                    </Button>
                  )}
                </div>
                {missing && (
                  <div className="text-xs text-muted-foreground">
                    <AgentInstallHelp agent={agent} />
                  </div>
                )}
                {managedSupported && status && (
                  <ManagedLine
                    phase={status.phase}
                    runtimeReady={runtimeReady}
                    runtimeProgress={runtimeProgress(runtime.status)}
                    agentName={agentName}
                    agentSetupReady={agentSetupReady}
                    summary={setupSummary(setup, managedAgent)}
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
                <p className="text-xs leading-4 text-muted-foreground">
                  You can change this draft in the chat before you send it. Press{' '}
                  <kbd className="kbd">{shortcutLabel(['mod'], 'Enter')}</kbd> to open the chat.
                </p>
              </Step>
            </ol>
          </DialogBody>
          <DialogFooter className="items-center">
            <span className="mr-auto text-xs text-muted-foreground tabular-nums">
              Setup {progress.done}/{progress.total}
            </span>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Set up later
            </Button>
            <Hint
              label={
                !repo
                  ? 'Choose a code folder first'
                  : !prompt.trim()
                    ? 'Write the first message'
                    : !managedReady
                      ? 'Sign in and finish the managed agents setup first'
                      : agentReady
                        ? 'Opens the chat with your draft'
                        : `Opens the chat with your draft. Make ${agentName} available before you send it.`
              }
            >
              <Button disabled={!canStart} onClick={start}>
                Open first chat
              </Button>
            </Hint>
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

/**
 * One line about managed agents, with one action. It never leaves onboarding: the sign-in
 * opens as a dialog above it, and the recommended setup saves in place.
 */
function ManagedLine({
  phase,
  runtimeReady,
  runtimeProgress: progress,
  agentName,
  agentSetupReady,
  summary,
  applying,
  applyError,
  onApply,
}: {
  phase: string;
  runtimeReady: boolean;
  runtimeProgress?: number;
  agentName: string;
  agentSetupReady: boolean;
  summary?: string;
  applying: boolean;
  applyError: string;
  onApply: () => void;
}) {
  if (phase === 'authenticated' && runtimeReady && agentSetupReady)
    return (
      <p className="flex items-center gap-1.5 text-xs leading-4 text-muted-foreground">
        <Check className="size-3.5 text-success" aria-hidden="true" />
        Ready: {summary || `${agentName} managed agent`}
      </p>
    );
  if (phase === 'authenticated' && !runtimeReady)
    return (
      <div className="grid gap-1.5 text-xs leading-4 text-muted-foreground" role="status">
        <span>Getting managed agents ready{progress !== undefined ? `… ${progress}%` : '…'}</span>
        <Progress value={progress} label="Managed agents runtime install" className="max-w-64" />
      </div>
    );
  if (phase === 'authenticated')
    return (
      <div className="onboarding-managed" role="group" aria-label="Managed agents">
        <p>{applyError || `Your organization has no saved setup for ${agentName} yet.`}</p>
        <Button size="xs" variant="outline" disabled={applying} onClick={onApply}>
          {applying ? 'Saving…' : 'Use the recommended setup'}
        </Button>
      </div>
    );
  return (
    <div className="onboarding-managed" role="group" aria-label="Managed agents">
      <p>
        {phase === 'authorizing'
          ? 'Finish signing in in your browser.'
          : phase === 'expired'
            ? 'Your session ended. Sign in again to send messages.'
            : 'Sign in to Verdictan to send messages. Chats run as managed agents.'}
      </p>
      <Button size="xs" onClick={() => startSignIn('login')}>
        {phase === 'authorizing' ? 'Show sign-in' : 'Sign in'}
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
