import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Brain, FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { Alert, AlertDescription } from './ui/alert';
import { EmptyState } from './ui/empty-state';
import { Input } from './ui/input';
import { MoreButton } from './ui/more-button';
import { Textarea } from './ui/textarea';
import { showToast } from './ui/toast';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from './ui/select';
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

/** The text of a new or changed memory fact. */
export interface MemoryEntryInput {
  /** The fact to change. Undefined for a new fact. */
  id?: string;
  /** The revision that the user changed. The save stops when the fact changed meanwhile. */
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
      return 'Checking the new facts';
    case 'saved':
      return extraction.saved ? `Saved ${plural(extraction.saved, 'fact')}` : 'Nothing new to save';
    case 'skipped':
      return 'Nothing new to save';
    case 'failed':
      return 'Could not save memory';
  }
}

/** One fact of project memory. `entry` is missing for an older desktop app. */
export interface MemoryFact {
  id: string;
  topic: string;
  content: string;
  updatedAt: string;
  truncated?: boolean;
  entry?: MemoryEntry;
}

/**
 * The facts of project memory, sorted by topic and then by the newest change. The entries give
 * the facts. Without entries (an older desktop app), each memory page is one fact.
 */
export function memoryFacts(memory: ProjectMemory | undefined, entries: MemoryEntry[] | undefined) {
  const facts: MemoryFact[] = entries?.length
    ? entries.map((entry) => ({
        id: entry.id,
        topic: memoryTopicName(entry),
        content: entry.content,
        updatedAt: entry.updatedAt,
        entry,
      }))
    : (memory?.pages || []).map((page) => ({
        id: page.name,
        topic: memoryTopicName(page),
        content: withoutRepeatedTitle(page.content, memoryTopicName(page)),
        updatedAt: page.updatedAt,
        truncated: page.truncated,
      }));
  return facts.sort(
    (a, b) => a.topic.localeCompare(b.topic) || b.updatedAt.localeCompare(a.updatedAt),
  );
}

/** The facts grouped by topic, in topic order. */
export function factTopics(facts: MemoryFact[]) {
  const topics = new Map<string, MemoryFact[]>();
  for (const fact of facts) topics.set(fact.topic, [...(topics.get(fact.topic) || []), fact]);
  return [...topics].map(([topic, items]) => ({ topic, facts: items }));
}

/** The DOM ID of a memory topic heading. The Knowledge rail scrolls to it. */
export const topicAnchor = (topic: string) =>
  'memory-topic-' + topic.toLowerCase().replace(/[^a-z0-9]+/g, '-');

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

/**
 * The memory facts and entries of a project. The Knowledge rail and the Memory pane share the
 * memory resource, so both show the same facts.
 */
