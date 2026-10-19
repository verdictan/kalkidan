import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, RefreshCw } from 'lucide-react';
import type { API, Snapshot, Agent, AgentInstallation, Project } from '../types';
import { agentCatalog } from '../config/agents';
import { CreateProject } from './create-project';
import { AddRepository } from './add-repository';
import { Choice } from './choice';
import { Hint } from './hint';
import { hasPrimaryModifier, shortcutLabel } from '../lib/platform';
import { Button } from './ui/button';
import { Textarea } from './ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from './ui/dialog';
import { errorMessage } from '../lib/errors';
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
}: {
  api: API;
  data: Snapshot;
  open: boolean;
  preview: boolean;
  onOpenChange: (open: boolean) => void;
  onRefresh: () => Promise<void>;
  onSettings: () => void;
  onStart: (agent: Agent, repo: Project, prompt: string) => void;
}) {
  const [groupId, setGroupId] = useState('');
  const [repoId, setRepoId] = useState('');
  const [creating, setCreating] = useState(false);
  const [agent, setAgent] = useState<Agent>('codex');
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
  useEffect(() => {
    if (!open || repo?.hostId || preview) return;
    let active = true;
    setChecking(true);
    setCheckError('');
    setInstallations([]);
    const request = pendingCheck.current || api.agentInstallations();
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
  const canStart =
    !!repo &&
    !!prompt.trim() &&
    (preview ||
      (repo.hostId
        ? host?.status === 'connected'
        : installation?.status === 'installed' && !checking && !checkError));
  const status = preview
    ? 'Browser preview: explore setup and prepare a draft. Run agents in the desktop app.'
    : repo?.hostId
      ? `${host?.name || 'Remote host'} · ${host?.status || 'disconnected'}. Agent availability is checked when you send your first message.`
      : checking
        ? 'Checking installed agents…'
        : checkError
          ? `Could not check agents: ${checkError}`
          : installation?.status === 'installed'
            ? 'Agent found. Your first message will use its existing sign-in.'
            : 'Install and sign in to this agent’s CLI, then check again. Agent settings shows detected installations.';
  function start() {
    if (!canStart || !repo) return;
    onStart(agent, repo, prompt.trim());
    onOpenChange(false);
  }
  return (
    <>
      <Dialog open={open && !creating} onOpenChange={onOpenChange}>
        <DialogContent size="lg" className="flex flex-col gap-0 overflow-hidden p-0">
          <DialogHeader className="shrink-0 px-6 pt-6 pb-4">
            <p className="text-xs font-medium text-muted-foreground">Get started with Kalkidan</p>
            <DialogTitle className="text-xl">From repository to your first session</DialogTitle>
            <DialogDescription>
              Choose where your work lives, add code, and prepare your first session.
            </DialogDescription>
          </DialogHeader>
          <ol className="min-h-0 divide-y overflow-y-auto px-6">
            <Step number={1} done={!!group} title="Choose your project">
              <p className="text-sm text-muted-foreground">
                A project keeps docs, cloned repositories, and new worktrees together in one folder.
              </p>
              <div className="flex flex-wrap gap-2">
                {groups.length > 0 && (
                  <Choice
                    label="Setup project"
                    value={group?.id || ''}
                    options={groups.map((g) => ({ value: g.id, label: g.name }))}
                    onChange={(value) => {
                      setGroupId(value);
                      setRepoId('');
                    }}
                  />
                )}
                <Button variant="outline" onClick={() => setCreating(true)}>
                  Create project
                </Button>
              </div>
              {group?.rootPath && (
                <p className="text-xs break-all text-muted-foreground">{group.rootPath}</p>
              )}
              {!group && (
                <p className="text-xs text-muted-foreground">
                  Project setup includes connecting your tracker and choosing a local folder or
                  remote host.
                </p>
              )}
            </Step>
            <Step number={2} done={!!repo} title="Bring in your code">
              <p className="text-sm text-muted-foreground">
                Clone a repository or add an existing folder.
              </p>
              <div className="flex flex-wrap gap-2">
                {repos.length > 0 && (
                  <Choice
                    label="Setup repository"
                    value={repo?.id || ''}
                    options={repos.map((r) => ({ value: r.id, label: r.name }))}
                    onChange={setRepoId}
                  />
                )}
                <AddRepository
                  api={api}
                  groupId={group?.id}
                  disabled={!group}
                  variant="outline"
                  onRefresh={onRefresh}
                >
                  Add repository
                </AddRepository>
              </div>
              {repo && <p className="text-xs break-all text-muted-foreground">{repo.path}</p>}
            </Step>
            <Step number={3} done={false} title="Write a clear first message">
              <div className="flex flex-wrap gap-2">
                <Choice
                  label="Setup agent"
                  value={agent}
                  options={agentCatalog.map((a) => ({ value: a.id, label: a.name }))}
                  onChange={(value) => setAgent(value as Agent)}
                />
                <Button variant="ghost" onClick={onSettings}>
                  Agent settings
                </Button>
                {!preview && !repo?.hostId && (
                  <Button
                    variant="ghost"
                    disabled={checking}
                    onClick={() => setCheckRevision((r) => r + 1)}
                  >
                    <RefreshCw /> Check again
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground" role="status">
                {status}
              </p>
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
              <p className="-mt-2 text-xs text-muted-foreground">
                You can edit this draft in the session before you send it. Press{' '}
                <kbd className="kbd">{shortcutLabel(['mod'], 'Enter')}</kbd> to open the session.
              </p>
            </Step>
          </ol>
          <DialogFooter className="shrink-0 border-t px-6 py-4">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Set up later
            </Button>
            <Hint
              label={
                !repo
                  ? 'Add a repository first'
                  : !prompt.trim()
                    ? 'Write the first message'
                    : canStart
                      ? 'Open first session'
                      : 'Make the agent available first'
              }
            >
              <Button disabled={!canStart} onClick={start}>
                Open first session
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
