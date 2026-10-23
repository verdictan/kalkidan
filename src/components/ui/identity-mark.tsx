import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { identityStyle, type IdentityColor, type IdentityKind } from '../../domain/identity';

/**
 * The identity mark of an item. The shape tells the level: a project is a filled square, a
 * repo is a ring, a session is a dot and a subagent session is a diamond. The color tells the
 * item. A mark never animates and never changes with the status.
 * sm (rows, tokens): square 10 radius 3, ring 10 with a 2px stroke, dot 8, diamond 6.
 * lg (headers, window bar): square 16 radius 4, ring 16 with a 3px stroke, dot 12, diamond 9.
 * With `slot` (the default), the mark is centered in the 16px leading slot of a row.
 */
export function IdentityMark({
  kind,
  color,
  size = 'sm',
  slot = true,
  label,
  className,
}: {
  kind: IdentityKind;
  color: IdentityColor;
  size?: 'sm' | 'lg';
  slot?: boolean;
  /** The accessible name, only when the mark is the only name of the item. */
  label?: string;
  className?: string;
}) {
  const a11y = label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true as const };
  const mark = (
    <span
      data-slot="identity-mark"
      data-kind={kind}
      data-size={size}
      className={cn('identity-mark', !slot && className)}
      style={identityStyle(color) as CSSProperties}
      {...(slot ? { 'aria-hidden': true as const } : a11y)}
    />
  );
  if (!slot) return mark;
  return (
    <span className={cn('identity-slot', className)} {...a11y}>
      {mark}
    </span>
  );
}

/**
 * A mark and a name inline, with a 6px gap: crumbs, view and editor tabs, pickers, chips and
 * command results. The name truncates. `strong` shows the current item in 600 weight.
 */
export function IdentityToken({
  kind,
  color,
  name,
  strong = false,
  className,
}: {
  kind: IdentityKind;
  color: IdentityColor;
  name: ReactNode;
  strong?: boolean;
  className?: string;
}) {
  return (
    <span
      data-slot="identity-token"
      data-strong={strong ? '' : undefined}
      className={cn('identity-token', className)}
    >
      <IdentityMark kind={kind} color={color} slot={false} />
      <span className="identity-token-name">{name}</span>
    </span>
  );
}
