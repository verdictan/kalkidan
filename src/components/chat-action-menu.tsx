import { Fragment, createElement, type ReactElement, type ReactNode } from 'react';
import {
  AppWindow,
  Archive,
  ArchiveRestore,
  ChevronRight,
  Code,
  Copy,
  CopyPlus,
  ExternalLink,
  FolderOpen,
  Gauge,
  GitCommitHorizontal,
  GitPullRequest,
  ListTodo,
  NotebookPen,
  PanelRight,
  Pencil,
  Pin,
  PinOff,
  Share2,
  FileText,
  type LucideIcon,
} from 'lucide-react';
import { ContextMenu, DropdownMenu } from 'radix-ui';
import {
  chatShortcutKeys,
  type ChatActionId,
  type ChatMenuGroup,
  type ChatMenuItem,
  type ChatShortcut,
} from '../domain/chat-actions';
import { cn } from '../lib/utils';
import { platform, shortcutLabel } from '../lib/platform';
import { MoreButton } from './ui/more-button';
import { Hint } from './hint';
import {
  menuCollisionPadding,
  menuContentClass,
  menuItemClass,
  menuSeparatorClass,
  menuShortcutClass,
} from './ui/menu-styles';

const icons: Partial<Record<ChatActionId, LucideIcon>> = {
  open: ExternalLink,
  'open-beside': PanelRight,
  'open-window': AppWindow,
  rename: Pencil,
  pin: Pin,
  'link-task': ListTodo,
  'open-linked-task': ListTodo,
  notes: NotebookPen,
  commit: GitCommitHorizontal,
  'open-pull-request': GitPullRequest,
  duplicate: CopyPlus,
  'show-folder': FolderOpen,
  share: Share2,
  'save-to-docs': FileText,
  'copy-markdown': Copy,
  'usage-history': Gauge,
  developer: Code,
  archive: Archive,
};
function iconOf(item: ChatMenuItem) {
  if (item.id === 'pin' && item.label === 'Unpin') return PinOff;
  if (item.id === 'archive' && item.label === 'Restore') return ArchiveRestore;
  return icons[item.id];
}

/** The shortcut as the menu shows it, such as "⌥⌘R" or "Ctrl+Shift+E". */
export function chatShortcutText(shortcut: ChatShortcut) {
  const keys = chatShortcutKeys(shortcut, platform);
  return shortcutLabel(keys.modifiers, keys.key);
}
/** The shortcut for `aria-keyshortcuts`, such as "Meta+Alt+R". */
function ariaShortcut(shortcut: ChatShortcut) {
  const keys = chatShortcutKeys(shortcut, platform);
  const names = { mod: platform === 'mac' ? 'Meta' : 'Control', alt: 'Alt', shift: 'Shift' };
  return [...keys.modifiers.map((m) => names[m]), keys.key].join('+');
}

type Parts = typeof DropdownMenu | typeof ContextMenu;
const withReason = 'h-auto flex-col items-start gap-0 py-1.5';

function Item({
  parts: P,
  item,
  onRun,
}: {
  parts: Parts;
  item: ChatMenuItem;
  onRun: (item: ChatMenuItem) => void;
}) {
  const icon = iconOf(item);
  const reason = item.disabled && item.reason;
  const label = (
    <span className="flex w-full items-center gap-2">
      {icon ? createElement(icon, { 'aria-hidden': true }) : null}
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.shortcut && (
        <span className={menuShortcutClass} aria-hidden="true">
          {chatShortcutText(item.shortcut)}
        </span>
      )}
      {item.children && <ChevronRight className="ml-auto size-3.5" aria-hidden="true" />}
    </span>
  );
  const note = reason && (
    <span className="pl-5.5 text-xs text-muted-foreground" data-reason>
      {reason}
    </span>
  );
  if (item.children)
    return (
      <P.Sub>
        <P.SubTrigger
          disabled={item.disabled}
          className={cn(menuItemClass, reason && withReason)}
          data-action={item.id}
        >
          {label}
          {note}
        </P.SubTrigger>
        <P.Portal>
          <P.SubContent
            collisionPadding={menuCollisionPadding}
            className={cn(menuContentClass, 'w-64')}
          >
            {item.children.map((child) => (
              <Fragment key={child.id}>
                {child.separator && <P.Separator className={menuSeparatorClass} />}
                <Item parts={P} item={child} onRun={onRun} />
              </Fragment>
            ))}
          </P.SubContent>
        </P.Portal>
      </P.Sub>
    );
  return (
    <P.Item
      disabled={item.disabled}
      className={cn(menuItemClass, reason && withReason)}
      aria-keyshortcuts={item.shortcut ? ariaShortcut(item.shortcut) : undefined}
      data-action={item.id}
      onSelect={() => onRun(item)}
    >
      {label}
      {note}
    </P.Item>
  );
}

