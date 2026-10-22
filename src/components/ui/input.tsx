import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * outline: a strong border (forms). filled: tinted, with a divider border (filter and address
 * bars). Focus: the border in the ring color plus a 3px ring at 20%, with no offset.
 */
function Input({
  className,
  type,
  variant = 'outline',
  size = 'md',
  ...props
}: Omit<React.ComponentProps<'input'>, 'size'> & {
  variant?: 'outline' | 'filled';
  /** md 32px for forms, sm 28px for toolbars and filter bars. */
  size?: 'sm' | 'md';
}) {
  return (
    <input
      type={type}
      data-slot="input"
      data-variant={variant}
      data-size={size}
      className={cn(
        'h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1 text-sm shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:border-ring focus-visible:shadow-[var(--focus-ring-field)]',
        size === 'sm' && 'h-7 px-2 text-xs',
        variant === 'filled' &&
          'border-border bg-secondary shadow-none focus-visible:bg-transparent',
        'aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
