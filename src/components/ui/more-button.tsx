import { forwardRef, type ComponentProps } from 'react';
import { Ellipsis } from 'lucide-react';
import { Button } from './button';

/** The one "more actions" trigger: 28px with a 16px icon, or 24px with a 14px icon in rows. */
export const MoreButton = forwardRef<
  HTMLButtonElement,
  Omit<ComponentProps<typeof Button>, 'size' | 'children'> & { size?: 'sm' | 'xs'; label: string }
>(function MoreButton({ size = 'sm', label, ...props }, ref) {
  return (
    <Button
      ref={ref}
      variant="ghost"
      size={size === 'sm' ? 'icon-sm' : 'icon-xs'}
      aria-label={label}
      {...props}
    >
      <Ellipsis className={size === 'sm' ? 'size-4' : 'size-3.5'} />
    </Button>
  );
});
