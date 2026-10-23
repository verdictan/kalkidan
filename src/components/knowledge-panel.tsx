import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, FileText, Lightbulb } from 'lucide-react';
import type { API, ProjectGroup, Session } from '../types';
import type { DocPassage } from '../domain/docs';
import { useProjectResource } from '../hooks/use-project-resource';
import { plural } from '../lib/platform';
import { Button } from './ui/button';
import { NavRow } from './ui/nav-row';
import { SearchInput } from './ui/search-input';
import { ProjectDocsPanel, type DocOpenRequest } from './project-docs';
import { ProjectMemoryPanel, useMemoryFacts } from './project-memory';
import { openProjectUsage } from './project-usage';
import { useReadCounts } from './context-usage-chip';

/**
 * A part of the Knowledge tab. 'insights' is an old name only: Board health and GitHub checks
 * are on the Tasks tab now, and Agent usage is the Usage sheet.
 */
export type KnowledgeSection = 'pages' | 'memory' | 'insights';

/** Opens the part of the project that has an old Insights view now. */
function openInsight(groupId: string, view: unknown, taskId?: string) {
  if (view === 'usage' || view === 'knowledge' || taskId) {
    openProjectUsage(groupId, taskId);
    return;
  }
  window.dispatchEvent(
    new CustomEvent('kalkidan-open-project-page', { detail: { groupId, page: 'tasks' } }),
  );
}

/** The section of the Knowledge tab for an old page name or a section name. */
export function knowledgeSection(value: unknown): KnowledgeSection | undefined {
  if (value === 'docs' || value === 'pages') return 'pages';
  if (value === 'memory') return 'memory';
  if (value === 'insights') return 'insights';
  return undefined;
}

/** The words of a text, in lower case. */
const wordsOf = (text: string) => text.toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];

/** True when each word of the query starts a word of the text. */
export function wordStartMatch(text: string, query: string) {
  const words = wordsOf(text);
  return wordsOf(query).every((part) => words.some((word) => word.startsWith(part)));
}

