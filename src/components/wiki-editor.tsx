import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type RefObject,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { Extension, isNodeSelection, posToDOMRect } from '@tiptap/core';
import { Plugin, PluginKey, Selection } from '@tiptap/pm/state';
import type { Node as ProseNode } from '@tiptap/pm/model';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import {
  Bold,
  CircleDot,
  Italic,
  Code,
  FileText,
  Heading2,
  Heading3,
  Link as LinkIcon,
  List,
  ListChecks,
  MessageSquare,
  ListOrdered,
  ListTodo,
  Minus,
  Quote,
  SquareCode,
  Table,
  type LucideIcon,
} from 'lucide-react';
import { Button } from './ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from './ui/dialog';
import { Input } from './ui/input';
import { SearchInput } from './ui/search-input';
import { EmptyState } from './ui/empty-state';
import type { TrackerItem } from '../domain/tracker';
import type { API } from '../types';
import { showToast } from './ui/toast';
import { DocPagePicker, loadDocPages, matchingPageRows } from './doc-page-picker';
import type { ProjectDocMetadata } from '../domain/docs';
import { WikiContextMenu } from './wiki-context-menu';
import { hasPrimaryModifier, plural } from '../lib/platform';

/**
 * An open menu at the caret: the typed text from `from` to `to`, and the menu position. `kind`
 * tells the "[[" page menu from the "#" task menu.
 */
type Slash = {
  from: number;
  to: number;
  query: string;
  left: number;
  top: number;
  kind?: 'page' | 'task';
};
type CommandGroup = 'Blocks' | 'Links';
export type Command = {
  label: string;
  /** The 16px icon on the left of the item. */
  icon: LucideIcon;
  /** The Markdown shortcut that makes the same block. It shows on the right. */
  shortcut?: string;
  /** Other words that find the command, for example "todo" for Checklist. */
  keywords: string[];
  group: CommandGroup;
  run: (e: Editor) => unknown;
  /** The command shows only when the typed text finds it. */
  searchOnly?: boolean;
};

/** The most rows of the slash menu. */
export const slashLimit = 8;

/**
 * The rows of the slash menu for the typed text: without text, the commands that are not
 * search-only; with text, each command that matches. At most `slashLimit` rows.
 */
export function slashRows<T extends Pick<Command, 'label' | 'keywords' | 'searchOnly'>>(
  commands: T[],
  query: string,
) {
  const typed = !!query.trim();
  return commands
    .filter((command) => (typed ? commandMatches(command, query) : !command.searchOnly))
    .slice(0, slashLimit);
}

/** The height of a menu at the caret with this number of 28px rows and its 4px padding. */
export const caretMenuHeight = (rows: number) => Math.max(1, rows) * 28 + 10;

/**
 * The position of a menu at the caret: 8px under the line when there is space, else above it.
 * The menu stays inside the window (and so under the title bar and the tabs).
 */
export function menuPosition(
  rect: { left: number; top: number; bottom: number },
  height = caretMenuHeight(slashLimit),
  view = { width: window.innerWidth, height: window.innerHeight },
) {
  const below = rect.bottom + 8;
  return {
    left: Math.max(8, Math.min(rect.left - 4, view.width - 288)),
    top: below + height <= view.height - 8 ? below : Math.max(8, rect.top - 8 - height),
  };
}

/**
 * The task that the user types before the caret: "#" at the start of a word, then the search
 * text (the number or a word of the title). Returns the position of "#" in the text, or null.
 * "# " at the start of a line stays a heading.
 */
export function taskLinkTrigger(before: string) {
  const match = /(^|\s)#([^\s#[\]]{0,40})$/.exec(before);
  return match ? { start: match.index + match[1].length, query: match[2] } : null;
}

