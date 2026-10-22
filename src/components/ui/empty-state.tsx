import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The one empty state: one quiet sentence that says what is missing, with the action on the
 * same line. It is left-aligned on the content edge of its area. The title is in the
 * foreground and the text after it is muted. Compact uses 12/16 text for small areas.
 *
 * `icon` is not drawn. Lists are text first, so an empty state has no tile.
 */
export function EmptyState({
  title,
  children,
  action,
  compact = false,
  className,
}: {
  /** Not drawn. Kept so that older call sites compile. */
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div className={cn('empty-state', className)} data-compact={compact || undefined}>
      {(title || children) && (
        <div className="empty-state-text">
          {title && (
            <span className="empty-state-title">
              {/* The title and the text read as one sentence or two, never as a run-on. */}
              {typeof title === 'string' && children && !/[.!?…]$/.test(title)
                ? title + '.'
                : title}
            </span>
          )}
          {title && children && ' '}
          {children && <span className="empty-state-body">{children}</span>}
        </div>
      )}
      {action && <div className="empty-state-action">{action}</div>}
    </div>
  );
}
