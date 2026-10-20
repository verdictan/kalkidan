import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, FolderOpen, RefreshCw } from 'lucide-react';
import type { API, Snapshot, Agent, AgentInstallation, Project } from '../types';
import { agentCatalog, agentLabel } from '../config/agents';
import { CreateProject } from './create-project';
import { AddRepository } from './add-repository';
import { Choice } from './choice';
import { AgentInstallHelp } from './settings-dialog';
import { boardLabel } from './tracker-project-picker';
import { codeFolders, folderName, useFolderImport } from './repository-import';
import { showToast } from './ui/toast';
import { Hint } from './hint';
import { hasPrimaryModifier, shortcutLabel } from '../lib/platform';
import { Button } from './ui/button';
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
import { readPreferredAgent, savePreferredAgent } from '../lib/agent-preference';
import { cn } from '../lib/utils';

const starters = [
  {
    name: 'Understand this repository',
    prompt:
      'Explore this repository and explain its architecture, main entry points, and how to run and test it. Identify a useful first task. Do not change files yet.',
  },
  {
    name: 'Plan a change',
    prompt:
      'Help me plan a change in this repository. First inspect the project conventions and tests, then ask me what I want to build before proposing a focused implementation plan.',
  },
  {
    name: 'Find a useful improvement',
    prompt:
      'Review this repository for one concrete reliability or performance improvement. Explain the evidence, proposed change, and how to verify it before editing files.',
  },
];
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