/** The chat actions in their groups, with a separator between two groups. */
function Items({
  parts,
  groups,
  onRun,
}: {
  parts: Parts;
  groups: ChatMenuGroup[];
  onRun: (item: ChatMenuItem) => void;
}) {
  return groups.map((entry, index) => (
    <Fragment key={entry.group}>
      {index > 0 && <parts.Separator className={menuSeparatorClass} />}
      {entry.items.map((item) => (
        <Item key={item.id} parts={parts} item={item} onRun={onRun} />
      ))}
    </Fragment>
  ));
}

/** The ⋯ menu of a chat. The chat header and the chat rows use it. */
export function ChatActionsDropdown({
  label,
  groups,
  onRun,
  disabled,
  size = 'sm',
  className,
  onOpenChange,
  footer,
}: {
  label: string;
  groups: ChatMenuGroup[];
  onRun: (item: ChatMenuItem) => void;
  disabled?: boolean;
  /** md (32px) in page headers, sm (28px) in toolbars, xs (24px) in list and tree rows. */
  size?: 'md' | 'sm' | 'xs';
  className?: string;
  onOpenChange?: (open: boolean) => void;
  footer?: ReactNode;
}) {
  return (
    <DropdownMenu.Root onOpenChange={onOpenChange}>
      <Hint label={label} disabled={disabled}>
        <DropdownMenu.Trigger asChild>
          <MoreButton size={size} label={label} className={className} disabled={disabled} />
        </DropdownMenu.Trigger>
      </Hint>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={6}
          collisionPadding={menuCollisionPadding}
          aria-label={label}
          className={cn(
            menuContentClass,
            'w-80 max-h-(--radix-dropdown-menu-content-available-height) origin-(--radix-dropdown-menu-content-transform-origin)',
          )}
        >
          <Items parts={DropdownMenu} groups={groups} onRun={onRun} />
          {footer}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/** The right-click menu of a chat row. Shift+F10 and the menu key open it too. */
export function ChatContextMenu({
  children,
  groups,
  onRun,
  label = 'Chat actions',
}: {
  children: ReactElement;
  groups: ChatMenuGroup[];
  onRun: (item: ChatMenuItem) => void;
  label?: string;
}) {
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        asChild
        onKeyDown={(event) => {
          if ((event.shiftKey && event.key === 'F10') || event.key === 'ContextMenu') {
            event.preventDefault();
            event.stopPropagation();
            const rect = event.currentTarget.getBoundingClientRect();
            event.currentTarget.dispatchEvent(
              new MouseEvent('contextmenu', {
                bubbles: true,
                clientX: rect.left + 20,
                clientY: rect.bottom,
              }),
            );
          }
        }}
      >
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Content
          collisionPadding={menuCollisionPadding}
          aria-label={label}
          className={cn(
            menuContentClass,
            'w-80 max-h-(--radix-context-menu-content-available-height) origin-(--radix-context-menu-content-transform-origin)',
          )}
        >
          <Items parts={ContextMenu} groups={groups} onRun={onRun} />
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
