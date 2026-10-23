import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import type { API, Project, ProjectGroup, Session } from '../types';
import type { ProjectDoc } from '../domain/docs';
import { useProjectResource } from '../hooks/use-project-resource';
import { hasPrimaryModifier, plural } from '../lib/platform';
import { Button } from './ui/button';
import { ProjectDocsPanel, type DocOpenRequest } from './project-docs';
import { ProjectMemoryPanel, useMemoryFacts } from './project-memory';
import { openProjectUsage } from './project-usage';
import { useReadCounts } from './context-usage-chip';

/**
 * A part of the Knowledge tab. 'insights' is an old name only: Board health and GitHub checks
 * are on the Tasks tab now, and Agent usage is the Usage card of the project menu.
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

/**
 * The number of words in the text that start with a word of the query. Zero when one word of
 * the query starts no word of the text.
 */
export function matchCount(text: string, query: string) {
  const parts = wordsOf(query);
  if (!parts.length || !wordStartMatch(text, query)) return 0;
  return wordsOf(text).filter((word) => parts.some((part) => word.startsWith(part))).length;
}

/** The text ranges of the words that start with a word of the query: [start, end] pairs. */
export function matchRanges(text: string, query: string) {
  const parts = wordsOf(query);
  const ranges: [number, number][] = [];
  if (!parts.length) return ranges;
  for (const match of text.matchAll(/[\p{L}\p{N}]+/gu)) {
    const word = match[0].toLowerCase();
    if (parts.some((part) => word.startsWith(part)))
      ranges.push([match.index, match.index + match[0].length]);
  }
  return ranges;
}

type HighlightRegistry = {
  set: (name: string, value: unknown) => void;
  delete: (name: string) => void;
};
const findHighlight = 'knowledge-find';

/**
 * Highlights the words that Find matches in the open page or in Memory, with the CSS Custom
 * Highlight API. The text and the editor do not change. Without the API, nothing shows.
 */
function useFindHighlight(root: HTMLElement | null, query: string) {
  useEffect(() => {
    const scope = globalThis as unknown as {
      Highlight?: new (...ranges: Range[]) => unknown;
      CSS?: { highlights?: HighlightRegistry };
    };
    const registry = scope.CSS?.highlights;
    if (!registry || !scope.Highlight) return;
    if (!root || !query.trim()) {
      registry.delete(findHighlight);
      return;
    }
    const Highlight = scope.Highlight;
    let frame = 0;
    const paint = () => {
      frame = 0;
      const ranges: Range[] = [];
      const panes = root.querySelectorAll('.doc-workspace, .knowledge-pane');
      for (const pane of panes) {
        const walker = document.createTreeWalker(pane, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          if (node.parentElement?.closest('.knowledge-switcher-row, [contenteditable="false"]'))
            continue;
          for (const [start, end] of matchRanges(node.textContent || '', query)) {
            const range = document.createRange();
            range.setStart(node, start);
            range.setEnd(node, end);
            ranges.push(range);
          }
        }
      }
      registry.set(findHighlight, new Highlight(...ranges));
    };
    paint();
    const observer = new MutationObserver(() => {
      if (!frame) frame = requestAnimationFrame(paint);
    });
    observer.observe(root, { subtree: true, childList: true, characterData: true });
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      registry.delete(findHighlight);
    };
  }, [root, query]);
}

/**
 * The first part of the Knowledge tab to show, in the order of the rail: Memory when it has
 * facts, else Pages when there are pages, else Memory, where the caret waits in "Add a fact".
 */
export function firstKnowledgeSection(facts: number, pages: number): 'memory' | 'pages' {
  return facts || !pages ? 'memory' : 'pages';
}

/** The window event that puts the caret in Find of the Knowledge tab. detail: { groupId }. */
export const knowledgeFindEvent = 'kalkidan-knowledge-find';

/**
 * The Knowledge tab of a project: what agents read. The rail is the search: Find (⌘F) filters
 * Memory and the pages in place, shows the number of matches and highlights them in the open
 * page. Memory is the first row and opens as a page.
 */
