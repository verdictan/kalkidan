import type { ComponentProps } from 'react';
import { Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Input } from './input';

/**
 * A search field with a 14px icon. sm 28px for filter bars, md 32px elsewhere. Every search
 * field uses the filled style with 13px text, in both themes.
 */
export function SearchInput({
  className,
  size = 'md',
  variant = 'filled',
  ...props
}: Omit<ComponentProps<typeof Input>, 'size'> & { size?: 'sm' | 'md' }) {
  return (
    <div className={cn('relative min-w-0', className)}>
      <Search
        className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden="true"
      />
      <Input type="search" variant={variant} size={size} className="pl-7 text-sm" {...props} />
    </div>
  );
}
