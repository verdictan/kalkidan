import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { BarChart3, ChevronDown, FileText, Lightbulb, Plus } from 'lucide-react';
import type { API, Project, ProjectGroup, Session } from '../types';
import { sessionRepo } from '../lib/session-repository';
import type { DocPassage } from '../domain/docs';
import { useProjectResource } from '../hooks/use-project-resource';
import { plural } from '../lib/platform';
import { Button } from './ui/button';
import { NavRow } from './ui/nav-row';
import { SearchInput } from './ui/search-input';
import { Hint } from './hint';
import { KnowledgeRailGroup, ProjectDocsPanel, type DocOpenRequest } from './project-docs';
import { ProjectMemoryPanel, factTopics, useMemoryFacts } from './project-memory';
import {
  InsightsView,
  insightSearchItems,
  insightViews,
  useInsightsBoard,
  type InsightView,
} from './insights-cards';
import { useUncertainWrites } from './github-write-history';
import { useReadCounts } from './context-usage-chip';

export type KnowledgeSection = 'pages' | 'memory' | 'insights';

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
  | { kind: 'fact'; key: string; id: string; topic: string; title: string; detail: string }
  | { kind: 'insight'; key: string; view: InsightView; title: string; detail: string };

const resultGroups: { kind: Result['kind']; label: string }[] = [
  { kind: 'page', label: 'Pages' },
  { kind: 'fact', label: 'Memory' },
  { kind: 'insight', label: 'Insights' },
];

/**
 * The Knowledge tab of a project: pages, memory facts and insights in one rail, with one search
 * for all three. Enter opens the selected result on the right.
 */
