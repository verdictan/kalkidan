import { Hint } from './hint';
import { ActivityDot, activityKey, type SessionActivityState } from './activity-dot';
import { useEffect, useState } from 'react';
import { Archive, ArchiveRestore, History, Pin } from 'lucide-react';
import { agentCatalog, agentLabel } from '../config/agents';
import { Choice } from './choice';
import { AgentIcon } from './ui/agent-icon';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { EmptyState } from './ui/empty-state';
import { EntityIcon } from './ui/entity-icon';
import { MoreButton } from './ui/more-button';
import { SegmentedControl } from './ui/segmented-control';
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
          <SegmentedControl
            label="Session view"
            value={scope}
            onChange={setScope}
            options={['active', 'pinned', 'archived'].map((value) => ({
              value,
              label: value[0].toUpperCase() + value.slice(1),
            }))}
          />
          <Choice
            label="Filter by agent"
            className="min-w-32"
            value={agent}
            onChange={setAgent}
            options={[
              { value: 'all', label: 'All agents' },
              ...agentCatalog.map((item) => ({ value: item.id, label: item.name })),
            ]}
          />
          <Choice
            label="Filter by collection"
            className="min-w-32"
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
              <div className="list-row" key={session.agent + session.id}>
                <EntityIcon>
                  <AgentIcon agent={session.agent} />
                </EntityIcon>
                <div className="min-w-0 flex-1">
                  <Button
                    variant="bare"
                    className="session-title max-w-full gap-1.5 text-left font-medium"
                    title={title}
                    disabled={busy}
                    aria-label={`Resume ${title}`}
                    onClick={() => onResume(session)}
                  >
                    {org.pinned && <Pin size={12} />}
                    <span>{title}</span>
                    <ActivityDot state={activity[activityKey(session.agent, session.id)]} />
                  </Button>
                  <div
                    className="session-meta"
                    title={`${agentLabel(session.agent)} · ${new Date(session.updatedAt).toLocaleString()}${org.collection ? ' · ' + org.collection : ''}`}
                  >
                    {agentLabel(session.agent)} ·{' '}
                    <time
                      dateTime={session.updatedAt}
                      title={new Date(session.updatedAt).toLocaleString()}
                    >
                      {formatDay(session.updatedAt)}
                    </time>
                    {org.collection && (
                      <Badge variant="secondary" size="sm" className="ml-2">
                        {org.collection}
                      </Badge>
                    )}
                  </div>
                  {org.notes && !compact && <p className="session-note">{org.notes}</p>}
                </div>
                <div className="session-actions">
                  {org.archived && !compact && (
                    <Button
                      variant="outline"
                      size="xs"
                      disabled={busy}
                      aria-label={`Restore ${title}`}
                      onClick={() => void onUpdate(session, { ...org, archived: false })}
                    >
                      <ArchiveRestore aria-hidden="true" />
                      Restore
                    </Button>
                  )}
                  <Hint label="Organize session">
                    <MoreButton
                      size="xs"
                      disabled={busy}
                      label={`Organize ${title}`}
                      onClick={() => {
                        setSaveError('');
                        setEditing(session);
                        setDraft({ ...org });
                      }}
                    />
                  </Hint>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          compact
          icon={<History />}
          title={
            scope === 'archived' && !compact
              ? 'No archived sessions'
              : scope === 'pinned' && !compact
                ? 'No pinned sessions'
                : sessions.length
                  ? 'No sessions found'
                  : 'No sessions yet'
          }
        >
          {sessions.length
            ? 'Try a different search or filter. Use Organize on a session to pin, collect, or archive it.'
            : 'Use New session above.'}
        </EmptyState>
      )}
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open && !saving) setEditing(null);
        }}
      >
        <DialogContent size="md">
          <DialogHeader>
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
          {saveError && (
            <p role="alert" className="field-error">
              {saveError}
            </p>
          )}
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
