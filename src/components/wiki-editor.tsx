import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type FormEvent,
  type RefObject,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import { isNodeSelection, posToDOMRect } from '@tiptap/core';
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
  ChevronDown,
  CircleDot,
  Italic,
  Strikethrough,
  Code,
  FileText,
  Heading1,
  Heading2,
  Heading3,
  Link as LinkIcon,
  List,
  ListChecks,
  MessageSquare,
  ListOrdered,
  ListTodo,
  Minus,
  Pilcrow,
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
import { DocPagePicker } from './doc-page-picker';
import { WikiContextMenu } from './wiki-context-menu';
import { hasPrimaryModifier } from '../lib/platform';
import { menuLabelClass } from './ui/menu-styles';

type Slash = { from: number; to: number; query: string; left: number; top: number };
type CommandGroup = 'Ask and plan' | 'Blocks' | 'Links';
const commandGroups: CommandGroup[] = ['Ask and plan', 'Blocks', 'Links'];
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
};

/** The slash menu height: the most rows that show, the group labels and the padding. */
const slashHeight = 400;

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
                    <span className="text-subtle max-w-[35%] shrink-0 truncate text-xs">
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

const commands: Command[] = [
  {
    label: 'Heading 1',
    icon: Heading1,
    shortcut: '#',
    keywords: ['h1', 'title', 'large heading'],
    group: 'Blocks',
    run: (e: Editor) => e.chain().focus().setHeading({ level: 1 }).run(),
  },
  {
    label: 'Heading 2',
    icon: Heading2,
    shortcut: '##',
    keywords: ['h2', 'section heading'],
    group: 'Blocks',
    run: (e: Editor) => e.chain().focus().setHeading({ level: 2 }).run(),
  },
  {
    label: 'Heading 3',
    icon: Heading3,
    shortcut: '###',
    keywords: ['h3', 'small heading'],
    group: 'Blocks',
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
    run: (e: Editor) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    label: 'Code block',
    icon: SquareCode,
    shortcut: '```',
    keywords: ['code', 'pre', 'monospace', 'snippet'],
    group: 'Blocks',
    run: (e: Editor) => e.chain().focus().setCodeBlock().run(),
  },
  {
    label: 'Table',
    icon: Table,
    keywords: ['grid', 'columns', 'rows'],
    group: 'Blocks',
    run: (e: Editor) =>
      e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    label: 'Divider',
    icon: Minus,
    shortcut: '---',
    keywords: ['hr', 'line', 'rule', 'separator'],
    group: 'Blocks',
    run: (e: Editor) => e.chain().focus().setHorizontalRule().run(),
  },
];