export function KnowledgePanel({
  api,
  group,
  sessions = [],
  repos: reposProp,
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
  /** The code folders of the app. Without them, the panel reads them once. */
  repos?: Project[];
  /** The part to open: pages, memory or insights. */
  section?: KnowledgeSection;
  /** Opens this page. */
  docId?: string;
  /** Opens this memory topic. */
  topic?: string;
  /** Scrolls the opened page to the heading with this text. */
  heading?: string;
  /** Opens Agent usage at this task. */
  taskId?: string;
}) {
  const [section, setSection] = useState<KnowledgeSection>(
    sectionProp || (topic ? 'memory' : taskId ? 'insights' : 'pages'),
  );
  const [memoryTopic, setMemoryTopic] = useState(topic || '');
  const [factFocus, setFactFocus] = useState<{ id: string; serial: number }>();
  const { connection, board } = useInsightsBoard(api, group);
  // Board and GitHub checks need a board. Without one, the rail does not show them.
  const views = insightViews.filter(
    (item) => !!connection || (item.view !== 'board' && item.view !== 'github'),
  );
  const [view, setView] = useState<InsightView>(taskId || !connection ? 'usage' : 'board');
  const [usageTask, setUsageTask] = useState(taskId);
  const [request, setRequest] = useState<DocOpenRequest>();
  const [addSerial, setAddSerial] = useState(0);
  const [railOpen, setRailOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const serial = useRef(0);
  const [loadedRepos, setLoadedRepos] = useState<Project[]>();
  useEffect(() => {
    if (reposProp) return;
    let live = true;
    api
      .snapshot()
      .then((snapshot) => live && setLoadedRepos(snapshot.projects))
      .catch(() => live && setLoadedRepos([]));
    return () => {
      live = false;
    };
  }, [api, !!reposProp]);
  const projectSessions = useMemo(() => {
    const repos = (reposProp || loadedRepos || []).filter((repo) =>
      group.repoIds.includes(repo.id),
    );
    return sessions.filter((session) => !!sessionRepo(session, repos));
  }, [sessions, reposProp, loadedRepos, group.repoIds]);
  const { facts } = useMemoryFacts(api, group);
  const topics = useMemo(() => factTopics(facts), [facts]);
  // An API without doc pages (an older bridge) shows no pages instead of an error.
  const metadata = useProjectResource(api, group, 'docs-metadata', () =>
    typeof api.docsMetadata === 'function' ? api.docsMetadata(group.id) : Promise.resolve([]),
  );
  const pages = metadata.state.value || [];
  const checks = useUncertainWrites(api, group.id);
  const reads = useReadCounts(api, group.id);

  /** Opens a part of the Knowledge tab, from a prop, an event or a search result. */
  function apply(detail: {
    section?: KnowledgeSection;
    docId?: string;
    heading?: string;
    topic?: string;
    factId?: string;
    view?: InsightView;
    taskId?: string;
  }) {
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
    if (next === 'insights') {
      if (detail.taskId) {
        setView('usage');
        setUsageTask(detail.taskId);
      } else if (detail.view) setView(detail.view);
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
          ? knowledgeSection(detail.section) || 'pages'
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
        view: insightViews.some((item) => item.view === detail.view)
          ? (detail.view as InsightView)
          : undefined,
      });
    };
    window.addEventListener('kalkidan-open-project-page', open);
    return () => window.removeEventListener('kalkidan-open-project-page', open);
  }, [group.id]);

  // Search: page titles and passages, facts, and insight numbers.
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
    const insightResults: Result[] = insightSearchItems(board.state.value, projectSessions)
      .filter((item) => views.some((value) => value.view === item.view))
      .filter((item) => wordStartMatch(`${item.title} ${item.detail}`, trimmed))
      .map((item) => ({
        kind: 'insight',
        key: `insight:${item.view}:${item.title}`,
        view: item.view,
        title: item.title,
        detail: insightViews.find((value) => value.view === item.view)!.label,
      }));
    return [...pageResults.slice(0, 8), ...factResults, ...insightResults];
  }, [trimmed, pages, passages, facts, board.state.value, projectSessions, reads, views.length]);
  const current = Math.min(active, Math.max(0, results.length - 1));

  function openResult(result: Result) {
    setQuery('');
    if (result.kind === 'page')
      apply({ section: 'pages', docId: result.docId, heading: result.heading });
    else if (result.kind === 'fact')
      apply({ section: 'memory', topic: result.topic, factId: result.id });
    else apply({ section: 'insights', view: result.view });
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

  const currentLabel =
    section === 'memory'
      ? memoryTopic || 'Memory'
      : section === 'insights'
        ? insightViews.find((item) => item.view === view)!.label
        : 'Pages';
  const switcher = (
    <Button
      variant="ghost"
      size="sm"
      className="knowledge-switcher -ml-2 hidden @max-[719px]:inline-flex"
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
        placeholder="Search knowledge"
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
  const railRow = (
    key: string,
    label: string,
    selected: boolean,
    onClick: () => void,
    count?: number,
    className?: string,
  ) => (
    <li key={key}>
      <NavRow
        label={label}
        current={selected}
        onClick={onClick}
        count={count || undefined}
        className={className}
      />
    </li>
  );
  const railBottom = (
    <>
      <KnowledgeRailGroup
        label="Memory"
        actions={
          <Hint label="Add fact">
            <Button
              variant="ghost"
              size="icon-xs"
              aria-label="Add fact"
              onClick={() => {
                apply({ section: 'memory' });
                setAddSerial((value) => value + 1);
              }}
            >
              <Plus size={14} />
            </Button>
          </Hint>
        }
      >
        <ul className="knowledge-rail-list">
          {railRow(
            'all',
            'All facts',
            !trimmed && section === 'memory' && !memoryTopic,
            () => apply({ section: 'memory' }),
            facts.length,
          )}
          {topics.map((item) =>
            railRow(
              item.topic,
              item.topic,
              !trimmed &&
                section === 'memory' &&
                memoryTopic.toLowerCase() === item.topic.toLowerCase(),
              () => apply({ section: 'memory', topic: item.topic }),
              item.facts.length,
            ),
          )}
        </ul>
      </KnowledgeRailGroup>
      <KnowledgeRailGroup label="Insights">
        <ul className="knowledge-rail-list">
          {views.map((item) =>
            railRow(
              item.view,
              item.label,
              !trimmed && section === 'insights' && view === item.view,
              () => apply({ section: 'insights', view: item.view }),
              item.view === 'github' ? checks : undefined,
              item.view === 'github' ? 'knowledge-rail-checks' : undefined,
            ),
          )}
        </ul>
      </KnowledgeRailGroup>
    </>
  );
  const searchPane = trimmed ? (
    <div className="knowledge-results" id={`knowledge-results-${group.id}`} role="listbox">
      <div className="knowledge-pane-header">
        {switcher}
        <p className="knowledge-results-count" role="status">
          {results.length
            ? `${plural(results.length, 'result')} for “${trimmed}”`
            : `No results for “${trimmed}”`}
        </p>
      </div>
      {resultGroups.map(({ kind, label }) => {
        const items = results.filter((item) => item.kind === kind);
        if (!items.length) return null;
        return (
          <div key={kind} role="group" aria-label={label} className="knowledge-result-group">
            <p className="group-label knowledge-result-label">
              {label} · {items.length}
            </p>
            {items.map((item) => {
              const index = results.indexOf(item);
              const Icon = kind === 'page' ? FileText : kind === 'fact' ? Lightbulb : BarChart3;
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
        onShowAll={() => apply({ section: 'memory' })}
        focus={factFocus}
        addSerial={addSerial}
        readCounts={reads?.memory}
        switcher={switcher}
      />
    ) : section === 'insights' ? (
      <InsightsView
        key={view + (usageTask || '')}
        api={api}
        group={group}
        sessions={projectSessions}
        view={view}
        taskId={view === 'usage' ? usageTask : undefined}
        switcher={switcher}
      />
    ) : undefined);
  return (
    <div ref={root} className="knowledge-root">
      <ProjectDocsPanel
        api={api}
        group={group}
        request={request}
        railTop={searchBox}
        railBottom={railBottom}
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