export function KnowledgePanel({
  api,
  group,
  sessions = [],
  repos,
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
  /** The code folders of the project. They give the repository colors of task rows. */
  repos?: Project[];
  /** The part to open: pages or memory. 'insights' opens Tasks or the Usage card. */
  section?: KnowledgeSection;
  /** Opens this page. */
  docId?: string;
  /** Opens this memory topic. */
  topic?: string;
  /** Scrolls the opened page to the heading with this text. */
  heading?: string;
  /** Opens the Usage card at this task. */
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

  // Find: the text of every page loads once while Find has text. The counts follow the text.
  const trimmed = query.trim();
  const [texts, setTexts] = useState<ProjectDoc[] | null>(null);
  const finding = !!trimmed;
  useEffect(() => {
    if (!finding || typeof api.docsList !== 'function') {
      setTexts(null);
      return;
    }
    let live = true;
    api
      .docsList(group.id)
      .then((value) => live && setTexts(value))
      .catch(() => live && setTexts([]));
    return () => {
      live = false;
    };
  }, [api, group.id, finding, metadata.state.value]);
  const matches = useMemo(() => {
    if (!trimmed) return undefined;
    const result: Record<string, number> = {};
    for (const page of pages) {
      const text = texts?.find((doc) => doc.id === page.id);
      const count = matchCount(`${page.title} ${text?.markdown || ''}`, trimmed);
      if (count) result[page.id] = count;
    }
    return result;
  }, [trimmed, pages, texts]);
  const memoryMatches = useMemo(
    () =>
      trimmed
        ? facts.reduce((sum, fact) => sum + matchCount(`${fact.topic} ${fact.content}`, trimmed), 0)
        : 0,
    [trimmed, facts],
  );
  const noMatches =
    !!trimmed && texts !== null && !memoryMatches && !Object.keys(matches || {}).length;

  const [rootElement, setRootElement] = useState<HTMLDivElement | null>(null);
  useFindHighlight(rootElement, trimmed);
  const findField = useRef<HTMLInputElement>(null);
  const [findFocused, setFindFocused] = useState(false);
  // ⌘F puts the caret in Find while the Knowledge tab shows. ⌘K sends an event.
  useEffect(() => {
    const focusFind = () => {
      setRailOpen(true);
      requestAnimationFrame(() => {
        findField.current?.focus();
        findField.current?.select();
      });
    };
    const key = (event: globalThis.KeyboardEvent) => {
      if (!hasPrimaryModifier(event) || event.shiftKey || event.key.toLowerCase() !== 'f') return;
      event.preventDefault();
      focusFind();
    };
    const requested = (event: Event) => {
      const detail = (event as CustomEvent<{ groupId?: string }>).detail;
      if (!detail?.groupId || detail.groupId === group.id) focusFind();
    };
    window.addEventListener('keydown', key);
    window.addEventListener(knowledgeFindEvent, requested);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener(knowledgeFindEvent, requested);
    };
  }, [group.id]);
  /** The first row that Find shows: Memory, else the first page in rail order. */
  function firstMatch() {
    if (memoryMatches) return apply({ section: 'memory' });
    const page = rootElement?.querySelector<HTMLButtonElement>(
      '.knowledge-rail-pages .wiki-tree-row:not([data-dim]) .doc-tree-page',
    );
    page?.click();
  }
  function findKeys(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape' && query) {
      event.preventDefault();
      event.stopPropagation();
      setQuery('');
    } else if (event.key === 'Enter' && trimmed) {
      event.preventDefault();
      firstMatch();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      rootElement
        ?.querySelector<HTMLButtonElement>('.knowledge-rail-scroll .doc-tree-page')
        ?.focus();
    }
  }
  // In a narrow window the rail shows over the content. A click outside it closes it.
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
  const find = (
    <div className="knowledge-find" data-active={findFocused || !!query || undefined}>
      <Search size={14} aria-hidden="true" />
      <input
        ref={findField}
        type="search"
        aria-label="Find in knowledge"
        aria-keyshortcuts="Meta+F"
        placeholder="Find"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onFocus={() => setFindFocused(true)}
        onBlur={() => setFindFocused(false)}
        onKeyDown={findKeys}
      />
      <kbd aria-hidden="true">{query ? 'esc' : '⌘F'}</kbd>
    </div>
  );
  // Memory is the first row of the one rail list. The pages follow it.
  const memoryRow =
    trimmed && !memoryMatches ? null : (
      <div className="wiki-tree-row knowledge-memory-row" data-selected={section === 'memory'}>
        <button
          type="button"
          className="doc-tree-page"
          aria-current={section === 'memory' ? 'page' : undefined}
          onClick={() => apply({ section: 'memory' })}
        >
          Memory
          {memoryMatches > 0 && (
            <span className="sr-only">, {plural(memoryMatches, 'match', 'matches')}</span>
          )}
        </button>
        {memoryMatches > 0 && (
          <span className="knowledge-count" aria-hidden="true">
            {memoryMatches}
          </span>
        )}
      </div>
    );
  const railLead = (
    <>
      {memoryRow}
      {noMatches && (
        <p className="knowledge-no-matches" role="status">
          No matches
        </p>
      )}
    </>
  );
  const pane =
    section === 'memory' ? (
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
    ) : undefined;
  return (
    <div ref={setRootElement} className="knowledge-root">
      <ProjectDocsPanel
        api={api}
        group={group}
        repos={repos}
        request={request}
        find={find}
        matches={matches}
        railLead={railLead}
        railOpen={railOpen}
        pane={pane}
        switcher={switcher}
        readCounts={reads?.docs}
        onPageOpen={() => {
          setSection('pages');
          setRailOpen(false);
        }}
      />
    </div>
  );
}
