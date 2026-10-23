import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * SY-B: every field is the grey fill with no border at rest, radius 8. Focus: white, the strong
 * border as an inset ring, plus a 3px brown ring at 20%. Invalid: a red inset ring. The
 * `variant` prop stays for old callers; both values look the same.
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
        'h-8 w-full min-w-0 rounded-md border-0 bg-[var(--fill)] px-3 py-1 text-sm transition-[color,background-color,box-shadow] hover:bg-[var(--fill-strong)] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50',
        'focus-visible:bg-background focus-visible:shadow-[inset_0_0_0_1px_var(--border-strong),var(--focus-ring-field)]',
        size === 'sm' && 'h-7 px-2 text-sm',
        'aria-invalid:shadow-[inset_0_0_0_1px_var(--destructive)]',
        className,
      )}
      {...props}
    />
  );
}

export { Input };
