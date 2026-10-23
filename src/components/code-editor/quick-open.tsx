import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import { Braces, File, Hash, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { matchFiles, matchSymbols, splitPath, type CodeSymbol } from '../../domain/code-navigation';
import type { CodeSearchResult } from '../../domain/code-files';

export interface QuickOpenPick {
  path: string;
  line?: number;
  column?: number;
}

interface Item {
  key: string;
  icon: ReactNode;
  label: ReactNode;
  detail?: ReactNode;
  pick: QuickOpenPick;
}

function marked(text: string, range: [number, number] | null) {
  if (!range) return text;
  return (
    <>
      {text.slice(0, range[0])}
      <b>{text.slice(range[0], range[1])}</b>
      {text.slice(range[1])}
    </>
  );
}

function markedText(text: string, query: string) {
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  return index < 0 ? text : marked(text, [index, index + query.length]);
}

/**
 * Go to file (⌘P). "@" goes to a symbol of the open file, "#" finds text in all files, and
 * "name:12" opens a file at line 12. Arrow keys move, Return opens, Esc closes.
 */
export function QuickOpen({
  initial,
  files,
  filesError,
  suggested,
  activePath,
  symbols,
  search,
  onPick,
  onClose,
}: {
  initial: string;
  files: string[] | null;
  filesError?: string;
  /** The files to show before the user types: open, changed and recent files. */
  suggested: string[];
  activePath: string | null;
  symbols: CodeSymbol[];
  search: (query: string) => Promise<CodeSearchResult>;
  onPick: (pick: QuickOpenPick) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initial);
  const [selected, setSelected] = useState(0);
  const [found, setFound] = useState<{
    query: string;
    result?: CodeSearchResult;
    error?: string;
  } | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const searchRef = useRef(search);
  searchRef.current = search;
  const list = useRef<HTMLDivElement>(null);
  const listId = useId();
  const mode = query.startsWith('@') ? 'symbol' : query.startsWith('#') ? 'text' : 'file';
  const text = mode === 'file' ? query : query.slice(1);

  useEffect(() => {
    const field = input.current;
    if (!field) return;
    field.focus();
    field.setSelectionRange(field.value.length, field.value.length);
  }, []);

  useEffect(() => {
    if (mode !== 'text') return;
    const value = text.trim();
    if (value.length < 2) {
      setFound(null);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      searchRef
        .current(value)
        .then((result) => live && setFound({ query: value, result }))
        .catch(
          (error: unknown) =>
            live &&
            setFound({
              query: value,
              error: error instanceof Error ? error.message : 'Kalkidan could not search.',
            }),
        );
    }, 180);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [mode, text]);

  const items = useMemo<Item[]>(() => {
    if (mode === 'symbol')
      return matchSymbols(symbols, text)
        .slice(0, 200)
        .map((symbol) => ({
          key: `${symbol.line}:${symbol.name}`,
          icon: <Braces aria-hidden />,
          label: markedText(symbol.name, text.trim()),
          detail: `Line ${symbol.line}`,
          pick: { path: activePath || '', line: symbol.line },
        }));
    if (mode === 'text') {
      const value = text.trim();
      if (!found || found.query !== value || !found.result) return [];
      return found.result.matches.map((match) => {
        const { name } = splitPath(match.path);
        return {
          key: `${match.path}:${match.line}:${match.column}`,
          icon: <Hash aria-hidden />,
          label: <span className="code-quick-snippet">{markedText(match.text.trim(), value)}</span>,
          detail: `${name}:${match.line}`,
          pick: { path: match.path, line: match.line, column: match.column },
        };
      });
    }
    const lineMatch = /^(.*?):(\d+)$/.exec(text.trim());
    const value = lineMatch ? lineMatch[1] : text;
    const line = lineMatch ? Number(lineMatch[2]) : undefined;
    const source = value.trim() ? files || [] : suggested;
    return matchFiles(source, value).map((match) => ({
      key: match.path,
      icon: <File aria-hidden />,
      label: marked(match.name, match.range),
      detail: match.folder,
      pick: { path: match.path, line },
    }));
  }, [mode, text, symbols, activePath, found, files, suggested]);

  useEffect(() => setSelected(0), [query]);
  useEffect(() => {
    list.current
      ?.querySelector<HTMLElement>(`[data-index="${selected}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const hint =
    mode === 'symbol'
      ? !activePath
        ? 'Open a file to see its symbols.'
        : 'No symbols match.'
      : mode === 'text'
        ? text.trim().length < 2
          ? 'Type 2 or more characters to find text in all files.'
          : found?.error
            ? found.error
            : !found || found.query !== text.trim()
              ? 'Finding…'
              : 'No text matches.'
        : filesError
          ? filesError
          : text.trim() && !files
            ? 'Loading files…'
            : 'No files match.';
  const truncated = mode === 'text' && found?.result?.truncated;
  const pick = (item: Item | undefined) => {
    if (item?.pick.path) onPick(item.pick);
  };

  return (
    <div
      className="code-quick"
      role="dialog"
      aria-label="Go to file"
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }
      }}
    >
      <div className="code-quick-input">
        <Search aria-hidden />
        <input
          ref={input}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onBlur={(event) => {
            if (!event.currentTarget.closest('.code-quick')?.contains(event.relatedTarget as Node))
              onClose();
          }}
          onKeyDown={(event) => {
            if (event.key === 'ArrowDown' || (event.ctrlKey && event.key === 'n')) {
              event.preventDefault();
              setSelected((index) => Math.min(index + 1, Math.max(items.length - 1, 0)));
            } else if (event.key === 'ArrowUp' || (event.ctrlKey && event.key === 'p')) {
              event.preventDefault();
              setSelected((index) => Math.max(index - 1, 0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              pick(items[selected]);
            }
          }}
          role="combobox"
          aria-expanded
          aria-controls={listId}
          aria-activedescendant={items[selected] ? `${listId}-${selected}` : undefined}
          aria-label="File name, @ symbol or # text"
          placeholder="Go to file"
          spellCheck={false}
          autoComplete="off"
        />
        <span className="code-quick-hint" aria-hidden>
          @ symbols · # text
        </span>
      </div>
      <div ref={list} id={listId} role="listbox" aria-label="Results" className="code-quick-list">
        {items.length ? (
          items.map((item, index) => (
            <div
              key={item.key}
              id={`${listId}-${index}`}
              data-index={index}
              role="option"
              aria-selected={index === selected}
              data-kind={mode}
              className={cn('code-quick-item', index === selected && 'is-selected')}
              onMouseMove={() => setSelected(index)}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => pick(item)}
            >
              <span className="code-quick-icon">{item.icon}</span>
              <span className="code-quick-label">{item.label}</span>
              {item.detail ? <span className="code-quick-detail">{item.detail}</span> : null}
            </div>
          ))
        ) : (
          <div className="code-quick-empty" role="status">
            {hint}
          </div>
        )}
        {truncated ? <div className="code-quick-empty">Showing the first 500 matches.</div> : null}
      </div>
    </div>
  );
}
