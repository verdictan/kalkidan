import {
  isValidElement,
  useRef,
  type CSSProperties,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { cn } from '@/lib/utils';
import { identityStyle, type IdentityColor, type IdentityKind } from '../../domain/identity';
import { Hint } from '../hint';
import { Count } from './count';
import { IdentityMark } from './identity-mark';

interface MarkSpec {
  kind: IdentityKind;
  color: IdentityColor;
}

export interface PageView<T extends string> {
  value: T;
  label: ReactNode;
  /** An identity mark before the label, for example a project in Settings. */
  mark?: MarkSpec;
  /** A count after the label. Zero shows nothing. */
  count?: number;
  hint?: string;
  shortcut?: string;
  /** The accessible name when the label is not the full name. */
  ariaLabel?: string;
  id?: string;
}

function isMarkSpec(value: unknown): value is MarkSpec {
  return (
    !!value &&
    typeof value === 'object' &&
    !isValidElement(value) &&
    'kind' in value &&
    'color' in value
  );
}

/**
 * The 40px title bar of every page, and on a page with views the page head under it. The title
 * bar holds the crumb: the identity mark and the name (13/20, 500), or the `crumbs` of a chat,
 * then the actions. A page with views (a project) adds the page head: a title row with the
 * 16px mark, the 20px title and the actions, then the views as underlined tabs. Without
 * `titleRow`, the page head is only the tabs and the actions stay in the title bar. The title
 * bar is a drag region; its buttons and links are not.
 */
export function PageHeader<T extends string = string>({
  title,
  mark,
  icon,
  crumbs,
  subtitle,
  views,
  view,
  onViewChange,
  viewsLabel = 'Views',
  titleRow,
  actions,
  className,
}: {
  title?: ReactNode;
  /** An identity mark ({ kind, color }) or any 16px node before the title. */
  mark?: MarkSpec | ReactNode;
  /** Old callers: a node before the title. Use `mark`. */
  icon?: ReactNode;
  /** Replaces the mark and the title, for example the crumbs of a chat. */
  crumbs?: ReactNode;
  /** Old callers: a short muted line after the title. */
  subtitle?: ReactNode;
  reserveSubtitle?: boolean;
  views?: PageView<T>[];
  view?: T;
  onViewChange?: (value: T) => void;
  /** The name of the view landmark. */
  viewsLabel?: string;
  /** With views: the large title row above the tabs. The default is on. */
  titleRow?: boolean;
  /** Old callers. The title bar has no tint. */
  tintViews?: boolean;
  tint?: IdentityColor;
  actions?: ReactNode;
  className?: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const markSpec = isMarkSpec(mark) ? mark : null;
  const hasViews = Boolean(views && views.length > 0);
  const head = hasViews && (titleRow ?? true);
  function move(event: KeyboardEvent<HTMLDivElement>) {
    const buttons = [...(list.current?.querySelectorAll('button') || [])];
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (index < 0) return;
    const next =
      event.key === 'ArrowRight'
        ? (index + 1) % buttons.length
        : event.key === 'ArrowLeft'
          ? (index - 1 + buttons.length) % buttons.length
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    buttons[next].focus();
  }
  const leading = (size: 'sm' | 'lg') =>
    markSpec ? (
      <IdentityMark kind={markSpec.kind} color={markSpec.color} size={size} slot={false} />
    ) : (
      ((mark as ReactNode) ?? icon)
    );
  const style = markSpec ? (identityStyle(markSpec.color) as CSSProperties) : undefined;
  return (
    <>
      <header
        data-slot="page-header"
        data-page-head={hasViews ? (head ? 'title' : 'tabs') : undefined}
        className={cn('app-header page-header', className)}
        style={style}
      >
        {crumbs ? (
          <div className="app-header-crumbs">{crumbs}</div>
        ) : head ? (
          // The crumb of a page with a title row. The title row below holds the heading.
          <div className="app-header-title" aria-hidden="true">
            {leading('lg')}
            <span className="app-header-title-text">{title}</span>
          </div>
        ) : (
          <h1 className="app-header-title page-title">
            {leading('lg')}
            <span className="app-header-title-text">{title}</span>
            {subtitle && <span className="app-header-subtitle">{subtitle}</span>}
          </h1>
        )}
        <span className="app-header-spacer" />
        {actions && !head && (
          <div className="app-header-actions page-header-actions">{actions}</div>
        )}
      </header>
      {hasViews && (
        <div className="page-head" data-title-row={head ? '' : undefined} style={style}>
          {head && (
            <div className="page-head-row">
              <h1 className="page-head-title page-title">
                {leading('lg')}
                <span className="app-header-title-text">{title}</span>
                {subtitle && <span className="app-header-subtitle">{subtitle}</span>}
              </h1>
              <span className="app-header-spacer" />
              {actions && <div className="app-header-actions page-header-actions">{actions}</div>}
            </div>
          )}
          <nav aria-label={viewsLabel} className="page-tabs">
            <div ref={list} className="page-tabs-list" onKeyDown={move}>
              {views!.map((option) => {
                const current = option.value === view;
                const button = (
                  <button
                    key={option.value}
                    id={option.id}
                    type="button"
                    className="page-tab"
                    aria-current={current ? 'page' : undefined}
                    aria-label={option.ariaLabel}
                    onClick={() => onViewChange?.(option.value)}
                  >
                    {option.mark && (
                      <IdentityMark
                        kind={option.mark.kind}
                        color={option.mark.color}
                        slot={false}
                      />
                    )}
                    {option.label}
                    {!!option.count && <Count aria-hidden="true">{option.count}</Count>}
                  </button>
                );
                return option.hint ? (
                  <Hint key={option.value} label={option.hint} shortcut={option.shortcut}>
                    {button}
                  </Hint>
                ) : (
                  button
                );
              })}
            </div>
          </nav>
        </div>
      )}
    </>
  );
}

/**
 * The label of a page section, such as "Needs you" or "Repos": 12/16 muted, 28 high, 4 above
 * the first row. Optional count and actions.
 */
export function SectionHeader({
  title,
  count,
  actions,
  as: Heading = 'h3',
  size = 'md',
  className,
}: {
  /** sm removes the minimum height, for headers inside dialogs. */
  size?: 'sm' | 'md';
  title: ReactNode;
  count?: number;
  actions?: ReactNode;
  as?: 'h2' | 'h3' | 'h4';
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
