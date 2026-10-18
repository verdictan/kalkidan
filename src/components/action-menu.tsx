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
}: {
  label: string;
  disabled?: boolean;
  items: { label: string; action: () => void; danger?: boolean }[];
}) {
  return (
    <DropdownMenu>
      <Hint label={label}>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={label} disabled={disabled}>
            <Ellipsis size={16} />
          </Button>
        </DropdownMenuTrigger>
      </Hint>
      <DropdownMenuContent align="end" sideOffset={6}>
        {items.map((item) => (
          <DropdownMenuItem
            key={item.label}
            variant={item.danger ? 'destructive' : 'default'}
            onSelect={item.action}
          >
            {item.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
