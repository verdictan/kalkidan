import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** The title row of a management page: optional icon and eyebrow, title, subtitle, actions. */
export function PageHeader({
  icon,
  eyebrow,
  title,
  subtitle,
  actions,
  className,
}: {
  icon?: ReactNode;
  eyebrow?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn('page-header', className)}>
      {icon}
      <div className="page-header-text">
        {eyebrow && <div className="page-header-eyebrow">{eyebrow}</div>}
        <h2 className="page-title">{title}</h2>
        {subtitle && <div className="page-subtitle">{subtitle}</div>}
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </header>
  );
}

/** The heading row of a page section, such as "Sessions 3". */
export function SectionHeader({
  title,
  count,
  actions,
  as: Heading = 'h3',
  className,
}: {
  title: ReactNode;
  count?: number;
  actions?: ReactNode;
  as?: 'h3' | 'h4';
  className?: string;
}) {
  return (
    <div className={cn('section-header', className)}>
      <Heading className="section-title">
        {title}
        {count !== undefined && <span className="section-count">{count}</span>}
      </Heading>
      {actions && <div className="section-actions">{actions}</div>}
    </div>
  );
}
