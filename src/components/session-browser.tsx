import { Hint } from './hint';
import { useState } from 'react';
import { Archive, ArchiveRestore, ArrowUpRight, History, Pin, Settings2, Terminal } from 'lucide-react';
import { Choice } from './choice';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog';
import type { Session, SessionOrganization } from '../types';

interface Props {
  sessions: Session[];
  query?: string;
  compact?: boolean;
  busy: boolean;
  onUpdate: (session: Session, changes: SessionOrganization) => Promise<boolean>;
  onResume: (session: Session) => void;
}
export function SessionBrowser({ sessions, query = '', compact = false, busy, onUpdate, onResume }: Props) {
  const [agent, setAgent] = useState('all');
  const [scope, setScope] = useState('active');
  const [collection, setCollection] = useState('all');
  const [editing, setEditing] = useState<Session | null>(null);
  const [draft, setDraft] = useState<SessionOrganization>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const collections = [...new Set(sessions.map(s => s.organization?.collection).filter((c): c is string => !!c))].sort();
  const list = sessions.filter(session => {
    const org = session.organization || {};
    return (compact ? !org.archived : (agent === 'all' || session.agent === agent) && (scope === 'archived' ? org.archived : !org.archived && (scope !== 'pinned' || org.pinned)) && (collection === 'all' || org.collection === collection))
      && `${org.title || session.title} ${session.title} ${session.cwd} ${session.agent} ${org.notes || ''} ${org.collection || ''}`.toLowerCase().includes(query.toLowerCase());
  }).sort((a, b) => Number(!!b.organization?.pinned) - Number(!!a.organization?.pinned) || b.updatedAt.localeCompare(a.updatedAt));
  const shown = compact ? list.slice(0, 3) : list;
  return <>
    {!compact && <div className="session-filters">
      <div className="session-scopes" aria-label="Session view">{['active', 'pinned', 'archived'].map(value => <Button variant="ghost" key={value} aria-pressed={scope === value} onClick={() => setScope(value)}>{value[0].toUpperCase() + value.slice(1)}</Button>)}</div>
      <Choice label="Filter by agent" value={agent} onChange={setAgent} options={[{ value: 'all', label: 'Both agents' }, { value: 'codex', label: 'Codex' }, { value: 'claude', label: 'Claude Code' }]}/>
      <Choice label="Filter by collection" value={collection} onChange={setCollection} options={[{ value: 'all', label: 'All collections' }, ...collections.map(c => ({ value: c, label: c }))]}/>

    </div>}
    {shown.length ? <div className="session-list">{shown.map(session => {
      const org = session.organization || {};
      const title = org.title || session.title;
      return <div className="session organized-session" key={session.agent + session.id}>
        <span className={'agent-mark ' + session.agent}>{session.agent === 'codex' ? <Terminal size={16}/> : '✳'}</span>
        <div className="min-w-0 flex-1"><Button variant="ghost" className="session-title" title={title} disabled={busy} aria-label={`Resume ${title}`} onClick={() => onResume(session)}>{org.pinned && <Pin size={12}/>}<span>{title}</span></Button>
          <div className="session-meta">{session.agent === 'codex' ? 'Codex' : 'Claude Code'} · <time dateTime={session.updatedAt} title={new Date(session.updatedAt).toLocaleString()}>{new Date(session.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</time>{org.collection && <span className="collection-label">{org.collection}</span>}</div>
          {org.notes && !compact && <p className="session-note">{org.notes}</p>}
        </div>
        <div className="session-actions">
          <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={`Organize ${title}`} onClick={() => { setSaveError(''); setEditing(session); setDraft({ ...org }); }}><Settings2 size={14}/></Button>
          <Hint label="Continue conversation"><Button variant="ghost" size="icon-sm" aria-label="Resume session" disabled={busy} onClick={() => onResume(session)}><ArrowUpRight size={15}/></Button></Hint>
        </div>
      </div>;
    })}</div> : <div className="empty-small"><History size={26}/><h3>{scope === 'archived' ? 'No archived sessions' : scope === 'pinned' ? 'No pinned sessions' : 'No sessions found'}</h3><p>{sessions.length ? 'Try a different search or filter. Use session settings to pin, organize, or archive a conversation.' : 'Start a conversation with Codex or Claude Code from this repository’s Overview.'}</p></div>}
    <Dialog open={!!editing} onOpenChange={open => { if (!open && !saving) setEditing(null); }}><DialogContent className="max-h-[calc(100dvh-48px)] overflow-y-auto"><DialogHeader className="pr-6"><DialogTitle>Organize session</DialogTitle><DialogDescription>These settings are saved in Kalkidan. The original conversation stays unchanged.</DialogDescription></DialogHeader>
      <label className="form-label">Session title<Input maxLength={160} placeholder={editing?.title} value={draft.title || ''} onChange={e => setDraft({ ...draft, title: e.target.value })}/></label>
      <label className="form-label">Collection<Input maxLength={160} placeholder="e.g. Website redesign" value={draft.collection || ''} onChange={e => setDraft({ ...draft, collection: e.target.value })}/></label>
      <label className="form-label">Session notes<Textarea rows={3} maxLength={20000} placeholder="Where you left off, next steps…" value={draft.notes || ''} onChange={e => setDraft({ ...draft, notes: e.target.value })}/></label>
      <div className="session-options"><Button variant={draft.pinned ? 'secondary' : 'outline'} aria-pressed={!!draft.pinned} onClick={() => setDraft({ ...draft, pinned: !draft.pinned })}><Pin size={14}/>{draft.pinned ? 'Pinned' : 'Pin session'}</Button><Button variant={draft.archived ? 'secondary' : 'outline'} aria-pressed={!!draft.archived} onClick={() => setDraft({ ...draft, archived: !draft.archived })}>{draft.archived ? <ArchiveRestore size={14}/> : <Archive size={14}/>} {draft.archived ? 'Archived' : 'Archive session'}</Button></div>
      <p role={saveError ? "alert" : undefined} className="text-destructive text-sm">{saveError}</p><DialogFooter><Button variant="outline" disabled={saving} onClick={() => setEditing(null)}>Cancel</Button><Button disabled={saving || busy} onClick={async () => { if (!editing) return; setSaving(true); try { if (await onUpdate(editing, draft)) setEditing(null); else setSaveError('Could not save session settings. Check that the session still exists, then try again.'); } finally { setSaving(false); } }}>{saving ? 'Saving…' : 'Save session'}</Button></DialogFooter>
    </DialogContent></Dialog>
  </>;
}
