import { RemoteHostPicker } from './remote-host-picker';
import { useState } from 'react';
import { Compass, Loader2, Terminal } from 'lucide-react';
import type { API, ProjectGroup } from '../types';
import { Button } from './ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import { Choice } from './choice';

export function SettingsDialog({ open, onOpenChange, api, groups, onRefresh }: {
  open: boolean; onOpenChange: (open: boolean) => void; api: API;
  groups: ProjectGroup[]; onRefresh: () => Promise<void>;
}) {
  const [remoteId, setRemoteId] = useState('');
  const [projectId, setProjectId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState('');
  const [error, setError] = useState('');
  const selected = groups.some(group => group.id === projectId) ? projectId : '';
  async function discover() {
    if (!selected || busy) return;
    setBusy(true); setResult(''); setError('');
    try {
      const { added } = await api.discover(selected);
      await onRefresh();
      setResult(added ? `Added ${added} ${added === 1 ? 'repository' : 'repositories'} to ${groups.find(group => group.id === selected)?.name}.` : 'No new repositories found. Your project is up to date.');
    } catch (e) {
      setError(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': Error: /, '') : String(e));
    } finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={value => { if (!busy) { onOpenChange(value); setError(''); setResult(''); } }}>
    <DialogContent className="flex max-h-[calc(100dvh-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-lg" showCloseButton={!busy}>
      <DialogHeader className="border-b px-6 py-5 pr-12 text-left">
        <DialogTitle>Settings</DialogTitle>
        <DialogDescription>Manage your local agents and repository discovery.</DialogDescription>
      </DialogHeader>
      <div className="min-h-0 overflow-y-auto px-6 py-5">
        <section aria-labelledby="settings-agents-title" className="space-y-3">
          <h3 id="settings-agents-title" className="text-sm font-medium">Agents</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">Conversations use the CLIs installed on your Mac and their existing sign-ins.</p>
          <div className="divide-y rounded-lg border">
            {(['Codex', 'Claude Code'] as const).map((name, index) => <div key={name} className="flex items-center gap-3 p-3">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground" aria-hidden="true">{index === 0 ? <Terminal size={17}/> : '✳'}</span>
              <div className="min-w-0 flex-1"><p className="text-sm font-medium">{name}</p><p className="text-xs text-muted-foreground">{index === 0 ? 'OpenAI' : 'Anthropic'}</p></div>
              <span className="text-xs text-muted-foreground">Local CLI</span>
            </div>)}
          </div>
        </section>
        <div className="mt-6"><RemoteHostPicker api={api} value={remoteId} onChange={setRemoteId} onReady={() => { void onRefresh().catch(() => {}); }} onBusy={setBusy}/></div>
        <section aria-labelledby="settings-discovery-title" className="mt-6 space-y-3 border-t pt-5">
          <h3 id="settings-discovery-title" className="text-sm font-medium">Repository discovery</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">Find repositories from local agent history and add them to a project.</p>
          {groups.length ? <div className="space-y-2"><p className="text-xs font-medium text-muted-foreground">Add repositories to</p><Choice label="Discovery project" className="w-full" disabled={busy} value={selected} onChange={value => { setProjectId(value); setResult(''); setError(''); }} options={[{ value: '', label: 'Choose a project' }, ...groups.map(group => ({ value: group.id, label: group.name }))]}/></div> : <p className="rounded-md bg-muted p-3 text-sm text-muted-foreground">Create a project first, then discover its repositories here.</p>}
          <Button variant="outline" className="w-full" disabled={busy || !selected} onClick={() => void discover()}>{busy ? <Loader2 className="animate-spin"/> : <Compass/>}{busy ? 'Discovering repositories…' : 'Discover local repositories'}</Button>
          {result && <p role="status" className="rounded-md bg-muted p-3 text-sm">{result}</p>}
          {error && <p role="alert" className="break-words rounded-md border border-destructive/20 bg-destructive/5 p-3 text-sm text-destructive">{error}</p>}
        </section>
      </div>
      <DialogFooter className="shrink-0 border-t px-6 py-4"><Button variant="outline" disabled={busy} onClick={() => { onOpenChange(false); setError(''); setResult(''); }}>Done</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}
