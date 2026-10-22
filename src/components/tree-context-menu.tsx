import {
  Check,
  FilePlus2,
  FolderGit2,
  FolderPlus,
  ListPlus,
  MessageSquarePlus,
  Palette,
  PenLine,
  Settings2,
  Unplug,
} from 'lucide-react';
import { projectColors, type ProjectColor } from '../domain/project-colors';
import { Fragment, type ReactElement, type ReactNode } from 'react';
import { ContextMenu, DropdownMenu as Menu } from 'radix-ui';
import { cn } from '../lib/utils';
import { Hint } from './hint';
import { MoreButton } from './ui/more-button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import {
  menuCollisionPadding,
  menuContentClass,
  menuDestructiveClass,
  menuItemClass,
  menuSeparatorClass,
} from './ui/menu-styles';

export interface TreeAction {
  label: string;
  action(): void;
  /** A 16px icon before the label. */
  icon?: ReactNode;
  disabled?: boolean;
  destructive?: boolean;
  /** Tells the user why the action is disabled. */
  reason?: string;
  /** Draws a separator above this item. */
  separator?: boolean;
  /** Shows the Color submenu just before this item and its separator. */
  colorBefore?: boolean;
}
/** The folder color choices of a project menu. */
export interface FolderColorChoice {
  value?: ProjectColor;
  disabled?: boolean;
  onChange: (color: ProjectColor | null) => void;
}
export const folderColorOptions: [string, string][] = [
  ['default', 'var(--muted-foreground)'],
  ...Object.entries(projectColors),
];
export const colorName = (name: string) => name[0].toUpperCase() + name.slice(1);

/** One color choice row: the swatch, the name and a check on the current color. */
function ColorItems({
  parts,
  folderColor,
}: {
  parts: typeof ContextMenu | typeof Menu;
  folderColor: FolderColorChoice;
}) {
  return (
    <parts.RadioGroup
      value={folderColor.value || 'default'}
      onValueChange={(value) =>
        folderColor.onChange(value === 'default' ? null : (value as ProjectColor))
      }
    >
      {folderColorOptions.map(([name, color]) => (
        <parts.RadioItem
          key={name}
          value={name}
          disabled={folderColor.disabled}
          className={menuItemClass}
        >
          <span className="size-3 shrink-0 rounded-full" style={{ backgroundColor: color }} />
          <span className="flex-1">{colorName(name)}</span>
          <parts.ItemIndicator aria-hidden="true">
            <Check />
          </parts.ItemIndicator>
        </parts.RadioItem>
      ))}
    </parts.RadioGroup>
  );
}

/** The Color submenu of a right-click menu. */
function ContextColor({ folderColor }: { folderColor: FolderColorChoice }) {
  return (
    <ContextMenu.Sub>
      <ContextMenu.SubTrigger className={menuItemClass}>
        <Palette className="size-4" />
        <span className="flex-1">Color</span>
      </ContextMenu.SubTrigger>
      <ContextMenu.Portal>
        <ContextMenu.SubContent
          collisionPadding={menuCollisionPadding}
          className={menuContentClass}
        >
          <ColorItems parts={ContextMenu} folderColor={folderColor} />
        </ContextMenu.SubContent>
      </ContextMenu.Portal>
    </ContextMenu.Sub>
  );
}

