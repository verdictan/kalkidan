import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Count } from './count';

/**
 * A navigation row: 32px (28px with size="sm", for the sidebar tree), radius 8, 8px padding,
 * a 16px icon and an 8px gap. The current row has the selected fill and aria-current="page".
 * Actions show at the end of the row. In the sidebar, set --row-hover and --row-selected on
 * the sidebar to --sidebar-hover and --sidebar-selected.
 */
export function NavRow({
  icon,
  label,
  count,
  current = false,
  size = 'md',
  href,
  onClick,
  actions,
  className,
}: {
  icon?: ReactNode;
  label: ReactNode;
  count?: number;
  current?: boolean;
  size?: 'sm' | 'md';
  /** A link row. Without href the row is a button. */
  href?: string;
  onClick?: () => void;
  actions?: ReactNode;
  className?: string;
}) {
  const content = (
    <>
      {icon}
      <span className="nav-row-label">{label}</span>
      {count !== undefined && <Count>{count}</Count>}
    </>
  );
  return (
    <div
      data-slot="nav-row"
      data-size={size}
      data-current={current ? '' : undefined}
      className={cn('nav-row', className)}
    >
      {href ? (
        <a
          className="nav-row-main"
          href={href}
          aria-current={current ? 'page' : undefined}
          onClick={onClick}
        >
          {content}
        </a>
      ) : (
        <button
          type="button"
          className="nav-row-main"
          aria-current={current ? 'page' : undefined}
          onClick={onClick}
        >
          {content}
        </button>
      )}
      {actions && <div className="nav-row-actions">{actions}</div>}
    </div>
  );
}
