import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
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
import { Bold, Italic, Strikethrough, Code, Link as LinkIcon } from 'lucide-react';
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
import { WikiContextMenu } from './wiki-context-menu';

type Slash = { from: number; to: number; query: string; left: number; top: number };
const commands = [
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
}: {
  markdown: string;
  readOnly: boolean;
  onChange: (text: string) => void;
}) {
  const [slash, setSlash] = useState<Slash | null>(null);
  const [index, setIndex] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [editingLink, setEditingLink] = useState(false);
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
      left: Math.min(rect.left, window.innerWidth - 290),
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
        class: 'wiki-prose',
        role: 'textbox',
        'aria-label': 'Document content',
        'aria-multiline': 'true',
      },
      handleKeyDown: (_view, event) => keyHandler.current(event),
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
  const filtered = commands.filter((c) =>
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
  const validUrl = /^(https?:\/\/|mailto:|#)/i.test(url.trim());
  function applyLink(event: FormEvent) {
    event.preventDefault();
    if (!validUrl) return;
    editor?.chain().focus().extendMarkRange('link').setLink({ href: url.trim() }).run();
    setLinkOpen(false);
  }
  function choose(i: number) {
    if (!editor || !slash || !filtered[i]) return;
    editor.chain().focus().deleteRange({ from: slash.from, to: slash.to }).run();
    filtered[i].run(editor);
    setSlash(null);
  }
  keyHandler.current = (event) => {
    if (!slash || readOnly || event.isComposing) return false;
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
    <div className="wiki-writing-area">
      <div className="wiki-editor-body">
        {editor && !readOnly && (
          <BubbleMenu editor={editor} className="wiki-bubble">
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
            ].map(({ name, Icon, mark, action }) => (
              <Button
                key={name}
                variant="ghost"
                size="icon-sm"
                aria-label={name}
                aria-pressed={editor.isActive(mark)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={action}
              >
                <Icon size={15} />
              </Button>
            ))}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={editor.isActive('link') ? 'Edit link' : 'Add link'}
              aria-pressed={editor.isActive('link')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={openLink}
            >
              <LinkIcon size={15} />
            </Button>
          </BubbleMenu>
        )}
        {editor?.isActive('table') && !readOnly && (
          <div className="wiki-table-tools">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => editor.chain().focus().addRowAfter().run()}
            >
              Add row
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => editor.chain().focus().addColumnAfter().run()}
            >
              Add column
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => editor.chain().focus().deleteTable().run()}
            >
              Remove table
            </Button>
          </div>
        )}
        {editor && !readOnly ? (
          <WikiContextMenu editor={editor} commands={commands} onLink={openLink}>
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
              style={{ paddingLeft: (h.level - 1) * 10 }}
              onClick={() => {
                if (!editor) return;
                const node = editor.view.nodeDOM(h.pos);
                if (node instanceof HTMLElement)
                  node.scrollIntoView({ behavior: 'smooth', block: 'center' });
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
                  <strong>{c.label}</strong>
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
              </DialogDescription>
            </DialogHeader>
            <Input
              aria-label="Link URL"
              autoFocus
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://…"
            />
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
    </div>
  );
}
