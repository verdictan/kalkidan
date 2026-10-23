import type { CSSProperties, MouseEvent, ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { identityStyle, type IdentityColor, type ItemStatus } from '../../domain/identity';
import { StatusGlyph } from './status-glyph';

/**
 * The one selectable line outside the tree: Needs you, menu-like lists, command results and
 * settings lists. nav is 32 high with one line; list is 48 high with a 13/20 500 title and a
 * 12/16 muted detail line. The leading 16px slot holds an icon or an identity mark, never a
 * status. After the text: the meta (12/16 muted), the status glyph, then the actions. Actions
 * show on hover and keyboard focus and then hide the meta, or show always with
 * `actionsVisible`. Hover is the grey fill, selected is the strong fill, or the 12% identity
 * tint with `tint`. A list row's fill bleeds 12px past the content edge, so its text is on the
 * content edge.
 */
export function Row({
  size = 'nav',
  leading,
  title,
  detail,
  meta,
  status,
  actions,
  actionsVisible = false,
  selected = false,
  tint,
  onClick,
  href,
  onDoubleClick,
  onContextMenu,
  as: Element = 'div',
  className,
  'aria-label': ariaLabel,
}: {
  size?: 'nav' | 'list';
  leading?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  meta?: ReactNode;
  status?: ItemStatus | null;
  actions?: ReactNode;
  actionsVisible?: boolean;
  selected?: boolean;
  tint?: IdentityColor;
  onClick?: () => void;
  /** A link row. Without href and with onClick, the row is a button. */
  href?: string;
  onDoubleClick?: (event: MouseEvent) => void;
  onContextMenu?: (event: MouseEvent) => void;
  as?: 'div' | 'li';
  className?: string;
  'aria-label'?: string;
}) {
  const content = (
    <>
      {leading && <span className="row-leading">{leading}</span>}
      <span className="row-text">
        <span className="row-title">{title}</span>
        {detail && size === 'list' && <span className="row-detail">{detail}</span>}
      </span>
      {meta && <span className="row-meta">{meta}</span>}
      <StatusGlyph status={status} />
    </>
  );
  const interactive = Boolean(onClick || href);
  return (
    <Element
      data-slot="row"
      data-size={size}
      data-interactive={interactive ? '' : undefined}
      data-selected={selected ? '' : undefined}
      data-actions-visible={actionsVisible ? '' : undefined}
      data-tint={tint ? '' : undefined}
      className={cn('row', className)}
      style={tint ? (identityStyle(tint) as CSSProperties) : undefined}
      onDoubleClick={onDoubleClick}
      onContextMenu={onContextMenu}
    >
      {href ? (
        <a
          className="row-main"
          href={href}
          aria-current={selected ? 'page' : undefined}
          aria-label={ariaLabel}
          onClick={onClick}
        >
          {content}
        </a>
      ) : onClick ? (
        <button
          type="button"
          className="row-main"
          aria-current={selected || undefined}
          aria-label={ariaLabel}
          onClick={onClick}
        >
          {content}
        </button>
      ) : (
        <span className="row-main" aria-label={ariaLabel}>
          {content}
        </span>
      )}
      {actions && <div className="row-actions">{actions}</div>}
    </Element>
  );
}
