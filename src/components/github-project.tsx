import { sessionRepo } from './project-tree';
import { ActionMenu } from './action-menu';
import { TrackerBoard } from './tracker-board';
import { AddRepository } from './add-repository';
import { useEffect, useRef, useState } from 'react';
import { GitFork, RefreshCw, Plus, GitBranch, Search, LayoutGrid, FolderGit2 } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Badge } from './ui/badge';
import { Alert, AlertDescription } from './ui/alert';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';
import { GitHubProjectPicker } from './github-project-picker';
import { Choice } from './choice';
import type { API, ProjectGroup, Project, GitHubBoard, GitHubItem, Agent, Session, GitHubAuthState } from '../types';
export function GitHubProjectPanel({ api, group, repos, sessions, revision, embedded = false, preferredRepoId, connectRequested, onConnectHandled, onResume, onRefresh, onRepo, onTask }: { embedded?: boolean; preferredRepoId?: string; connectRequested?: boolean; onConnectHandled?: () => void; revision?: number; api: API; group: ProjectGroup; repos: Project[]; sessions: Session[]; onResume: (session: Session) => void; onRefresh: () => Promise<void>; onRepo: (repo: Project) => void; onTask: (repo: Project, agent: Agent, task: GitHubItem) => void }) {
  const [repoFilter, setRepoFilter] = useState('all');
  const projectSessions = sessions.filter(session => !!sessionRepo(session, repos));
  const [checkout, setCheckout] = useState('current');
  const [taskBranch, setTaskBranch] = useState('');
  const [taskBusy, setTaskBusy] = useState(false);
  const [taskError, setTaskError] = useState('');
  const authActive = useRef(false);
  const [auth, setAuth] = useState<GitHubAuthState>({ status: 'idle' });
  const [board, setBoard] = useState<GitHubBoard | null>(null);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [url, setUrl] = useState(''); const [query, setQuery] = useState(''); const [status, setStatus] = useState('all');
  const [modal, setModal] = useState<'draft' | 'issue' | 'connect' | null>(null);
  const [title, setTitle] = useState(''); const [body, setBody] = useState('');
  const [task, setTask] = useState<GitHubItem | null>(null); const [repoId, setRepoId] = useState(repos[0]?.id || '');
  async function authorize() {
    authActive.current = true;
    setAuth({ status: 'checking' }); setError('');
    try { setAuth(await api.githubAuthStart()); }
    catch { setAuth({ status: 'error', message: 'Could not start GitHub authorization. Restart Kalkidan and try again.' }); }
  }
  function connect() { setUrl(group.github?.url || ''); setModal('connect'); void authorize(); }
  useEffect(() => {
    if (!connectRequested) return;
    // Defer until mount cleanup has finished before starting CLI authorization.
    const timer = setTimeout(() => { connect(); onConnectHandled?.(); }, 0);
    return () => clearTimeout(timer);
  }, [connectRequested]);
  function closeModal() { if (modal === 'connect') { authActive.current = false; void api.githubAuthCancel(); setAuth({ status: 'idle' }); } setModal(null); }
  useEffect(() => {
    if (modal !== 'connect' || !['checking', 'waiting'].includes(auth.status)) return;
    let active = true;
    const timer = setInterval(() => { void api.githubAuthStatus().then(value => { if (active) setAuth(value); }).catch(() => { if (active) setAuth({ status: 'error', message: 'Lost connection to GitHub authorization. Try again.' }); }); }, 700);
    return () => { active = false; clearInterval(timer); };
  }, [modal, auth.status, api]);
  useEffect(() => () => { if (authActive.current) void api.githubAuthCancel(); }, [api, group.id]);
  function chooseTask(item: GitHubItem) { setTask(item); setCheckout('current'); setTaskBranch(''); setTaskError(''); const matches = repos.filter(r => r.name === item.repository?.split('/').at(-1)); setRepoId(matches.length === 1 ? matches[0].id : preferredRepoId || (repos.length === 1 ? repos[0].id : '')); }
  async function startTask(agent: Agent) {
    const repo = repos.find(r => r.id === repoId);
    if (!repo || !task || taskBusy) return;
    setTaskBusy(true); setTaskError('');
    try {
      const target = checkout === 'worktree' ? await api.taskWorktree(repo.id, taskBranch.trim()) : repo;
      if (!target) return;
      if (checkout === 'worktree') await onRefresh();
      onTask(target, agent, task); setTask(null);
    } catch (e) { setTaskError(e instanceof Error ? e.message : String(e)); }
    finally { setTaskBusy(false); }
  }
  async function refreshBoard() { setBoard(await api.githubBoard(group.id)); }
  async function action(fn: () => Promise<unknown>, refresh = true) { setBusy(true); setError(''); try { await fn(); if (refresh) await refreshBoard(); } catch (e) { setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(e)); } finally { setBusy(false); } }
  useEffect(() => { let current = true; setBoard(null); if (!group.github) return; setBusy(true); api.githubBoard(group.id).then(value => { if (current) setBoard(value); }).catch(e => { if (current) setError(e.message); }).finally(() => { if (current) setBusy(false); }); return () => { current = false; }; }, [group.id, group.github?.id, revision]);
  const items = board?.items.filter(item => (status === 'all' || item.statusId === status || (status === 'none' && !item.statusId)) && (repoFilter === 'all' || (repoFilter === 'draft' ? !item.repository : item.repository === repoFilter)) && `${item.title} ${item.repository || ''}`.toLowerCase().includes(query.toLowerCase())) || [];
  const repositoryOptions = [...new Set(board?.items.map(item => item.repository).filter((repo): repo is string => !!repo) || [])].sort();
  return <section className={embedded ? "project-tracker embedded-tracker" : "project-tracker"} aria-label={embedded ? "Repository project tasks" : "Project tracker"}>
    <header className="tracker-project-heading"><div className="flex min-w-0 items-center gap-3"><span className="project-symbol"><FolderGit2 size={18}/></span><div className="min-w-0"><h2>{embedded ? 'Project tasks' : group.name}</h2><div className="tracker-project-source"><GitFork size={12}/><span>{group.github?.title || 'Connect this project to GitHub'}</span>{group.github && <span className="text-muted-foreground">#{group.github.number}</span>}</div></div></div><div className="flex shrink-0 items-center gap-2">{group.github ? <><Button variant="ghost" size="icon-sm" aria-label="Refresh GitHub project" disabled={busy} onClick={() => void action(refreshBoard, false)}><RefreshCw size={14} className={busy ? 'animate-spin' : ''}/></Button><Button size="sm" disabled={busy} onClick={() => { setTitle(''); setBody(''); setModal('draft'); }}><Plus size={14}/>New item</Button><ActionMenu label="Tracker actions" disabled={busy} items={[{ label: 'Add existing issue', action: () => { setUrl(''); setModal('issue'); } }]}/></> : null}</div></header>
    {error && !modal && <Alert variant="destructive"><AlertDescription>{error}{group.github && <Button variant="outline" size="sm" onClick={connect}>Authorize GitHub access</Button>}</AlertDescription></Alert>}
    {!embedded && <div className="tracker-navigation"><span className="flex items-center gap-2 py-2 text-sm font-medium"><LayoutGrid size={14}/>Board</span><span className="tracker-item-count">{board ? `${board.items.length} issues` : 'GitHub Projects'}</span></div>}
        {!embedded && <div className="tracker-repository-strip"><span>Work happens in</span>{repos.map(repo => <Button key={repo.id} variant="ghost" size="sm" className="h-7 max-w-48 px-2 text-xs" title={repo.path} onClick={() => onRepo(repo)}><GitBranch size={12}/><span className="truncate">{repo.name}</span></Button>)}<AddRepository api={api} groupId={group.id} disabled={busy} onRefresh={onRefresh} className="h-7 px-2 text-xs"/>{!repos.length && <span>Add a repository to start agent work.</span>}</div>}
        {group.github ? <div className="tracker-filterbar"><div className="relative min-w-40 flex-1 sm:max-w-64"><Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"/><Input className="h-8 pl-8 text-xs" aria-label="Search GitHub items" placeholder="Search issues…" value={query} onChange={e => setQuery(e.target.value)}/></div><Choice className="h-8 text-xs" label="Filter task status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'All statuses' }, { value: 'none', label: 'No status' }, ...(board?.statusField?.options.map(o => ({ value: o.id, label: o.name })) || [])]}/><Choice className="h-8 max-w-60 text-xs" label="Filter issues by repository" value={repoFilter} onChange={setRepoFilter} options={[{ value: 'all', label: 'All repositories' }, { value: 'draft', label: 'Draft items' }, ...repositoryOptions.map(repo => ({ value: repo, label: repo }))]}/>{(query || status !== 'all' || repoFilter !== 'all') && <Button variant="ghost" size="sm" onClick={() => { setQuery(''); setStatus('all'); setRepoFilter('all'); }}>Clear filters</Button>}</div> : embedded ? <p className="py-3 text-sm text-muted-foreground">Connect GitHub from the sidebar to see project tasks here.</p> : <div className="project-empty"><GitFork size={24}/><h3>Connect your project tracker</h3><p>This existing project remains available. Use Connect GitHub at the bottom of the sidebar to manage issues alongside your repositories.</p></div>}
    {board && <TrackerBoard board={board} items={items} sessions={projectSessions} busy={busy} onOpen={chooseTask} onStatus={(item, value) => void action(() => api.githubStatus(group.id, item.id, value))}/>}
    {group.github && !items.length && <div className="tracker-empty-result">{busy ? 'Loading issues…' : error ? 'Issues could not be loaded. Retry the connection above.' : 'No matching issues. Adjust your filters or create a new item.'}</div>}
    {group.github && <footer className="tracker-footer"><span>{items.length} {items.length === 1 ? 'issue' : 'issues'} shown</span><span>Synced with GitHub · select an issue to start work</span></footer>}
    <Dialog open={!!modal} onOpenChange={open => !open && !busy && closeModal()}><DialogContent className="max-h-[calc(100dvh-48px)] overflow-y-auto"><DialogHeader className="pr-6"><DialogTitle>{modal === 'connect' ? 'Connect GitHub Project' : modal === 'issue' ? 'Add existing issue or pull request' : 'Create draft item'}</DialogTitle><DialogDescription>{modal === 'connect' ? 'Choose an existing GitHub Project or create a new one for your team. Kalkidan uses GitHub CLI to securely save your login.' : 'This action updates the linked GitHub Project.'}</DialogDescription></DialogHeader>{modal === 'connect' && <div className="space-y-3" aria-live="polite">
      {auth.status === 'checking' && <p className="text-sm text-muted-foreground">Checking GitHub access…</p>}
      {auth.status === 'waiting' && <><p className="text-sm">{auth.code ? 'Enter this code on GitHub and approve Projects access:' : 'Requesting a code from GitHub…'}</p>{auth.code && <><Input aria-label="GitHub device code" readOnly value={auth.code} className="text-center font-mono text-lg tracking-widest" onFocus={event => event.target.select()}/><Button variant="outline" onClick={() => void action(() => api.githubAuthOpen(), false)}>Open GitHub</Button></>}<p className="text-xs text-muted-foreground">{auth.message || 'Waiting for approval. This dialog will update automatically.'}</p></>}
      {auth.status === 'ready' && <Badge variant="secondary">GitHub access granted</Badge>}
      {auth.status === 'error' && <><Alert variant="destructive"><AlertDescription>{auth.message}</AlertDescription></Alert><Button variant="outline" onClick={() => void authorize()}>Retry GitHub authorization</Button></>}
    </div>}{modal === 'draft'  ? <><Input maxLength={256} aria-label="Item title" placeholder="What needs to be done?" value={title} onChange={e => setTitle(e.target.value)}/><Textarea maxLength={20000} aria-label="Item description" placeholder="Description and acceptance criteria" value={body} onChange={e => setBody(e.target.value)}/></> : modal === 'connect' ? auth.status === 'ready' && <GitHubProjectPicker api={api} defaultTitle={group.name} value={url} onChange={setUrl} onBusy={setBusy}/> : <Input aria-label="GitHub URL" placeholder="https://github.com/owner/repo/issues/123" value={url} onChange={e => setUrl(e.target.value)}/>} {error && <p role="alert" className="text-sm text-destructive">{error}</p>}<DialogFooter><Button variant="outline" disabled={busy} onClick={closeModal}>Cancel</Button><Button disabled={busy || (modal === 'connect' && auth.status !== 'ready') || (modal === 'draft' ? !title.trim() : !url.trim())} onClick={() => void action(async () => { if (modal === 'connect') { await api.githubLink(group.id, url); await onRefresh(); } else if (modal === 'issue') await api.githubAddIssue(group.id, url); else await api.githubDraft(group.id, title, body); setModal(null); })}>{busy ? 'Saving…' : modal === 'connect' ? 'Connect project' : 'Add to GitHub'}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={!!task} onOpenChange={open => !open && !taskBusy && setTask(null)}><DialogContent className="max-h-[calc(100dvh-48px)] overflow-y-auto"><DialogHeader className="pr-6"><DialogTitle>{task?.title}</DialogTitle><DialogDescription>{task?.repository || 'Project task'} · {task?.status || 'No status'}</DialogDescription></DialogHeader><div className="max-h-64 overflow-auto whitespace-pre-wrap text-sm">{task?.body || 'No description.'}</div>{task?.url && <Input aria-label="Issue URL" readOnly value={task.url}/>}<Choice className="w-full" label="Task repository" disabled={taskBusy} value={repoId} onChange={setRepoId} options={[{ value: '', label: 'Choose repository' }, ...repos.map(r => ({ value: r.id, label: r.name }))]}/>{task && projectSessions.filter(s => !s.organization?.archived && s.organization?.taskId === task.id).length > 0 && <div className="space-y-2"><p className="text-xs font-medium">Continue existing work</p>{projectSessions.filter(s => !s.organization?.archived && s.organization?.taskId === task.id).map(s => <Button className="w-full justify-start truncate" variant="outline" key={s.agent + s.id} onClick={() => { onResume(s); setTask(null); }}>{s.agent === 'codex' ? 'Codex' : 'Claude'} · {s.organization?.title || s.title}</Button>)}</div>}<Choice className="w-full" label="Task checkout" disabled={taskBusy} value={checkout} onChange={setCheckout} options={[{ value: 'current', label: 'Current checkout' }, { value: 'worktree', label: 'New worktree' }]}/>{checkout === 'worktree' && <label className="form-label">New branch<Input aria-label="Task branch" disabled={taskBusy} value={taskBranch} onChange={e => setTaskBranch(e.target.value)} placeholder="feature/task-name"/></label>}{taskError && <p role="alert" className="text-sm text-destructive">{taskError}</p>}<p className="text-xs text-muted-foreground">Choose where the agent should work. You can review the prompt before sending.</p><DialogFooter>{(['codex','claude'] as Agent[]).map(agent => <Button key={agent} disabled={taskBusy || !repos.some(r => r.id === repoId) || (checkout === 'worktree' && !taskBranch.trim())} variant={agent === 'codex' ? 'default' : 'outline'} onClick={() => void startTask(agent)}>{agent === 'codex' ? 'Open in Codex' : 'Open in Claude Code'}</Button>)}</DialogFooter></DialogContent></Dialog>
  </section>;
}
