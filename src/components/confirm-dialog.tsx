import type { ReactNode } from 'react';
import { LoaderCircle } from 'lucide-react';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

/**
 * Asks the user to confirm an action before it runs. Every confirmation of the app uses it: sm
 * 440, the title, one line of description, optional content, then Cancel and the action. Use the
 * same verb in the item that opens it, in the title, and in the action button.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive = false,
  busy = false,
  confirmDisabled = false,
  children,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  /** The label of the button that closes the question without the action. */
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  /** True while the content has no valid choice, for example no option is selected. */
  confirmDisabled?: boolean;
  children?: ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && !busy && onCancel()}>
      <DialogContent size="sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter>
          {/* For a destructive action, focus Cancel so Enter does not confirm it. */}
          <Button variant="outline" autoFocus={destructive} disabled={busy} onClick={onCancel}>
            {cancelLabel}
          </Button>
          <Button
            autoFocus={!destructive}
            disabled={busy || confirmDisabled}
            variant={destructive ? 'destructive' : 'default'}
            onClick={onConfirm}
          >
            {busy && <LoaderCircle className="animate-spin" aria-hidden="true" />}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
