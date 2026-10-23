import { cn } from '@/lib/utils';
import type { ItemStatus } from '../../domain/identity';

const statusLabels: Record<Exclude<ItemStatus, 'idle'>, string> = {
  working: 'Working',
  'needs-you': 'Needs you',
  failed: 'Failed',
};

/**
 * The status of an item: a 16px slot after the name, never in the leading slot. Working is a
 * 10px neutral spinner, needs you is a plain amber "!", failed is a 10px red cross. Idle shows nothing; the time goes in the meta. It never truncates.
 */
export function StatusGlyph({
  status,
  label,
  className,
}: {
  status: ItemStatus | null | undefined;
  /** The accessible name. The default is the status name. */
  label?: string;
  className?: string;
}) {
  if (!status || status === 'idle') return null;
  return (
    <span
      data-slot="status-glyph"
      data-status={status}
      role="img"
      aria-label={label ?? statusLabels[status]}
      className={cn('status-glyph', className)}
    >
      {status === 'needs-you' ? '!' : null}
    </span>
  );
}
