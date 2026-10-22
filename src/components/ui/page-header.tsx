import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { Count } from './count';

/**
 * The header of a page. The title row is 32px high, so the 20/28 title is at the same y on
 * every page, and the actions align with it. Every title starts at the same x, so use the
 * optional 28px tile only when the icon carries meaning (an agent), never for a project or a
 * list page. The 12/16 subtitle line is under the title.
 * Set `reserveSubtitle` to keep its space when the subtitle is empty, so that the content
 * below does not move. The header is 16px above the tabs or the content.
 */
export function PageHeader({
  icon,
  title,
  subtitle,
  reserveSubtitle = false,
  actions,
  className,
}: {
  /** An EntityIcon (28px). */
  icon?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  reserveSubtitle?: boolean;
  actions?: ReactNode;
  className?: string;
}) {
  const showSubtitle = Boolean(subtitle) || reserveSubtitle;
  return (
    <header className={cn('page-header', className)} data-icon={icon ? '' : undefined}>
      {icon && <div className="page-header-icon">{icon}</div>}
      <h1 className="page-title">{title}</h1>
      {actions && <div className="page-header-actions">{actions}</div>}
      {showSubtitle && <div className="page-subtitle">{subtitle}</div>}
    </header>
  );
}

/** The heading row of a page section, such as "Sessions 3". */
export function SectionHeader({
  title,
  count,
  actions,
  as: Heading = 'h3',
  size = 'md',
  className,
}: {
  /** sm removes the minimum height and uses an 8px gap below, for headers inside dialogs. */
  size?: 'sm' | 'md';
  title: ReactNode;
  count?: number;
  actions?: ReactNode;
  as?: 'h3' | 'h4';
  className?: string;
}) {
  return (
    <div className={cn('section-header', className)} data-size={size}>
      <Heading className="section-title">
        {title}
        {count !== undefined && <Count>{count}</Count>}
      </Heading>
      {actions && <div className="section-actions">{actions}</div>}
    </div>
  );
}
