import { projectColors, type ProjectColor } from '../domain/project-colors';
import type { ReactElement } from 'react';
import { ContextMenu } from 'radix-ui';

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
        <ContextMenu.Content
          className="z-50 min-w-48 rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          aria-label="Explorer actions"
        >
          {folderColor && (
            <>
              <ContextMenu.Label className="px-2 py-1.5 text-xs text-muted-foreground">
                Folder color
              </ContextMenu.Label>
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
                      className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none focus:bg-accent data-[disabled]:opacity-50"
                    >
                      <span className="size-3 rounded-full" style={{ backgroundColor: color }} />
                      <span className="flex-1">{name[0].toUpperCase() + name.slice(1)}</span>
                      <ContextMenu.ItemIndicator aria-hidden="true">✓</ContextMenu.ItemIndicator>
                    </ContextMenu.RadioItem>
                  ),
                )}
              </ContextMenu.RadioGroup>
              <ContextMenu.Separator className="my-1 h-px bg-border" />
            </>
          )}
          {actions.map((item) => (
            <ContextMenu.Item
              key={item.label}
              disabled={item.disabled}
              onSelect={item.action}
              className={
                'relative flex cursor-default select-none flex-col items-start rounded-sm px-2 py-1.5 text-sm outline-hidden focus:bg-accent data-[disabled]:pointer-events-none data-[disabled]:opacity-50' +
                (item.destructive ? ' text-destructive focus:bg-destructive/10' : '')
              }
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
