import {
  useEffect,
  useId,
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
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import Placeholder from '@tiptap/extension-placeholder';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import { TableKit } from '@tiptap/extension-table';
import Image from '@tiptap/extension-image';
import { Bold, Italic, Strikethrough, Code, FileText, Link as LinkIcon } from 'lucide-react';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from './ui/dialog';
import { Input } from './ui/input';
import { showToast } from './ui/toast';
import { DocPagePicker } from './doc-page-picker';
import { WikiContextMenu } from './wiki-context-menu';
import { hasPrimaryModifier } from '../lib/platform';

type Slash = { from: number; to: number; query: string; left: number; top: number };
type Command = { label: string; hint: string; run: (e: Editor) => unknown };

/** A link to another page of these docs. All pages are in one folder, so the link works on disk. */
export const pageHref = (id: string) => `./${id}.md`;
/** Returns the page ID of a docs page link, or null for other links. */
export function pageIdFromHref(href: string | null | undefined) {
  return /^(?:\.\/)?([\w-]+)\.md$/.exec(href?.trim() || '')?.[1] ?? null;
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

const commands: Command[] = [
  {
    label: 'Heading 1',
    hint: 'Large section heading',
    run: (e: Editor) => e.chain().focus().setHeading({ level: 1 }).run(),
  },
  {
    label: 'Heading 2',
    hint: 'Medium section heading',
    run: (e: Editor) => e.chain().focus().setHeading({ level: 2 }).run(),
  },
  {
    label: 'Heading 3',
    hint: 'Small section heading',
    run: (e: Editor) => e.chain().focus().setHeading({ level: 3 }).run(),
  },
  {
    label: 'Bullet list',
    hint: 'A simple list',
    run: (e: Editor) => e.chain().focus().toggleBulletList().run(),
  },
  {
    label: 'Numbered list',
    hint: 'An ordered list',
    run: (e: Editor) => e.chain().focus().toggleOrderedList().run(),
  },
  {
    label: 'Checklist',
    hint: 'Track tasks',
    run: (e: Editor) => e.chain().focus().toggleTaskList().run(),
  },
  {
    label: 'Quote',
    hint: 'Highlight a quotation',
    run: (e: Editor) => e.chain().focus().toggleBlockquote().run(),
  },
  {
    label: 'Code block',
    hint: 'Code with monospace formatting',
    run: (e: Editor) => e.chain().focus().setCodeBlock().run(),
  },
  {
    label: 'Table',
    hint: 'Organize information',
    run: (e: Editor) =>
      e.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(),
  },
  {
    label: 'Divider',
    hint: 'Separate sections',
    run: (e: Editor) => e.chain().focus().setHorizontalRule().run(),
  },
];
export function WikiEditor({
  markdown,
  readOnly,
  onChange,
  groupId,
  onOpenPage,
}: {
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
  // The format toolbar and the table toolbar each have one tab stop. Arrow keys move between
  // the buttons.
  const toolbar = useRef<HTMLDivElement>(null);
  const tableToolbar = useRef<HTMLDivElement>(null);
  const [tableMenu] = useState(() => tableMenuProps(tableToolbar));
  const [toolIndex, setToolIndex] = useState(0);
  const slashId = useId();
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
      left: Math.min(rect.left, window.innerWidth - 330),
      top: Math.min(rect.bottom + 8, window.innerHeight - 330),
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
        if (text !== ' ') return false;
        const { $from } = view.state.selection;
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
    onSelectionUpdate: ({ editor }) => detect(editor),
  });
  useEffect(() => {
    if (editor && editor.isEditable === readOnly) editor.setEditable(!readOnly, false);
  }, [editor, readOnly]);
  const allCommands: Command[] = groupId
    ? [
        ...commands,
        {
          label: 'Link to page',
          hint: 'Link to a page in these docs',
          run: () => setPickerOpen(true),
        },
      ]
    : commands;
  const filtered = allCommands.filter((c) =>
    c.label.toLowerCase().includes(slash?.query.toLowerCase() || ''),
  );
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
      document.getElementById(activeOption)?.scrollIntoView({ block: 'nearest' });
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
    if (hasPrimaryModifier(event.nativeEvent) && event.key.toLowerCase() === 'k') {
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
  /** A click on a docs page link opens that page. Other links do not open from the editor. */
  function openPageLink(event: ReactMouseEvent<HTMLDivElement>) {
    const link = (event.target as Element).closest?.('a[href]');
    const id = pageIdFromHref(link?.getAttribute('href'));
    if (!link || !id || !onOpenPage) return;
    event.preventDefault();
    onOpenPage(id);
  }
  keyHandler.current = (event) => {
    if (readOnly || event.isComposing) return false;
    // The app search ignores Mod-K in the editor (data-shortcut-scope). Here it adds a link.
    if (
      hasPrimaryModifier(event) &&
      !event.shiftKey &&
      !event.altKey &&
      event.key.toLowerCase() === 'k'
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
  editor?.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading')
      headings.push({ text: node.textContent, level: node.attrs.level, pos });
  });
  return (
    <div className="wiki-writing-area" data-shortcut-scope="editor">
      <div className="wiki-editor-body" onClick={openPageLink}>
        {editor && !readOnly && (
          <BubbleMenu editor={editor} className="wiki-bubble">
            {/* The menu element does not pass key events correctly, so the toolbar is a child. */}
            <div
              ref={toolbar}
              className="flex gap-0.5"
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
                className="rounded-sm"
                aria-label={editor.isActive('link') ? 'Edit link' : 'Add link'}
                aria-pressed={editor.isActive('link')}
                tabIndex={toolIndex === 4 ? 0 : -1}
                onFocus={() => setToolIndex(4)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={openLink}
              >
                <LinkIcon size={14} />
              </Button>
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
            commands={allCommands}
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
            <p aria-hidden="true">Insert block</p>
            {filtered.length ? (
              filtered.map((c, i) => (
                <button
                  key={c.label}
                  id={`${slashId}-${i}`}
                  role="option"
                  tabIndex={-1}
                  aria-selected={i === index}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(i)}
                >
                  <span>{c.label}</span>
                  <small>{c.hint}</small>
                </button>
              ))
            ) : (
              <p>No matching blocks</p>
            )}
          </div>,
          document.body,
        )}
      <Dialog open={linkOpen} onOpenChange={setLinkOpen}>
        <DialogContent>
          <form className="contents" onSubmit={applyLink}>
            <DialogHeader>
              <DialogTitle>{editingLink ? 'Edit link' : 'Add link'}</DialogTitle>
              <DialogDescription>
                Type a web address, an email link, or a heading link.
                {groupId && ' Or link to a page in these docs.'}
              </DialogDescription>
            </DialogHeader>
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
      {groupId && (
        <DocPagePicker
          groupId={groupId}
          open={pickerOpen}
          onOpenChange={setPickerOpen}
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
