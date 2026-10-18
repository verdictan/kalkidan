import { ScheduledTasksButton } from './components/schedule-dialog';
import { SettingsDialog } from './components/settings-dialog';
import { ProjectOverview } from './components/project-overview';
import { ActionMenu } from './components/action-menu';
import { Hint } from './components/hint';
import { TooltipProvider } from './components/ui/tooltip';
import { AddRepository } from './components/add-repository';
import React, { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GitFork, PanelLeft, Layers2, Folder, FolderPlus, Search, Star, ArrowUpRight, GitBranch, Terminal, History, RefreshCw, Plus, ChevronRight, Circle, X, Settings2, ArrowRight, Check, Trash2 } from 'lucide-react';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Badge } from './components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './components/ui/dialog';
import { Textarea } from './components/ui/textarea';
import { demo } from './demo';
import { SessionBrowser } from './components/session-browser';
import { GitHubProjectPanel } from './components/github-project';
import { Choice } from './components/choice';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from './components/ui/collapsible';
import { ProjectTree, sessionRepo } from './components/project-tree';
import { AgentWorkspace } from './components/agent-workspace';
import type { Snapshot, GitInfo, Agent, Project, Session, GitHubItem } from './types';
import './styles.css';
const api = window.workspace || demo;
const preview = !window.workspace;
function AgentMark({ agent }: { agent: Agent }) { return <span aria-hidden="true" className={'agent-mark ' + agent}>{agent === 'codex' ? <Terminal size={17}/> : '✳'}</span>; }
function App() {
  const [data, setData] = useState<Snapshot>({ projects: [], sessions: [], warnings: [], platform: '' });
  const [home, setHome] = useState(true);
  const [navigationOpen, setNavigationOpen] = useState(true);
  const [githubTarget, setGithubTarget] = useState('');
  const [connectRequest, setConnectRequest] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [boardGroup, setBoardGroup] = useState<string | null>(null);
  const [selected, setSelected] = useState(''); const [query, setQuery] = useState('');
  const [tab, setTab] = useState('overview');
  const [git, setGit] = useState<GitInfo | null>(null); const [gitError, setGitError] = useState('');
  const [busy, setBusy] = useState(false); const [notice, setNotice] = useState(''); const [error, setError] = useState('');
  const [modal, setModal] = useState<'worktree' | 'edit' | 'remove' | null>(null);
  const [branch, setBranch] = useState(''); const [name, setName] = useState(''); const [notes, setNotes] = useState('');
  const [repoGroup, setRepoGroup] = useState('');
  const [revision, setRevision] = useState(0);
  const [drafts, setDrafts] = useState<Session[]>([]);
  const [chatSession, setChatSession] = useState<Session | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [gitLoading, setGitLoading] = useState(false);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') { event.preventDefault(); setNavigationOpen(true); requestAnimationFrame(() => searchRef.current?.focus()); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  async function refresh() { const value = await api.snapshot(); setData(value); setSelected(id => value.projects.some(p => p.id === id) ? id : value.projects[0]?.id || ''); setRevision(r => r + 1); }
  async function run(action: () => Promise<unknown>, message?: string) { setBusy(true); setError(''); setNotice(''); try { await action(); await refresh(); if (message) setNotice(message); } catch (e) { setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(e)); } finally { setBusy(false); } }
  useEffect(() => { void run(async () => {}); }, []);
  const routed = useRef(false);
  useEffect(() => {
    if (routed.current || !data.sessions.length || !location.hash.startsWith('#session=')) return;
    routed.current = true;
    try { const target = JSON.parse(decodeURIComponent(location.hash.slice(9))); const session = data.sessions.find(s => s.id === target.id && s.agent === target.agent); if (session) openConversation(session); else setError('This conversation is no longer available.'); } catch { setError('Invalid conversation link.'); }
  }, [data.sessions]);
  useEffect(() => { let current = true; setGit(null); setGitError(''); setGitLoading(!!selected); if (selected) api.git(selected).then(value => { if (current) setGit(value); }).catch(e => { if (current) setGitError(String(e.message)); }).finally(() => { if (current) setGitLoading(false); }); return () => { current = false; }; }, [selected, revision]);
  const project = data.projects.find(p => p.id === selected);
  const repositoryGroup = data.groups?.find(g => g.repoIds.includes(selected));
  const connectionGroup = (!home && (data.groups?.find(g => g.id === boardGroup) || data.groups?.find(g => g.repoIds.includes(selected)))) || data.groups?.find(g => g.id === githubTarget) || (data.groups?.length === 1 ? data.groups[0] : undefined);
  const projects = data.projects.filter(p => `${p.name} ${p.path} ${(data.groups || []).find(g => g.repoIds.includes(p.id))?.name || ''}`.toLowerCase().includes(query.toLowerCase())).sort((a,b) => Number(b.favorite)-Number(a.favorite) || a.name.localeCompare(b.name));
  const sessions = data.sessions.filter(s => sessionRepo(s, data.projects)?.id === project?.id);
  function openProject(p: Project) { setHome(false); setChatOpen(false); setBoardGroup(null); setSelected(p.id); setTab('overview'); }
  function openConversation(session: Session) { setHome(false); const repo = sessionRepo(session, data.projects); if (repo) setSelected(repo.id); setBoardGroup(current => data.groups?.find(g => g.id === current)?.repoIds.includes(repo?.id || '') ? current : null); setChatSession(session); setChatOpen(true); }
  const launchTerminal = () => project && run(() => api.launch(project.id, 'terminal'), 'Opened in Terminal.');
  function newSession(agent: Agent, repo = project, task?: GitHubItem) {
    if (!repo) return;
    setHome(false); setSelected(repo.id);
    const draft: Session = { id: 'draft-' + crypto.randomUUID(), projectId: repo.id, hostId: repo.hostId, agent, cwd: repo.path, task, initialPrompt: task ? `Work on this task: ${task.title}. Review the repository and propose an implementation plan first.` : undefined, title: `New ${agent === 'codex' ? 'Codex' : 'Claude Code'} session`, updatedAt: new Date().toISOString() };
    setDrafts(previous => [...previous, draft]); setChatSession(draft);
    setChatOpen(true);
  }
  function sessionList() {
    return <SessionBrowser sessions={sessions} query="" compact={tab === 'overview'} busy={busy}
      onResume={openConversation}
      onUpdate={async (session, changes) => {
        setBusy(true); setError('');
        try { await api.updateSession(session.agent, session.id, changes); await refresh(); return true; }
        catch (e) { setError(e instanceof Error ? e.message : String(e)); return false; }
        finally { setBusy(false); }
      }}/>
  }
  return <div className={"app-shell" + (!navigationOpen ? " navigation-collapsed" : "") + (chatOpen ? " conversation-open" : "")}>
    <main><header className={'topbar' + (!preview ? ' desktop-titlebar' : '')}>
      <div className="topbar-brand"><Button variant="ghost" className="app-name" aria-label="Project overview" onClick={() => { setHome(true); setChatOpen(false); setBoardGroup(null); }}>Kalkidan</Button><Hint label={navigationOpen ? "Hide project navigation" : "Show project navigation"}><Button variant="ghost" size="icon-sm" aria-label="Toggle project navigation" aria-expanded={navigationOpen} onClick={() => setNavigationOpen(!navigationOpen)}><PanelLeft size={16}/></Button></Hint></div>
      <div className="topbar-content"><div className="topbar-context"><Folder size={15}/><span>{chatOpen && chatSession ? (chatSession.organization?.title || chatSession.title) : home ? "Projects" : boardGroup ? data.groups?.find(g => g.id === boardGroup)?.name : data.projects.find(p => p.id === selected)?.name || "Projects"}</span></div><div className="topbar-actions"><div id="conversation-titlebar-tools" className="titlebar-tools"/><div id="conversation-titlebar-actions"/><ScheduledTasksButton api={api}/><Hint label="Refresh projects and sessions"><Button variant="ghost" size="icon-sm" aria-label="Refresh projects and history" disabled={busy} onClick={() => run(async () => {})}><RefreshCw size={15} className={busy ? 'animate-spin' : ''}/></Button></Hint><AddRepository api={api} variant="outline" disabled={busy} onRefresh={() => run(async () => {})}><Plus size={15}/> Add repository</AddRepository><Hint label="Settings"><Button variant="ghost" size="icon-sm" aria-label="Settings" onClick={() => setSettingsOpen(true)}><Settings2 size={16}/></Button></Hint></div></div>
    </header>
    <div className="page-content">

    {(error || notice) && <div role={error ? 'alert' : 'status'} className={'notice ' + (error ? 'error' : '')}>{error || notice}<Button variant="ghost" aria-label="Dismiss notification" onClick={() => { setError(''); setNotice(''); }}><X size={15}/></Button></div>}
    {data.warnings.length > 0 && <Collapsible className="warnings"><CollapsibleTrigger asChild><Button variant="ghost">History scan notes ({data.warnings.length})</Button></CollapsibleTrigger><CollapsibleContent>{data.warnings.map((w,i) => <p key={i}>{w}</p>)}</CollapsibleContent></Collapsible>}
    <div className="workspace-grid"><div className="library-panel" hidden={!navigationOpen}><div className="search"><Search size={16}/><Input ref={searchRef} aria-label="Search projects or sessions" placeholder="Find a project…" value={query} onChange={e => setQuery(e.target.value)}/><kbd>⌘ K</kbd></div><ProjectTree hosts={data.hosts} api={api} repos={projects} allRepos={data.projects} groups={data.groups || []} sessions={[...drafts.filter(d => !data.sessions.some(s => s.agent === d.agent && s.id === d.id)), ...data.sessions]} selected={home ? '' : selected} activeGroup={home ? null : boardGroup} activeSession={chatOpen ? chatSession : null} busy={busy} onSelect={openProject} onProject={group => { setHome(false); setChatOpen(false); setBoardGroup(group.id); }} onResume={openConversation} run={run}/><div className="sidebar-github">{home && (data.groups?.length || 0) > 1 && <Choice label="GitHub connection project" className="w-full" value={githubTarget} onChange={setGithubTarget} options={[{ value: '', label: 'Choose a project' }, ...(data.groups || []).map(g => ({ value: g.id, label: g.name }))]}/>}<Button variant="ghost" className="w-full justify-start" disabled={!connectionGroup} onClick={() => { if (!connectionGroup) return; setHome(false); setChatOpen(false); setBoardGroup(connectionGroup.id); setConnectRequest(connectionGroup.id); }}><GitFork size={16}/>{connectionGroup?.github ? 'GitHub project' : 'Connect GitHub'}</Button></div></div>
    <div className="project-content"><div className="management-pane" hidden={chatOpen}>
    {home ? <ProjectOverview api={api} groups={data.groups || []} repos={data.projects} sessions={data.sessions} query={query} onRefresh={refresh} onSelect={group => { setHome(false); setBoardGroup(group.id); }}/>:
    boardGroup && data.groups?.find(g => g.id === boardGroup) ? <GitHubProjectPanel connectRequested={connectRequest === boardGroup} onConnectHandled={() => setConnectRequest(null)} key={boardGroup} revision={revision} api={api} sessions={data.sessions} onResume={openConversation} group={data.groups.find(g => g.id === boardGroup)!} repos={data.projects.filter(p => data.groups!.find(g => g.id === boardGroup)!.repoIds.includes(p.id))} onRefresh={refresh} onRepo={openProject} onTask={(repo, agent, task) => newSession(agent, repo, task)}/> : project ? <section className="detail"><div className="detail-heading"><div className="detail-icon"><Folder size={27}/></div><div className="flex-1 min-w-0"><h2>{project.name}</h2>{project.hostId && <span className="text-xs text-muted-foreground">SSH · {data.hosts?.find(h=>h.id===project.hostId)?.name || 'Remote host'} · {data.hosts?.find(h=>h.id===project.hostId)?.status || 'disconnected'}</span>}<Button variant="ghost" className="path-button" disabled={!!project.hostId} title={project.hostId ? 'Remote filesystem path' : 'Open folder in Finder'} onClick={() => run(() => api.reveal(project.id))}>{project.path}<ArrowUpRight size={12}/></Button></div><ActionMenu label="Repository actions" disabled={busy} items={[...(!project.hostId ? [{ label: 'Open folder in Finder', action: () => void run(() => api.reveal(project.id)) }, { label: 'Open Terminal', action: () => void launchTerminal() }] : []), { label: project.favorite ? 'Remove favorite' : 'Mark as favorite', action: () => void run(() => api.update(project.id, { favorite: !project.favorite })) }]}/><Button variant="ghost" size="icon" aria-label="Edit repository" onClick={() => { setName(project.name); setNotes(project.notes); setRepoGroup((data.groups || []).find(g => g.repoIds.includes(project.id))?.id || ''); setModal('edit'); }}><Settings2 size={18}/></Button></div>
    <div className="project-status"><Badge variant="outline"><GitBranch size={12}/>{gitLoading ? 'Checking Git…' : git?.branch || (gitError ? 'Unavailable' : 'Local folder')}</Badge>{git && <span className={git.changes ? 'changes' : 'clean'}><Circle size={7} fill="currentColor"/>{git.changes ? `${git.changes} changed files` : 'Working tree clean'}</span>}</div>
    <Tabs value={tab} onValueChange={setTab}><TabsList variant="line" className="detail-tabs"><TabsTrigger value="overview">Overview</TabsTrigger><TabsTrigger value="worktrees">Worktrees {git ? <span>{git.worktrees.length}</span> : ''}</TabsTrigger><TabsTrigger value="sessions">Sessions <span>{sessions.length}</span></TabsTrigger></TabsList>
    <TabsContent value="overview" className="tab-body"><div className="repository-start"><span>New conversation</span>{(['codex','claude'] as Agent[]).map(agent => <Button variant="outline" size="sm" disabled={busy} key={agent} aria-label={`${agent === 'codex' ? 'Codex' : 'Claude Code'} New session`} onClick={() => newSession(agent)}><Plus size={14}/>{agent === 'codex' ? 'Codex' : 'Claude Code'}</Button>)}</div>
    {repositoryGroup && <GitHubProjectPanel embedded preferredRepoId={project.id} key={repositoryGroup.id + project.id} revision={revision} api={api} sessions={data.sessions} onResume={openConversation} group={repositoryGroup} repos={data.projects.filter(p => repositoryGroup.repoIds.includes(p.id))} onRefresh={refresh} onRepo={openProject} onTask={(repo, agent, task) => newSession(agent, repo, task)}/>}
    <div className="section-header recent-heading"><h3>Recent sessions</h3><Button variant="ghost" onClick={() => setTab('sessions')}>View all <ArrowRight size={13}/></Button></div>{sessionList()}<Collapsible className="notes-box"><div><CollapsibleTrigger asChild><Button variant="ghost">Repository notes <ChevronRight size={13}/></Button></CollapsibleTrigger><Button variant="ghost" onClick={() => { setName(project.name); setNotes(project.notes); setRepoGroup((data.groups || []).find(g => g.repoIds.includes(project.id))?.id || ''); setModal('edit'); }}>Edit</Button></div><CollapsibleContent><p>{project.notes || 'Add a reminder or useful command…'}</p></CollapsibleContent></Collapsible></TabsContent>
    <TabsContent value="worktrees" className="tab-body"><div className="section-header"><h3>Parallel work, separate branches</h3><Button size="sm" disabled={!git || busy} onClick={() => { setBranch(''); setModal('worktree'); }}><Plus size={14}/> New worktree</Button></div><p className="help-text">Give each agent its own worktree to work on different tasks without changing the same files.</p>{gitError && <p role="alert" className="text-destructive">{gitError}</p>}{git ? git.worktrees.map(tree => <div className="worktree" key={tree.path}><GitBranch size={20}/><div><strong>{tree.branch}</strong><code>{tree.path}</code></div>{tree.path === project.path && <Badge variant="secondary">Current</Badge>}</div>) : <div className="empty-small"><GitBranch size={28}/><h3>No Git worktrees available</h3><p>Choose an existing Git repository with an initial commit to create a worktree.</p></div>}</TabsContent>
    <TabsContent value="sessions" className="tab-body"><div className="section-header"><h3>Repository sessions</h3></div>{sessionList()}</TabsContent></Tabs></section> : <section className="detail welcome"><Layers2 size={44}/><h2>Organize your repositories</h2><p>Create a project to group related repositories, or add a repository folder to get started.</p><AddRepository api={api} variant="default" onRefresh={() => run(async () => {})}><FolderPlus size={16}/> Add your first repository</AddRepository></section>}</div>{chatSession && <AgentWorkspace onDraft={draft => { setDrafts(previous => [...previous.filter(s => s.id !== draft.id), draft]); setChatSession(current => current?.id === draft.id ? draft : current); }} onCreated={(draft, id, title) => { setDrafts(previous => previous.map(s => s.id === draft.id && s.agent === draft.agent ? { ...s, id, title } : s)); setChatSession(current => current?.id === draft.id && current.agent === draft.agent ? { ...current, id, title } : current); }} api={api} projects={data.projects} projectGroups={data.groups} sessions={data.sessions} selected={chatSession} visible={chatOpen} onSelect={openConversation} onClose={() => { setChatOpen(false); setBoardGroup(null); }} onComplete={() => { void refresh().catch(e => setError(String(e))); }}/> }</div></div>
    </div></main>

    <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} api={api} groups={data.groups || []} onRefresh={refresh}/>
    <Dialog open={modal !== null} onOpenChange={open => !open && !busy && setModal(null)}><DialogContent className="max-h-[calc(100dvh-48px)] overflow-y-auto"><DialogHeader className="pr-6"><DialogTitle>{modal === 'worktree' ? 'Create a Git worktree' : modal === 'edit' ? 'Repository settings' : modal === 'remove' ? 'Remove from library?' : 'Settings'}</DialogTitle><DialogDescription>{modal === 'worktree' ? 'Create a new branch in a separate folder. The folder is automatically added to your library.' : modal === 'edit' ? 'Name this repository and assign it to a project.' : modal === 'remove' ? 'The repository folder, files, and agent sessions will remain on disk.' : 'Your agents, projects, and repositories.'}</DialogDescription></DialogHeader>
    {modal === 'worktree' && <label className="form-label">New branch name<Input autoFocus placeholder="feature/my-next-idea" value={branch} onChange={e => setBranch(e.target.value)}/></label>}
    {modal === 'edit' && <><label className="form-label">Repository name<Input value={name} onChange={e => setName(e.target.value)}/></label><label className="form-label">Project<Choice label="Project" value={repoGroup} onChange={setRepoGroup} options={[{ value: '', label: 'Choose a project' }, ...(data.groups || []).filter(g=>g.hostId===project?.hostId).map(g => ({ value: g.id, label: g.name }))]}/></label><label className="form-label">Notes<Textarea rows={5} value={notes} onChange={e => setNotes(e.target.value)}/></label><Button variant="ghost" className="text-destructive justify-start" onClick={() => setModal('remove')}><Trash2 size={14}/> Remove from library</Button></>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <DialogFooter><Button variant="outline" disabled={busy} onClick={() => setModal(null)}>Cancel</Button>{modal === 'edit' && <Button disabled={busy || !name.trim() || !repoGroup} onClick={() => run(async () => { await api.update(selected, { name, notes }); if (api.moveRepo) await api.moveRepo(selected, repoGroup || null); setModal(null); }, 'Project updated.')}><Check size={15}/> Save changes</Button>}{modal === 'remove' && <Button variant="destructive" disabled={busy} onClick={() => run(async () => { await api.remove(selected); setModal(null); }, 'Removed from library. Files were kept.')} >Remove project</Button>}{modal === 'worktree' && <Button disabled={busy || !branch.trim()} onClick={() => run(async () => { if (await api.worktree(selected, branch.trim())) { setModal(null); setNotice('Worktree created and added to your library.'); } })}>{busy ? 'Creating…' : 'Choose folder & create'}</Button>}</DialogFooter></DialogContent></Dialog>
  </div>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><TooltipProvider delayDuration={350}><App/></TooltipProvider></React.StrictMode>);
