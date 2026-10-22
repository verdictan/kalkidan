import { useEffect, useMemo, useRef, useState } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Brain, FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';
import { EmptyState } from './ui/empty-state';
import { Input } from './ui/input';
import { MoreButton } from './ui/more-button';
import { SearchInput } from './ui/search-input';
import { Textarea } from './ui/textarea';
import { showToast } from './ui/toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Hint } from './hint';
import { ConfirmDialog } from './confirm-dialog';
import type { API, ProjectGroup, Session } from '../types';
import type {
  MemoryEntry,
  MemoryExtraction,
  MemoryWriteResult,
  ProjectMemory,
} from '../domain/memory';
import { useProjectResource } from '../hooks/use-project-resource';
import { errorMessage } from '../lib/errors';
import { plural } from '../lib/platform';
import { fullTime, relativeTime } from '../lib/relative-time';
import { managedSteps, memoryEmptyAction, type ManagedSteps } from '../lib/verdictan-labels';
import { managedAgentsChangedEvent } from './verdictan-settings';

type MemoryPage = ProjectMemory['pages'][number];

/** The text of a new or changed memory entry. */
export interface MemoryEntryInput {
  /** The entry to change. Undefined for a new entry. */
  id?: string;
  /** The revision that the user changed. The save stops when the entry changed meanwhile. */
  expectedRevision?: string;
  topic: string;
  content: string;
}

/** What the page shows after a save: a toast, a message at the form, or a page error. */
export function memorySaveOutcome(
  result: MemoryWriteResult,
):
  | { kind: 'saved'; topic: string }
  | { kind: 'duplicate' }
  | { kind: 'conflict' }
  | { kind: 'deferred'; reason: string } {
  if (result.status === 'conflict') return { kind: 'conflict' };
  if (result.status === 'deferred') return { kind: 'deferred', reason: result.reason };
  if (result.status === 'duplicate') return { kind: 'duplicate' };
  return { kind: 'saved', topic: memoryTopicName(result.entry) };
}

/** True when the topic or the text of a memory page contains each word of the search. */
export function memoryMatches(
  page: { topic?: string; name?: string; content: string },
  query: string,
) {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const text = `${memoryTopicName(page)} ${page.content}`.toLowerCase();
  return words.every((word) => text.includes(word));
}

/** The topic name of a memory page, with a capital first letter. */
export function memoryTopicName(page: { topic?: string; name?: string }) {
  const text = (page.topic || (page.name || '').replace(/\.md$/, '').replace(/[-_]/g, ' ')).trim();
  return text ? text[0].toLocaleUpperCase() + text.slice(1) : 'Untitled topic';
}

/** Removes a first level-one heading that only repeats the topic. */
export function withoutRepeatedTitle(content: string, topic: string) {
  const match = /^\s*#\s+(.+?)\s*#*\s*(?:\n|$)/.exec(content);
  if (!match) return content;
  const plain = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');
  return plain(match[1]) === plain(topic) ? content.slice(match[0].length).trimStart() : content;
}

/** Finds the entry of a memory page: the same topic and text, else the same topic. */
export function entryForPage(page: MemoryPage, entries: MemoryEntry[] | undefined) {
  if (!entries?.length) return undefined;
  const topic = (page.topic || page.name.replace(/\.md$/, '')).trim().toLowerCase();
  const same = entries.filter((entry) => entry.topic.trim().toLowerCase() === topic);
  return same.find((entry) => entry.content === page.content) || same[0];
}

/** The last memory update in plain words, without the chat title. */
export function extractionText(extraction: MemoryExtraction) {
  switch (extraction.status) {
    case 'queued':
      return 'Waiting to save memory';
    case 'extracting':
      return 'Reading the chat';
    case 'validating':
      return 'Checking the new entries';
    case 'saved':
      return extraction.saved
        ? `Saved ${plural(extraction.saved, 'entry', 'entries')}`
        : 'Nothing new to save';
    case 'skipped':
      return 'Nothing new to save';
    case 'failed':
      return 'Could not save memory';
  }
}