/** The block styles of the "Text" menu in the format toolbar. */
const textStyles: {
  label: string;
  short: string;
  icon: LucideIcon;
  active: (e: Editor) => boolean;
  run: (e: Editor) => unknown;
}[] = [
  {
    label: 'Paragraph',
    short: 'Text',
    icon: Pilcrow,
    active: (e) =>
      e.isActive('paragraph') &&
      !e.isActive('bulletList') &&
      !e.isActive('orderedList') &&
      !e.isActive('taskList'),
    run: (e) => e.chain().focus().clearNodes().setParagraph().run(),
  },
  {
    label: 'Heading 1',
    short: 'H1',
    icon: Heading1,
    active: (e) => e.isActive('heading', { level: 1 }),
    run: (e) => e.chain().focus().setHeading({ level: 1 }).run(),
  },
  {
    label: 'Heading 2',
    short: 'H2',
    icon: Heading2,
    active: (e) => e.isActive('heading', { level: 2 }),
    run: (e) => e.chain().focus().setHeading({ level: 2 }).run(),
  },
  {
    label: 'Heading 3',
    short: 'H3',
    icon: Heading3,
    active: (e) => e.isActive('heading', { level: 3 }),
    run: (e) => e.chain().focus().setHeading({ level: 3 }).run(),
  },
  {
    label: 'Bullet list',
    short: 'List',
    icon: List,
    active: (e) => e.isActive('bulletList'),
    run: (e) => e.chain().focus().toggleBulletList().run(),
  },
  {
    label: 'Numbered list',
    short: 'List',
    icon: ListOrdered,
    active: (e) => e.isActive('orderedList'),
    run: (e) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    label: 'Checklist',
    short: 'List',
    icon: ListTodo,
    active: (e) => e.isActive('taskList'),
    run: (e) => e.chain().focus().toggleTaskList().run(),
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

/** The page and task actions of the editor: in "/" and in the selection toolbar. */
export interface WikiEditorActions {
  /** The number of tasks that the page makes. It shows on "Make this list into tasks". */
  taskCount: number;
  onMakeTasks: () => void;
  onAskAgent: () => void;
  /** Links a task to the page. The editor also adds a link to the task in the text. */
  onLinkTask: (task: TrackerItem) => void;
  /** Opens the task picker when the project has no board yet: connect a board first. */
  onConnectBoard?: () => void;
  /** Makes a task from the selected text. */
  onMakeTask: (text: string) => void;
  /** Asks an agent about the selected text. */
  onAskSelection: (text: string) => void;
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
}: {
  actions?: WikiEditorActions;
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
  const [pickerOpen, setPickerOpen] = useState(false);
  // The text that opened the page picker ("[[" or "@"). It comes back when no page is picked.
  const pickerTrigger = useRef('');
  const [taskPickerOpen, setTaskPickerOpen] = useState(false);
  // The format toolbar and the table toolbar each have one tab stop. Arrow keys move between
  // the buttons.
  const toolbar = useRef<HTMLDivElement>(null);
  const tableToolbar = useRef<HTMLDivElement>(null);
  const [tableMenu] = useState(() => tableMenuProps(tableToolbar));
  const [formatMenu] = useState(() => formatMenuProps(toolbar));
  const [toolIndex, setToolIndex] = useState(0);
  const [textMenu, setTextMenu] = useState(false);
  const textMenuRef = useRef<HTMLDivElement>(null);
  const slashId = useId();
  const editorRef = useRef<Editor | null>(null);
  const keyHandler = useRef<(event: KeyboardEvent) => boolean>(() => false);
  function detect(editor: Editor) {
    const { $from, empty } = editor.state.selection;
    const prefix = $from.parent.textBetween(0, $from.parentOffset);
    const match = empty && $from.parent.type.name === 'paragraph' && /^\/([\w ]*)$/.exec(prefix);
    if (!match) {
      setSlash(null);
      return;
    }
    const rect = editor.view.coordsAtPos($from.pos);
    setSlash({
      from: $from.start(),
      to: $from.pos,
      query: match[1],
      left: Math.max(8, Math.min(rect.left, window.innerWidth - 328)),
      // Below the line when there is space, else above it.
      top:
        rect.bottom + 8 + slashHeight <= window.innerHeight - 8
          ? rect.bottom + 8
          : Math.max(8, rect.top - 8 - slashHeight),
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
        // "[[" and "@" open the page picker. A page link goes in place of the typed text.
        if (groupId && (text === '[' || text === '@') && view.state.selection.empty) {
          const { $from } = view.state.selection;
          const before = $from.parent.textBetween(0, $from.parentOffset);
          const opens =
            $from.parent.type.name !== 'codeBlock' &&
            !view.state.schema.marks.code?.isInSet($from.marks()) &&
            (text === '[' ? before.endsWith('[') : !before || /\s$/.test(before));
          if (opens) {
            if (text === '[') view.dispatch(view.state.tr.delete(from - 1, to));
            pickerTrigger.current = text === '[' ? '[[' : '@';
            setPickerOpen(true);
            return true;
          }
        }
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
      onChange(editor.getMarkdown());
      detect(editor);
    },
    onSelectionUpdate: ({ editor }) => {
      detect(editor);
      setTextMenu(false);
    },
  });
  editorRef.current = editor;
  useEffect(() => {
    if (editor && editor.isEditable === readOnly) editor.setEditable(!readOnly, false);
  }, [editor, readOnly]);
  const planCommands: Command[] = actions
    ? [
        {
          label: actions.taskCount
            ? `Make this list into tasks (${actions.taskCount})`
            : 'Make this list into tasks',
          icon: ListChecks,
          keywords: ['tasks', 'issues', 'plan', 'board', 'create'],
          group: 'Ask and plan',
          run: () => actions.onMakeTasks(),
        },
        {
          label: 'Link a task',
          icon: CircleDot,
          keywords: ['link', 'task', 'issue', 'board'],
          group: 'Ask and plan',
          run: () =>
            tasks === undefined && actions.onConnectBoard
              ? actions.onConnectBoard()
              : setTaskPickerOpen(true),
        },
        {
          label: 'Ask an agent about this page',
          icon: MessageSquare,
          keywords: ['agent', 'chat', 'ask', 'codex', 'claude'],
          group: 'Ask and plan',
          run: () => actions.onAskAgent(),
        },
      ]
    : tasks !== undefined
      ? [
          {
            label: 'Link a task',
            icon: CircleDot,
            keywords: ['link', 'task', 'issue', 'board'],
            group: 'Links',
            run: () => setTaskPickerOpen(true),
          },
        ]
      : [];
  const linkCommands: Command[] = groupId
    ? [
        {
          label: 'Link to page',
          icon: FileText,
          shortcut: '[[',
          keywords: ['link', 'page', 'doc', 'wiki'],
          group: 'Links',
          run: () => setPickerOpen(true),
        },
      ]
    : [];
  const allCommands: Command[] = [...planCommands, ...commands, ...linkCommands];
  const filtered = allCommands.filter((c) => commandMatches(c, slash?.query || ''));
  const activeOption = slash && !readOnly && filtered[index] ? `${slashId}-${index}` : '';
  // Focus stays in the editor while the slash menu is open. Point assistive
  // technology at the highlighted option.
  useEffect(() => {
    const dom = editor?.view.dom;
    if (!dom) return;
    if (slash && !readOnly) {
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
  }, [editor, slash, readOnly, activeOption, slashId]);
  function openLink() {
    if (!editor) return;
    const href = editor.getAttributes('link').href || '';
    setEditingLink(!!href);
    setUrl(href);
    setLinkOpen(true);
  }
  const validUrl = /^(https?:\/\/|mailto:|#)/i.test(url.trim()) || !!pageIdFromHref(url);
  function applyLink(event: FormEvent) {
    event.preventDefault();
    if (!validUrl) return;
    editor?.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
    setLinkOpen(false);
  }
  /** Links the selected text to a page. With no selected text, it adds the page title as a link. */
  function linkPage(doc: { id: string; title: string }) {
    if (!editor) return;
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
      setTextMenu(false);
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
    filtered[i].run(editor);
    setSlash(null);
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
    if (!slash) return false;
    if (event.key === 'Escape') {
      setSlash(null);
      return true;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      setIndex(
        (i) =>
          (i + (event.key === 'ArrowDown' ? 1 : -1) + Math.max(1, filtered.length)) %
          Math.max(1, filtered.length),
      );
      return true;
    }
    if (event.key === 'Enter' && filtered.length) {
      choose(index);
      return true;
    }
    return false;
  };
  const headings: { text: string; level: number; pos: number }[] = [];
  const textStyle = editor ? textStyles.find((style) => style.active(editor)) : undefined;
  /** Opens the Text menu and moves focus to the active style, or closes it. */
  function toggleTextMenu(focus: boolean) {
    setTextMenu((open) => !open);
    if (!focus || textMenu) return;
    requestAnimationFrame(() =>
      (
        textMenuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]') ||
        textMenuRef.current?.querySelector<HTMLElement>('[role="menuitemradio"]')
      )?.focus(),
    );
  }
  function textMenuKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    const items = [...event.currentTarget.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
    const current = items.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      setTextMenu(false);
      toolbar.current?.querySelector<HTMLElement>('button')?.focus();
      return;
    }
    const next =
      event.key === 'ArrowDown'
        ? (current + 1) % items.length
        : event.key === 'ArrowUp'
          ? (current - 1 + items.length) % items.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? items.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    items[next].focus();
  }
  // Close the Text menu when the toolbar hides.
  const hasSelection = !!editor && !editor.state.selection.empty;
  useEffect(() => {
    if (!hasSelection) setTextMenu(false);
  }, [hasSelection]);
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
              <Button
                variant="ghost"
                size="xs"
                className="wiki-bubble-style rounded-sm"
                aria-label={`Text style: ${textStyle?.label || 'Mixed'}`}
                aria-haspopup="menu"
                aria-expanded={textMenu}
                tabIndex={toolIndex === 0 ? 0 : -1}
                onFocus={() => setToolIndex(0)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={(e) => toggleTextMenu(e.detail === 0)}
              >
                {textStyle?.short || 'Text'}
                <ChevronDown size={12} aria-hidden="true" />
              </Button>
              <span className="wiki-bubble-divider" aria-hidden="true" />
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
                  name: 'Strikethrough',
                  Icon: Strikethrough,
                  mark: 'strike',
                  action: () => editor.chain().focus().toggleStrike().run(),
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
                  className="rounded-sm"
                  aria-label={name}
                  aria-pressed={editor.isActive(mark)}
                  tabIndex={i + 1 === toolIndex ? 0 : -1}
                  onFocus={() => setToolIndex(i + 1)}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={action}
                >
                  <Icon size={14} />
                </Button>
              ))}
              <Button
                variant="ghost"
                size="icon-xs"
                className="rounded-sm"
                aria-label={editor.isActive('link') ? 'Edit link' : 'Add link'}
                aria-pressed={editor.isActive('link')}
                tabIndex={toolIndex === 5 ? 0 : -1}
                onFocus={() => setToolIndex(5)}
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
                    className="rounded-sm"
                    tabIndex={toolIndex === 6 ? 0 : -1}
                    onFocus={() => setToolIndex(6)}
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
                    className="rounded-sm"
                    tabIndex={toolIndex === 7 ? 0 : -1}
                    onFocus={() => setToolIndex(7)}
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
            {textMenu && (
              <div
                ref={textMenuRef}
                className="wiki-bubble-menu"
                role="menu"
                aria-label="Text style"
                onKeyDown={textMenuKeyDown}
              >
                {textStyles.map((style) => (
                  <button
                    key={style.label}
                    type="button"
                    role="menuitemradio"
                    aria-checked={style === textStyle}
                    tabIndex={-1}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => {
                      style.run(editor);
                      setTextMenu(false);
                    }}
                  >
                    <style.icon size={16} aria-hidden="true" />
                    <span>{style.label}</span>
                  </button>
                ))}
              </div>
            )}
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
      {slash &&
        !readOnly &&
        createPortal(
          <div
            id={`${slashId}-list`}
            className="wiki-slash"
            role="listbox"
            aria-label="Insert block"
            style={{ left: slash.left, top: slash.top }}
          >
            {filtered.length ? (
              commandGroups.map((group) => {
                const items = filtered.filter((c) => c.group === group);
                if (!items.length) return null;
                return (
                  <div
                    key={group}
                    role="group"
                    aria-labelledby={`${slashId}-${group.replace(/\s/g, '-')}`}
                  >
                    <p id={`${slashId}-${group.replace(/\s/g, '-')}`} className={menuLabelClass}>
                      {group}
                    </p>
                    {items.map((c) => {
                      const i = filtered.indexOf(c);
                      return (
                        <button
                          key={c.label}
                          id={`${slashId}-${i}`}
                          role="option"
                          tabIndex={-1}
                          aria-selected={i === index}
                          onMouseDown={(e) => e.preventDefault()}
                          onMouseMove={() => setIndex(i)}
                          onClick={() => choose(i)}
                        >
                          <c.icon size={16} aria-hidden="true" />
                          <span>{c.label}</span>
                          {c.shortcut && (
                            <span className="wiki-slash-hint" aria-hidden="true">
                              {c.shortcut}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                );
              })
            ) : (
              <p className="wiki-slash-empty">No matching blocks</p>
            )}
          </div>,
          document.body,
        )}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent
          layout="scroll"
          onCloseAutoFocus={(event) => {
            // The page picker now owns focus. Closing this dialog must not take it back.
            if (pickerOpen) event.preventDefault();
          }}
        >
          <form className="contents" onSubmit={applyLink}>
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
                placeholder="https://…"
              />
              {groupId && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="justify-self-start"
                  onClick={() => {
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
              <Button type="submit" disabled={!validUrl}>
                Apply link
              </Button>
            </DialogFooter>
          </form>
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
            setPickerOpen(open);
            // No page was picked: give back the text that opened the picker.
            if (!open && pickerTrigger.current) {
              editor?.chain().focus().insertContent(pickerTrigger.current).run();
              pickerTrigger.current = '';
            }
          }}
          onPick={(doc) => {
            pickerTrigger.current = '';
            linkPage(doc);
          }}
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
