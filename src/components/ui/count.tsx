import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** A count next to a label: 12/16, tabular, muted. For example "Sessions 3". */
export function Count({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="count" className={cn('count', className)} {...props} />;
}

/** A count in a 16px pill, for tabs, filters and tool buttons. */
export function CountBadge({ className, ...props }: ComponentProps<'span'>) {
  return <span data-slot="count-badge" className={cn('count-badge', className)} {...props} />;
}
