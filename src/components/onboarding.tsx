import { useEffect, useRef, useState } from 'react';
import { Check, FolderPlus, GitBranch, Sparkles, RefreshCw } from 'lucide-react';
import type { API, Snapshot, Agent, AgentInstallation, Project } from '../types';
import { agentCatalog } from '../config/agents';
import { CreateProject } from './create-project';
import { AddRepository } from './add-repository';
import { Choice } from './choice';
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
        if (active) setCheckError(error instanceof Error ? error.message : String(error));
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
  return (
    <>
      <Dialog open={open && !creating} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <div className="mb-2 flex items-center gap-2 text-sm text-muted-foreground">
              <Sparkles size={16} /> Get started with Kalkidan
            </div>
            <DialogTitle className="text-2xl">From repository to your first task</DialogTitle>
            <DialogDescription>
              Choose where your work lives, add code, and prepare a useful conversation.
            </DialogDescription>
          </DialogHeader>
          <ol className="grid gap-5 py-2">
            <li className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center gap-2 font-medium">
                {group ? <Check size={18} /> : <FolderPlus size={18} />} 1. Choose your project
              </div>
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
                <p className="text-xs text-muted-foreground break-all">{group.rootPath}</p>
              )}
              {!group && (
                <p className="text-xs text-muted-foreground">
                  Project setup includes connecting your tracker and choosing a local folder or
                  remote host.
                </p>
              )}
            </li>
            <li className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center gap-2 font-medium">
                {repo ? <Check size={18} /> : <GitBranch size={18} />} 2. Bring in your code
              </div>
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
              {repo && <p className="text-xs text-muted-foreground break-all">{repo.path}</p>}
            </li>
            <li className="rounded-lg border p-4 space-y-3">
              <div className="flex items-center gap-2 font-medium">
                <Sparkles size={18} /> 3. Start with a clear task
              </div>
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
                    <RefreshCw size={14} /> Check again
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground" role="status">
                {status}
              </p>
              <Choice
                label="Starter task"
                value={starter}
                options={starters.map((s) => ({ value: s.name, label: s.name }))}
                onChange={(value) => {
                  setStarter(value);
                  setPrompt(starters.find((s) => s.name === value)!.prompt);
                }}
              />
              <Textarea
                aria-label="First task"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                rows={4}
              />
              <p className="text-xs text-muted-foreground">
                You can edit this draft in chat before sending it.
              </p>
            </li>
          </ol>
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Set up later
            </Button>
            <Button
              disabled={!canStart}
              onClick={() => {
                if (repo) {
                  onStart(agent, repo, prompt.trim());
                  onOpenChange(false);
                }
              }}
            >
              Open first conversation
            </Button>
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
