import { useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { cn } from '@/lib/utils';
import {
  identityColorLabels,
  identityColorNames,
  identityStyle,
  type IdentityColor,
} from '../../domain/identity';

/**
 * The eight identity colors as 16px swatches (radius 4), 6px apart. The current color has a 2px
 * ring. A radio group: the arrow keys move between the colors. With `withAutomatic`, an
 * "Automatic" row follows the swatches; the caller can also render Automatic as a menu item.
 * With `automaticChoice`, "Automatic" is the last radio of the group and is checked while no
 * color is chosen; `automatic` (the color that Kalkidan gives) then shows as the current color
 * with a thin ring, without a check.
 */
export function IdentitySwatches({
  value,
  onChange,
  label = 'Color',
  withAutomatic = false,
  automaticChoice = false,
  automatic,
  className,
}: {
  value: IdentityColor | null;
  onChange: (color: IdentityColor | null) => void;
  label?: string;
  withAutomatic?: boolean;
  /** Shows "Automatic" as a radio of the group, checked while `value` is null. */
  automaticChoice?: boolean;
  /** The automatic color. While `value` is null, its swatch shows as the current color. */
  automatic?: IdentityColor;
  className?: string;
}) {
  const group = useRef<HTMLDivElement>(null);
  function move(event: KeyboardEvent<HTMLDivElement>) {
    const step =
      event.key === 'ArrowRight' || event.key === 'ArrowDown'
        ? 1
        : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    event.stopPropagation();
    const index = value ? identityColorNames.indexOf(value) : -1;
    const next =
      identityColorNames[(index + step + identityColorNames.length) % identityColorNames.length];
    onChange(next);
    requestAnimationFrame(() =>
      group.current?.querySelector<HTMLButtonElement>(`[data-color='${next}']`)?.focus(),
    );
  }
  return (
    <div className={cn('identity-swatches', className)}>
      <div
        ref={group}
        role="radiogroup"
        aria-label={label}
        className="identity-swatches-row"
        onKeyDown={move}
      >
        {identityColorNames.map((color, index) => {
          const checked = color === value;
          const current = !value && color === automatic;
          return (
            <button
              key={color}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={identityColorLabels[color]}
              title={current ? `${identityColorLabels[color]} (automatic)` : undefined}
              data-color={color}
              data-current={current || undefined}
              tabIndex={checked || (!value && !automaticChoice && index === 0) ? 0 : -1}
              className="identity-swatch"
              style={identityStyle(color) as CSSProperties}
              onClick={() => onChange(color)}
            />
          );
        })}
        {automaticChoice && (
          <button
            type="button"
            role="radio"
            aria-checked={value === null}
            tabIndex={value === null ? 0 : -1}
            className="identity-swatch-auto"
            onClick={() => onChange(null)}
          >
            Automatic
          </button>
        )}
      </div>
      {withAutomatic && (
        <button
          type="button"
          className="identity-swatches-auto"
          aria-pressed={value === null}
          onClick={() => onChange(null)}
        >
          Automatic
        </button>
      )}
    </div>
  );
}
