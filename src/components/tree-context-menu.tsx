import {
  AppWindow,
  PenLine,
  Plus,
  SlidersHorizontal,
  SquarePen,
  Trash2,
  Unplug,
} from 'lucide-react';
import { Fragment, type ReactElement, type ReactNode } from 'react';
import { ContextMenu } from 'radix-ui';
import { cn } from '../lib/utils';
import { shortcutLabel } from '../lib/platform';
import type { IdentityColor } from '../domain/identity';
import { Hint } from './hint';
import { MoreButton } from './ui/more-button';
import { IdentitySwatches } from './ui/identity-swatches';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import {
  menuCollisionPadding,
  menuDestructiveClass,
  menuItemClass,
  menuLabelClass,
  menuSeparatorClass,
  menuShortcutClass,
  menuWideClass,
  menuSurfaceClass,
} from './ui/menu-styles';

export interface TreeAction {
  label: string;
  action(): void;
  /** A 16px icon before the label. */
  icon?: ReactNode;
  /** A key hint at the right side, such as "⌘N". */
  shortcut?: string;
  disabled?: boolean;
  destructive?: boolean;
  /** Tells the user why the action is disabled. */
  reason?: string;
  /** Draws a separator above this item. */
  separator?: boolean;
  /** Shows the Color swatches and the extra rows (Usage) just before this item. */
  colorBefore?: boolean;
}
/** The identity color choice of a menu: 8 swatches and Automatic. */
export interface ColorChoice {
  /** The color that the item shows now. */
  value: IdentityColor;
  /** True when the user chose the color. Automatic then shows. */
  chosen?: boolean;
  onChange: (color: IdentityColor | null) => void;
}

/** What the one project menu does. The sidebar row and the project header use the same menu. */
export interface ProjectMenuHandlers {
  projectName: string;
  /** Opens the project in its own window. */
  onOpenWindow?(): void;
  onNewChat(): void;
  /** Opens the one Add code folder dialog. It has the Local and Clone from GitHub sources. */
  onAddFolder(): void;
  onRename(): void;
  onSettings(): void;
  /** Removes the project from Kalkidan, after a confirmation. The last item, in red. */
  onRemove?(): void;
  /** Shows "Reconnect to host" for a remote project whose host is not connected. */
  reconnect?: { host: string; disabled?: boolean; run(): void };
  busy?: boolean;
}

/**
 * The items of the one project menu (SH-A2), in this order: Open in new window, New chat — Add
 * repo, Rename, Color — Settings, then Remove project when the caller gives `onRemove`. New task
 * and New page are in search. Give the color choice to the menu as `color`; it shows before
 * Settings, with the extra rows that the caller gives.
 */
export function projectMenuActions(handlers: ProjectMenuHandlers): TreeAction[] {
  const icon = (Icon: typeof Plus) => <Icon className="size-4" />;
  return [
    ...(handlers.onOpenWindow
      ? [
          {
            label: 'Open in new window',
            icon: icon(AppWindow),
            shortcut: shortcutLabel(['shift'], '↵'),
            action: handlers.onOpenWindow,
          },
        ]
      : []),
    {
      label: `New chat in ${handlers.projectName}`,
      icon: icon(SquarePen),
      shortcut: shortcutLabel(['mod'], 'N'),
      action: handlers.onNewChat,
    },
    {
      label: 'Add repo…',
      icon: icon(Plus),
      separator: true,
      disabled: handlers.busy,
      action: handlers.onAddFolder,
    },
    ...(handlers.reconnect
      ? [
          {
            label: `Reconnect to ${handlers.reconnect.host}`,
            icon: icon(Unplug),
            disabled: handlers.reconnect.disabled,
            action: handlers.reconnect.run,
          },
        ]
      : []),
    {
      label: 'Rename…',
      icon: icon(PenLine),
      disabled: handlers.busy,
      action: handlers.onRename,
    },
    {
      label: 'Settings…',
      icon: icon(SlidersHorizontal),
      separator: true,
      colorBefore: true,
      action: handlers.onSettings,
    },
    ...(handlers.onRemove
      ? [
          {
            label: 'Remove project…',
            icon: icon(Trash2),
            destructive: true,
            separator: true,
            action: handlers.onRemove,
          },
        ]
      : []),
  ];
}

/** The label of an item, with the reason of a disabled item as a second line. */
function ItemLabel({ item }: { item: TreeAction }) {
  return item.disabled && item.reason ? (
    <span className="grid min-w-0 flex-1">
      <span>{item.label}</span>
      <span className="text-xs text-muted-foreground">{item.reason}</span>
    </span>
  ) : (
    <span className="flex-1">{item.label}</span>
  );
}

