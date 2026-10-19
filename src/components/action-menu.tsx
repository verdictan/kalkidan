import { Ellipsis } from 'lucide-react';
import { Button } from './ui/button';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from './ui/dropdown-menu';
import { Hint } from './hint';
export function ActionMenu({
  label,
  disabled,
  items,
  restoreFocus = true,
  className,
}: {
  restoreFocus?: boolean;
  label: string;
  disabled?: boolean;
  className?: string;
  items: { label: string; action: () => void; danger?: boolean; disabled?: boolean }[];
}) {
  return (
    <DropdownMenu>
      <Hint label={label} disabled={disabled}>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className={className}
            aria-label={label}
            disabled={disabled}
          >
            <Ellipsis size={16} />
          </Button>
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent
        align="end"
        sideOffset={6}
        onCloseAutoFocus={(event) => {
          if (!restoreFocus) event.preventDefault();
        }}
      >
        {items.map((item) => (
          <DropdownMenuItem
            key={item.label}
            variant={item.danger ? 'destructive' : 'default'}
            disabled={item.disabled}
            onSelect={item.action}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
