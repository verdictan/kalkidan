import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * A list row: 48px, a 28px tile (EntityIcon or AgentIcon), a 12px gap, a 13/500 title and a
 * 12px muted meta line. The hover bleeds 8px past the content edge, so the text aligns with
 * the content edge. With `onClick`, the tile and text are one button. Actions show on hover
 * and keyboard focus.
 */
export function ListRow({
  icon,
  title,
  meta,
  actions,
  selected = false,
  onClick,
  as: Element = 'div',
  className,
  children,
}: {
  icon?: ReactNode;
  title: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  /** li in a list. */
  as?: 'div' | 'li';
  className?: string;
  /** Extra content between the text and the actions, for example a Badge. */
  children?: ReactNode;
}) {
  const content = (
    <>
      {icon}
      <span className="list-row-text">
        <span className="list-row-title">{title}</span>
        {meta && <span className="list-row-meta">{meta}</span>}
      </span>
    </>
  );
  return (
    <Element
      data-slot="list-row"
      data-interactive={onClick ? '' : undefined}
      data-selected={selected ? '' : undefined}
      className={cn('list-row', className)}
    >
      {onClick ? (
        <button
          type="button"
          className="list-row-main"
          aria-current={selected || undefined}
          onClick={onClick}
        >
          {content}
        </button>
      ) : (
        <span className="list-row-main">{content}</span>
      )}
      {children}
      {actions && <div className="list-row-actions">{actions}</div>}
    </Element>
  );
}
