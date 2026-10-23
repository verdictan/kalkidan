'use client';

import * as React from 'react';
import { cn } from '@/lib/utils';
import { XIcon } from 'lucide-react';
import { Dialog as DialogPrimitive } from 'radix-ui';

import { Button } from '@/components/ui/button';

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        'fixed inset-0 z-[var(--z-dialog)] bg-[var(--overlay)] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0',
        className,
      )}
      {...props}
    />
  );
}

/**
 * Keeps the element that had focus when the dialog opened. It mounts with the dialog content,
 * so a dialog that stays rendered while closed keeps the element of its last opening, not the
 * element of its first render.
 */
function ReturnFocusCapture({
  onCapture,
}: {
  onCapture: (target: HTMLElement | null, fallback: HTMLElement | null) => void;
}) {
  React.useLayoutEffect(() => {
    let active = document.activeElement;
    // A menu item closes with its menu. Return focus to the menu button instead.
    const menu = active instanceof HTMLElement ? active.closest('[role="menu"]') : null;
    if (menu?.id) active = document.querySelector(`[aria-controls="${CSS.escape(menu.id)}"]`);
    const target = active instanceof HTMLElement && active !== document.body ? active : null;
    const row = target?.closest('li, [role="row"], .tree-row, .list-row');
    const sibling = (row?.nextElementSibling || row?.previousElementSibling) as HTMLElement | null;
    onCapture(
      target,
      sibling?.querySelector<HTMLElement>('button, a[href], [tabindex="0"]') || null,
    );
  }, []);
  return null;
}

function DialogContent({
  className,
  children,
  showCloseButton = true,
  size = 'md',
  layout = 'simple',
  onCloseAutoFocus,
  onInteractOutside,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  /** sm 440 for confirmations, md 560 for forms, lg 720 for pickers and onboarding. */
  size?: 'sm' | 'md' | 'lg';
  /**
   * simple: one padded block. scroll: DialogHeader, DialogBody and DialogFooter split the
   * dialog, only the body scrolls, and the footer has a divider.
   */
  layout?: 'simple' | 'scroll';
}) {
  // The app opens dialogs without a DialogTrigger, so Radix has no element to
  // focus on close. Keep the element that had focus before the dialog opened.
  const returnFocus = React.useRef<HTMLElement | null>(null);
  // The focus target can be gone after the dialog removes something. Use the nearest
  // focusable item in the same list, or the main heading.
  const fallbackFocus = React.useRef<HTMLElement | null>(null);
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        className={cn(
          'fixed top-[50%] left-[50%] z-[var(--z-dialog)] grid max-h-[min(80vh,calc(100dvh-2rem))] w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] rounded-xl bg-popover text-popover-foreground shadow-lg duration-[var(--motion-base)] outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95',
          layout === 'simple' && 'gap-4 overflow-y-auto p-6',
          layout === 'scroll' &&
            'grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 [&>[data-slot=dialog-header]]:px-6 [&>[data-slot=dialog-header]]:pt-6 [&>[data-slot=dialog-header]]:pb-3 [&>[data-slot=dialog-footer]]:px-6 [&>[data-slot=dialog-footer]]:pt-3 [&>[data-slot=dialog-footer]]:pb-6',
          size === 'sm' && 'sm:max-w-[var(--dialog-sm)]',
          size === 'md' && 'sm:max-w-[var(--dialog-md)]',
          size === 'lg' && 'sm:max-w-[var(--dialog-lg)]',
          className,
        )}
        onInteractOutside={(event) => {
          onInteractOutside?.(event);
          // A toast, for example "Saved" with Undo, shows above the dialog. Using it does not
          // close the dialog.
          const target = event.target;
          if (target instanceof Element && target.closest('[data-slot="toast"]'))
            event.preventDefault();
        }}
        onCloseAutoFocus={(event) => {
          onCloseAutoFocus?.(event);
          if (event.defaultPrevented) return;
          const target = returnFocus.current;
          const fallback = fallbackFocus.current;
          const next = target?.isConnected
            ? target
            : fallback?.isConnected
              ? fallback
              : document.querySelector<HTMLElement>('main h1, main h2');
          if (next) {
            event.preventDefault();
            if (!next.matches('button, a[href], input, [tabindex]'))
              next.setAttribute('tabindex', '-1');
            next.focus();
          }
        }}
        {...props}
      >
        <ReturnFocusCapture
          onCapture={(target, fallback) => {
            returnFocus.current = target;
            fallbackFocus.current = fallback;
          }}
        />
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-4 right-4 inline-flex size-7 items-center justify-center rounded-sm text-muted-foreground transition-colors hover:bg-[var(--fill)] hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--focus-color)] focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      className={cn('flex flex-col gap-1 pr-10 text-left', className)}
      {...props}
    />
  );
}

/** The scrolling middle part of a dialog with layout="scroll". */
function DialogBody({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-body"
      className={cn('min-h-0 overflow-y-auto px-6 pb-4', className)}
      {...props}
    />
  );
}

function DialogFooter({
  className,
  showCloseButton = false,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  showCloseButton?: boolean;
}) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}
      {...props}
    >
      {children}
      {showCloseButton && (
        <DialogPrimitive.Close asChild>
          <Button variant="outline">Close</Button>
        </DialogPrimitive.Close>
      )}
    </div>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      // A 28px title row: the 16/24 title is centered on the 28px close button.
      className={cn('py-0.5 text-lg font-semibold', className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogBody,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
