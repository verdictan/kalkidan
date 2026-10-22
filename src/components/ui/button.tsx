import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';
import { Slot } from 'radix-ui';

const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 rounded-md text-sm font-medium whitespace-nowrap transition-[color,background-color,border-color,box-shadow,opacity] duration-150 outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus-color)] focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50 aria-pressed:bg-[var(--surface-selected)] aria-invalid:border-destructive aria-invalid:ring-destructive/20 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // A disabled primary is a muted fill with muted text at full opacity: never pale brown.
        default:
          'bg-primary text-primary-foreground hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100',
        destructive: 'bg-destructive text-destructive-foreground hover:bg-destructive/90',
        outline: 'border bg-transparent shadow-xs hover:bg-[var(--surface-hover)]',
        // The trigger of a destructive action in a Danger zone. Filled red is only for the
        // button inside the confirmation.
        'destructive-outline':
          'border bg-transparent text-destructive shadow-xs hover:bg-destructive/10 hover:text-destructive',
        ghost: 'hover:bg-[var(--surface-hover)] hover:text-accent-foreground',
        // The one link style. At the default size it is inline text: no height or padding.
        link: 'text-link underline-offset-2 hover:underline',
        // Small pill for composer controls, attachments and inline links: 28px, 12px text.
        chip: "h-7 rounded-full px-2.5 text-xs font-medium text-muted-foreground hover:bg-[var(--surface-hover)] hover:text-foreground has-[>svg]:px-2.5 [&_svg:not([class*='size-'])]:size-3.5",
        // Text that acts as a button: no padding, height, background or centering.
        bare: 'h-auto justify-start p-0 hover:bg-transparent has-[>svg]:px-0',
      },
      size: {
        // Control heights: lg 36 (empty-state actions), default 32, sm 28, xs 24.
        default: 'h-8 px-3 has-[>svg]:px-2.5',
        xs: "h-6 gap-1 rounded-sm px-2 text-xs has-[>svg]:px-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1.5 rounded-md px-2.5 has-[>svg]:px-2 [&_svg:not([class*='size-'])]:size-3.5",
        lg: 'h-9 rounded-md px-4 has-[>svg]:px-3',
        icon: 'size-8',
        'icon-xs': "size-6 rounded-sm [&_svg:not([class*='size-'])]:size-3.5",
        'icon-2xs': "size-5 rounded-sm [&_svg:not([class*='size-'])]:size-3",
        // Icon buttons: 16px icons at 32 and 28, 14px at 24, 12px at 20.
        'icon-sm': 'size-7',
      },
    },
    compoundVariants: [
      // A bare button keeps no size box: the size classes would add height and padding.
      { variant: 'bare', class: 'h-auto rounded-sm p-0 has-[>svg]:px-0' },
      // A link at the default size is inline text with the size and weight of its paragraph.
      {
        variant: 'link',
        size: 'default',
        class:
          'h-auto gap-1 rounded-xs p-0 align-baseline [font-size:inherit] [font-weight:inherit] [line-height:inherit] has-[>svg]:px-0',
      },
      // A chip is always a 28px pill, at every size.
      { variant: 'chip', class: 'h-7 rounded-full px-2.5 has-[>svg]:px-2.5' },
    ],
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  asChild = false,
  ...props
}: React.ComponentProps<'button'> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot.Root : 'button';

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
