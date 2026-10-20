import type { ReactNode } from 'react';
import type { Editor } from '@tiptap/react';
import { ContextMenu } from 'radix-ui';
import { Check, ChevronRight } from 'lucide-react';
import { cn } from '../lib/utils';
import {
  menuContentClass,
  menuItemClass,
  menuSeparatorClass,
  menuShortcutClass,
} from './ui/menu-styles';

const itemClass = menuItemClass;
const menuClass = cn(
  menuContentClass,
  'z-[70] max-h-[var(--radix-context-menu-content-available-height)]',
);

export function WikiContextMenu({
  editor,
  children,
  commands,
  onLink,
  onRemoveTable,
}: {
  editor: Editor;
  children: ReactNode;
  commands: { label: string; run: (editor: Editor) => unknown }[];
  onLink: () => void;
  /** Removes the table and tells the user how to undo. */
  onRemoveTable: () => void;
}) {
  const item = (label: string, action: () => unknown, disabled = false) => (
    <ContextMenu.Item
      key={label}
      className={itemClass}
      disabled={disabled}
      onSelect={() => {
        action();
      }}
    >
      {label}
    </ContextMenu.Item>
  );
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        asChild
        onContextMenu={(event) => {
          // Keep a highlighted range; otherwise target the block under the pointer.
          if (editor.state.selection.empty) {
            const position = editor.view.posAtCoords({ left: event.clientX, top: event.clientY });
            if (position) editor.commands.setTextSelection(position.pos);
          }
        }}
        onKeyDown={(event) => {
          if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
            event.preventDefault();
            event.stopPropagation();
            const rect = editor.view.coordsAtPos(editor.state.selection.from);
            event.currentTarget.dispatchEvent(
              new MouseEvent('contextmenu', {
                bubbles: true,
                clientX: rect.left,
                clientY: rect.top + 2,
              }),
            );
          }
        }}
      >
        <div>{children}</div>
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          className={menuClass}
          aria-label="Document editing"
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {item('Undo', () => editor.chain().focus().undo().run(), !editor.can().undo())}
          {item('Redo', () => editor.chain().focus().redo().run(), !editor.can().redo())}
          <ContextMenu.Separator className={menuSeparatorClass} />
          {[
            { label: 'Bold', mark: 'bold', run: () => editor.chain().focus().toggleBold().run() },
            {
              label: 'Italic',
              mark: 'italic',
              run: () => editor.chain().focus().toggleItalic().run(),
            },
            {
              label: 'Strikethrough',
              mark: 'strike',
              run: () => editor.chain().focus().toggleStrike().run(),
            },
            {
              label: 'Inline code',
              mark: 'code',
              run: () => editor.chain().focus().toggleCode().run(),
            },
          ].map(({ label, mark, run }) => (
            <ContextMenu.CheckboxItem
              key={mark}
              className={itemClass}
              checked={editor.isActive(mark)}
              onSelect={() => {
                run();
              }}
            >
              {label}
              <ContextMenu.ItemIndicator className={menuShortcutClass}>
                <Check className="size-3.5" />
              </ContextMenu.ItemIndicator>
            </ContextMenu.CheckboxItem>
          ))}
          {item(editor.isActive('link') ? 'Edit link' : 'Add link', onLink)}
          {editor.isActive('link') &&
            item('Remove link', () =>
              editor.chain().focus().extendMarkRange('link').unsetLink().run(),
            )}
          {item('Clear formatting', () => editor.chain().focus().unsetAllMarks().run())}
          <ContextMenu.Separator className={menuSeparatorClass} />
          <ContextMenu.Sub>
            <ContextMenu.SubTrigger className={itemClass}>
              Blocks
              <ChevronRight className="ml-auto" aria-hidden="true" />
            </ContextMenu.SubTrigger>
            <ContextMenu.Portal>
              <ContextMenu.SubContent className={menuClass} sideOffset={4}>
                {item('Paragraph', () => editor.chain().focus().clearNodes().setParagraph().run())}
                {commands.map((command) => item(command.label, () => command.run(editor)))}
              </ContextMenu.SubContent>
            </ContextMenu.Portal>
          </ContextMenu.Sub>
          {editor.isActive('table') && (
            <>
              <ContextMenu.Separator className={menuSeparatorClass} />
              {item('Add row', () => editor.chain().focus().addRowAfter().run())}
              {item('Add column', () => editor.chain().focus().addColumnAfter().run())}
              {item('Delete row', () => editor.chain().focus().deleteRow().run())}
              {item('Delete column', () => editor.chain().focus().deleteColumn().run())}
              {item('Remove table', onRemoveTable)}
            </>
          )}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
