import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Slot } from 'radix-ui';

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-sm border border-transparent font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:ring-2 focus-visible:ring-[var(--focus-color)] focus-visible:ring-offset-2 focus-visible:ring-offset-background aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground [a&]:hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90',
        destructive: 'bg-destructive text-destructive-foreground [a&]:hover:bg-destructive/90',
        outline: 'border-border text-foreground [a&]:hover:bg-[var(--surface-hover)]',
        ghost: '[a&]:hover:bg-[var(--surface-hover)]',
        link: 'text-primary underline-offset-4 [a&]:hover:underline',
        success: 'bg-success-subtle text-success',
        warning: 'bg-warning-subtle text-warning',
        muted: 'bg-secondary text-muted-foreground',
      },
      size: {
        // One badge shape: 20px, radius 6, 11/16 medium, 6px side padding. sm is the same.
        sm: 'h-5 px-1.5 text-2xs',
        md: 'h-5 px-1.5 text-2xs',
      },
    },
    // Status and labels are quiet. Brown (default) is only for the "waiting for you" count.
    defaultVariants: {
      variant: 'muted',
      size: 'md',
    },
  },
);

function Badge({
  className,
  variant = 'muted',
  size = 'md',
  asChild = false,
  ...props
}: React.ComponentProps<'span'> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'span';

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  );
}

export { Badge, badgeVariants };
