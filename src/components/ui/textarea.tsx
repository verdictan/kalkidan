import * as React from 'react';
import { cn } from '@/lib/utils';

function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        'flex field-sizing-content min-h-16 w-full rounded-md border-0 bg-[var(--fill)] px-3 py-2 text-sm transition-[color,background-color,box-shadow] hover:bg-[var(--fill-strong)] outline-none placeholder:text-muted-foreground focus-visible:bg-background focus-visible:shadow-[inset_0_0_0_1px_var(--border-strong),var(--focus-ring-field)] disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:shadow-[inset_0_0_0_1px_var(--destructive)]',
        className,
      )}
      {...props}
    />
  );
}

export { Textarea };
