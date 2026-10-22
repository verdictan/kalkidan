import { useEffect, useId, useMemo, useState, type KeyboardEvent } from 'react';
import { FileText } from 'lucide-react';
import type { API } from '../types';
import type { ProjectDocMetadata } from '../domain/docs';
import { errorMessage } from '../lib/errors';
import { Button } from './ui/button';
import { SearchInput } from './ui/search-input';
import { EmptyState } from './ui/empty-state';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

/** The app API: the desktop bridge, or the browser preview data. */
async function appAPI(): Promise<Pick<API, 'docsMetadata'>> {
  return window.workspace || (await import('../demo')).demo;
}

/**
 * Returns the pages in tree order, with the titles of their parent pages. The sort is the same
 * as the docs page list: order, then title. This file does not import project-docs.tsx, because
 * the docs editor imports this file.
 */
function pageRows(pages: ProjectDocMetadata[]) {
  const rows: { page: ProjectDocMetadata; path: string }[] = [];
  const order = (page: ProjectDocMetadata) => page.order ?? Number.POSITIVE_INFINITY;
  const visit = (parentId: string | null, path: string[], seen: Set<string>) => {
    const siblings = pages
      .filter((page) => page.parentId === parentId && !seen.has(page.id))
      .sort((a, b) => order(a) - order(b) || a.title.localeCompare(b.title));
    for (const page of siblings) {
      rows.push({ page, path: path.join(' / ') });
      visit(page.id, [...path, page.title || 'Untitled'], new Set(seen).add(page.id));
    }
  };
  visit(null, [], new Set());
  return rows;
}

/** A searchable list of the project's doc pages. Enter or a click picks a page. */
export function DocPagePicker({
  groupId,
  open,
  onOpenChange,
  onPick,
  title = 'Choose a doc page',
  api,
  onCloseAutoFocus,
}: {
  groupId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (doc: { id: string; title: string }) => void;
  title?: string;
  /** The API to read pages from. Default: the desktop bridge, or the preview data. */
  api?: Pick<API, 'docsMetadata'>;
  /** Call event.preventDefault() to move focus yourself when the dialog closes. */
  onCloseAutoFocus?: (event: Event) => void;
}) {
  const [pages, setPages] = useState<ProjectDocMetadata[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  useEffect(() => {
    if (!open) return;
    let live = true;
    setPages(null);
    setError('');
    setQuery('');
    setActive(0);
    (api ? Promise.resolve(api) : appAPI())
      .then((source) => source.docsMetadata(groupId))
      .then((value) => live && setPages(value))
      .catch((e) => {
        if (!live) return;
        setPages([]);
        setError(errorMessage(e));
      });
    return () => {
      live = false;
    };
  }, [api, groupId, open]);
  const rows = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return pageRows(pages || []).filter(({ page, path }) => {
      const text = (path + ' ' + page.title).toLowerCase();
      return words.every((word) => text.includes(word));
    });
  }, [pages, query]);
  const current = Math.min(active, Math.max(0, rows.length - 1));
  function pick(page: ProjectDocMetadata) {
    onPick({ id: page.id, title: page.title });
    onOpenChange(false);
  }
  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!rows.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      const next = (current + step + rows.length) % rows.length;
      setActive(next);
      document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: 'nearest' });
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (rows[current]) pick(rows[current].page);
    }
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* The dialog fits its content. The page list scrolls after 240px. */}
      <DialogContent size="md" layout="scroll" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription className="sr-only">
            Search the doc pages of this project.
          </DialogDescription>
          <SearchInput
            className="mt-3"
            aria-label="Search doc pages"
            placeholder="Search pages…"
            autoFocus
            value={query}
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={rows[current] ? `${listId}-${current}` : undefined}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(0);
            }}
            onKeyDown={onKeyDown}
          />
        </DialogHeader>
        <DialogBody>
          {error && (
            <p role="alert" className="field-error mb-2">
              {error}
            </p>
          )}
          {pages === null ? (
            <EmptyState compact>Loading pages…</EmptyState>
          ) : rows.length ? (
            <div id={listId} role="listbox" aria-label="Doc pages" className="list-box">
              {rows.map(({ page, path }, i) => (
                <div
                  key={page.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === current}
                  className="list-box-row cursor-default"
                  onMouseMove={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(page)}
                >
                  <FileText size={16} className="shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate" title={page.title}>
                    {page.title || 'Untitled'}
                  </span>
                  {path && (
                    <span
                      className="text-muted-foreground max-w-[45%] truncate text-xs"
                      title={path}
                    >
                      {path}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact>
              {pages.length ? 'No pages match your search.' : 'No pages yet.'}
            </EmptyState>
          )}
        </DialogBody>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