export function useMemoryFacts(api: API, group: ProjectGroup) {
  const resource = useProjectResource(api, group, 'memory', () => api.memoryList(group.id));
  const memory = resource.state.value;
  const [entries, setEntries] = useState<MemoryEntry[]>();
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
  const facts = useMemo(() => memoryFacts(memory, entries), [memory, entries]);
  return { resource, memory, entries, setEntries, facts };
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

const newTopic = '__new-topic';

/** The topic field: the existing topics, and "New topic…" for a new one. */
function TopicField({
  topics,
  value,
  disabled,
  autoFocus,
  onChange,
}: {
  topics: string[];
  value: string;
  disabled: boolean;
  autoFocus: boolean;
  onChange: (value: string) => void;
}) {
  const known = topics.some((topic) => topic.toLowerCase() === value.trim().toLowerCase());
  const [typing, setTyping] = useState(!topics.length || (!!value && !known));
  if (typing)
    return (
      <Input
        aria-label="Topic"
        autoFocus={autoFocus || topics.length > 0}
        maxLength={120}
        placeholder="New topic"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  return (
    <Select
      value={known ? topics.find((t) => t.toLowerCase() === value.trim().toLowerCase()) : ''}
      onValueChange={(next) => {
        if (next === newTopic) {
          setTyping(true);
          onChange('');
        } else onChange(next);
      }}
      disabled={disabled}
    >
      <SelectTrigger aria-label="Topic" className="w-full" autoFocus={autoFocus}>
        <SelectValue placeholder="Choose a topic" />
      </SelectTrigger>
      <SelectContent>
        {topics.map((topic) => (
          <SelectItem key={topic} value={topic}>
            {topic}
          </SelectItem>
        ))}
        <SelectSeparator />
        <SelectItem value={newTopic}>New topic…</SelectItem>
      </SelectContent>
    </Select>
  );
}

/**
 * The Memory pane of the Knowledge tab: all facts in one list, grouped by topic. Each fact shows
 * its source, its age and how many chats read it.
 */
export function ProjectMemoryPanel({
  api,
  group,
  sessions: sessionsProp,
  initialTopic,
  focus,
  addSerial = 0,
  readCounts,
  switcher,
}: {
  api: API;
  group: ProjectGroup;
  /** The chats of the app. They give the titles of the source chats. */
  sessions?: Session[];
  /** Scrolls to this topic, for example from a search result or another page. */
  initialTopic?: string;
  /** Scrolls to this fact and highlights it. The serial repeats a request. */
  focus?: { id: string; serial: number };
  /** A new value opens the form for a new fact. */
  addSerial?: number;
  /** The number of chats that read each fact. */
  readCounts?: Record<string, number>;
  /** The Knowledge switcher for a narrow window. */
  switcher?: ReactNode;
}) {
  const { resource, memory, entries, setEntries, facts } = useMemoryFacts(api, group);
  const { state, refresh } = resource;
  const error = state.error || '';
  const [loadedSessions, setLoadedSessions] = useState<Session[]>();
  const [forgetting, setForgetting] = useState<MemoryEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  // The fact form: a new fact, or a change to one fact.
  const [editing, setEditing] = useState<MemoryEntryInput | null>(null);
  // A message at the fact form, for example for a fact that memory has already.
  const [formError, setFormError] = useState('');
  const [highlight, setHighlight] = useState('');
  const sessions = sessionsProp || loadedSessions;
  const list = useRef<HTMLDivElement>(null);
  const emptyAction = memoryEmptyAction(useManagedSteps(api));
  const topics = useMemo(() => factTopics(facts), [facts]);
  const topicNames = topics.map((item) => item.topic);

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
  useEffect(() => {
    if (addSerial) startAdd();
  }, [addSerial]);
  // Scroll to the requested topic or fact when the facts show.
  useEffect(() => {
    if (!initialTopic || !facts.length) return;
    const topic = topicNames.find((name) => name.toLowerCase() === initialTopic.toLowerCase());
    document.getElementById(topicAnchor(topic || initialTopic))?.scrollIntoView({ block: 'start' });
  }, [initialTopic, facts.length > 0]);
  useEffect(() => {
    if (!focus || !facts.length) return;
    setHighlight(focus.id);
    list.current
      ?.querySelector<HTMLElement>(`[data-fact="${CSS.escape(focus.id)}"]`)
      ?.scrollIntoView({ block: 'center' });
    const timer = setTimeout(() => setHighlight(''), 2000);
    return () => clearTimeout(timer);
  }, [focus?.serial, facts.length > 0]);

  const sessionOf = (id?: string) => (id ? sessions?.find((s) => s.id === id) : undefined);
  const extraction = memory?.extraction;
  const extractionSession =
    extraction &&
    sessionOf(entries?.find((item) => item.source.turnId === extraction.turnId)?.source.sessionId);

  function startAdd() {
    setActionError('');
    setFormError('');
    setEditing({ topic: initialTopic || '', content: '' });
  }
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
        showToast({ message: value.id ? 'Fact saved.' : 'Fact added.' });
        await refresh();
      } else if (outcome.kind === 'duplicate') {
        setFormError('Memory has this fact already.');
      } else if (outcome.kind === 'conflict') {
        setEditing(null);
        setActionError('This fact changed. Load it again.');
        await refresh();
      } else setFormError(outcome.reason);
    } catch (failure) {
      setFormError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  async function promote(fact: MemoryFact) {
    setBusy(true);
    setActionError('');
    try {
      const doc = await api.docsCreate(group.id, fact.topic, null);
      await api.docsSave(group.id, { ...doc, markdown: fact.content });
      showToast({
        message: `Page “${fact.topic}” added.`,
        actions: [
          {
            label: 'Open',
            onClick: () =>
              window.dispatchEvent(
                new CustomEvent('kalkidan-open-project-page', {
                  detail: { groupId: group.id, page: 'knowledge', section: 'pages', docId: doc.id },
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
      showToast({ message: 'Fact removed.' });
      await refresh();
    } catch (failure) {
      setForgetting(null);
      setActionError(errorMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  const form = (value: MemoryEntryInput) => (
    <form
      className="memory-form"
      aria-label={value.id ? 'Edit fact' : 'New fact'}
      onSubmit={(event) => {
        event.preventDefault();
        if (value.topic.trim() && value.content.trim()) void saveEntry(value);
      }}
    >
      {!value.id && (
        <label className="form-label">
          Topic
          <TopicField
            topics={topicNames}
            value={value.topic}
            disabled={busy}
            autoFocus={false}
            onChange={(topic) => {
              setFormError('');
              setEditing({ ...value, topic });
            }}
          />
        </label>
      )}
      <Textarea
        aria-label="Fact"
        autoFocus={!!value.id || !!value.topic}
        rows={value.id ? 4 : 3}
        maxLength={16000}
        placeholder="For example: Run npm test before a pull request."
        value={value.content}
        disabled={busy}
        onChange={(event) => {
          setFormError('');
          setEditing({ ...value, content: event.target.value });
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            setEditing(null);
          }
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
      />
      {formError && (
        <p role="alert" className="field-error">
          {formError}
        </p>
      )}
      <div className="memory-form-actions">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => setEditing(null)}
        >
          Cancel
        </Button>
        <Button
          type="submit"
          size="sm"
          disabled={busy || !value.topic.trim() || !value.content.trim()}
        >
          {value.id ? 'Save fact' : 'Add fact'}
        </Button>
      </div>
    </form>
  );

  function factMeta(fact: MemoryFact) {
    const entry = fact.entry;
    const source = sessionOf(entry?.source.sessionId);
    const reads = readCounts?.[fact.id] || 0;
    return (
      <p className="memory-fact-meta">
        {entry?.provenance === 'user' ? (
          <span>Added by you</span>
        ) : source ? (
          <span className="flex min-w-0 items-center gap-1">
            From <SessionLink session={source} />
          </span>
        ) : entry?.provenance === 'external' ? (
          <span>Changed outside Kalkidan</span>
        ) : null}
        <span title={fullTime(fact.updatedAt)}>{relativeTime(fact.updatedAt)}</span>
        {reads > 0 && <span>Read in {plural(reads, 'chat')}</span>}
      </p>
    );
  }

  return (
    <section className="project-memory" aria-label="Memory">
      <div className="knowledge-pane-header">
        {switcher}
        <h2 className="knowledge-pane-title">Memory</h2>
        {facts.length > 0 && (
          <span className="knowledge-pane-count">{plural(facts.length, 'fact')}</span>
        )}
        <span className="flex-1" />
        {memory && (facts.length > 0 || editing) && (
          <Button size="sm" disabled={busy || (!!editing && !editing.id)} onClick={startAdd}>
            <Plus /> Add fact
          </Button>
        )}
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
      {editing && !editing.id && <div className="memory-new">{form(editing)}</div>}
      {!memory && !error && <EmptyState compact>Loading memory…</EmptyState>}
      {memory && !facts.length && !editing && (
        <EmptyState
          icon={<Brain />}
          title="No facts yet"
          action={
            <>
              {emptyAction === 'start-chat' && (
                <Button
                  variant="outline"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent('kalkidan-new-session', { detail: { groupId: group.id } }),
                    )
                  }
                >
                  Start a chat
                </Button>
              )}
              {emptyAction === 'set-up' && (
                <Button
                  variant="outline"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent('kalkidan-open-settings', { detail: { section: 'account' } }),
                    )
                  }
                >
                  Set up managed agents
                </Button>
              )}
              <Button variant="outline" onClick={startAdd}>
                <Plus /> Add fact
              </Button>
            </>
          }
        >
          Agents save facts after verified work.
        </EmptyState>
      )}
      {facts.length > 0 && (
        <div ref={list} className="memory-list">
          {topics.map((item) => (
            <section
              key={item.topic}
              className="memory-topic-group"
              aria-labelledby={topicAnchor(item.topic)}
            >
              <h3 id={topicAnchor(item.topic)} className="memory-topic-title">
                {item.topic}
                <span className="memory-topic-count">{item.facts.length}</span>
              </h3>
              <ul className="memory-facts">
                {item.facts.map((fact) => {
                  const entry = fact.entry;
                  const isEditing = !!editing?.id && editing.id === entry?.id;
                  return (
                    <li
                      key={fact.id}
                      className="memory-fact"
                      data-fact={fact.id}
                      data-highlight={highlight === fact.id || undefined}
                    >
                      {isEditing && editing ? (
                        form(editing)
                      ) : (
                        <>
                          <div className="min-w-0 flex-1">
                            <div className="prose-ui memory-fact-text" data-size="sm">
                              <Markdown skipHtml remarkPlugins={[remarkGfm]}>
                                {fact.content}
                              </Markdown>
                            </div>
                            {fact.truncated && (
                              <p className="memory-fact-meta">Only the first 64 KB shows.</p>
                            )}
                            {factMeta(fact)}
                          </div>
                          <div className="memory-fact-actions">
                            {entry && (
                              <Hint label="Edit fact">
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  aria-label="Edit fact"
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
                                  <Pencil />
                                </Button>
                              </Hint>
                            )}
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <MoreButton size="xs" label="Fact actions" disabled={busy} />
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onSelect={() => void promote(fact)}>
                                  <FileText className="size-4" aria-hidden="true" />
                                  Make a page from this fact
                                </DropdownMenuItem>
                                {entry && (
                                  <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                      variant="destructive"
                                      onSelect={() => setForgetting(entry)}
                                    >
                                      <Trash2 className="size-4" aria-hidden="true" />
                                      Remove fact…
                                    </DropdownMenuItem>
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
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
        title="Remove this fact?"
        description="Agents stop using this fact. You cannot undo this."
        confirmLabel="Remove fact"
        destructive
        busy={busy}
        onConfirm={() => forgetting && void forget(forgetting)}
        onCancel={() => setForgetting(null)}
      />
    </section>
  );
}