export function Onboarding({
  api,
  data,
  open,
  preview,
  onOpenChange,
  onRefresh,
  onSettings,
  onStart,
  onConnectBoard,
}: {
  api: API;
  data: Snapshot;
  open: boolean;
  preview: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => Promise<void>;
  onSettings: () => void;
  onStart: (agent: Agent, repo: Project, prompt: string) => void;
  /** Opens the board picker of a project. Without it, the last step only explains it. */
  onConnectBoard?: (groupId: string) => void;
}) {
  const [groupId, setGroupId] = useState('');
  const [repoId, setRepoId] = useState('');
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [setupError, setSetupError] = useState('');
  const folderImport = useFolderImport(api, `${open}:${groupId}`);
  const [agent, setAgent] = useState<Agent>(readPreferredAgent);
  const [installations, setInstallations] = useState<AgentInstallation[]>([]);
  const pendingCheck = useRef<Promise<AgentInstallation[]> | null>(null);
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [checkRevision, setCheckRevision] = useState(0);
  const [starter, setStarter] = useState(starters[0].name);
  const [prompt, setPrompt] = useState(starters[0].prompt);
  const groups = data.groups || [];
  const group = groups.find((g) => g.id === groupId) || groups[0];
  const repos = data.projects.filter((repo) => group?.repoIds.includes(repo.id));
  const repo = repos.find((r) => r.id === repoId) || repos[0];
  const host = data.hosts?.find((h) => h.id === repo?.hostId);
  const installation = installations.find((item) => item.agent === agent);
  const agentName = agentLabel(agent);
  // The repositories of the project before an add. After the refresh, select the new one.
  const before = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (!before.current) return;
    const added = repos.find((r) => !before.current!.has(r.id));
    if (!added) return;
    before.current = null;
    setRepoId(added.id);
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
      const added = result.paths.length;
      setGroupId(id);
      setRepoId('');
      await onRefresh();
      localStorage.removeItem(key);
      showToast(`Created ${name} with ${codeFolders(added)}.`);
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
  const agentReady =
    preview ||
    (repo?.hostId
      ? host?.status === 'connected'
      : installation?.status === 'installed' && !checking && !checkError);
  const missing = !preview && !repo?.hostId && !checking && installation?.status === 'missing';
  // The session opens with a draft and sends nothing, so a missing agent does not block it.
  const canStart = !!repo && !!prompt.trim();
  const status = preview
    ? 'Browser preview: explore setup and prepare a draft. Run agents in the desktop app.'
    : repo?.hostId
      ? `${host?.name || 'Remote host'} · ${host?.status || 'disconnected'}. Kalkidan checks the agent on the host when you send your first message.`
      : checking
        ? 'Checking installed agents…'
        : checkError
          ? `Could not check agents: ${checkError}`
          : installation?.status === 'installed'
            ? `${agentName} is ready. It uses its own sign-in.`
            : `Kalkidan cannot find ${agentName} on this computer. Select Check again after you install it.`;
  function start() {
    if (!canStart || !repo) return;
    onStart(agent, repo, prompt.trim());
    onOpenChange(false);
  }
  return (
    <>
      <Dialog open={open && !creating} onOpenChange={onOpenChange}>
        <DialogContent size="lg" layout="scroll">
          <DialogHeader>
            <p className="text-xs font-medium text-muted-foreground">Get started with Kalkidan</p>
            <DialogTitle className="text-xl">Set up your first session</DialogTitle>
            <DialogDescription>
              Choose your code, choose an agent, and write a first message. Kalkidan sends nothing
              until you select Send.
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="pb-0">
            <ol className="divide-y">
              <Step number={1} done={!!repo} title="Choose your code folder">
                <p className="text-sm text-muted-foreground">
                  Kalkidan makes a project with the name of the folder. If the folder holds more
                  than one Git repository, Kalkidan adds each one.
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={group ? 'outline' : 'default'}
                    disabled={importing}
                    onClick={() => void chooseCodeFolder()}
                  >
                    <FolderOpen /> {importing ? 'Adding code folders…' : 'Choose code folder'}
                  </Button>
                  <Button variant="ghost" disabled={importing} onClick={() => setCreating(true)}>
                    Create project
                  </Button>
                </div>
                {setupError && (
                  <p role="alert" className="field-error">
                    {setupError}
                  </p>
                )}
                {group && (
                  <div className="grid gap-2 rounded-lg border p-3">
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
                      {group.rootPath ? (
                        <Hint label={group.rootPath}>
                          <span tabIndex={0} className="text-xs text-muted-foreground">
                            Saved in Kalkidan
                          </span>
                        </Hint>
                      ) : (
                        <span className="text-xs text-muted-foreground">Saved in Kalkidan</span>
                      )}
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center gap-2">
                      {repos.length > 0 ? (
                        <Choice
                          label="Setup repository"
                          value={repo?.id || ''}
                          options={repos.map((r) => ({ value: r.id, label: r.name }))}
                          onChange={setRepoId}
                        />
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          This project has no code folder yet.
                        </span>
                      )}
                      <AddRepository
                        api={api}
                        groupId={group.id}
                        variant="ghost"
                        onRefresh={refreshAfterAdd}
                      >
                        Add code folder
                      </AddRepository>
                    </div>
                  </div>
                )}
              </Step>
              <Step number={2} done={!!repo && agentReady} title="Choose an agent">
                <div className="flex flex-wrap gap-2">
                  <Choice
                    label="Setup agent"
                    value={agent}
                    options={agentCatalog.map((a) => ({ value: a.id, label: a.name }))}
                    onChange={(value) => {
                      setAgent(value as Agent);
                      savePreferredAgent(value as Agent);
                    }}
                  />
                  {!preview && !repo?.hostId && (
                    <Button
                      variant="ghost"
                      disabled={checking}
                      onClick={() => setCheckRevision((r) => r + 1)}
                    >
                      <RefreshCw className={checking ? 'animate-spin' : ''} /> Check again
                    </Button>
                  )}
                  <Button variant="ghost" onClick={onSettings}>
                    Agent settings
                  </Button>
                </div>
                <div role="status" className="text-xs text-muted-foreground">
                  {missing ? <AgentInstallHelp agent={agent} /> : <p>{status}</p>}
                </div>
              </Step>
              <Step number={3} done={false} title="Write a clear first message">
                <label className="form-label">
                  Starter message
                  <Choice
                    label="Starter message"
                    value={starter}
                    options={starters.map((s) => ({ value: s.name, label: s.name }))}
                    onChange={(value) => {
                      setStarter(value);
                      setPrompt(starters.find((s) => s.name === value)!.prompt);
                    }}
                  />
                </label>
                <Textarea
                  aria-label="First message"
                  className="max-h-48 min-h-24 resize-none"
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
                <p className="text-xs text-muted-foreground">
                  You can change this draft in the session before you send it. Press{' '}
                  <kbd className="kbd">{shortcutLabel(['mod'], 'Enter')}</kbd> to open the session.
                </p>
              </Step>
              <Step
                number={4}
                done={!!group?.tracker || !!group?.github}
                title="Track tasks (optional)"
              >
                <p className="text-sm text-muted-foreground">
                  Connect a {boardLabel('GitHub')} to see the tasks of the project and start
                  sessions from them. You can do this later from the project page.
                </p>
                {onConnectBoard && group && !group.tracker && !group.github && (
                  <Button
                    variant="outline"
                    className="justify-self-start"
                    onClick={() => {
                      onConnectBoard(group.id);
                      onOpenChange(false);
                    }}
                  >
                    Connect {boardLabel('GitHub')}
                  </Button>
                )}
              </Step>
            </ol>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Set up later
            </Button>
            <Hint
              label={
                !repo
                  ? 'Choose a code folder first'
                  : !prompt.trim()
                    ? 'Write the first message'
                    : agentReady
                      ? 'Opens the session with your draft'
                      : `Opens the session with your draft. Make ${agentName} available before you send it.`
              }
            >
              <Button disabled={!canStart} onClick={start}>
                Open first session
              </Button>
            </Hint>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {folderImport.dialog}
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

/** One setup step. The number changes to a check mark when the step is done. */
function Step({
  number,
  done,
  title,
  children,
}: {
  number: number;
  done: boolean;
  title: string;
  children: ReactNode;
}) {
  return (
    <li className="flex gap-4 py-5 first:pt-1 last:pb-6">
      <span
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums',
          done ? 'border-transparent bg-primary text-primary-foreground' : 'text-muted-foreground',
        )}
      >
        {done ? <Check className="size-3.5" aria-label="Done" /> : number}
      </span>
      <div className="min-w-0 flex-1 space-y-3">
        <h3 className="text-sm leading-6 font-semibold">{title}</h3>
        {children}
      </div>
    </li>
  );
}
