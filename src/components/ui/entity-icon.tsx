import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** A square tile for a project, repository, agent or tool. sm 28px in rows, lg 40px in headers. */
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
