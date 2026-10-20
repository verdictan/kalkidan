import { Fragment, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { DropdownMenu as Menu } from 'radix-ui';
import type { ProjectColor } from '../domain/project-colors';
import { MoreButton } from './ui/more-button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from './ui/dropdown-menu';
import { menuItemClass } from './ui/menu-styles';
import { colorName, folderColorOptions, type FolderColorChoice } from './tree-context-menu';
import { Hint } from './hint';

export interface ActionMenuItem {
  label: string;
  action: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Tells the user why the item is disabled. It shows as a second line. */
  reason?: string;
  /** Draws a separator above this item. */
  separator?: boolean;
}

export function ActionMenu({
  label,
  disabled,
  items,
  restoreFocus = true,
  size = 'sm',
  className,
  folderColor,
  trigger,
}: {
  restoreFocus?: boolean;
  label: string;
  disabled?: boolean;
  /** md (32px) in page headers, sm (28px) in toolbars, xs (24px) in list and tree rows. */
  size?: 'md' | 'sm' | 'xs';
  className?: string;
  items: ActionMenuItem[];
  /** Shows the folder colors first, the same as the project context menu. */
  folderColor?: FolderColorChoice;
  /** A different trigger button. The default is the ellipsis button. */
  trigger?: ReactNode;
}) {
  return (
    <DropdownMenu>
      <Hint label={label} disabled={disabled}>
        <DropdownMenuTrigger asChild>
          {trigger || (
            <MoreButton size={size} label={label} className={className} disabled={disabled} />
          )}
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          if (!restoreFocus) event.preventDefault();
        }}
      >
        {folderColor && (
          <>
            <DropdownMenuLabel>Folder color</DropdownMenuLabel>
            <Menu.RadioGroup
              value={folderColor.value || 'default'}
              onValueChange={(value) =>
                folderColor.onChange(value === 'default' ? null : (value as ProjectColor))
              }
            >
              {folderColorOptions.map(([name, color]) => (
                <Menu.RadioItem
                  key={name}
                  value={name}
                  disabled={folderColor.disabled}
                  className={menuItemClass}
                >
                  <span
                    className="size-3 shrink-0 rounded-full"
                    style={{ backgroundColor: color }}
                  />
                  <span className="flex-1">{colorName(name)}</span>
                  <Menu.ItemIndicator aria-hidden="true">
                    <Check />
                  </Menu.ItemIndicator>
                </Menu.RadioItem>
              ))}
            </Menu.RadioGroup>
            <DropdownMenuSeparator />
          </>
        )}
        {items.map((item) => {
          const reason = item.disabled && item.reason;
          return (
            <Fragment key={item.label}>
              {item.separator && <DropdownMenuSeparator />}
              <DropdownMenuItem
                variant={item.danger ? 'destructive' : 'default'}
                disabled={item.disabled}
                className={reason ? 'h-auto flex-col items-start gap-0 py-1.5' : undefined}
                onSelect={item.action}
              >
                {item.label}
                {reason && <span className="text-xs text-muted-foreground">{reason}</span>}
              </DropdownMenuItem>
            </Fragment>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