/** The board tasks for "#" and the typed text: the number first, then the words of the title. */
export function matchingTasks(tasks: TrackerItem[], query: string) {
  const text = query.trim().toLowerCase();
  const open = tasks.filter((task) => !task.archived);
  if (!text) return open.slice(0, slashLimit);
  return open
    .filter(
      (task) =>
        (task.number && String(task.number).startsWith(text.replace(/^#/, ''))) ||
        task.title
          .toLowerCase()
          .split(/[^\p{L}\p{N}]+/u)
          .some((word) => word.startsWith(text)),
    )
    .slice(0, slashLimit);
}

/**
 * The page link that the user types before the caret: "[[" or "@" at the start of a word, then
 * the search text. Returns the position of "[[" or "@" in the text, or null.
 */
export function pageLinkTrigger(before: string) {
  const link = /\[\[([^[\]\n]{0,60})$/.exec(before);
  if (link) return { start: link.index, query: link[1] };
  const at = /(^|\s)@([^\s@[\]]{0,40})$/.exec(before);
  if (at) return { start: at.index + at[1].length, query: at[2] };
  return null;
}

/**
 * The Markdown of the editor without empty paragraphs ("&nbsp;" lines) and without more than
 * one empty line in a row. Code blocks do not change.
 */
export function withoutEmptyParagraphs(markdown: string) {
  const lines: string[] = [];
  let fence = '';
  for (const line of markdown.split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker && (!fence || (marker[0] === fence[0] && marker.length >= fence.length)))
      fence = fence ? '' : marker;
    else if (!fence) {
      if (line.trim() === '&nbsp;') continue;
      if (!line.trim() && !lines[lines.length - 1]?.trim()) continue;
    }
    lines.push(line);
  }
  return lines.join('\n').trim() ? lines.join('\n').replace(/^\n+/, '') : '';
}

/** True when the command label or one of its keywords contains the typed text. */
export function commandMatches(command: Pick<Command, 'label' | 'keywords'>, query: string) {
  const value = query.trim().toLowerCase();
  if (!value) return true;
  return [command.label, ...command.keywords].some((word) => word.toLowerCase().includes(value));
}

/** A link to another page of these docs. All pages are in one folder, so the link works on disk. */
export const pageHref = (id: string) => `./${id}.md`;
/** Returns the page ID of a docs page link, or null for other links. */
export function pageIdFromHref(href: string | null | undefined) {
  return /^(?:\.\/)?([\w-]+)\.md$/.exec(href?.trim() || '')?.[1] ?? null;
}

/** The link of a board task. A draft task has no URL, so its link is a task anchor. */
export const taskHref = (task: Pick<TrackerItem, 'id' | 'url'>) => task.url || `#task-${task.id}`;
/** Returns the board task of a link, or undefined for other links. */
export function taskFromHref(
  href: string | null | undefined,
  tasks: TrackerItem[] | null | undefined,
) {
  const value = href?.trim();
  if (!value || !tasks) return undefined;
  const anchor = /^#task-(.+)$/.exec(value)?.[1];
  return tasks.find((task) => (anchor ? task.id === anchor : task.url === value));
}
const taskText = (task: TrackerItem) =>
  task.number ? `#${task.number} ${task.title}` : task.title || 'Untitled task';

/** A searchable list of the board tasks. Enter or a click picks a task. */
export function TaskPicker({
  open,
  onOpenChange,
  tasks,
  onPick,
  onCloseAutoFocus,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Null while the board loads. */
  tasks: TrackerItem[] | null;
  onPick: (task: TrackerItem) => void;
  onCloseAutoFocus: (event: Event) => void;
}) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const listId = useId();
  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActive(0);
  }, [open]);
  const rows = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return (tasks || [])
      .filter((task) => !task.archived)
      .filter((task) => {
        const text = `${taskText(task)} ${task.repository || ''}`.toLowerCase();
        return words.every((word) => text.includes(word));
      })
      .slice(0, 100);
  }, [tasks, query]);
  const current = Math.min(active, Math.max(0, rows.length - 1));
  function pick(task: TrackerItem) {
    onPick(task);
    onOpenChange(false);
  }
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" layout="scroll" onCloseAutoFocus={onCloseAutoFocus}>
        <DialogHeader>
          <DialogTitle>Link a task</DialogTitle>
          <DialogDescription className="sr-only">
            Search the tasks of the project board.
          </DialogDescription>
          <SearchInput
            className="mt-3"
            aria-label="Search tasks"
            placeholder="Search tasks…"
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
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                if (!rows.length) return;
                const step = event.key === 'ArrowDown' ? 1 : -1;
                const next = (current + step + rows.length) % rows.length;
                setActive(next);
                document.getElementById(`${listId}-${next}`)?.scrollIntoView({ block: 'nearest' });
              } else if (event.key === 'Enter') {
                event.preventDefault();
                if (rows[current]) pick(rows[current]);
              }
            }}
          />
        </DialogHeader>
        <DialogBody>
          {tasks === null ? (
            <EmptyState compact>Loading tasks…</EmptyState>
          ) : rows.length ? (
            <div id={listId} role="listbox" aria-label="Tasks" className="list-box">
              {rows.map((task, i) => (
                <div
                  key={task.id}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === current}
                  className="list-box-row cursor-default"
                  onMouseMove={() => setActive(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pick(task)}
                >
                  <CircleDot size={16} className="shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1 truncate" title={task.title}>
                    {taskText(task)}
                  </span>
                  {task.status && (
                    <span className="text-muted-foreground max-w-[35%] shrink-0 truncate text-xs">
                      {task.status}
                    </span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState compact>
              {tasks.length ? 'No tasks match your search.' : 'The board has no tasks yet.'}
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

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

type BubbleProps = ComponentProps<typeof BubbleMenu>;
/**
 * The table tools show above the table while the cursor is in it. With selected text, the format
 * toolbar shows instead. The props must not change between renders: a change updates the menu,
 * and that update renders the editor again.
 */
function tableMenuProps(tableToolbar: RefObject<HTMLDivElement | null>) {
  const shouldShow: NonNullable<BubbleProps['shouldShow']> = ({ editor, view, state }) =>
    editor.isEditable &&
    editor.isActive('table') &&
    state.selection.empty &&
    (view.hasFocus() || !!tableToolbar.current?.contains(document.activeElement));
  let view: Editor['view'] | null = null;
  return {
    shouldShow: ((props) => {
      view = props.view;
      return shouldShow(props);
    }) as NonNullable<BubbleProps['shouldShow']>,
    anchor: () => {
      if (!view) return null;
      const { node } = view.domAtPos(view.state.selection.from);
      const element = node instanceof Element ? node : node.parentElement;
      const table = element?.closest('table');
      return table ? { getBoundingClientRect: () => table.getBoundingClientRect() } : null;
    },
    options: { placement: 'top-start', offset: 8, flip: true } satisfies BubbleProps['options'],
  };
}

/**
 * The format toolbar shows for each selection that is not empty, also after Select all. It shows
 * 8px above the first selected line, or under the last line when there is no space above. Like
 * the table menu, the props must not change between renders.
 */
function formatMenuProps(toolbar: RefObject<HTMLDivElement | null>) {
  let view: Editor['view'] | null = null;
  const shouldShow: NonNullable<BubbleProps['shouldShow']> = (props) => {
    view = props.view;
    const { editor, state } = props;
    return (
      editor.isEditable &&
      !state.selection.empty &&
      !isNodeSelection(state.selection) &&
      (props.view.hasFocus() || !!toolbar.current?.contains(document.activeElement))
    );
  };
  return {
    shouldShow,
    anchor: () => {
      if (!view) return null;
      const { from, to } = view.state.selection;
      const rect = posToDOMRect(view, Math.max(1, from), Math.max(1, to));
      return { getBoundingClientRect: () => rect };
    },
    options: {
      placement: 'top-start',
      offset: 8,
      flip: { fallbackPlacements: ['bottom-start'] },
      shift: { padding: 8 },
    } satisfies BubbleProps['options'],
  };
}

// The page title is the first heading, so "/" offers Heading (H2). Six rows show: Heading,
// Bullet list, Checklist, Code, Link a page and Link a task. Subheading, Numbered list, Quote,
// Table and Divider show when the typed text finds them.
const commands: Command[] = [
  {
    label: 'Heading',
    icon: Heading2,
    shortcut: '##',
    keywords: ['h2', 'heading 2', 'section heading'],
    group: 'Blocks',
    run: (e: Editor) => e.chain().focus().setHeading({ level: 2 }).run(),
  },
  {
    label: 'Subheading',
    icon: Heading3,
    shortcut: '###',
    keywords: ['h3', 'heading 3', 'small heading'],
    group: 'Blocks',
    searchOnly: true,
    run: (e: Editor) => e.chain().focus().setHeading({ level: 3 }).run(),
  },
  {
    label: 'Bullet list',
    icon: List,
    shortcut: '-',
    keywords: ['ul', 'bullets', 'unordered list'],
    group: 'Blocks',
    run: (e: Editor) => e.chain().focus().toggleBulletList().run(),
  },
  {
    label: 'Numbered list',
    icon: ListOrdered,
    shortcut: '1.',
    keywords: ['ol', 'ordered list', 'numbers'],
    group: 'Blocks',
    searchOnly: true,
    run: (e: Editor) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    label: 'Checklist',
    icon: ListTodo,
    shortcut: '[]',
    keywords: ['todo', 'task', 'check box', 'checkbox', 'track tasks'],
    group: 'Blocks',
    run: (e: Editor) => e.chain().focus().toggleTaskList().run(),
  },
  {
    label: 'Quote',
    icon: Quote,
    shortcut: '>',
    keywords: ['blockquote', 'quotation'],
    group: 'Blocks',
    searchOnly: true,
    run: (e: Editor) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    label: 'Code',
    icon: SquareCode,
    shortcut: '```',
    keywords: ['code block', 'pre', 'monospace', 'snippet'],
    group: 'Blocks',
    run: (e: Editor) => e.chain().focus().setCodeBlock().run(),
  },
  {
    label: 'Table',
    icon: Table,
    keywords: ['grid', 'columns', 'rows'],
    group: 'Blocks',
    searchOnly: true,
    run: (e: Editor) =>
      e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    label: 'Divider',
    icon: Minus,
    shortcut: '---',
    keywords: ['hr', 'line', 'rule', 'separator'],
    group: 'Blocks',
    searchOnly: true,
    run: (e: Editor) => e.chain().focus().setHorizontalRule().run(),
  },
];

/**
 * Text that becomes a check list item when the user types a space after it: "[ ]", "[x]",
 * or the same after a list marker ("- [ ]"). Returns null for other text.
 */
export function checklistMarker(before: string) {
  const match = /^\s*(?:[-+*]\s+)?\[([ xX]?)\]$/.exec(before);
  return match ? { checked: match[1].toLowerCase() === 'x' } : null;
}

/** The task actions of the editor: "Link a task" in "/", and the selection toolbar. */
export interface WikiEditorActions {
  /** Links a task to the page. The editor also adds a link to the task in the text. */
  onLinkTask: (task: TrackerItem) => void;
  /** Opens the task picker when the project has no board yet: connect a board first. */
  onConnectBoard?: () => void;
  /** Makes a task from the selected text. */
  onMakeTask: (text: string) => void;
  /** Asks an agent about the selected text. */
  onAskSelection: (text: string) => void;
  /**
   * "Make N tasks" on a checklist: makes one board task for each open item. It gives the new
   * tasks in the order of the items, or nothing when it did not make them. The editor then
   * turns each item into a task row. `rows` changes the rows later (Undo, another repository).
   */
  onMakeTasks?: (titles: string[], rows: TaskRowControl) => Promise<TrackerItem[] | void>;
}

/** Changes the task rows of an open editor. Each call returns false when the editor is gone. */
export interface TaskRowControl {
  /** Turns the open items with these titles into rows of these tasks (same order). */
  apply: (titles: string[], tasks: TrackerItem[]) => boolean;
  /** Turns the rows of these tasks back into open items. */
  revert: (tasks: TrackerItem[]) => boolean;
}

/** A checklist under a heading: its position, its open items and the tasks it made. */
export interface ChecklistTasks {
  /** The position of the checklist in the document. */
  pos: number;
  /** The end of the text of the heading above the checklist. */
  headingEnd: number;
  /** The text of each open item that is not a task yet. */
  open: string[];
  /** The board tasks of the items that are task rows. */
  tasks: TrackerItem[];
}

/** The board task of a check list item whose only text is a link to that task. */
export function itemTask(item: ProseNode, tasks: TrackerItem[] | null | undefined) {
  const paragraph = item.firstChild;
  if (!paragraph || item.childCount !== 1 || paragraph.childCount !== 1) return undefined;
  const link = paragraph.firstChild!.marks.find((mark) => mark.type.name === 'link');
  return link ? taskFromHref(link.attrs.href as string, tasks) : undefined;
}

/** The checklists of a page that come right after a heading, in page order. */
export function headedChecklists(doc: ProseNode, tasks: TrackerItem[] | null | undefined) {
  const result: ChecklistTasks[] = [];
  let previous: { node: ProseNode; offset: number } | undefined;
  doc.forEach((node, offset) => {
    if (node.type.name === 'taskList' && previous?.node.type.name === 'heading') {
      const list: ChecklistTasks = {
        pos: offset,
        headingEnd: previous.offset + previous.node.nodeSize - 1,
        open: [],
        tasks: [],
      };
      node.forEach((item) => {
        const task = itemTask(item, tasks);
        if (task) list.tasks.push(task);
        else if (!item.attrs.checked && item.firstChild?.textContent.trim())
          list.open.push(item.firstChild.textContent.trim());
      });
      result.push(list);
    }
    previous = { node, offset };
  });
  return result;
}

/** The short name of a repository: "atlas-web" for "example/atlas-web". */
export const repositoryName = (value: string | undefined) => (value || '').split('/').pop() || '';

/** What the task rows and the "Make N tasks" button read. The editor updates it each render. */
interface TaskRowSource {
  tasks: TrackerItem[] | null | undefined;
  /** True while "Make N tasks" runs. */
  busy: boolean;
  /** Undefined when the page cannot make tasks (no actions or a read-only editor). */
  onMake?: (list: ChecklistTasks) => void;
  /** The color of a repository ring in the chip, from the identity palette. */
  repoColor?: (repository: string) => string | undefined;
}

const taskRowsKey = new PluginKey<DecorationSet>('wikiTaskRows');
const svgIcon = (paths: string) =>
  `<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" ` +
  `stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
const listChecksIcon = svgIcon(
  '<path d="m3 17 2 2 4-4"/><path d="m3 7 2 2 4-4"/><path d="M13 6h8"/><path d="M13 12h8"/><path d="M13 18h8"/>',
);

/** The decorations of the task rows, the "Make N tasks" buttons and the chips. */
function taskRowDecorations(doc: ProseNode, source: TaskRowSource) {
  const list: Decoration[] = [];
  doc.descendants((node, pos) => {
    if (node.type.name !== 'taskItem') return true;
    const task = itemTask(node, source.tasks);
    if (!task) return true;
    list.push(Decoration.node(pos, pos + node.nodeSize, { class: 'wiki-task-row' }));
    const end = pos + node.firstChild!.nodeSize;
    const meta = [task.number ? `#${task.number}` : '', task.status || ''].filter(Boolean);
    list.push(
      Decoration.widget(
        end,
        () => {
          const span = document.createElement('span');
          span.className = 'wiki-task-meta';
          span.contentEditable = 'false';
          span.textContent = meta.join(' · ');
          return span;
        },
        { side: 1, key: `meta:${task.id}:${meta.join()}`, ignoreSelection: true },
      ),
    );
    return false;
  });
  for (const checklist of headedChecklists(doc, source.tasks)) {
    const { open, tasks } = checklist;
    if (open.length && source.onMake) {
      const label = `Make ${plural(open.length, 'task')}`;
      list.push(
        Decoration.widget(
          checklist.headingEnd,
          () => {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'wiki-make-tasks';
            button.contentEditable = 'false';
            button.disabled = source.busy;
            button.innerHTML = listChecksIcon;
            button.append(label);
            button.addEventListener('mousedown', (event) => event.preventDefault());
            button.addEventListener('click', () => source.onMake?.(checklist));
            return button;
          },
          { side: 1, key: `make:${checklist.pos}:${label}:${source.busy}`, ignoreSelection: true },
        ),
      );
    } else if (!open.length && tasks.length) {
      const repositories = [...new Set(tasks.map((task) => task.repository || ''))];
      const one = repositories.length === 1 ? repositories[0] : '';
      list.push(
        Decoration.widget(
          checklist.headingEnd,
          () => {
            const chip = document.createElement('span');
            chip.className = 'wiki-tasks-chip';
            chip.contentEditable = 'false';
            if (one) {
              const ring = document.createElement('span');
              ring.className = 'wiki-repo-ring';
              const color = source.repoColor?.(one);
              if (color) ring.style.setProperty('--c', color);
              ring.setAttribute('aria-hidden', 'true');
              chip.append(ring);
            }
            chip.append(
              one
                ? `${plural(tasks.length, 'task')} in ${repositoryName(one)}`
                : plural(tasks.length, 'task'),
            );
            return chip;
          },
          { side: 1, key: `chip:${checklist.pos}:${tasks.length}:${one}`, ignoreSelection: true },
        ),
      );
    }
  }
  return DecorationSet.create(doc, list);
}

/** Shows check list items that link to a board task as task rows, with "#142 · Todo". */
// The source is a function: Tiptap copies option objects, so a ref object would not update.
const TaskRows = Extension.create<{ source: () => TaskRowSource }>({
  name: 'wikiTaskRows',
  addOptions: () => ({ source: () => ({ tasks: undefined, busy: false }) }),
  addProseMirrorPlugins() {
    const source = this.options.source;
    return [
      new Plugin({
        key: taskRowsKey,
        state: {
          init: (_, state) => taskRowDecorations(state.doc, source()),
          apply: (tr, old, _, state) =>
            tr.docChanged || tr.getMeta(taskRowsKey)
              ? taskRowDecorations(state.doc, source())
              : old,
        },
        props: { decorations: (state) => taskRowsKey.getState(state) },
      }),
    ];
  },
});

/** The menu at the caret: "/" blocks, "[[" pages or "#" tasks. One hint shows on each row. */
export function CaretMenu({
  id,
  label,
  position,
  rows,
  active,
  empty,
  onActive,
  onPick,
}: {
  id: string;
  label: string;
  position: { left: number; top: number };
  rows: { key: string; icon: LucideIcon; label: string; hint?: string; detail?: string }[];
  active: number;
  /** The text when there are no rows. */
  empty: string;
  onActive: (index: number) => void;
  onPick: (index: number) => void;
}) {
  return createPortal(
    <div
      id={`${id}-list`}
      className="wiki-slash"
      role="listbox"
      aria-label={label}
      style={{ left: position.left, top: position.top }}
    >
      {rows.length ? (
        rows.map((row, i) => (
          <button
            key={row.key}
            id={`${id}-${i}`}
            type="button"
            role="option"
            tabIndex={-1}
            aria-selected={i === active}
            onMouseDown={(e) => e.preventDefault()}
            onMouseMove={() => onActive(i)}
            onClick={() => onPick(i)}
          >
            <row.icon size={16} aria-hidden="true" />
            <span>{row.label}</span>
            {row.detail && <span className="wiki-slash-path">{row.detail}</span>}
            {row.hint && (
              <span className="wiki-slash-hint" aria-hidden="true">
                {row.hint}
              </span>
            )}
          </button>
        ))
      ) : (
        <p className="menu-empty">{empty}</p>
      )}
    </div>,
    document.body,
  );
}

export function WikiEditor({
  markdown,
  readOnly,
  onChange,
  groupId,
  onOpenPage,
  tasks,
  onOpenTask,
  api,
  actions,
  repoColor,
}: {
  actions?: WikiEditorActions;
  /** The color of a repository ring, from the identity palette. */
  repoColor?: (repository: string) => string | undefined;
  /** The API that the page picker reads pages from. Default: the desktop bridge or the demo. */
  api?: Pick<API, 'docsMetadata'>;
  /** The board tasks for "/task". Undefined: the project has no board. Null: the board loads. */
  tasks?: TrackerItem[] | null;
  /** Opens a board task from a task link. */
  onOpenTask?: (itemId: string) => void;
  markdown: string;
  readOnly: boolean;
  onChange: (text: string) => void;
  /** The project of these docs. With it, the editor can link to other pages. */
  groupId?: string;
  /** Opens a page from a docs page link. */
  onOpenPage?: (id: string) => void;
}) {
  const [slash, setSlash] = useState<Slash | null>(null);
  const [index, setIndex] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [editingLink, setEditingLink] = useState(false);
  // The page picker of the Link dialog. It links the selected text to a page.
  const [pickerOpen, setPickerOpen] = useState(false);
  // True from the moment "Link a page…" is selected. The Link dialog then closes and must not
  // give focus back to the editor. The state value can be one render late.
  const pickerOpening = useRef(false);
  // The text selection when the Link dialog opened. Focus moves to the dialog and then to the
  // page picker. On the way, focus can go back to the editor for a moment, and the browser caret
  // then replaces the selection. Each link action restores this selection first.
  const linkSelection = useRef<unknown>(undefined);
  // "[[" or "@" opens a page menu at the caret. The typed text after it filters the pages.
  const [mention, setMention] = useState<Slash | null>(null);
  const [mentionPages, setMentionPages] = useState<ProjectDocMetadata[] | null>(null);
  const [taskPickerOpen, setTaskPickerOpen] = useState(false);
  // "Make N tasks" runs. The button shows as disabled meanwhile.
  const [making, setMaking] = useState(false);
  const rowSource = useRef<TaskRowSource>({ tasks, busy: false });
  // The format toolbar and the table toolbar each have one tab stop. Arrow keys move between
  // the buttons.
  const toolbar = useRef<HTMLDivElement>(null);
  const tableToolbar = useRef<HTMLDivElement>(null);
  const [tableMenu] = useState(() => tableMenuProps(tableToolbar));
  const [formatMenu] = useState(() => formatMenuProps(toolbar));
  const [toolIndex, setToolIndex] = useState(0);
  const slashId = useId();
  const editorRef = useRef<Editor | null>(null);
  const keyHandler = useRef<(event: KeyboardEvent) => boolean>(() => false);
  /**
   * The page menu for "[[" or "@" before the caret, or the task menu for "#", or null. Not in
   * code, and "#" only in a paragraph when the project has a board.
   */
  function mentionAt(editor: Editor): Slash | null {
    const { $from, empty } = editor.state.selection;
    if (!empty || $from.parent.type.name === 'codeBlock') return null;
    if (editor.state.schema.marks.code?.isInSet($from.marks())) return null;
    const before = $from.parent.textBetween(0, $from.parentOffset, undefined, '\ufffc');
    const page = groupId ? pageLinkTrigger(before) : null;
    const task =
      !page && rowSource.current.tasks !== undefined && $from.parent.type.name === 'paragraph'
        ? taskLinkTrigger(before)
        : null;
    const trigger = page || task;
    if (!trigger) return null;
    const from = $from.pos - (before.length - trigger.start);
    return {
      from,
      to: $from.pos,
      query: trigger.query,
      kind: page ? 'page' : 'task',
      ...menuPosition(editor.view.coordsAtPos(from)),
    };
  }
  function detect(editor: Editor) {
    const { $from, empty } = editor.state.selection;
    const prefix = $from.parent.textBetween(0, $from.parentOffset);
    const match = empty && $from.parent.type.name === 'paragraph' && /^\/([\w ]*)$/.exec(prefix);
    const nextMention = match ? null : mentionAt(editor);
    setMention(nextMention);
    if (!match) {
      setSlash(null);
      if (nextMention) setIndex(0);
      return;
    }
    setSlash({
      from: $from.start(),
      to: $from.pos,
      query: match[1],
      ...menuPosition(editor.view.coordsAtPos($from.pos), caretMenuHeight(6)),
    });
    setIndex(0);
  }
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ underline: false, link: { openOnClick: false } }),
      Markdown,
      Placeholder.configure({ placeholder: "Write something, or press '/' for commands…" }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit,
      Image,
      TaskRows.configure({ source: () => rowSource.current }),
    ],
    content: markdown,
    contentType: 'markdown',
    editable: !readOnly,
    shouldRerenderOnTransaction: true,
    editorProps: {
      attributes: {
        class: 'wiki-prose prose-ui',
        role: 'textbox',
        'aria-label': 'Document content',
        'aria-multiline': 'true',
      },
      handleKeyDown: (_view, event) => keyHandler.current(event),
      // At the start of a list item, "- ", "* ", "+ " or "1. " does nothing: the line is
      // already a list item. Without this, the list shortcut puts a second list in the item,
      // and literal text "- " would load again as a nested list. Use Tab to make a nested list.
      handleTextInput: (view, from, to, text) => {
        if (text !== ' ') return false;
        const { $from } = view.state.selection;
        const inList = $from.depth >= 2 ? $from.node(-1).type.name : '';
        // "[ ] ", "[x] " and "- [ ] " make a check list item. In a bullet or numbered list,
        // only this item becomes a check list item.
        const marker =
          $from.parent.type.name === 'paragraph' &&
          inList !== 'taskItem' &&
          checklistMarker($from.parent.textBetween(0, $from.parentOffset));
        if (marker && editorRef.current) {
          const length = $from.parentOffset;
          view.dispatch(view.state.tr.delete(from - length, to));
          const chain = editorRef.current.chain();
          if (inList === 'listItem') chain.liftListItem('listItem');
          chain.toggleTaskList();
          if (marker.checked) chain.updateAttributes('taskItem', { checked: true });
          chain.run();
          return true;
        }
        if ($from.depth < 2 || !['listItem', 'taskItem'].includes($from.node(-1).type.name))
          return false;
        const before = $from.parent.textBetween(0, $from.parentOffset);
        if (!/^\s*(?:[-+*]|\d+[.)])$/.test(before)) return false;
        view.dispatch(view.state.tr.delete(from - before.length, to));
        return true;
      },
    },
    onUpdate: ({ editor }) => {
      onChange(withoutEmptyParagraphs(editor.getMarkdown()));
      detect(editor);
    },
    onSelectionUpdate: ({ editor }) => detect(editor),
  });
  editorRef.current = editor;
  /** Makes tasks from the open items of a checklist, then turns the items into task rows. */
  async function makeTasks(list: ChecklistTasks) {
    if (!editor || !actions?.onMakeTasks || rowSource.current.busy || !list.open.length) return;
    setMaking(true);
    try {
      const created = await actions.onMakeTasks(list.open, rowControl);
      if (created?.length && !editor.isDestroyed) toTaskRows(list.open, created);
    } finally {
      setMaking(false);
    }
  }
  /** Turns each open item with one of the titles into a link to its new task. */
  function toTaskRows(titles: string[], created: TrackerItem[]) {
    const editor = editorRef.current;
    if (!editor || editor.isDestroyed) return false;
    const { state } = editor;
    const link = state.schema.marks.link;
    const wanted = titles.map((title, i) => ({ title, task: created[i] })).filter((x) => x.task);
    const changes: { from: number; to: number; title: string; task: TrackerItem }[] = [];
    state.doc.descendants((node, pos) => {
      if (node.type.name !== 'taskItem') return true;
      const title = node.firstChild?.textContent.trim() || '';
      const index = wanted.findIndex((value) => value.title === title);
      if (!node.attrs.checked && index >= 0 && !itemTask(node, rowSource.current.tasks)) {
        const paragraph = node.firstChild!;
        changes.push({ from: pos + 2, to: pos + paragraph.nodeSize, ...wanted[index] });
        wanted.splice(index, 1);
      }
      return false;
    });
    if (!changes.length || !link) return true;
    const tr = state.tr;
    for (const change of changes.reverse())
      tr.replaceWith(
        change.from,
        change.to,
        state.schema.text(change.title, [link.create({ href: taskHref(change.task) })]),
      );
    editor.view.dispatch(tr);
    return true;
  }
  /** Turns the task rows of these tasks back into open items. False when the editor is gone. */
  function revertTasks(tasksToRevert: TrackerItem[]) {
    const current = editorRef.current;
    if (!current || current.isDestroyed) return false;
    const hrefs = new Set(tasksToRevert.map(taskHref));
    const { state } = current;
    const tr = state.tr;
    const changes: { from: number; to: number; text: string }[] = [];
    state.doc.descendants((node, pos) => {
      if (node.type.name !== 'taskItem') return true;
      const paragraph = node.firstChild;
      const mark = paragraph?.firstChild?.marks.find((value) => value.type.name === 'link');
      if (paragraph?.childCount === 1 && mark && hrefs.has(mark.attrs.href as string))
        changes.push({ from: pos + 2, to: pos + paragraph.nodeSize, text: paragraph.textContent });
      return false;
    });
    for (const change of changes.reverse())
      tr.replaceWith(change.from, change.to, state.schema.text(change.text));
    if (changes.length) current.view.dispatch(tr);
    return true;
  }
  const rowControl: TaskRowControl = { apply: toTaskRows, revert: revertTasks };
  rowSource.current = {
    tasks,
    busy: making,
    onMake: actions?.onMakeTasks && !readOnly ? (list) => void makeTasks(list) : undefined,
    repoColor,
  };
  // Draw the task rows again when the board tasks, the busy state or the actions change.
  const canMake = !!actions?.onMakeTasks && !readOnly;
  useEffect(() => {
    if (editor && !editor.isDestroyed)
      editor.view.dispatch(editor.state.tr.setMeta(taskRowsKey, true));
  }, [editor, tasks, making, canMake]);
  useEffect(() => {
    if (editor && editor.isEditable === readOnly) editor.setEditable(!readOnly, false);
  }, [editor, readOnly]);
  // "Make N tasks" shows on each checklist. "/" only adds blocks and links.
  const linkCommands: Command[] = [
    ...(groupId
      ? [
          {
            label: 'Link a page',
            icon: FileText,
            shortcut: '[[',
            keywords: ['link', 'page', 'doc', 'wiki'],
            group: 'Links' as const,
            // "[[" opens the page menu at the caret.
            run: (e: Editor) => e.chain().focus().insertContent('[[').run(),
          },
        ]
      : []),
    ...(actions || tasks !== undefined
      ? [
          {
            label: 'Link a task',
            icon: CircleDot,
            shortcut: '#',
            keywords: ['link', 'task', 'issue', 'board'],
            group: 'Links' as const,
            run: () =>
              tasks === undefined && actions?.onConnectBoard
                ? actions.onConnectBoard()
                : setTaskPickerOpen(true),
          },
        ]
      : []),
  ];
  const allCommands: Command[] = [...commands, ...linkCommands];
  const filtered = slashRows(allCommands, slash?.query || '');
  // The pages of the "[[" menu. They load each time the menu opens.
  const mentionOpen = mention?.kind === 'page' && !readOnly;
  useEffect(() => {
    if (!mentionOpen || !groupId) return;
    let live = true;
    setMentionPages(null);
    loadDocPages(groupId, api)
      .then((value) => live && setMentionPages(value))
      .catch(() => live && setMentionPages([]));
    return () => {
      live = false;
    };
  }, [mentionOpen, groupId, api]);
  const mentionRows =
    mention?.kind === 'page' ? matchingPageRows(mentionPages || [], mention.query).slice(0, 8) : [];
  const taskRows = mention?.kind === 'task' ? matchingTasks(tasks || [], mention.query) : [];
  const menuOpen = (!!slash || !!mention) && !readOnly;
  const optionCount = slash
    ? filtered.length
    : mention?.kind === 'task'
      ? taskRows.length
      : mentionRows.length;
  const activeOption = menuOpen && index < optionCount ? `${slashId}-${index}` : '';
  // Focus stays in the editor while the slash menu or the page menu is open. Point assistive
  // technology at the highlighted option.
  useEffect(() => {
    const dom = editor?.view.dom;
    if (!dom) return;
    if (menuOpen) {
      dom.setAttribute('aria-controls', `${slashId}-list`);
      dom.setAttribute('aria-autocomplete', 'list');
    } else {
      dom.removeAttribute('aria-controls');
      dom.removeAttribute('aria-autocomplete');
    }
    if (activeOption) {
      dom.setAttribute('aria-activedescendant', activeOption);
      // Scroll only the menu. scrollIntoView also scrolls the page, and the page then jumps.
      const option = document.getElementById(activeOption);
      const list = option?.closest<HTMLElement>('.wiki-slash');
      if (option && list) {
        if (option.offsetTop < list.scrollTop) list.scrollTop = option.offsetTop - 4;
        else if (option.offsetTop + option.offsetHeight > list.scrollTop + list.clientHeight)
          list.scrollTop = option.offsetTop + option.offsetHeight - list.clientHeight + 4;
      }
    } else dom.removeAttribute('aria-activedescendant');
  }, [editor, menuOpen, activeOption, slashId]);
  function openLink() {
    if (!editor) return;
    linkSelection.current = editor.state.selection.toJSON();
    const href = editor.getAttributes('link').href || '';
    setEditingLink(!!href);
    setUrl(href);
    setLinkOpen(true);
  }
  /** Selects again the text that was selected when the Link dialog opened. */
  function restoreLinkSelection() {
    const saved = linkSelection.current;
    linkSelection.current = undefined;
    if (!editor || !saved) return;
    try {
      const selection = Selection.fromJSON(editor.state.doc, saved);
      if (!selection.eq(editor.state.selection))
        editor.view.dispatch(editor.state.tr.setSelection(selection));
    } catch {
      // The document changed, so the saved positions are not valid. Keep the current selection.
    }
  }
  const validUrl = /^(https?:\/\/|mailto:|#)/i.test(url.trim()) || !!pageIdFromHref(url);
  function applyLink() {
    if (!validUrl) return;
    restoreLinkSelection();
    editor?.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
    setLinkOpen(false);
  }
  /** Links the selected text to a page. With no selected text, it adds the page title as a link. */
  function linkPage(doc: { id: string; title: string }) {
    if (!editor) return;
    restoreLinkSelection();
    const href = pageHref(doc.id);
    const chain = editor.chain().focus();
    if (editor.state.selection.empty && !editor.isActive('link'))
      chain
        .insertContent({
          type: 'text',
          text: doc.title || 'Untitled',
          marks: [{ type: 'link', attrs: { href } }],
        })
        .unsetMark('link')
        .run();
    else chain.extendMarkRange('link').setLink({ href }).run();
  }
  /** Adds a "#12 Title" link to the task. With selected text, it links that text. */
  function linkTask(task: TrackerItem) {
    if (!editor) return;
    const href = taskHref(task);
    const chain = editor.chain().focus();
    if (editor.state.selection.empty && !editor.isActive('link'))
      chain
        .insertContent([
          { type: 'text', text: taskText(task), marks: [{ type: 'link', attrs: { href } }] },
          { type: 'text', text: ' ' },
        ])
        .unsetMark('link')
        .run();
    else chain.extendMarkRange('link').setLink({ href }).run();
  }
  function removeTable() {
    if (!editor) return;
    editor.chain().focus().deleteTable().run();
    showToast({
      message: 'Table removed.',
      actions: [{ label: 'Undo', onClick: () => editor.chain().focus().undo().run() }],
    });
  }
  /** Returns the buttons of the toolbar that shows now: the format toolbar or the table toolbar. */
  function toolbarButtons() {
    const visible = [toolbar.current, tableToolbar.current].find(
      (element) =>
        element?.isConnected &&
        element.closest<HTMLElement>('.wiki-bubble')?.style.visibility !== 'hidden',
    );
    return [...(visible?.querySelectorAll<HTMLButtonElement>('button') || [])];
  }
  /** Arrow keys, Home and End move focus in a toolbar. Escape goes back to the text. */
  function toolbarKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (!editor) return;
    const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>('button')];
    const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      editor.view.focus();
      return;
    }
    if (hasPrimaryModifier(event.nativeEvent) && event.key.toLowerCase() === 'l') {
      event.preventDefault();
      openLink();
      return;
    }
    const next =
      event.key === 'ArrowRight'
        ? (current + 1) % buttons.length
        : event.key === 'ArrowLeft'
          ? (current - 1 + buttons.length) % buttons.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : -1;
    if (next < 0 || current < 0) return;
    event.preventDefault();
    setToolIndex(next);
    buttons[next].focus();
  }
  function choose(i: number) {
    if (!editor || !slash || !filtered[i]) return;
    editor.chain().focus().deleteRange({ from: slash.from, to: slash.to }).run();
    setSlash(null);
    filtered[i].run(editor);
  }
  /** Puts a link to the page or the task in place of "[[", "@" or "#" and the typed text. */
  function chooseMention(i: number) {
    if (!editor || !mention) return;
    const task = mention.kind === 'task' ? taskRows[i] : undefined;
    const row = mention.kind === 'task' ? undefined : mentionRows[i];
    if (!task && !row) return;
    editor.chain().focus().deleteRange({ from: mention.from, to: mention.to }).run();
    setMention(null);
    if (task) {
      linkTask(task);
      actions?.onLinkTask(task);
    } else if (row) linkPage({ id: row.page.id, title: row.page.title });
  }
  /**
   * A click on a docs page link opens that page. A click on a task link opens the task in
   * Kalkidan. Other links do not open from the editor.
   */
  function openPageLink(event: ReactMouseEvent<HTMLDivElement>) {
    const link = (event.target as Element).closest?.('a[href]');
    const href = link?.getAttribute('href');
    const task = onOpenTask && taskFromHref(href, tasks);
    if (link && task) {
      event.preventDefault();
      onOpenTask!(task.id);
      return;
    }
    const id = pageIdFromHref(href);
    if (!link || !id || !onOpenPage) return;
    event.preventDefault();
    onOpenPage(id);
  }
  keyHandler.current = (event) => {
    if (readOnly || event.isComposing) return false;
    // Mod-L adds or edits a link. Mod-K always opens the app search.
    if (
      hasPrimaryModifier(event) &&
      !event.shiftKey &&
      !event.altKey &&
      event.key.toLowerCase() === 'l'
    ) {
      openLink();
      return true;
    }
    // Alt+F10 moves focus to the format toolbar when it shows.
    if (event.altKey && event.key === 'F10') {
      const buttons = toolbarButtons();
      if (!buttons.length) return false;
      (buttons[Math.min(toolIndex, buttons.length - 1)] || buttons[0]).focus();
      return true;
    }
    if (mention && editor) {
      // Escape removes "[[" or "@" and the typed text, so no trigger text stays in the page.
      // "#" can be text, so Escape only closes the task menu.
      if (event.key === 'Escape') {
        if (mention.kind !== 'task')
          editor.chain().focus().deleteRange({ from: mention.from, to: mention.to }).run();
        setMention(null);
        return true;
      }
      if ((event.key === 'Enter' || event.key === 'Tab') && optionCount) {
        chooseMention(Math.min(index, optionCount - 1));
        return true;
      }
    } else if (!slash) return false;
    if (slash && event.key === 'Escape') {
      setSlash(null);
      return true;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const count = Math.max(1, optionCount);
      setIndex((i) => (i + (event.key === 'ArrowDown' ? 1 : -1) + count) % count);
      return true;
    }
    if (slash && event.key === 'Enter' && filtered.length) {
      choose(index);
      return true;
    }
    return false;
  };
  const headings: { text: string; level: number; pos: number }[] = [];
  /** The selected text, for "Make task" and "Ask agent" in the selection toolbar. */
  function selectedText() {
    if (!editor) return '';
    const { from, to } = editor.state.selection;
    return editor.state.doc.textBetween(from, to, '\n').trim();
  }
  editor?.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading')
      headings.push({ text: node.textContent, level: node.attrs.level, pos });
  });
  return (
    <div className="wiki-writing-area">
      <div className="wiki-editor-body" onClick={openPageLink}>
        {editor && !readOnly && (
          <BubbleMenu
            editor={editor}
            className="wiki-bubble"
            shouldShow={formatMenu.shouldShow}
            getReferencedVirtualElement={formatMenu.anchor}
            options={formatMenu.options}
          >
            {/* The menu element does not pass key events correctly, so the toolbar is a child. */}
            <div
              ref={toolbar}
              className="flex items-center gap-0.5"
              role="toolbar"
              aria-label="Text formatting"
              aria-orientation="horizontal"
              onKeyDown={toolbarKeyDown}
            >
              {[
                {
                  name: 'Bold',
                  Icon: Bold,
                  mark: 'bold',
                  action: () => editor.chain().focus().toggleBold().run(),
                },
                {
                  name: 'Italic',
                  Icon: Italic,
                  mark: 'italic',
                  action: () => editor.chain().focus().toggleItalic().run(),
                },
                {
                  name: 'Inline code',
                  Icon: Code,
                  mark: 'code',
                  action: () => editor.chain().focus().toggleCode().run(),
                },
              ].map(({ name, Icon, mark, action }, i) => (
                // Mouse down keeps the text selection. Keyboard focus works as usual.
                <Button
                  key={name}
                  variant="ghost"
                  size="icon-xs"
                  aria-label={name}
                  aria-pressed={editor.isActive(mark)}
                  tabIndex={i === toolIndex ? 0 : -1}
                  onFocus={() => setToolIndex(i)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={action}
                >
                  <Icon size={14} />
                </Button>
              ))}
              <Button
                variant="ghost"
                size="icon-xs"
                aria-label={editor.isActive('link') ? 'Edit link' : 'Add link'}
                aria-pressed={editor.isActive('link')}
                tabIndex={toolIndex === 3 ? 0 : -1}
                onFocus={() => setToolIndex(3)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={openLink}
              >
                <LinkIcon size={14} />
              </Button>
              {actions && (
                <>
                  <span className="wiki-bubble-divider" aria-hidden="true" />
                  <Button
                    variant="ghost"
                    size="xs"
                    tabIndex={toolIndex === 4 ? 0 : -1}
                    onFocus={() => setToolIndex(4)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      const text = selectedText();
                      if (text) actions.onMakeTask(text);
                    }}
                  >
                    <ListChecks size={14} aria-hidden="true" />
                    Make task
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    tabIndex={toolIndex === 5 ? 0 : -1}
                    onFocus={() => setToolIndex(5)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      const text = selectedText();
                      if (text) actions.onAskSelection(text);
                    }}
                  >
                    <MessageSquare size={14} aria-hidden="true" />
                    Ask agent
                  </Button>
                </>
              )}
            </div>
          </BubbleMenu>
        )}
        {editor && !readOnly && (
          <BubbleMenu
            editor={editor}
            pluginKey="wikiTableMenu"
            className="wiki-bubble"
            shouldShow={tableMenu.shouldShow}
            getReferencedVirtualElement={tableMenu.anchor}
            options={tableMenu.options}
          >
            <div
              ref={tableToolbar}
              className="flex gap-0.5"
              role="toolbar"
              aria-label="Table tools"
              aria-orientation="horizontal"
              onKeyDown={toolbarKeyDown}
            >
              {[
                { label: 'Add row', action: () => editor.chain().focus().addRowAfter().run() },
                {
                  label: 'Add column',
                  action: () => editor.chain().focus().addColumnAfter().run(),
                },
                { label: 'Remove table', action: removeTable },
              ].map(({ label, action }, i) => (
                <Button
                  key={label}
                  variant="ghost"
                  size="xs"
                  tabIndex={i === 0 ? 0 : -1}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={action}
                >
                  {label}
                </Button>
              ))}
            </div>
          </BubbleMenu>
        )}
        {editor && !readOnly ? (
          <WikiContextMenu
            editor={editor}
            commands={commands}
            onLink={openLink}
            onRemoveTable={removeTable}
          >
            <EditorContent editor={editor} />
          </WikiContextMenu>
        ) : (
          <EditorContent editor={editor} />
        )}
      </div>
      {headings.length > 1 && (
        <aside className="wiki-outline" aria-label="On this page">
          <span>On this page</span>
          {headings.map((h) => (
            <button
              key={h.pos}
              style={{ paddingLeft: (h.level - 1) * 12 }}
              onClick={() => {
                if (!editor) return;
                const node = editor.view.nodeDOM(h.pos);
                if (node instanceof HTMLElement)
                  node.scrollIntoView({
                    behavior: reducedMotion() ? 'auto' : 'smooth',
                    block: 'center',
                  });
              }}
            >
              {h.text || 'Untitled heading'}
            </button>
          ))}
        </aside>
      )}
      {slash && !readOnly && (
        <CaretMenu
          id={slashId}
          label="Insert block"
          position={slash}
          rows={filtered.map((c) => ({
            key: c.label,
            icon: c.icon,
            label: c.label,
            hint: c.shortcut,
          }))}
          active={index}
          empty="No matching blocks"
          onActive={setIndex}
          onPick={choose}
        />
      )}
      {mention?.kind === 'page' && !readOnly && (
        <CaretMenu
          id={slashId}
          label="Link a page"
          position={mention}
          rows={mentionRows.map(({ page, path }) => ({
            key: page.id,
            icon: FileText,
            label: page.title || 'Untitled',
            detail: path,
          }))}
          active={index}
          empty={
            mentionPages === null
              ? 'Loading pages…'
              : mentionPages.length
                ? 'No matching pages'
                : 'No pages yet'
          }
          onActive={setIndex}
          onPick={chooseMention}
        />
      )}
      {mention?.kind === 'task' && !readOnly && (
        <CaretMenu
          id={slashId}
          label="Link a task"
          position={mention}
          rows={taskRows.map((task) => ({
            key: task.id,
            icon: CircleDot,
            label: task.title || 'Untitled task',
            hint: task.number ? `#${task.number}` : undefined,
          }))}
          active={index}
          empty={tasks === null ? 'Loading tasks…' : 'No matching tasks'}
          onActive={setIndex}
          onPick={chooseMention}
        />
      )}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent
          layout="scroll"
          onCloseAutoFocus={(event) => {
            // The page picker now owns focus. Closing this dialog must not take it back.
            if (pickerOpen || pickerOpening.current) event.preventDefault();
          }}
        >
          {/* No form element: the header, body and footer must be direct children for the
              dialog padding. Enter in the field applies the link. */}
          <DialogHeader>
            <DialogTitle>{editingLink ? 'Edit link' : 'Add link'}</DialogTitle>
            <DialogDescription>
              Type a web address, an email link, or a heading link.
              {groupId && ' Or link to a page in these docs.'}
            </DialogDescription>
          </DialogHeader>
          <DialogBody className="grid gap-3">
            <Input
              aria-label="Link URL"
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || e.nativeEvent.isComposing) return;
                e.preventDefault();
                applyLink();
              }}
              placeholder="https://…"
            />
            {groupId && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="justify-self-start"
                onClick={() => {
                  pickerOpening.current = true;
                  setLinkOpen(false);
                  setPickerOpen(true);
                }}
              >
                <FileText /> Link a page…
              </Button>
            )}
          </DialogBody>
          <DialogFooter>
            {editingLink && (
              <Button
                type="button"
                variant="ghost"
                className="sm:mr-auto"
                onClick={() => {
                  restoreLinkSelection();
                  editor?.chain().focus().extendMarkRange('link').unsetLink().run();
                  setLinkOpen(false);
                }}
              >
                Remove link
              </Button>
            )}
            <Button type="button" variant="outline" onClick={() => setLinkOpen(false)}>
              Cancel
            </Button>
            <Button type="button" disabled={!validUrl} onClick={applyLink}>
              Apply link
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {tasks !== undefined && (
        <TaskPicker
          open={taskPickerOpen}
          onOpenChange={setTaskPickerOpen}
          tasks={tasks}
          onPick={(task) => {
            linkTask(task);
            actions?.onLinkTask(task);
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            editor?.view.focus();
          }}
        />
      )}
      {groupId && (
        <DocPagePicker
          api={api}
          groupId={groupId}
          open={pickerOpen}
          onOpenChange={(open) => {
            if (!open) pickerOpening.current = false;
            setPickerOpen(open);
          }}
          onPick={linkPage}
          title="Link a page"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            editor?.view.focus();
          }}
        />
      )}
    </div>
  );
}
