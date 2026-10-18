import { useState } from 'react';
import { ChevronDown, Pin } from 'lucide-react';
import type { API, Session } from '../types';
import { Button } from './ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible';

export function SessionMetadata({ api, session, providerId, onUpdate }: { api: API; session: Session; providerId?: string; onUpdate: () => void }) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const agent = session.agent === 'codex' ? 'Codex' : 'Claude Code';
  const fields = [
    ['Agent', agent],
    ['Collection', session.organization?.collection || 'No collection'],
    ['Last activity', new Date(session.updatedAt).toLocaleString()],
    ['Project folder', session.cwd],
    ['Notes', session.organization?.notes || 'No notes yet'],
    ['Session ID', providerId || (session.projectId ? 'Created when you send your first message' : session.id)],
  ];
  async function togglePin() {
    setSaving(true); setError('');
    try { await api.updateSession(session.agent, providerId || session.id, { pinned: !session.organization?.pinned }); onUpdate(); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  }
  return <Collapsible open={open} onOpenChange={setOpen} className="session-metadata shrink-0" >
    <div className="flex min-w-0 items-center gap-3 py-1">
      <CollapsibleTrigger asChild><Button variant="ghost" size="sm" aria-label="Toggle session details" className="shrink-0 gap-2 text-muted-foreground"><ChevronDown size={14} className={open ? 'rotate-180' : ''}/>Session details</Button></CollapsibleTrigger>
      <span className="min-w-0 truncate text-xs text-muted-foreground">{agent} · {session.hostId ? 'SSH' : 'Local'}{session.organization?.collection ? ` · ${session.organization.collection}` : ''}</span>
      {session.organization?.pinned && <Pin size={12} aria-label="Pinned" className="shrink-0 text-muted-foreground"/>}
    </div>
    <CollapsibleContent>
      <section aria-label="Session details" className="max-h-[28vh] overflow-y-auto px-3 pb-3 pt-2">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 xl:grid-cols-3">
          {fields.map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-xs text-muted-foreground">{label}</dt><dd className={'mt-1 whitespace-pre-wrap break-words text-xs leading-relaxed ' + (label === 'Session ID' ? 'font-mono' : '')}>{value}</dd></div>)}
        </dl>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" disabled={saving || (!!session.projectId && !providerId)} onClick={() => void togglePin()}><Pin size={13}/>{session.organization?.pinned ? 'Unpin session' : 'Pin session'}</Button>
          <p className="text-xs text-muted-foreground">Rename, add notes, or archive in the repository’s Sessions tab.</p>
        </div>
        {error && <p role="alert" className="mt-2 text-xs text-destructive">{error}</p>}
      </section>
    </CollapsibleContent>
  </Collapsible>;
}