/**
 * Reads the managed agent steps: runtime, sign-in and agent setup. Undefined while the check
 * runs, after a failed check, and when the app cannot check managed agents.
 */
function useManagedSteps(api: API) {
  const [steps, setSteps] = useState<ManagedSteps>();
  useEffect(() => {
    if (typeof api.verdictanStatus !== 'function') return;
    let live = true;
    const read = async () => {
      try {
        const status = await api.verdictanStatus();
        const [setup, runtime] = await Promise.all([
          status.phase === 'authenticated' && typeof api.verdictanSetup === 'function'
            ? api.verdictanSetup().catch(() => undefined)
            : undefined,
          // The installer status is the real runtime state. Without it, the account is a fallback.
          typeof api.runtimeUpdateStatus === 'function'
            ? api.runtimeUpdateStatus('local').catch(() => undefined)
            : undefined,
        ]);
        if (live) setSteps(managedSteps(status, setup, runtime));
      } catch {
        if (live) setSteps(undefined);
      }
    };
    void read();
    window.addEventListener(managedAgentsChangedEvent, read);
    const unsubscribe = api.onVerdictanChanged?.(() => void read());
    return () => {
      live = false;
      window.removeEventListener(managedAgentsChangedEvent, read);
      unsubscribe?.();
    };
  }, [api]);
  return steps;
}

const openSession = (session: Session) =>
  window.dispatchEvent(
    new CustomEvent('kalkidan-open-session', { detail: { agent: session.agent, id: session.id } }),
  );

function SessionLink({ session }: { session: Session }) {
  return (
    <button
      type="button"
      className="text-link max-w-full truncate"
      title={session.title}
      onClick={() => openSession(session)}
    >
      {session.title || 'Untitled chat'}
    </button>
  );
}

