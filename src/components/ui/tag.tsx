import type { CSSProperties, ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * A 24px bordered tag with radius 6, for labels, linked items and removable choices. Use Badge
 * for status. With `onRemove`, a 20px X removes the tag; its name is "Remove <label>".
 */
export function Tag({
  icon,
  children,
  onRemove,
  removeLabel,
  title,
  style,
  className,
}: {
  icon?: ReactNode;
  children: ReactNode;
  onRemove?: () => void;
  /** The name of the remove button. Default: "Remove" and the tag text. */
  removeLabel?: string;
  title?: string;
  /** For example a label color. */
  style?: CSSProperties;
  className?: string;
}) {
  return (
    <span
      data-slot="tag"
      data-removable={onRemove ? '' : undefined}
      className={cn('tag', className)}
      title={title}
      style={style}
    >
      {icon}
      <span className="tag-label">{children}</span>
      {onRemove && (
        <button
          type="button"
          className="tag-remove"
          aria-label={
            removeLabel || `Remove ${typeof children === 'string' ? children : ''}`.trim()
          }
          onClick={onRemove}
        >
          <X aria-hidden="true" />
        </button>
      )}
    </span>
  );
}
