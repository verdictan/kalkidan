import type { ComponentProps, ReactNode } from 'react';
import { cn } from '@/lib/utils';

const control =
  'peer shrink-0 size-4 cursor-pointer accent-[var(--primary)] outline-none focus-visible:shadow-[var(--focus-ring)] disabled:cursor-not-allowed disabled:opacity-50';

/** A 16px check box with the app focus ring. Use CheckboxRow for a box with a label. */
export function Checkbox({ className, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
  return (
    <input
      type="checkbox"
      data-slot="checkbox"
      className={cn(control, 'rounded-sm', className)}
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
      className={cn(control, 'rounded-full', className)}
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
