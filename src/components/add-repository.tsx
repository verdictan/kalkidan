import { RemoteRepositoryPicker } from './remote-repository-picker';
import { CreateProject } from './create-project';
import { useEffect, useState, type ReactNode } from 'react';
import { Plus, RefreshCw } from 'lucide-react';
import type { API, GitHubAuthState, GitHubRepository, Snapshot } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Badge } from './ui/badge';
import { Choice } from './choice';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from './ui/dialog';

export function AddRepository({ api, groupId, onRefresh, children, disabled, className, variant = 'ghost' }: { api: API; groupId?: string; onRefresh: () => Promise<unknown>; children?: ReactNode; disabled?: boolean; className?: string; variant?: 'ghost' | 'default' | 'outline' }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState('github');
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const [target, setTarget] = useState(groupId || '');
  const [creatingProject, setCreatingProject] = useState(false);
  const [repos, setRepos] = useState<GitHubRepository[]>([]);
  const [selected, setSelected] = useState('');
  const [query, setQuery] = useState('');
  const [manual, setManual] = useState('');
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [auth, setAuth] = useState<GitHubAuthState>({ status: 'idle' });
  const remoteGroup = snapshot?.groups?.find(g => g.id === target && g.hostId);
  async function loadRepos() {
    setLoading(true); setError('');
    try { setRepos(await api.githubRepositories()); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }
  async function show() {
    setOpen(true); setCreatingProject(false); setTarget(groupId || ''); setSelected(''); setQuery(''); setManual(''); setError(''); setAuth({ status: 'idle' });
    try { setSnapshot(await api.snapshot()); } catch { setError('Could not load your projects. Close this dialog and try again.'); }
    void loadRepos();
  }
  function close() { if (busy) return; setOpen(false); if (auth.status === 'checking' || auth.status === 'waiting') void api.githubAuthCancel(); }
  useEffect(() => {
    if (!open || !['checking', 'waiting'].includes(auth.status)) return;
    let active = true;
    const timer = setInterval(() => { void api.githubAuthStatus().then(state => { if (!active) return; setAuth(state); if (state.status === 'ready') void loadRepos(); }).catch(() => { if (active) setAuth({ status: 'error', message: 'Authorization interrupted. Try again.' }); }); }, 700);
    return () => { active = false; clearInterval(timer); };
  }, [open, auth.status]);
  async function authorize() { setError(''); setAuth({ status: 'checking' }); try { const state = await api.githubAuthStart(true); setAuth(state); if (state.status === 'ready') await loadRepos(); } catch { setAuth({ status: 'error', message: 'Could not start GitHub authorization. Restart Kalkidan to load its latest desktop integration, then retry.' }); } }
  async function perform(fn: () => Promise<void>) { setBusy(true); setError(''); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); } }
  async function add() {
    await perform(async () => {
      if (!target || !snapshot?.groups?.some(g => g.id === target)) throw new Error('Choose or create a project first.');
      if (mode === 'local') await api.add(target || undefined);
      else if (mode === 'library') await api.moveRepo(selected, target || null);
      else if (!await api.cloneRepository(manual.trim() || selected, target || undefined)) return;
      await onRefresh(); setOpen(false);
    });
  }
  return <><Button variant={variant} disabled={disabled} className={className} onClick={() => void show()}>{children || <><Plus size={14}/> Add repositories</>}</Button>
    <Dialog open={open} onOpenChange={value => !value && close()}><DialogContent className="flex max-h-[calc(100dvh-48px)] flex-col gap-0 overflow-hidden p-0 sm:max-w-xl"><DialogHeader className="shrink-0 px-6 pt-6 pb-4 pr-12"><DialogTitle>Add repositories</DialogTitle><DialogDescription>Clone from GitHub, choose local folders, or organize repositories already in your library.</DialogDescription></DialogHeader>
      <div className="min-h-0 space-y-4 overflow-y-auto px-6 pb-6">
      <div className="space-y-2"><p className="text-sm font-medium">Project</p><Choice className="w-full" label="Add to project" value={target} disabled={busy} onChange={setTarget} options={[{ value: '', label: 'Choose a project' }, ...(snapshot?.groups || []).map(g => ({ value: g.id, label: g.name }))]}/></div>
      <Button variant="link" size="sm" className="px-0" disabled={busy} onClick={() => setCreatingProject(true)}>Create a new project</Button>
      {remoteGroup ? <RemoteRepositoryPicker key={remoteGroup.id} api={api} group={remoteGroup} repos={repos} onBusy={setBusy} onAdded={async()=>{await onRefresh();setOpen(false);}}/> : <>
      <div className="flex flex-wrap gap-1 rounded-md border bg-muted/50 p-1" aria-label="Repository source">{[{ value: 'github', label: 'Clone from GitHub' }, { value: 'local', label: 'Local folders' }, { value: 'library', label: 'From library' }].map(item => <Button key={item.value} size="sm" disabled={busy} variant={mode === item.value ? 'secondary' : 'ghost'} aria-pressed={mode === item.value} onClick={() => { setMode(item.value); setSelected(''); setError(''); }}>{item.label}</Button>)}</div>
      {mode === 'github' && <>
        <div className="flex gap-2"><Input aria-label="Search GitHub repositories" placeholder="Search owner or repository…" value={query} disabled={busy} onChange={e => setQuery(e.target.value)}/><Button variant="outline" size="icon" aria-label="Refresh repositories" disabled={busy || loading} onClick={() => void loadRepos()}><RefreshCw size={14}/></Button></div>
        <div className="min-h-20 max-h-48 space-y-1 overflow-auto rounded-md border p-1" aria-label="Available repositories">{loading ? <p className="text-sm text-muted-foreground">Loading repositories…</p> : repos.filter(r => r.nameWithOwner.toLowerCase().includes(query.toLowerCase())).map(repo => <Button key={repo.nameWithOwner} disabled={busy} variant={selected === repo.nameWithOwner ? 'secondary' : 'ghost'} aria-pressed={selected === repo.nameWithOwner} className="h-auto w-full items-start justify-start gap-3 whitespace-normal px-3 py-3 text-left" onClick={() => { setSelected(repo.nameWithOwner); setManual(''); }}><span className="min-w-0 flex-1"><span className="block break-all">{repo.nameWithOwner}</span><span className="mt-1 block break-words text-xs font-normal text-muted-foreground">{repo.description}</span></span><Badge variant="outline" className="mt-0.5 shrink-0">{repo.isArchived ? 'Archived' : repo.isPrivate ? 'Private' : 'Public'}</Badge></Button>)}{!loading && !repos.some(r => r.nameWithOwner.toLowerCase().includes(query.toLowerCase())) && <p className="text-sm text-muted-foreground">No matching repositories. Enter owner/repository below, or connect GitHub.</p>}</div>
        <p className="text-xs text-muted-foreground">{repos.length} repositories · {repos.filter(repo => repo.isPrivate).length} private · personal and organization access</p>
        <Input aria-label="GitHub repository name" placeholder="Or enter owner/repository" disabled={busy} value={manual} onChange={e => { setManual(e.target.value); setSelected(''); }}/>
        <Button variant="link" className="justify-start px-0" disabled={busy || ['checking', 'waiting'].includes(auth.status)} onClick={() => void authorize()}>{auth.status === 'checking' ? 'Starting GitHub authorization…' : auth.status === 'waiting' ? 'Waiting for GitHub approval…' : auth.status === 'ready' ? 'Authorize GitHub again' : 'Connect or authorize GitHub'}</Button>
        {auth.status === 'checking' && <p role="status" className="text-sm text-muted-foreground">Checking GitHub CLI and opening browser authorization…</p>}
        {auth.status === 'ready' && <p role="status" className="text-sm">GitHub connected. Your repository list has been refreshed.</p>}
        {auth.status === 'waiting' && <div className="space-y-3 rounded-md border p-4" aria-live="polite"><p className="text-sm">Approve access in your browser.{auth.code ? ' Enter this code:' : ' Requesting code…'}</p>{auth.code && <><Input aria-label="GitHub device code" readOnly value={auth.code} onFocus={e => e.target.select()}/><Button variant="outline" onClick={() => void api.githubAuthOpen().catch(() => setError('Could not open your browser. Visit https://github.com/login/device and enter the displayed code.'))}>Open GitHub</Button></>}<p className="text-xs text-muted-foreground">{auth.message || 'This dialog updates automatically after approval.'}</p></div>}
        {auth.status === 'error' && <p role="alert" className="text-sm text-destructive">{auth.message}</p>}
        <p className="text-xs text-muted-foreground">Next, choose a new local folder in Finder. Kalkidan will clone the repository and add it to the selected project.</p>
      </>}
      {mode === 'local' && <p className="text-sm text-muted-foreground">Choose one or more existing folders in Finder. They’ll be added to the selected project.</p>}
      {mode === 'library' && <Choice className="w-full" label="Repository from library" value={selected} disabled={busy} onChange={setSelected} options={[{ value: '', label: 'Choose a repository' }, ...(snapshot?.projects || []).filter(p=>!p.hostId).map(p => ({ value: p.id, label: p.name + ' · ' + p.path }))]}/>}
      </>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {busy && <p role="status" className="text-sm text-muted-foreground">Working… Cloning large repositories can take several minutes.</p>}
      </div><DialogFooter className="shrink-0 border-t px-6 py-4"><Button variant="outline" disabled={busy} onClick={close}>Cancel</Button><Button hidden={!!remoteGroup} disabled={busy || !target || !snapshot || (mode !== 'local' && !selected && !(mode === 'github' && manual.trim()))} onClick={() => void add()}>{mode === 'github' ? 'Choose location and clone' : mode === 'local' ? 'Choose folders' : 'Add to project'}</Button></DialogFooter>
    </DialogContent></Dialog>
    <CreateProject api={api} open={creatingProject} onOpenChange={setCreatingProject} onCreated={async group => { setSnapshot(await api.snapshot()); setTarget(group.id); await onRefresh(); }}/>
  </>;
}
