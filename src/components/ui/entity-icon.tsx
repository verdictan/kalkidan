import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A square tile with radius 8 for a project, repository, agent or tool. sm 28px in rows and page
 * headers, lg 48px in empty states.
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
