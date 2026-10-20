import { Check } from 'lucide-react';
import { projectColors, type ProjectColor } from '../domain/project-colors';
import { Fragment, type ReactElement } from 'react';
import { ContextMenu } from 'radix-ui';
import { cn } from '../lib/utils';
import {
  menuContentClass,
  menuDestructiveClass,
  menuItemClass,
  menuLabelClass,
  menuSeparatorClass,
} from './ui/menu-styles';

export interface TreeAction {
  label: string;
  action(): void;
  disabled?: boolean;
  destructive?: boolean;
  /** Tells the user why the action is disabled. */
  reason?: string;
  /** Draws a separator above this item. */
  separator?: boolean;
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
          className={cn(menuContentClass, 'origin-(--radix-context-menu-content-transform-origin)')}
          aria-label={label}
        >
          {folderColor && (
            <>
              <ContextMenu.Label className={menuLabelClass}>Folder color</ContextMenu.Label>
              <ContextMenu.RadioGroup
                value={folderColor.value || 'default'}
                onValueChange={(value) =>
                  folderColor.onChange(value === 'default' ? null : (value as ProjectColor))
                }
              >
                {folderColorOptions.map(([name, color]) => (
                  <ContextMenu.RadioItem
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
                    <ContextMenu.ItemIndicator aria-hidden="true">
                      <Check />
                    </ContextMenu.ItemIndicator>
                  </ContextMenu.RadioItem>
                ))}
              </ContextMenu.RadioGroup>
              <ContextMenu.Separator className={menuSeparatorClass} />
            </>
          )}
          {actions.map((item) => (
            <Fragment key={item.label}>
              {item.separator && <ContextMenu.Separator className={menuSeparatorClass} />}
              <ContextMenu.Item
                disabled={item.disabled}
                onSelect={item.action}
                className={cn(
                  menuItemClass,
                  // An item with a reason shows a second line, so it is taller.
                  item.disabled && item.reason && 'h-auto flex-col items-start gap-0 py-1.5',
                  item.destructive && menuDestructiveClass,
                )}
              >
                {item.label}
                {item.disabled && item.reason && (
                  <span className="text-xs text-muted-foreground">{item.reason}</span>
                )}
              </ContextMenu.Item>
            </Fragment>
          ))}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