/** The Color label and the 8 swatches of a menu. */
function ColorSection({ color }: { color: ColorChoice }) {
  return (
    <div className="menu-color" role="group" aria-label="Color">
      <div className={menuLabelClass} aria-hidden="true">
        Color
      </div>
      <IdentitySwatches
        label="Color"
        value={color.value}
        onChange={color.onChange}
        withAutomatic={color.chosen}
      />
    </div>
  );
}

/** The right-click menu of a sidebar row. It has the same items as the row's … menu. */
export function TreeContextMenu({
  children,
  actions,
  color,
  extra,
  label = 'Item actions',
  disabled = false,
}: {
  children: ReactElement;
  /** The accessible name of the menu, such as "Project actions". */
  label?: string;
  actions: TreeAction[];
  color?: ColorChoice;
  /** More rows after the Color swatches, such as Usage. Context menu parts only. */
  extra?: ReactNode;
  disabled?: boolean;
}) {
  const hasSlot = actions.some((item) => item.colorBefore);
  const slot = (
    <>
      {/* SH-A2: Color follows Rename… without a line. */}
      {color && <ColorSection color={color} />}
      {extra && (
        <>
          <ContextMenu.Separator className={menuSeparatorClass} />
          {extra}
        </>
      )}
    </>
  );
  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        asChild
        disabled={disabled}
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
          className={cn(
            menuSurfaceClass,
            // The project menu with its Color swatches is 248px wide (SH-A2).
            color ? 'w-[248px] min-w-fit' : menuWideClass,
            'max-h-(--radix-context-menu-content-available-height) origin-(--radix-context-menu-content-transform-origin)',
          )}
          aria-label={label}
        >
          {actions.map((item) => (
            <Fragment key={item.label}>
              {item.colorBefore && slot}
              {item.separator && <ContextMenu.Separator className={menuSeparatorClass} />}
              <ContextMenu.Item
                disabled={item.disabled}
                onSelect={item.action}
                className={cn(
                  menuItemClass,
                  // An item with a reason shows a second line, so it is taller.
                  item.disabled && item.reason && 'h-auto py-1.5',
                  item.destructive && menuDestructiveClass,
                )}
              >
                {item.icon}
                <ItemLabel item={item} />
                {item.shortcut && <span className={menuShortcutClass}>{item.shortcut}</span>}
              </ContextMenu.Item>
            </Fragment>
          ))}
          {!hasSlot && slot}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}

/**
 * The … menu of a row, with a 16px icon on each item. In the sidebar, it has the same items as
 * the right-click menu.
 */
export function TreeActionsMenu({
  label,
  actions,
  color,
  extra,
  disabled,
  className,
  size = 'xs',
  align = 'start',
}: {
  label: string;
  actions: TreeAction[];
  color?: ColorChoice;
  /** More rows after the Color swatches, such as Usage. Dropdown menu parts only. */
  extra?: ReactNode;
  disabled?: boolean;
  className?: string;
  /** md (32px) in page headers, sm (28px) in toolbars, xs (24px) in list and tree rows. */
  size?: 'md' | 'sm' | 'xs';
  align?: 'start' | 'end';
}) {
  const hasSlot = actions.some((item) => item.colorBefore);
  const slot = (
    <>
      {color && <ColorSection color={color} />}
      {extra && (
        <>
          <DropdownMenuSeparator />
          {extra}
        </>
      )}
    </>
  );
  return (
    <DropdownMenu>
      <Hint label={label} disabled={disabled}>
        <DropdownMenuTrigger asChild>
          <MoreButton size={size} label={label} className={className} disabled={disabled} />
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent
        align={align}
        aria-label={label}
        className={actions.some((item) => item.shortcut) ? menuWideClass : undefined}
      >
        {actions.map((item) => (
          <Fragment key={item.label}>
            {item.colorBefore && slot}
            {item.separator && <DropdownMenuSeparator />}
            <DropdownMenuItem
              variant={item.destructive ? 'destructive' : 'default'}
              disabled={item.disabled}
              className={item.disabled && item.reason ? 'h-auto py-1.5' : undefined}
              onSelect={item.action}
            >
              {item.icon}
              <ItemLabel item={item} />
              {item.shortcut && <span className={menuShortcutClass}>{item.shortcut}</span>}
            </DropdownMenuItem>
          </Fragment>
        ))}
        {!hasSlot && slot}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
