import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

// A drawn control, so that it looks the same in every theme and on every platform.
const control =
  'peer relative shrink-0 size-4 cursor-pointer appearance-none border border-[var(--border-strong)] bg-[var(--background)] outline-none transition-[background-color,border-color] duration-[var(--motion-fast)] hover:border-[var(--muted-foreground)] focus-visible:shadow-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-50 checked:border-[var(--primary)] checked:bg-[var(--primary)]';
const tick =
  'checked:bg-[image:var(--checkbox-tick)] checked:bg-center checked:bg-no-repeat checked:bg-[length:12px_12px] indeterminate:border-[var(--primary)] indeterminate:bg-[var(--primary)] indeterminate:bg-[image:var(--checkbox-dash)] indeterminate:bg-center indeterminate:bg-no-repeat indeterminate:bg-[length:10px_10px]';
const dot =
  'checked:bg-[image:var(--radio-dot)] checked:bg-center checked:bg-no-repeat checked:bg-[length:6px_6px]';

/** A 16px check box with the app focus ring. Use CheckboxRow for a box with a label. */
export function Checkbox({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn(control, tick, 'rounded-xs', className)}
      {...props}
    />
  );
}

/** A 16px radio button with the app focus ring. */
export function Radio({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <input
      type="radio"
      data-slot="radio"
      className={cn(control, dot, 'rounded-full', className)}
      {...props}
    />
  );
}

/**
 * A check box or radio button with its label and optional help text. The control aligns with
 * the first line of the label.
 */
export function CheckboxRow({
  type = 'checkbox',
  label,
  description,
  className,
  ...props
}: Omit<ComponentProps<'input'>, 'type'> & {
  type?: 'checkbox' | 'radio';
  label: ReactNode;
  description?: ReactNode;
}) {
  const Control = type === 'radio' ? Radio : Checkbox;
  return (
    <label
      className={cn('flex min-w-0 items-start gap-2 text-sm has-[:disabled]:opacity-50', className)}
    >
      <Control className="mt-0.5" {...props} />
      <span className="grid min-w-0 gap-0.5">
        <span className="min-w-0">{label}</span>
        {description && (
          <span className="text-xs leading-4 text-muted-foreground">{description}</span>
        )}
      </span>
    </label>
  );
}
