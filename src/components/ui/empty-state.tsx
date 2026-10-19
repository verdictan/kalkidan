import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** One empty state for pages, panels and columns. Compact for small areas. */
export function EmptyState({
  icon,
  title,
  children,
  action,
  compact = false,
  className,
}: {
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('empty-state', className)} data-compact={compact || undefined}>
      {icon && (
        <span className="empty-state-icon" aria-hidden="true">
          {icon}
        </span>
      )}
      {title && <h3 className="empty-state-title">{title}</h3>}
      {children && <div className="empty-state-body">{children}</div>}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