/** The Color submenu of a ⋯ menu. */
function DropdownColor({ folderColor }: { folderColor: FolderColorChoice }) {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Palette className="size-4" />
        Color
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        <ColorItems parts={Menu} folderColor={folderColor} />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/** What the one project menu does. The sidebar row and the project header use the same menu. */
export interface ProjectMenuHandlers {
  onNewChat(): void;
  onNewTask(): void;
  onNewPage(): void;
  onAddFolder(): void;
  onCloneFromGitHub(): void;
  onRename(): void;
  onSettings(): void;
  /** Shows "Reconnect to host" for a remote project whose host is not connected. */
  reconnect?: { host: string; disabled?: boolean; run(): void };
  busy?: boolean;
}

/**
 * The items of the one project menu, in this order: New chat, New task, New page — Add code
 * folder, Clone from GitHub — Rename, Color — Project settings. Give the color choice to the
 * menu as `folderColor`. The Color submenu then shows after "Rename".
 */
export function projectMenuActions(handlers: ProjectMenuHandlers): TreeAction[] {
  const icon = (Icon: typeof Palette) => <Icon className="size-4" />;
  return [
    { label: 'New chat', icon: icon(MessageSquarePlus), action: handlers.onNewChat },
    { label: 'New task', icon: icon(ListPlus), action: handlers.onNewTask },
    { label: 'New page', icon: icon(FilePlus2), action: handlers.onNewPage },
    {
      label: 'Add code folder…',
      icon: icon(FolderPlus),
      separator: true,
      disabled: handlers.busy,
      action: handlers.onAddFolder,
    },
    {
      label: 'Clone from GitHub…',
      icon: icon(FolderGit2),
      disabled: handlers.busy,
      action: handlers.onCloneFromGitHub,
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
      separator: true,
      disabled: handlers.busy,
      action: handlers.onRename,
    },
    {
      label: 'Project settings…',
      icon: icon(Settings2),
      separator: true,
      colorBefore: true,
      action: handlers.onSettings,
    },
  ];
}

/** The label of an item, with the reason of a disabled item as a second line. */
function ItemLabel({ item }: { item: TreeAction }) {
  return item.disabled && item.reason ? (
    <span className="grid min-w-0">
      <span>{item.label}</span>
      <span className="text-xs text-muted-foreground">{item.reason}</span>
    </span>
  ) : (
    <>{item.label}</>
  );
}

/** The right-click menu of a sidebar row. It has the same items as the row's … menu. */
export function TreeContextMenu({
  children,
  actions,
  folderColor,
  label = 'Item actions',
}: {
  children: ReactElement;
  /** The accessible name of the menu, such as "Project actions". */
  label?: string;
  actions: TreeAction[];
  folderColor?: FolderColorChoice;
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
          className={cn(
            menuContentClass,
            'max-h-(--radix-context-menu-content-available-height) origin-(--radix-context-menu-content-transform-origin)',
          )}
          aria-label={label}
        >
          {actions.map((item) => (
            <Fragment key={item.label}>
              {item.colorBefore && folderColor && <ContextColor folderColor={folderColor} />}
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
              </ContextMenu.Item>
            </Fragment>
          ))}
          {folderColor && !actions.some((item) => item.colorBefore) && (
            <>
              <ContextMenu.Separator className={menuSeparatorClass} />
              <ContextColor folderColor={folderColor} />
            </>
          )}
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
  folderColor,
  disabled,
  className,
  size = 'xs',
  align = 'start',
}: {
  label: string;
  actions: TreeAction[];
  folderColor?: FolderColorChoice;
  disabled?: boolean;
  className?: string;
  /** md (32px) in page headers, sm (28px) in toolbars, xs (24px) in list and tree rows. */
  size?: 'md' | 'sm' | 'xs';
  align?: 'start' | 'end';
}) {
  return (
    <DropdownMenu>
      <Hint label={label} disabled={disabled}>
        <DropdownMenuTrigger asChild>
          <MoreButton size={size} label={label} className={className} disabled={disabled} />
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent align={align} aria-label={label}>
        {actions.map((item) => (
          <Fragment key={item.label}>
            {item.colorBefore && folderColor && <DropdownColor folderColor={folderColor} />}
            {item.separator && <DropdownMenuSeparator />}
            <DropdownMenuItem
              variant={item.destructive ? 'destructive' : 'default'}
              disabled={item.disabled}
              className={item.disabled && item.reason ? 'h-auto py-1.5' : undefined}
              onSelect={item.action}
            >
              {item.icon}
              <ItemLabel item={item} />
            </DropdownMenuItem>
          </Fragment>
        ))}
        {folderColor && !actions.some((item) => item.colorBefore) && (
          <>
            <DropdownMenuSeparator />
            <DropdownColor folderColor={folderColor} />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
