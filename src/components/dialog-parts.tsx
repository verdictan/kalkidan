import { useEffect, useId, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import { relativeTime } from '../lib/github-labels';
import { Button } from './ui/button';
import { Input } from './ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

/**
 * Puts the actions of a form into the footer of its dialog. The dialog gives the footer element.
 * When the target is null (the form is in a tab that is not open), the actions do not show.
 */
export function FooterActions({
  target,
  children,
}: {
  target: HTMLElement | null | undefined;
  children: ReactNode;
}) {
  return target ? createPortal(children, target) : null;
}

/** "Updated just now" after a write. The text updates each 30 seconds. */
export function UpdatedNote({ at }: { at?: number }) {
  const [, tick] = useState(0);
  useEffect(() => {
    if (!at) return;
    const timer = window.setInterval(() => tick((n) => n + 1), 30000);
    return () => window.clearInterval(timer);
  }, [at]);
  if (!at) return null;
  return (
    <span role="status" className="mr-auto self-center text-xs leading-4 text-muted-foreground">
      Updated {relativeTime(at)}
    </span>
  );
}

const fieldSelector = [
  'input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=search])',
  'textarea',
  '[role=combobox]',
  'input[type=search]',
]
  .map((selector) => `${selector}:not(:disabled)`)
  .join(', ');

/** Focuses the first field in the container, or the primary action of the dialog. */
export function focusFirstField(container: HTMLElement | null) {
  if (!container) return false;
  const field = container.querySelector<HTMLElement>(fieldSelector);
  if (field) {
    field.focus();
    return true;
  }
  const dialog = container.closest('[role=dialog]');
  const primary = dialog?.querySelector<HTMLElement>(
    '[data-slot=dialog-footer] [data-primary]:not(:disabled)',
  );
  if (primary) {
    primary.focus();
    return true;
  }
  return false;
}

/**
 * When the form has loaded, moves focus to its first field. It does this one time, and only when
 * the focus is still on the dialog itself, so it does not move focus that the user has moved.
 */
export function useInitialFocus(container: RefObject<HTMLElement | null>, ready: boolean) {
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current) return;
    // Wait until the dialog has done its own open focus.
    const timer = window.setTimeout(() => {
      done.current = true;
      const dialog = container.current?.closest('[role=dialog]');
      const active = document.activeElement;
      if (active && active !== dialog && dialog?.contains(active)) return;
      focusFirstField(container.current);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [container, ready]);
}

/** The Radix open handler that keeps the focus on the dialog until a form has loaded. */
export function holdDialogFocus(event: Event) {
  event.preventDefault();
  (event.currentTarget as HTMLElement | null)?.focus();
}

/**
 * Confirms a destructive action. The user types `confirmText` to enable the action, so a
 * single click cannot delete data.
 */
export function TypedConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmText,
  actionLabel,
  busy,
  onConfirm,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
  title: string;
  description: ReactNode;
  confirmText: string;
  actionLabel: string;
  busy?: boolean;
  onConfirm(): void;
}) {
  const [value, setValue] = useState('');
  const id = useId();
  useEffect(() => {
    if (open) setValue('');
  }, [open]);
  const ready = value.trim() === confirmText.trim() && !busy;
  return (
    <Dialog open={open} onOpenChange={(next) => !busy && onOpenChange(next)}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (ready) onConfirm();
          }}
        >
          <label className="form-label" htmlFor={id}>
            <span>
              Type <strong className="font-mono font-medium">{confirmText}</strong> to confirm
            </span>
            <Input
              id={id}
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={value}
              disabled={busy}
              onChange={(event) => setValue(event.target.value)}
            />
          </label>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" variant="destructive" disabled={!ready}>
              {busy ? 'Deleting…' : actionLabel}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A destructive action with its description, at the end of a form. */
export function DangerZone({
  title,
  description,
  action,
}: {
  title: string;
  description: ReactNode;
  action: ReactNode;
}) {
  return (
    <div className="danger-zone">
      <div>
        <strong>{title}</strong>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