export function ProjectMemoryPanel({
  api,
  group,
  sessions: sessionsProp,
  initialTopic,
}: {
  api: API;
  group: ProjectGroup;
  /** The chats of the app. They give the titles of the source chats. */
  sessions?: Session[];
  /** Opens this topic, for example from a search result or another page. */
  initialTopic?: string;
}) {
  const { state, refresh } = useProjectResource(api, group, 'memory', () =>
    api.memoryList(group.id),
  );
  const memory = state.value;
  const error = state.error || '';
  const [selected, setSelected] = useState(initialTopic || '');
  const [entries, setEntries] = useState<MemoryEntry[]>();
  const [loadedSessions, setLoadedSessions] = useState<Session[]>();
  const [forgetting, setForgetting] = useState<MemoryEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const [query, setQuery] = useState('');
  // The entry form: a new entry, or a change to the shown entry.
  const [editing, setEditing] = useState<MemoryEntryInput | null>(null);
  // A message at the entry form, for example for an entry that memory has already.
  const [formError, setFormError] = useState('');
  const sessions = sessionsProp || loadedSessions;
  const topicList = useRef<HTMLElement>(null);
  const emptyAction = memoryEmptyAction(useManagedSteps(api));

  // Entries give the source chat and the revision. Older desktop apps do not have them.
  useEffect(() => {
    if (!memory || typeof api.memoryEntries !== 'function') return;
    let live = true;
    api
      .memoryEntries(group.id)
      .then((value) => live && setEntries(value))
      .catch(() => live && setEntries(undefined));
    return () => {
      live = false;
    };
  }, [api, group.id, memory]);
  // Without the chats from the app, read them once to show the source chat titles.
  useEffect(() => {
    if (sessionsProp || loadedSessions || !entries?.some((entry) => entry.source.sessionId)) return;
    let live = true;
    api
      .snapshot()
      .then((snapshot) => live && setLoadedSessions(snapshot.sessions))
      .catch(() => live && setLoadedSessions([]));
    return () => {
      live = false;
    };
  }, [api, sessionsProp, loadedSessions, entries]);
  // Other pages can open a topic of this project.
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<{ groupId?: string; page?: string; topic?: string }>)
        .detail;
      if (detail?.groupId === group.id && detail.page === 'memory' && detail.topic)
        setSelected(detail.topic);
    };
    window.addEventListener('kalkidan-open-project-page', open);
    return () => window.removeEventListener('kalkidan-open-project-page', open);
  }, [group.id]);
  useEffect(() => {
    if (initialTopic) setSelected(initialTopic);
  }, [initialTopic]);

  const pages = memory?.pages || [];
  const matches = (page: MemoryPage, key: string) => {
    const value = key.trim().toLowerCase();
    return (
      page.name === key ||
      page.topic?.trim().toLowerCase() === value ||
      memoryTopicName(page).toLowerCase() === value
    );
  };
  const visible = query.trim() ? pages.filter((item) => memoryMatches(item, query)) : pages;
  const page = visible.find((item) => matches(item, selected)) || visible[0];
  const entry = page && entryForPage(page, entries);
  const sessionOf = (id?: string) => (id ? sessions?.find((s) => s.id === id) : undefined);
  const source = sessionOf(entry?.source.sessionId);
  const extraction = memory?.extraction;
  const extractionSession = useMemo(
    () =>
      extraction &&
      sessionOf(
        entries?.find((item) => item.source.turnId === extraction.turnId)?.source.sessionId,
      ),
    [extraction, entries, sessions],
  );

  async function saveEntry(value: MemoryEntryInput) {
    setBusy(true);
    setActionError('');
    setFormError('');
    try {
      const outcome = memorySaveOutcome(
        await api.memorySave(group.id, {
          ...value,
          topic: value.topic.trim(),
          content: value.content.trim(),
        }),
      );
      if (outcome.kind === 'saved') {
        setEditing(null);
        setSelected(value.topic.trim());
        showToast({ message: `Memory entry “${outcome.topic}” saved.` });
        await refresh();
      } else if (outcome.kind === 'duplicate') {
        setFormError('Memory has this entry already. Change the text, or select Cancel.');
      } else if (outcome.kind === 'conflict') {
        setEditing(null);
        setActionError('This entry changed. Load it again.');
        await refresh();
      } else setFormError(outcome.reason);
    } catch (failure) {
      setFormError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function promote(target: MemoryPage) {
    setBusy(true);
    setActionError('');
    try {
      const title = memoryTopicName(target);
      const doc = await api.docsCreate(group.id, title, null);
      await api.docsSave(group.id, {
        ...doc,
        markdown: withoutRepeatedTitle(target.content, title),
      });
      showToast({
        message: `Doc page “${title}” added.`,
        actions: [
          {
            label: 'Open',
            onClick: () =>
              window.dispatchEvent(
                new CustomEvent('kalkidan-open-project-page', {
                  detail: { groupId: group.id, page: 'docs', docId: doc.id },
                }),
              ),
          },
        ],
      });
    } catch (failure) {
      setActionError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  async function forget(target: MemoryEntry) {
    setBusy(true);
    setActionError('');
    try {
      await api.memoryForget(group.id, target.id, target.revision);
      setForgetting(null);
      setEntries((current) => current?.filter((item) => item.id !== target.id));
      showToast({ message: `Memory entry “${memoryTopicName(target)}” removed.` });
      await refresh();
      topicList.current?.querySelector<HTMLElement>('button')?.focus();
    } catch (failure) {
      setForgetting(null);
      setActionError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  const entryForm = editing && (
    <form
      className="memory-form"
      aria-label={editing.id ? 'Edit memory entry' : 'New memory entry'}
      onSubmit={(event) => {
        event.preventDefault();
        if (editing.topic.trim() && editing.content.trim()) void saveEntry(editing);
      }}
    >
      <label className="form-label">
        Topic
        <Input
          autoFocus={!editing.id}
          maxLength={120}
          placeholder="For example: Testing"
          value={editing.topic}
          disabled={busy}
          onChange={(event) => {
            setFormError('');
            setEditing({ ...editing, topic: event.target.value });
          }}
        />
      </label>
      <label className="form-label">
        Text
        <Textarea
          autoFocus={!!editing.id}
          rows={8}
          maxLength={16000}
          placeholder="A fact that agents must know, for example: Run npm test before a pull request."
          value={editing.content}
          disabled={busy}
          onChange={(event) => {
            setFormError('');
            setEditing({ ...editing, content: event.target.value });
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              setEditing(null);
            }
          }}
        />
        <span className="form-help">Agents read this text at the start of each chat.</span>
      </label>
      {formError && (
        <p role="alert" className="field-error">
          {formError}
        </p>
      )}
      <div className="memory-form-actions">
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={busy}
          onClick={() => setEditing(null)}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={busy || !editing.topic.trim() || !editing.content.trim()}
        >
          {editing.id ? 'Save entry' : 'Add entry'}
        </Button>
      </div>
    </form>
  );

  return (
    <section className="page project-memory" aria-label="Project memory">
      <div className="memory-toolbar">
        <p className="memory-intro">
          Facts that agents learned about this project. Agents read them at the start of each chat.
        </p>
        <div className="memory-toolbar-actions">
          {pages.length > 0 && (
            <SearchInput
              size="sm"
              className="w-56"
              aria-label="Search memory"
              placeholder="Search memory"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          )}
          <Button
            size="sm"
            disabled={busy}
            onClick={() => {
              setActionError('');
              setFormError('');
              setEditing({ topic: '', content: '' });
            }}
          >
            <Plus /> Add entry
          </Button>
        </div>
      </div>
      {extraction?.status === 'failed' && extraction.error && (
        <Alert variant="destructive" size="sm" className="mb-4">
          <AlertDescription>{extraction.error}</AlertDescription>
        </Alert>
      )}
      {(error || actionError) && (
        <Alert variant="destructive" size="sm" className="mb-4">
          <AlertDescription>{actionError || error}</AlertDescription>
        </Alert>
      )}
      {!memory && !error && <EmptyState compact>Loading memory…</EmptyState>}
      {memory && !pages.length && !editing && (
        <EmptyState
          icon={<Brain />}
          title="No memory yet"
          action={
            emptyAction === 'start-chat' ? (
              <Button
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent('kalkidan-new-session', { detail: { groupId: group.id } }),
                  )
                }
              >
                Start a chat
              </Button>
            ) : emptyAction === 'set-up' ? (
              <Button
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent('kalkidan-open-settings', {
                      detail: { section: 'account' },
                    }),
                  )
                }
              >
                Set up managed agents
              </Button>
            ) : undefined
          }
        >
          Managed agents save what they learn after verified work.
          {emptyAction === 'start-chat' && ' Start a chat in this project to add memory.'}
          {emptyAction === 'set-up' && ' Set up managed agents first.'}
        </EmptyState>
      )}
      {memory && !pages.length && editing && <div className="memory-entry">{entryForm}</div>}
      {pages.length > 0 && (
        <div className="memory-layout">
          <nav ref={topicList} className="memory-topics" aria-label="Memory topics">
            <h2 className="sidebar-label memory-topics-label">
              Topics
              <span className="memory-topics-count" aria-label={`${visible.length} topics`}>
                {visible.length}
              </span>
            </h2>
            {visible.length ? (
              <ul>
                {visible.map((item) => (
                  <li key={item.name}>
                    <button
                      type="button"
                      className="wiki-tree-row row-focus memory-topic"
                      data-selected={!editing?.id && editing ? false : item.name === page?.name}
                      aria-current={item.name === page?.name ? 'page' : undefined}
                      title={memoryTopicName(item)}
                      onClick={() => {
                        setEditing(null);
                        setSelected(item.name);
                      }}
                    >
                      <span className="truncate">{memoryTopicName(item)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="memory-topics-empty">No topics match your search.</p>
            )}
            {extraction && (
              <p className="memory-status" role="status">
                Last update: {extractionText(extraction).toLowerCase()}
                {extractionSession && (
                  <>
                    {' from '}
                    <SessionLink session={extractionSession} />
                  </>
                )}{' '}
                <span title={fullTime(extraction.updatedAt)}>
                  {relativeTime(extraction.updatedAt)}
                </span>
              </p>
            )}
          </nav>
          {editing && !editing.id ? (
            <section className="memory-entry" aria-labelledby="memory-new-title">
              <h2 id="memory-new-title" className="memory-entry-title mb-4">
                New entry
              </h2>
              {entryForm}
            </section>
          ) : page ? (
            <article className="memory-entry" aria-labelledby="memory-entry-title">
              <div className="memory-entry-header">
                <div className="min-w-0">
                  <h2 id="memory-entry-title" className="memory-entry-title">
                    {memoryTopicName(page)}
                  </h2>
                  <p className="memory-entry-meta">
                    <span title={fullTime(entry?.updatedAt || page.updatedAt)}>
                      Updated {relativeTime(entry?.updatedAt || page.updatedAt)}
                    </span>
                    {entry?.provenance === 'user' ? (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>Added by you</span>
                      </>
                    ) : (
                      source && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="flex min-w-0 items-center gap-1">
                            Source: <SessionLink session={source} />
                          </span>
                        </>
                      )
                    )}
                    {entry?.provenance === 'external' && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>Changed outside Kalkidan</span>
                      </>
                    )}
                  </p>
                </div>
                {!editing && (
                  <div className="flex shrink-0 items-center justify-end gap-1">
                    {entry && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() => {
                          setActionError('');
                          setFormError('');
                          setEditing({
                            id: entry.id,
                            expectedRevision: entry.revision,
                            topic: entry.topic,
                            content: entry.content,
                          });
                        }}
                      >
                        <Pencil /> Edit
                      </Button>
                    )}
                    <DropdownMenu>
                      <Hint label="Entry actions">
                        <DropdownMenuTrigger asChild>
                          <MoreButton label="Entry actions" disabled={busy} />
                        </DropdownMenuTrigger>
                      </Hint>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => void promote(page)}>
                          <FileText className="size-4" aria-hidden="true" />
                          Promote to Docs page
                        </DropdownMenuItem>
                        {entry && (
                          <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() => setForgetting(entry)}
                            >
                              <Trash2 className="size-4" aria-hidden="true" />
                              Remove…
                            </DropdownMenuItem>
                          </>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                )}
              </div>
              {editing ? (
                entryForm
              ) : (
                <>
                  <div className="prose-ui" data-size="sm">
                    <Markdown skipHtml remarkPlugins={[remarkGfm]}>
                      {withoutRepeatedTitle(page.content, memoryTopicName(page))}
                    </Markdown>
                  </div>
                  {page.truncated && (
                    <p className="form-help mt-4">This preview shows only the first 64 KB.</p>
                  )}
                </>
              )}
            </article>
          ) : null}
        </div>
      )}
      {memory?.limited && (
        <Alert role={undefined} size="sm" className="mt-6">
          <AlertDescription>
            Some files do not show here. They stay in the memory folder of the project.
          </AlertDescription>
        </Alert>
      )}
      <ConfirmDialog
        open={!!forgetting}
        title={`Remove “${forgetting ? memoryTopicName(forgetting) : ''}”?`}
        description="Agents stop using this entry. You cannot undo this."
        confirmLabel="Remove entry"
        destructive
        busy={busy}
        onConfirm={() => forgetting && void forget(forgetting)}
        onCancel={() => setForgetting(null)}
      />
    </section>
  );
}
