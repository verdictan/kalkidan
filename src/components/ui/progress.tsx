import { cn } from '@/lib/utils';

/** A 4px progress bar. Leave `value` out for work with no known end. */
export function Progress({
  value,
  label,
  className,
}: {
  value?: number;
  label: string;
  className?: string;
}) {
  const known = typeof value === 'number' && Number.isFinite(value);
  const percent = known ? Math.max(0, Math.min(100, value)) : 0;
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={known ? Math.round(percent) : undefined}
      data-slot="progress"
      className={cn('h-1 w-full overflow-hidden rounded-full bg-secondary', className)}
    >
      <div
        className={cn(
          'h-full rounded-full bg-primary transition-[width] duration-[var(--motion-base)]',
          !known && 'w-1/3 motion-safe:animate-pulse',
        )}
        style={known ? { width: percent + '%' } : undefined}
      />
    </div>
  );
}
