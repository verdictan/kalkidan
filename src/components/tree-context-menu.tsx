import { Check } from 'lucide-react';
import { projectColors, type ProjectColor } from '../domain/project-colors';
import type { ReactElement } from 'react';
import { ContextMenu } from 'radix-ui';
import { cn } from '../lib/utils';
import {
  menuContentClass,
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
}
export function TreeContextMenu({
  children,
  actions,
  folderColor,
}: {
  children: ReactElement;
  actions: TreeAction[];
  folderColor?: {
    value?: ProjectColor;
    disabled?: boolean;
    onChange: (color: ProjectColor | null) => void;
  };
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
        <ContextMenu.Content className={menuContentClass} aria-label="Explorer actions">
          {folderColor && (
            <>
              <ContextMenu.Label className={menuLabelClass}>Folder color</ContextMenu.Label>
              <ContextMenu.RadioGroup
                value={folderColor.value || 'default'}
                onValueChange={(value) =>
                  folderColor.onChange(value === 'default' ? null : (value as ProjectColor))
                }
              >
                {[['default', 'var(--muted-foreground)'], ...Object.entries(projectColors)].map(
                  ([name, color]) => (
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
                      <span className="flex-1">{name[0].toUpperCase() + name.slice(1)}</span>
                      <ContextMenu.ItemIndicator aria-hidden="true">
                        <Check />
                      </ContextMenu.ItemIndicator>
                    </ContextMenu.RadioItem>
                  ),
                )}
              </ContextMenu.RadioGroup>
              <ContextMenu.Separator className={menuSeparatorClass} />
            </>
          )}
          {actions.map((item) => (
            <ContextMenu.Item
              key={item.label}
              disabled={item.disabled}
              onSelect={item.action}
              className={cn(
                menuItemClass,
                // An item with a reason shows a second line, so it is taller.
                item.disabled && item.reason && 'h-auto flex-col items-start gap-0 py-1.5',
                item.destructive &&
                  'text-destructive focus:bg-destructive/10 focus:text-destructive',
              )}
            >
              {item.label}
              {item.disabled && item.reason && (
                <span className="text-xs text-muted-foreground">{item.reason}</span>
              )}
            </ContextMenu.Item>
          ))}
        </ContextMenu.Content>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  );
}
