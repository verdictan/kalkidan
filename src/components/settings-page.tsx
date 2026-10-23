import { useEffect, useRef, useState } from 'react';
import { Dialog as DialogPrimitive } from 'radix-ui';
import { SettingsBody, useCloseOnEscape, type SettingsBodyProps } from './settings-dialog';

export { SettingsDialog, SettingsBody } from './settings-dialog';

/** A request to move the focus in Settings. A new `request` moves it again. */
export interface SettingsFocus {
  /** The element ID. Empty opens the part at the top. */
  id: string;
  request: number;
}

/**
 * The one Settings page (⌘,). The shell shows it in the main column, under its 48px
 * "Settings" header. `section` and `anchor` move to a part: 'account', 'tools', 'preferences'
 * or 'project:<id>' (older names work too). Escape calls `onClose`.
 */
export function SettingsPage({
  tab,
  focus,
  section,
  anchor,
  onClose,
  ...props
}: Omit<SettingsBodyProps, 'request'> & {
  /** @deprecated Use `section`. */
  tab?: SettingsBodyProps['section'];
  /** @deprecated Use `anchor`. */
  focus?: SettingsFocus;
  /** Leaves the page, for example back to the page before. */
  onClose?: () => void;
  onTab?: (tab: string) => void;
  onNavigate?: (tab: string, anchor?: string) => void;
}) {
  useCloseOnEscape(() => onClose?.());
  return (
    <div className="st-scroll st-embedded">
      <SettingsBody
        {...props}
        section={section ?? tab}
        anchor={anchor ?? (focus?.id || undefined)}
        request={focus?.request}
      />
    </div>
  );
}

/**
 * Settings as a sheet over the window (ST-C4, ⌘,): a 640px sheet over a light scrim, so the
 * tree and the page stay in view under it. The account row is the head of the sheet, with
 * Sign out and ×. Tools, Preferences and the current project scroll under it. Escape, × and a
 * click on the scrim close it. A dialog that opens from the sheet stays on top of it.
 */
export function SettingsSheet({
  open,
  onClose,
  ...props
}: Omit<SettingsBodyProps, 'onClose'> & {
  open: boolean;
  onClose: () => void;
}) {
  const opener = useRef<HTMLElement | null>(null);
  const shown = useShowAfterOtherDialogs(open);
  return (
    <DialogPrimitive.Root open={shown} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="st-sheet-overlay" />
        <DialogPrimitive.Content
          className="st-sheet"
          aria-describedby={undefined}
          onOpenAutoFocus={(event) => {
            // The focus goes to the sheet, not to Sign out.
            const active = document.activeElement;
            opener.current = active instanceof HTMLElement ? active : null;
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)?.focus();
          }}
          onCloseAutoFocus={(event) => {
            // The focus goes back to the element that opened Settings, if it is still there.
            // An element in a dialog that closed (for example search) does not get it, so a
            // dialog that opens next keeps the focus.
            event.preventDefault();
            const target = opener.current;
            opener.current = null;
            if (target?.isConnected && !target.closest('[role="dialog"]'))
              target.focus({ preventScroll: true });
          }}
        >
          <DialogPrimitive.Title className="sr-only">Settings</DialogPrimitive.Title>
          <SettingsBody {...props} onClose={onClose} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

/**
 * True after `open` turns true and every other dialog (for example search, which closes when
 * it opens Settings) has gone. The two focus traps then do not overlap: an overlap leaves a
 * stale trap that closes the next dialog. It waits at most 600 ms.
 */
function useShowAfterOtherDialogs(open: boolean) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!open) {
      setShown(false);
      return;
    }
    const start = performance.now();
    let frame = 0;
    const check = () => {
      const other = document.querySelector('[role="dialog"]:not(.st-sheet)');
      if (!other || performance.now() - start > 600) setShown(true);
      else frame = requestAnimationFrame(check);
    };
    check();
    return () => cancelAnimationFrame(frame);
  }, [open]);
  return open && shown;
}
