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
 * The one 48px header of every page, which is also the title bar. It holds the identity mark
 * and the title (15/24, 600), the view switch as a segmented control, and the actions. A chat
 * gives `crumbs` (identity tokens) instead of a title. The active view takes the 12% tint of
 * the page's identity color; `tint` gives the whole header a 5% tint (the chat). The header is
 * a drag region; its buttons and links are not.
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
  tintViews,
  tint,
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
  /** The active view takes the identity tint. The default is on when `mark` has a color. */
  tintViews?: boolean;
  /** A 5% tint of this color on the whole header. */
  tint?: IdentityColor;
  actions?: ReactNode;
  className?: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const markSpec = isMarkSpec(mark) ? mark : null;
  const tintColor = tint ?? markSpec?.color;
  const viewTint = (tintViews ?? Boolean(markSpec)) && Boolean(tintColor);
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
  const leading = markSpec ? (
    <IdentityMark kind={markSpec.kind} color={markSpec.color} slot={false} />
  ) : (
    ((mark as ReactNode) ?? icon)
  );
  return (
    <header
      data-slot="page-header"
      data-tinted={tint ? '' : undefined}
      data-view-tint={viewTint ? '' : undefined}
      className={cn('app-header page-header', className)}
      style={tintColor ? (identityStyle(tintColor) as CSSProperties) : undefined}
    >
      {crumbs ? (
        <div className="app-header-crumbs">{crumbs}</div>
      ) : (
        <h1 className="app-header-title page-title">
          {leading}
          <span className="app-header-title-text">{title}</span>
          {subtitle && <span className="app-header-subtitle">{subtitle}</span>}
        </h1>
      )}
      {views && views.length > 0 && (
        <nav aria-label={viewsLabel} className="app-header-views">
          <div ref={list} className="app-header-views-list" onKeyDown={move}>
            {views.map((option) => {
              const current = option.value === view;
              const button = (
                <button
                  key={option.value}
                  id={option.id}
                  type="button"
                  className="app-header-view"
                  aria-current={current ? 'page' : undefined}
                  aria-label={option.ariaLabel}
                  onClick={() => onViewChange?.(option.value)}
                >
                  {option.mark && (
                    <IdentityMark kind={option.mark.kind} color={option.mark.color} slot={false} />
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
      )}
      <span className="app-header-spacer" />
      {actions && <div className="app-header-actions page-header-actions">{actions}</div>}
    </header>
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
