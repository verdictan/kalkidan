import type { ComponentProps } from 'react';
import { Check } from 'lucide-react';
import { DropdownMenu as Menu } from 'radix-ui';
import { cn } from '../lib/utils';
import { menuItemClass } from './ui/menu-styles';

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

/**
 * A radio item with the check at the end. Its icon and label start at the same x as the plain
 * items of the menu, so a menu can mix choices and actions without an indent. Use it in a
 * `DropdownMenuRadioGroup`.
 */
export function MenuChoiceItem({
  className,
  children,
  ...props
}: ComponentProps<typeof Menu.RadioItem>) {
  return (
    <Menu.RadioItem className={cn(menuItemClass, className)} {...props}>
      {children}
      <Menu.ItemIndicator className="ml-auto flex" aria-hidden="true">
        <Check />
      </Menu.ItemIndicator>
    </Menu.RadioItem>
  );
}
