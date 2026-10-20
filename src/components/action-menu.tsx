import { MoreButton } from './ui/more-button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './ui/dropdown-menu';
import { Hint } from './hint';

export interface ActionMenuItem {
  label: string;
  action: () => void;
  danger?: boolean;
  disabled?: boolean;
  /** Tells the user why the item is disabled. It shows as a second line. */
  reason?: string;
}

export function ActionMenu({
  label,
  disabled,
  items,
  restoreFocus = true,
  size = 'sm',
  className,
}: {
  restoreFocus?: boolean;
  label: string;
  disabled?: boolean;
  /** md (32px) in page headers, sm (28px) in toolbars, xs (24px) in list and tree rows. */
  size?: 'md' | 'sm' | 'xs';
  className?: string;
  items: ActionMenuItem[];
}) {
  return (
    <DropdownMenu>
      <Hint label={label} disabled={disabled}>
        <DropdownMenuTrigger asChild>
          <MoreButton size={size} label={label} className={className} disabled={disabled} />
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent
        align="end"
        onCloseAutoFocus={(event) => {
          if (!restoreFocus) event.preventDefault();
        }}
      >
        {items.map((item) => {
          const reason = item.disabled && item.reason;
          return (
            <DropdownMenuItem
              key={item.label}
              variant={item.danger ? 'destructive' : 'default'}
              disabled={item.disabled}
              className={reason ? 'h-auto flex-col items-start gap-0 py-1.5' : undefined}
              onSelect={item.action}
            >
              {item.label}
              {reason && <span className="text-xs text-muted-foreground">{reason}</span>}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
