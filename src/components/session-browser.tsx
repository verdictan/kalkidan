import { Hint } from './hint';
import { ActivityDot, activityKey, type SessionActivityState } from './activity-dot';
import { useEffect, useState } from 'react';
import { Archive, ArchiveRestore, History, MoreHorizontal, Pin, Terminal } from 'lucide-react';
import { agentCatalog, agentLabel } from '../config/agents';
import { Choice } from './choice';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import type { Session, SessionOrganization } from '../types';

interface Props {
  sessions: Session[];
  query?: string;
  compact?: boolean;
  busy: boolean;
  onUpdate: (session: Session, changes: SessionOrganization) => Promise<boolean>;
  onResume: (session: Session) => void;
  /** Key that keeps the view and filters for one repository. */
  storageKey?: string;
  /** Background state of open sessions, by `activityKey`. */
  activity?: Record<string, SessionActivityState>;
}
interface SavedView {
  agent: string;
  scope: string;
  collection: string;
}
const defaultView: SavedView = { agent: 'all', scope: 'active', collection: 'all' };
function readView(key: string | undefined): SavedView {
  if (!key) return defaultView;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null') as Partial<SavedView> | null;
    return { ...defaultView, ...(saved && typeof saved === 'object' ? saved : {}) };
  } catch {
    return defaultView;
  }
}
function formatDay(value: string, now = new Date()) {
  const date = new Date(value);
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() === now.getFullYear() ? undefined : 'numeric',
  });
}
export function SessionBrowser({
  sessions,
  query = '',
  compact = false,
  busy,
  onUpdate,
  onResume,
  storageKey,
  activity = {},
}: Props) {
  const viewKey = (key: string | undefined) => (key ? `kalkidan.sessionView.${key}` : undefined);
  const repositoryKey = viewKey(storageKey ?? sessions[0]?.projectId);
  const [loadedKey, setLoadedKey] = useState(repositoryKey);
  const [view, setView] = useState(() => readView(repositoryKey));
  // Load the saved view again when the user goes to a different repository.
  if (loadedKey !== repositoryKey) {
    setLoadedKey(repositoryKey);
    setView(readView(repositoryKey));
  }
  const { agent, scope, collection } = view;
  useEffect(() => {
    if (!loadedKey) return;
    try {
      localStorage.setItem(loadedKey, JSON.stringify(view));
    } catch {
      // Storage is not available. The view stays for this window only.
    }
  }, [loadedKey, view]);
  const setAgent = (value: string) => setView((previous) => ({ ...previous, agent: value }));
  const setScope = (value: string) => setView((previous) => ({ ...previous, scope: value }));
  const setCollection = (value: string) =>
    setView((previous) => ({ ...previous, collection: value }));
  const [editing, setEditing] = useState<Session | null>(null);
  const [draft, setDraft] = useState<SessionOrganization>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const collections = [
    ...new Set(sessions.map((s) => s.organization?.collection).filter((c): c is string => !!c)),
  ].sort();
  const list = sessions
    .filter((session) => {
      const org = session.organization || {};
      return (
        (compact
          ? !org.archived
          : (agent === 'all' || session.agent === agent) &&
            (scope === 'archived'
              ? org.archived
              : !org.archived && (scope !== 'pinned' || org.pinned)) &&
            (collection === 'all' || org.collection === collection)) &&
        `${org.title || session.title} ${session.title} ${session.cwd} ${session.agent} ${org.notes || ''} ${org.collection || ''}`
          .toLowerCase()
          .includes(query.toLowerCase())
      );
    })
    .sort(
      (a, b) =>
        Number(!!b.organization?.pinned) - Number(!!a.organization?.pinned) ||
        b.updatedAt.localeCompare(a.updatedAt),
    );
  const shown = compact ? list.slice(0, 3) : list;
  return (
    <>
      {!compact && (
        <div className="session-filters">
          <div className="session-scopes" role="group" aria-label="Session view">
            {['active', 'pinned', 'archived'].map((value) => (
              <Button
                variant="ghost"
                key={value}
                aria-pressed={scope === value}
                onClick={() => setScope(value)}
              >
                {value[0].toUpperCase() + value.slice(1)}
              </Button>
            ))}
          </div>
          <Choice
            label="Filter by agent"
            value={agent}
            onChange={setAgent}
            options={[
              { value: 'all', label: 'All agents' },
              ...agentCatalog.map((item) => ({ value: item.id, label: item.name })),
            ]}
          />
          <Choice
            label="Filter by collection"
            value={collection}
            onChange={setCollection}
            options={[
              { value: 'all', label: 'All collections' },
              ...collections.map((c) => ({ value: c, label: c })),
            ]}
          />
        </div>
      )}
      {shown.length ? (
        <div className="session-list">
          {shown.map((session) => {
            const org = session.organization || {};
            const title = org.title || session.title;
            return (
              <div className="session organized-session" key={session.agent + session.id}>
                <span className={'agent-mark ' + session.agent} aria-hidden="true">
                  {session.agent === 'codex' ? <Terminal size={16} /> : '✳'}
                </span>
                <div className="min-w-0 flex-1">
                  <Button
                    variant="ghost"
                    className="session-title"
                    title={title}
                    disabled={busy}
                    aria-label={`Resume ${title}`}
                    onClick={() => onResume(session)}
                  >
                    {org.pinned && <Pin size={12} />}
                    <span>{title}</span>
                    <ActivityDot state={activity[activityKey(session.agent, session.id)]} />
                  </Button>
                  <div className="session-meta">
                    {agentLabel(session.agent)} ·{' '}
                    <time
                      dateTime={session.updatedAt}
                      title={new Date(session.updatedAt).toLocaleString()}
                    >
                      {formatDay(session.updatedAt)}
                    </time>
                    {org.collection && <span className="collection-label">{org.collection}</span>}
                  </div>
                  {org.notes && !compact && <p className="session-note">{org.notes}</p>}
                </div>
                <div className="session-actions">
                  <Hint label="Organize session">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      disabled={busy}
                      aria-label={`Organize ${title}`}
                      onClick={() => {
                        setSaveError('');
                        setEditing(session);
                        setDraft({ ...org });
                      }}
                    >
                      <MoreHorizontal size={14} />
                    </Button>
                  </Hint>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty-small">
          <History size={26} />
          <h3>
            {scope === 'archived'
              ? 'No archived sessions'
              : scope === 'pinned'
                ? 'No pinned sessions'
                : 'No sessions found'}
          </h3>
          <p>
            {sessions.length
              ? 'Try a different search or filter. Use Organize on a session to pin, collect, or archive it.'
              : `Start a session with ${agentCatalog.map((item) => item.name).join(' or ')} with the New session buttons above.`}
          </p>
        </div>
      )}
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open && !saving) setEditing(null);
        }}
      >
        <DialogContent className="max-h-[calc(100dvh-48px)] overflow-y-auto">
          <DialogHeader className="pr-6">
            <DialogTitle>Organize session</DialogTitle>
            <DialogDescription>
              These settings are saved in Kalkidan. The original session stays unchanged.
            </DialogDescription>
          </DialogHeader>
          <label className="form-label">
            Session title
            <Input
              maxLength={160}
              placeholder={editing?.title}
              value={draft.title || ''}
              onChange={(e) => setDraft({ ...draft, title: e.target.value })}
            />
          </label>
          <label className="form-label">
            Collection
            <Input
              maxLength={160}
              placeholder="e.g. Website redesign"
              value={draft.collection || ''}
              onChange={(e) => setDraft({ ...draft, collection: e.target.value })}
            />
          </label>
          <label className="form-label">
            Session notes
            <Textarea
              rows={3}
              maxLength={20000}
              placeholder="Where you left off, next steps…"
              value={draft.notes || ''}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </label>
          <div className="session-options">
            <Button
              variant={draft.pinned ? 'secondary' : 'outline'}
              aria-pressed={!!draft.pinned}
              onClick={() => setDraft({ ...draft, pinned: !draft.pinned })}
            >
              <Pin size={14} />
              {draft.pinned ? 'Pinned' : 'Pin session'}
            </Button>
            <Button
              variant={draft.archived ? 'secondary' : 'outline'}
              aria-pressed={!!draft.archived}
              onClick={() => setDraft({ ...draft, archived: !draft.archived })}
            >
              {draft.archived ? <ArchiveRestore size={14} /> : <Archive size={14} />}{' '}
              {draft.archived ? 'Archived' : 'Archive session'}
            </Button>
          </div>
          <p role={saveError ? 'alert' : undefined} className="text-destructive text-sm">
            {saveError}
          </p>
          <DialogFooter>
            <Button variant="outline" disabled={saving} onClick={() => setEditing(null)}>
              Cancel
            </Button>
            <Button
              disabled={saving || busy}
              onClick={async () => {
                if (!editing) return;
                setSaving(true);
                try {
                  if (await onUpdate(editing, draft)) setEditing(null);
                  else
                    setSaveError(
                      'Could not save the session. Check that the session still exists, then try again.',
                    );
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? 'Saving…' : 'Save session'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
