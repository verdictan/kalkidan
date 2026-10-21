import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Slot } from 'radix-ui';

const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:ring-2 focus-visible:ring-[var(--focus-color)] aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground [a&]:hover:bg-primary/90',
        secondary: 'bg-secondary text-secondary-foreground [a&]:hover:bg-secondary/90',
        destructive: 'bg-destructive text-destructive-foreground [a&]:hover:bg-destructive/90',
        outline:
          'border-border text-foreground [a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
        ghost: '[a&]:hover:bg-accent [a&]:hover:text-accent-foreground',
        link: 'text-primary underline-offset-4 [a&]:hover:underline',
        success: 'bg-[color-mix(in_srgb,var(--success)_16%,transparent)] text-success',
        warning: 'bg-[color-mix(in_srgb,var(--warning)_18%,transparent)] text-warning',
        muted: 'bg-secondary text-muted-foreground',
      },
      size: {
        // sm 20px for tags in rows, md 24px for status badges.
        sm: 'h-5 px-1.5 text-2xs',
        md: 'h-6 px-2 text-xs',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'md',
    },
  },
);

function Badge({
  className,
  variant = 'default',
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
