import {
  ActivityDot,
  activityKey,
  useActivityState,
  waitsForUser,
  type SessionActivityState,
} from './activity-dot';
import { useEffect, useState } from 'react';
import { ArchiveRestore, GitBranch, History, Pin } from 'lucide-react';
import { agentCatalog, agentLabel } from '../config/agents';
import { fullTime, relativeTime } from '../lib/relative-time';
import { plural } from '../lib/platform';
import { ActionMenu } from './action-menu';
import { Choice } from './choice';
import { RenameSessionDialog, archiveSessionWithUndo } from './session-actions';
import { AgentIcon } from './ui/agent-icon';
import { Button } from './ui/button';
import { EmptyState } from './ui/empty-state';
import { EntityIcon } from './ui/entity-icon';
import { SegmentedControl } from './ui/segmented-control';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import { showToast } from './ui/toast';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { errorMessage } from '../lib/errors';
import type { API, Session, SessionOrganization, TrackerItem } from '../types';

interface Props {
  /** The API for rename and archive. A remote session uses the API of its host. */
  api?: API;
  /** Reads the sessions again after a rename, an archive or an undo. */
  onChanged?: () => void;
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
  /** The label of the button that starts a session, for the empty state. */
  newSessionLabel?: string;
  /** The branch copy of a session, shown as a badge on sessions of a branch copy. */
  branchOf?: (session: Session) => string | undefined;
  /** The project and code folder of each session. With it, the list shows a Project filter. */
  placeOf?: (session: Session) => { project?: string; folder?: string } | undefined;
  /** The board item that a chat works on. Rows show "#12" and the list a Task filter. */
  taskOf?: (session: Session) => TrackerItem | undefined;
  /** Opens the task that a chat works on. */
  onOpenTask?: (session: Session, task: TrackerItem) => void;
}
interface SavedView {
  agent: string;
  scope: string;
  collection: string;
  project: string;
  task: string;
}
const defaultView: SavedView = {
  agent: 'all',
  scope: 'active',
  collection: 'all',
  project: 'all',
  task: 'all',
};
/** Filters show only for longer lists, or when more than one agent made the sessions. */
const filterThreshold = 8;
function readView(key: string | undefined): SavedView {
  if (!key) return defaultView;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || 'null') as Partial<SavedView> | null;
    return { ...defaultView, ...(saved && typeof saved === 'object' ? saved : {}) };
  } catch {
    return defaultView;
  }
}
/** The storage key of the saved view for one list. */
export const sessionViewKey = (key: string) => `kalkidan.sessionView.${key}`;
/** Shows the archived sessions of a list, for example from the "View archived" toast action. */
export function viewArchivedSessions(key: string) {
  try {
    localStorage.setItem(
      sessionViewKey(key),
      JSON.stringify({ ...readView(sessionViewKey(key)), scope: 'archived' }),
    );
  } catch {
    // Storage is not available. The event below still changes an open list.
  }
  window.dispatchEvent(new CustomEvent('kalkidan-view-archived', { detail: { key } }));
}
export function SessionBrowser({
  api,
  onChanged,
  sessions,
  query = '',
  compact = false,
  busy,
  onUpdate,
  onResume,
  storageKey,
  activity = {},
  newSessionLabel = 'New chat',
  branchOf,
  placeOf,
  taskOf,
  onOpenTask,
}: Props) {
  const { finished } = useActivityState();
  /** True when the chat waits for an approval or an answer, or finished and is not seen. */
  const waiting = (session: Session) =>
    waitsForUser(activity[activityKey(session.agent, session.id)]) ||
    finished.some((item) => item.agent === session.agent && item.id === session.id);
  const listKey = storageKey ?? sessions[0]?.projectId;
  const repositoryKey = listKey ? sessionViewKey(listKey) : undefined;
  const [loadedKey, setLoadedKey] = useState(repositoryKey);
  const [view, setView] = useState(() => readView(repositoryKey));
  // Load the saved view again when the user goes to a different repository.
  if (loadedKey !== repositoryKey) {
    setLoadedKey(repositoryKey);
    setView(readView(repositoryKey));
  }
  const { agent, scope, collection, project, task } = view;
  useEffect(() => {
    if (!loadedKey) return;
    try {
      localStorage.setItem(loadedKey, JSON.stringify(view));
    } catch {
      // Storage is not available. The view stays for this window only.
    }
  }, [loadedKey, view]);
  useEffect(() => {
    const onView = (event: Event) => {
      if ((event as CustomEvent<{ key?: string }>).detail?.key === listKey)
        setView((previous) => ({ ...previous, scope: 'archived' }));
    };
    window.addEventListener('kalkidan-view-archived', onView);
    return () => window.removeEventListener('kalkidan-view-archived', onView);
  }, [listKey]);
  const setAgent = (value: string) => setView((previous) => ({ ...previous, agent: value }));
  const setScope = (value: string) => setView((previous) => ({ ...previous, scope: value }));
  const setCollection = (value: string) =>
    setView((previous) => ({ ...previous, collection: value }));
  const setProject = (value: string) => setView((previous) => ({ ...previous, project: value }));
  const setTask = (value: string) => setView((previous) => ({ ...previous, task: value }));
  const linkedCount = taskOf ? sessions.filter((s) => !!taskOf(s)).length : 0;
  const waitingCount = sessions.filter((s) => !s.organization?.archived && waiting(s)).length;
  const [editing, setEditing] = useState<Session | null>(null);
  const [renaming, setRenaming] = useState<Session | null>(null);
  const [draft, setDraft] = useState<SessionOrganization>({});
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const collections = [
    ...new Set(sessions.map((s) => s.organization?.collection).filter((c): c is string => !!c)),
  ].sort();
  const projects = placeOf
    ? [
        ...new Set(
          sessions.map((s) => placeOf(s)?.project).filter((name): name is string => !!name),
        ),
      ].sort()
    : [];
  const agents = new Set(sessions.map((s) => s.agent));
  const archivedCount = sessions.filter((s) => s.organization?.archived).length;
  // A short list from one agent needs no filters. A saved filter keeps them visible.
  const showFilters =
    !compact &&
    (sessions.length >= filterThreshold ||
      agents.size > 1 ||
      projects.length > 1 ||
      linkedCount > 0 ||
      waitingCount > 0 ||
      scope !== 'active' ||
      agent !== 'all' ||
      collection !== 'all' ||
      project !== 'all' ||
      task !== 'all');
  const list = sessions
    .filter((session) => {
      const org = session.organization || {};
      return (
        (compact
          ? !org.archived
          : (agent === 'all' || session.agent === agent) &&
            (scope === 'archived'
              ? org.archived
              : !org.archived &&
                (scope !== 'pinned' || org.pinned) &&
                (scope !== 'waiting' || waiting(session))) &&
            (collection === 'all' || org.collection === collection) &&
            (project === 'all' || placeOf?.(session)?.project === project) &&
            (task === 'all' || (task === 'linked') === !!taskOf?.(session))) &&
        `${org.title || session.title} ${session.title} ${session.cwd} ${session.agent} ${org.notes || ''} ${org.collection || ''} ${taskOf?.(session)?.number ? '#' + taskOf(session)!.number : ''} ${taskOf?.(session)?.title || ''}`
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
  async function togglePin(session: Session) {
    const org = session.organization || {};
    if (await onUpdate(session, { ...org, pinned: !org.pinned }))
      showToast(org.pinned ? 'Chat unpinned.' : 'Chat pinned. It shows at the top of the sidebar.');
  }
  return (
    <>
      {showFilters && (
        <div className="session-filters">
          <SegmentedControl
            label="Chat view"
            value={scope}
            onChange={setScope}
            options={[
              { value: 'active', label: 'Active' },
              {
                value: 'waiting',
                label: waitingCount ? `Waiting for you (${waitingCount})` : 'Waiting for you',
              },
              { value: 'pinned', label: 'Pinned' },
              { value: 'archived', label: 'Archived' },
            ]}
          />
          {(agents.size > 1 || agent !== 'all') && (
            <Choice
              label="Filter by agent"
              size="sm"
              className="min-w-32"
              value={agent}
              onChange={setAgent}
              options={[
                { value: 'all', label: 'All agents' },
                ...agentCatalog.map((item) => ({ value: item.id, label: item.name })),
              ]}
            />
          )}
          {(projects.length > 1 || project !== 'all') && (
            <Choice
              label="Filter by project"
              size="sm"
              className="min-w-32"
              value={project}
              onChange={setProject}
              options={[
                { value: 'all', label: 'All projects' },
                ...projects.map((name) => ({ value: name, label: name })),
              ]}
            />
          )}
          {(linkedCount > 0 || task !== 'all') && (
            <Choice
              label="Filter by task"
              size="sm"
              className="min-w-32"
              value={task}
              onChange={setTask}
              options={[
                { value: 'all', label: 'All chats' },
                { value: 'linked', label: 'Linked to a task' },
                { value: 'unlinked', label: 'No task' },
              ]}
            />
          )}
          {(collections.length > 0 || collection !== 'all') && (
            <Choice
              label="Filter by group"
              size="sm"
              className="min-w-32"
              value={collection}
              onChange={setCollection}
              options={[
                { value: 'all', label: 'All groups' },
                ...collections.map((c) => ({ value: c, label: c })),
              ]}
            />
          )}
        </div>
      )}
      {shown.length ? (
        <div className="session-list">
          {shown.map((session) => {
            const org = session.organization || {};
            const title = org.title || session.title;
            const branch = branchOf?.(session);
            const linked = taskOf?.(session);
            const place = placeOf?.(session);
            const where = place ? [place.project, place.folder].filter(Boolean).join(' › ') : '';
            return (
              <div className="list-row" key={session.agent + session.id}>
                <EntityIcon>
                  <AgentIcon agent={session.agent} />
                </EntityIcon>
                <div className="min-w-0 flex-1">
                  <Button
                    variant="bare"
                    className="session-title max-w-full justify-start gap-1.5 text-left font-medium"
                    title={title}
                    disabled={busy}
                    aria-label={`Resume ${title}`}
                    onClick={() => onResume(session)}
                  >
                    {org.pinned && <Pin className="size-3" aria-hidden="true" />}
                    <span>{title}</span>
                    {linked?.number && (
                      <span className="session-task-number" title={`Task: ${linked.title}`}>
                        #{linked.number}
                      </span>
                    )}
                    <ActivityDot state={activity[activityKey(session.agent, session.id)]} />
                  </Button>
                  <div className="session-meta">
                    {agentLabel(session.agent)} ·{' '}
                    <time dateTime={session.updatedAt} title={fullTime(session.updatedAt)}>
                      {relativeTime(session.updatedAt)}
                    </time>
                    {where && ` · ${where}`}
                    {branch && (
                      <span className="session-branch" title={`Branch copy: ${branch}`}>
                        {' · '}
                        <GitBranch className="size-3" aria-hidden="true" />
                        <span className="sr-only">Branch </span>
                        {branch}
                      </span>
                    )}
                    {org.collection && ` · ${org.collection}`}
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
                  <ActionMenu
                    size="xs"
                    disabled={busy}
                    label={`${title} actions`}
                    items={[
                      { label: 'Open', action: () => onResume(session) },
                      ...(linked && onOpenTask
                        ? [
                            {
                              label: linked.number ? `Open task #${linked.number}` : 'Open task',
                              action: () => onOpenTask(session, linked),
                            },
                          ]
                        : []),
                      { label: 'Rename…', action: () => setRenaming(session) },
                      {
                        label: org.pinned ? 'Unpin' : 'Pin',
                        action: () => void togglePin(session),
                      },
                      {
                        label: 'Chat details…',
                        action: () => {
                          setSaveError('');
                          setEditing(session);
                          setDraft({ ...org });
                        },
                      },
                      org.archived
                        ? {
                            label: 'Restore',
                            separator: true,
                            action: () => void onUpdate(session, { ...org, archived: false }),
                          }
                        : {
                            label: 'Archive',
                            separator: true,
                            action: () =>
                              void archiveSessionWithUndo(session, {
                                api,
                                onChange: onChanged,
                                onViewArchived: listKey
                                  ? () => viewArchivedSessions(listKey)
                                  : undefined,
                              }).catch((e) =>
                                showToast({
                                  message: 'Could not archive the chat: ' + errorMessage(e),
                                  tone: 'error',
                                }),
                              ),
                          },
                    ]}
                  />
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
              ? 'No archived chats'
              : scope === 'pinned' && !compact
                ? 'No pinned chats'
                : scope === 'waiting' && !compact
                  ? 'Nothing waits for you'
                  : sessions.length
                    ? 'No chats found'
                    : 'No chats yet'
          }
        >
          {scope === 'waiting' && !compact
            ? 'Chats that ask for an approval or an answer, and finished runs, show here.'
            : sessions.length
              ? 'Try a different search or filter. Use ⋯ on a chat to pin, group, or archive it.'
              : placeOf
                ? 'No agent chats yet. Open a code folder, then start a chat.'
                : `No agent chats in this folder yet. Select ${newSessionLabel} above.`}
        </EmptyState>
      )}
      {!showFilters && !compact && archivedCount > 0 && (
        <Button
          variant="link"
          size="sm"
          className="session-archived-link"
          onClick={() => setScope('archived')}
        >
          View archived ({plural(archivedCount, 'chat')})
        </Button>
      )}
      <RenameSessionDialog
        api={api}
        onRenamed={() => onChanged?.()}
        session={renaming}
        open={!!renaming}
        onOpenChange={(open) => !open && setRenaming(null)}
      />
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open && !saving) setEditing(null);
        }}
      >
        <DialogContent size="md">
          <DialogHeader>
            <DialogTitle>Chat details</DialogTitle>
            <DialogDescription>
              Kalkidan keeps these details. The agent chat does not change.
            </DialogDescription>
          </DialogHeader>
          <label className="form-label">
            Group
            <span className="form-help">
              Put related chats in one group, for example one group for each feature. Then filter
              the list by group.
            </span>
            <Input
              maxLength={160}
              placeholder="e.g. Website redesign"
              value={draft.collection || ''}
              onChange={(e) => setDraft({ ...draft, collection: e.target.value })}
            />
          </label>
          <label className="form-label">
            Notes
            <Textarea
              rows={3}
              maxLength={20000}
              placeholder="Where you stopped, next steps…"
              value={draft.notes || ''}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            />
          </label>
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
                      'Could not save the chat details. Make sure that the chat is available, then try again.',
                    );
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? 'Saving…' : 'Save details'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
