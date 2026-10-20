import { forwardRef, type ComponentProps } from 'react';
import { Ellipsis } from 'lucide-react';
import { Button } from './button';

/**
 * The one "more actions" trigger. md 32px in page headers, sm 28px in toolbars, xs 24px in
 * rows. The icon is 16px at md and sm, 14px at xs.
 */
export const MoreButton = forwardRef<
  HTMLButtonElement,
  Omit<ComponentProps<typeof Button>, 'size' | 'children'> & {
    size?: 'md' | 'sm' | 'xs';
    label: string;
  }
>(function MoreButton({ size = 'sm', label, ...props }, ref) {
  return (
    <Button
      ref={ref}
      variant="ghost"
      size={size === 'md' ? 'icon' : size === 'sm' ? 'icon-sm' : 'icon-xs'}
      aria-label={label}
      {...props}
    >
      <Ellipsis className={size === 'xs' ? 'size-3.5' : 'size-4'} />
    </Button>
  );
});