/** The text with each word start that the query matches in a <mark>. */
function Highlight({ text, query }: { text: string; query: string }) {
  const parts = wordsOf(query);
  if (!parts.length) return <>{text}</>;
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{N}])(${parts.map((p) => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`,
    'giu',
  );
  const pieces = text.split(pattern);
  return (
    <>{pieces.map((piece, index) => (index % 2 ? <mark key={index}>{piece}</mark> : piece))}</>
  );
}

/** A passage as plain text: no HTML entities and no list markers. */
const plainExcerpt = (text: string) =>
  text
    .replace(/&nbsp;/g, ' ')
    .replace(/(^|\s)(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

type Result =
  | { kind: 'page'; key: string; docId: string; title: string; detail: string; heading?: string }
  | { kind: 'fact'; key: string; id: string; topic: string; title: string; detail: string };

const resultGroups: { kind: Result['kind']; label: string }[] = [
  { kind: 'fact', label: 'Memory' },
  { kind: 'page', label: 'Pages' },
];

/**
 * The first part of the Knowledge tab to show, in the order of the rail: Memory when it has
 * facts, else Pages when there are pages, else Memory, where the caret waits in "Add a fact".
 */
export function firstKnowledgeSection(facts: number, pages: number): 'memory' | 'pages' {
  return facts || !pages ? 'memory' : 'pages';
}

/**
 * The Knowledge tab of a project: what agents read. One rail list has Memory first, then the
 * pages, with one search for both. Enter opens the selected result on the right.
 */
export function KnowledgePanel({
  api,
  group,
  sessions = [],
  section: sectionProp,
  docId,
  topic,
  heading,
  taskId,
}: {
  api: API;
  group: ProjectGroup;
  /** The chats of the app. They give the titles of the source chats of facts. */
  sessions?: Session[];
  /** The code folders of the project. Not used now; the shell still passes them. */
  repos?: unknown;
  /** The part to open: pages or memory. 'insights' opens Tasks or the Usage sheet. */
  section?: KnowledgeSection;
  /** Opens this page. */
  docId?: string;
  /** Opens this memory topic. */
  topic?: string;
  /** Scrolls the opened page to the heading with this text. */
  heading?: string;
  /** Opens the Usage sheet at this task. */
  taskId?: string;
}) {
  // Without a part to open, the panel waits for memory and pages, then opens the first part
  // that has content (null until then).
  const [section, setSection] = useState<'pages' | 'memory' | null>(
    sectionProp === 'pages' || docId
      ? 'pages'
      : sectionProp === 'memory' || topic
        ? 'memory'
        : null,
  );
  const [memoryTopic, setMemoryTopic] = useState(topic || '');
  const [factFocus, setFactFocus] = useState<{ id: string; serial: number }>();
  const [request, setRequest] = useState<DocOpenRequest>();
  const [railOpen, setRailOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const serial = useRef(0);
  const { memory, facts, resource: memoryResource } = useMemoryFacts(api, group);
  // A failed memory read counts as no facts, so the panel can still open the pages.
  const memoryLoaded = !!memory || memoryResource.state.status === 'error';
  // An API without doc pages (an older bridge) shows no pages instead of an error.
  const metadata = useProjectResource(api, group, 'docs-metadata', () =>
    typeof api.docsMetadata === 'function' ? api.docsMetadata(group.id) : Promise.resolve([]),
  );
  const pages = metadata.state.value || [];
  const pagesLoaded = !!metadata.state.value || metadata.state.status === 'error';
  const reads = useReadCounts(api, group.id);
  // The caret goes to "Add a fact" when the panel chose Memory itself.
  const [chosen, setChosen] = useState(false);
  useEffect(() => {
    if (section || !memoryLoaded || !pagesLoaded) return;
    setSection(firstKnowledgeSection(facts.length, pages.length));
    setChosen(true);
  }, [section, memoryLoaded, pagesLoaded]);

  /** Opens a part of the Knowledge tab, from a prop, an event or a search result. */
  function apply(detail: {
    section?: KnowledgeSection;
    docId?: string;
    heading?: string;
    topic?: string;
    factId?: string;
    view?: unknown;
    taskId?: string;
  }) {
    if (detail.section === 'insights' || (!detail.section && detail.taskId)) {
      openInsight(group.id, detail.view, detail.taskId);
      return;
    }
    const next =
      detail.section ||
      (detail.docId ? 'pages' : detail.topic || detail.factId ? 'memory' : undefined);
    if (!next) return;
    setSection(next);
    setRailOpen(false);
    if (next === 'pages' && detail.docId)
      setRequest({ docId: detail.docId, heading: detail.heading, serial: ++serial.current });
    if (next === 'memory') {
      setMemoryTopic(detail.topic || '');
      if (detail.factId) setFactFocus({ id: detail.factId, serial: ++serial.current });
    }
  }
  useEffect(() => {
    apply({ section: sectionProp, docId, heading, topic, taskId });
  }, [sectionProp, docId, heading, topic, taskId]);
  // Other pages open a page, a topic or an insight view. Old page names still work.
  useEffect(() => {
    const open = (event: Event) => {
      const detail = (event as CustomEvent<Record<string, unknown>>).detail;
      if (!detail || detail.groupId !== group.id) return;
      const value =
        detail.page === 'knowledge'
          ? knowledgeSection(detail.section) || 'memory'
          : knowledgeSection(detail.page);
      if (!value) return;
      const text = (key: string) => (typeof detail[key] === 'string' ? detail[key] : undefined);
      apply({
        section: value,
        docId: text('docId'),
        heading: text('heading'),
        topic: text('topic'),
        factId: text('factId'),
        taskId: text('taskId'),
        view: detail.view,
      });
    };
    window.addEventListener('kalkidan-open-project-page', open);
    return () => window.removeEventListener('kalkidan-open-project-page', open);
  }, [group.id]);

  // Search: page titles and passages, and facts.
  const [passages, setPassages] = useState<DocPassage[]>([]);
  const trimmed = query.trim();
  useEffect(() => {
    if (!trimmed || typeof api.docsSearch !== 'function') {
      setPassages([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      api
        .docsSearch(group.id, trimmed, 8)
        .then((value) => live && setPassages(value))
        .catch(() => live && setPassages([]));
    }, 150);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [api, group.id, trimmed]);
  const results = useMemo<Result[]>(() => {
    if (!trimmed) return [];
    const pageResults: Result[] = [];
    for (const page of pages)
      if (wordStartMatch(page.title, trimmed))
        pageResults.push({
          kind: 'page',
          key: 'page:' + page.id,
          docId: page.id,
          title: page.title || 'Untitled',
          detail: '',
        });
    for (const passage of passages) {
      const known = pageResults.find((item) => item.kind === 'page' && item.docId === passage.id);
      if (known) {
        if (!known.detail) known.detail = plainExcerpt(passage.excerpt);
        continue;
      }
      pageResults.push({
        kind: 'page',
        key: 'page:' + passage.id,
        docId: passage.id,
        title: passage.title || 'Untitled',
        detail: plainExcerpt(passage.excerpt),
        heading: passage.heading || undefined,
      });
    }
    const factResults: Result[] = facts
      .filter((fact) => wordStartMatch(`${fact.topic} ${fact.content}`, trimmed))
      .slice(0, 8)
      .map((fact) => ({
        kind: 'fact',
        key: 'fact:' + fact.id,
        id: fact.id,
        topic: fact.topic,
        title: fact.content.replace(/\s+/g, ' ').slice(0, 160),
        detail: [
          fact.topic,
          reads?.memory[fact.id] ? `read in ${plural(reads.memory[fact.id], 'chat')}` : '',
        ]
          .filter(Boolean)
          .join(' · '),
      }));
    return [...factResults, ...pageResults.slice(0, 8)];
  }, [trimmed, pages, passages, facts, reads]);
  const current = Math.min(active, Math.max(0, results.length - 1));

  function openResult(result: Result) {
    setQuery('');
    if (result.kind === 'page')
      apply({ section: 'pages', docId: result.docId, heading: result.heading });
    else apply({ section: 'memory', topic: result.topic, factId: result.id });
  }
  function searchKeys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape' && query) {
      event.preventDefault();
      event.stopPropagation();
      setQuery('');
    } else if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && results.length) {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActive((current + step + results.length) % results.length);
    } else if (event.key === 'Enter' && results[current]) {
      event.preventDefault();
      openResult(results[current]);
    }
  }
  // In a narrow window the rail shows over the content. A click outside it closes it.
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!railOpen) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Element | null;
      if (target?.closest('.knowledge-rail, .knowledge-switcher, [role="menu"], [role="dialog"]'))
        return;
      setRailOpen(false);
    };
    const escape = (event: globalThis.KeyboardEvent) =>
      event.key === 'Escape' && setRailOpen(false);
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', escape);
    };
  }, [railOpen]);

  const currentLabel = section === 'pages' ? 'Pages' : 'Memory';
  const switcher = (
    <Button
      variant="ghost"
      size="sm"
      className="knowledge-switcher -ml-2 hidden @max-[599px]:inline-flex"
      aria-expanded={railOpen}
      aria-label={`Knowledge: ${currentLabel}`}
      onClick={() => setRailOpen((open) => !open)}
    >
      {currentLabel}
      <ChevronDown aria-hidden="true" />
    </Button>
  );
  const resultId = (index: number) => `knowledge-result-${group.id}-${index}`;
  const searchBox = (
    <div className="knowledge-search">
      <SearchInput
        size="sm"
        aria-label="Search knowledge"
        placeholder="Search"
        value={query}
        role="combobox"
        aria-expanded={!!trimmed}
        aria-controls={`knowledge-results-${group.id}`}
        aria-activedescendant={results[current] ? resultId(current) : undefined}
        onChange={(event) => {
          setQuery(event.target.value);
          setActive(0);
        }}
        onKeyDown={searchKeys}
      />
    </div>
  );
  // Memory is the first row of the one rail list. The pages follow it.
  const memoryRow = (
    <NavRow
      className="knowledge-rail-memory"
      size="sm"
      icon={<Lightbulb aria-hidden="true" />}
      label="Memory"
      current={!trimmed && section === 'memory'}
      onClick={() => apply({ section: 'memory' })}
    />
  );
  const searchPane = trimmed ? (
    <div className="knowledge-results" id={`knowledge-results-${group.id}`} role="listbox">
      {switcher && <div className="knowledge-pane-bar">{switcher}</div>}
      {/* The groups show the results. Only "no results" needs a line. */}
      <p className={results.length ? 'sr-only' : 'knowledge-results-empty'} role="status">
        {results.length
          ? `${plural(results.length, 'result')} for “${trimmed}”`
          : `No results for “${trimmed}”`}
      </p>
      {resultGroups.map(({ kind, label }) => {
        const items = results.filter((item) => item.kind === kind);
        if (!items.length) return null;
        return (
          <div key={kind} role="group" aria-label={label} className="knowledge-result-group">
            <p className="group-label knowledge-result-label">{label}</p>
            {items.map((item) => {
              const index = results.indexOf(item);
              const Icon = kind === 'page' ? FileText : Lightbulb;
              return (
                <div
                  key={item.key}
                  id={resultId(index)}
                  role="option"
                  aria-selected={index === current}
                  className="knowledge-result"
                  onMouseMove={() => setActive(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => openResult(item)}
                >
                  <Icon size={16} aria-hidden="true" />
                  <span className="min-w-0 flex-1">
                    <span className="knowledge-result-title">
                      <Highlight text={item.title} query={trimmed} />
                    </span>
                    {item.detail && (
                      <span className="knowledge-result-detail">
                        <Highlight text={item.detail} query={trimmed} />
                      </span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  ) : null;
  const pane =
    searchPane ||
    (section === 'memory' ? (
      <ProjectMemoryPanel
        api={api}
        group={group}
        sessions={sessions}
        topic={memoryTopic}
        focus={factFocus}
        autoFocus={chosen}
        readCounts={reads?.memory}
        switcher={switcher}
      />
    ) : section === null ? (
      // Memory and pages load. The pane stays empty for this short time.
      <span aria-busy="true" />
    ) : undefined);
  return (
    <div ref={root} className="knowledge-root">
      <ProjectDocsPanel
        api={api}
        group={group}
        request={request}
        search={searchBox}
        railLead={memoryRow}
        railOpen={railOpen}
        pane={pane}
        switcher={switcher}
        readCounts={reads?.docs}
        onPageOpen={() => {
          setQuery('');
          setSection('pages');
          setRailOpen(false);
        }}
      />
    </div>
  );
}
