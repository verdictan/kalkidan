import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A square tile with radius 6: the agent in rows, and the folder in a project header. sm 28px,
 * lg 48px. Lists are text first: do not add a tile only for decoration.
 */
export function EntityIcon({
  size = 'sm',
  color,
  className,
  children,
}: {
  size?: 'sm' | 'lg';
  color?: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <span
      className={cn('entity-icon', className)}
      data-size={size}
      style={color ? ({ '--entity-color': color } as CSSProperties) : undefined}
      aria-hidden="true"
    >
      {children}
    </span>
  );
}
