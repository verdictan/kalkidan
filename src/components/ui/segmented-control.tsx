import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Hint } from '../hint';
import { CountBadge } from './count';

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
  /** The accessible name when the label is not text, or is not the full name. */
  ariaLabel?: string;
  id?: string;
  /** A tooltip, with an optional shortcut. */
  hint?: string;
  shortcut?: string;
  /** A count after the label, as a CountBadge. Zero shows nothing. */
  count?: number;
}

/**
 * A row of toggle buttons where one option is active. Each option is a pressed button. sm
 * (28/24) for view switches in pages and toolbars, md (32/28) in forms. With `allowNone`, a
 * click on the active option clears the value (a toggle group, for example the tool buttons).
 * An option with an icon and no label is a 24px square at sm.
 */
export function SegmentedControl<T extends string>({
  value,
  onChange,
  options,
  label,
  size = 'md',
  allowNone = false,
  className,
}: {
  label: string;
  size?: 'sm' | 'md';
  className?: string;
} & (
  | { allowNone?: false; value: T; onChange: (value: T) => void }
  | { allowNone: true; value: T | null; onChange: (value: T | null) => void }
) & { options: SegmentedOption<T>[] }) {
  const select = (next: T) => {
    if (allowNone) (onChange as (value: T | null) => void)(next === value ? null : next);
    else (onChange as (value: T) => void)(next);
  };
  return (
    <div role="group" aria-label={label} className={cn('segmented', className)} data-size={size}>
      {options.map((option) => {
        const button = (
          <button
            key={option.value}
            id={option.id}
            type="button"
            className="segmented-item"
            aria-pressed={option.value === value}
            aria-label={option.ariaLabel}
            disabled={option.disabled}
            onClick={() => select(option.value)}
          >
            {option.icon}
            {option.label}
            {!!option.count && <CountBadge aria-hidden="true">{option.count}</CountBadge>}
          </button>
        );
        return option.hint ? (
          <Hint key={option.value} label={option.hint} shortcut={option.shortcut}>
            {button}
          </Hint>
        ) : (
          button
        );
      })}
    </div>
  );
}
