import type { ReactNode } from 'react';
import { CircleAlert } from 'lucide-react';
import { EmptyState } from './ui/empty-state';

/**
 * The one empty or error state of a tool pane: the compact EmptyState, left-aligned 16px inside
 * the pane under its header, with one action. Only the icon is red for an error.
 */
export function PaneMessage({
  tone = 'neutral',
  icon,
  title,
  children,
  action,
}: {
  tone?: 'neutral' | 'danger';
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="tool-pane-message" role={tone === 'danger' ? 'alert' : undefined}>
      {/* The empty state draws no icon, so an error shows its tone in the text. */}
      <EmptyState
        compact
        icon={icon || <CircleAlert className={tone === 'danger' ? 'text-destructive' : ''} />}
        title={title}
        action={action}
      >
        {children}
      </EmptyState>
    </div>
  );
}
