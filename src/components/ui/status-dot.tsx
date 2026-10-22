import { cn } from '@/lib/utils';

export type StatusTone = 'neutral' | 'success' | 'warning' | 'danger' | 'active';

/**
 * A status dot: 8px, or 6px with size="sm". active pulses (reduced motion: no pulse). Give a
 * `label` when the dot is the only sign of the status; otherwise screen readers skip it.
 */
export function StatusDot({
  tone = 'neutral',
  size = 'md',
  label,
  className,
}: {
  tone?: StatusTone;
  size?: 'sm' | 'md';
  label?: string;
  className?: string;
}) {
  return (
    <span
      data-slot="status-dot"
      data-tone={tone}
      data-size={size}
      className={cn('status-dot', className)}
      {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}
    />
  );
}
