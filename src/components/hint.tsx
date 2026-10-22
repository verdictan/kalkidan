import { useEffect, useId, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';

const openLayer = '[role="dialog"][data-state="open"], [role="menu"][data-state="open"]';
const layer = '[role="dialog"], [role="menu"], [role="listbox"]';

/**
 * A tooltip for one control. The shortcut shows as a separate muted key label.
 *
 * A disabled button gets no pointer events, so its tooltip never opens. A disabled child is
 * wrapped in a focusable span that receives hover and focus instead. Set `disabled` when the
 * child does not have a `disabled` prop itself. `className` and `style` go to the element that
 * is in the layout: the child, or the wrapper span when the child is disabled. Put layout rules
 * on the Hint, never on the button inside it.
 *
 * The tooltip closes when a menu or dialog opens, and it does not open again when focus
 * returns from the menu or dialog.
 */
export function Hint({
  label,
  shortcut,
  disabled: disabledProp,
  className,
  style,
  children,
}: {
  label: string;
  /** A key label, for example "⌘K". It is not part of the label. */
  shortcut?: string;
  disabled?: boolean;
  className?: string;
  style?: CSSProperties;
  children: ReactElement;
}) {
  const disabled = disabledProp ?? !!(children.props as { disabled?: boolean }).disabled;
  const reasonId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  // Close when the focus goes somewhere else, for example into a menu or a dialog.
  useEffect(() => {
    if (!open) return;
    const close = (event: FocusEvent) => {
      if (!trigger.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('focusin', close);
    return () => document.removeEventListener('focusin', close);
  }, [open]);
  return (
    <Tooltip
      open={open}
      onOpenChange={(next) => {
        const inLayer = trigger.current?.closest(layer);
        if (next && !inLayer && document.querySelector(openLayer)) return;
        setOpen(next);
      }}
    >
      <TooltipTrigger
        asChild
        ref={trigger}
        className={className}
        style={style}
        onFocus={(event) => {
          // Focus that comes back from a closed menu or dialog does not open the tooltip.
          const from = event.relatedTarget;
          if (!from || (from instanceof Element && from.closest(layer))) event.preventDefault();
        }}
      >
        {disabled ? (
          // The wrapper only receives hover and focus. The child keeps its own name, and
          // the reason is its description.
          <span className="hint-disabled" tabIndex={0} aria-describedby={reasonId}>
            {children}
            <span id={reasonId} className="sr-only">
              {label}
            </span>
          </span>
        ) : (
          children
        )}
      </TooltipTrigger>
      <TooltipContent sideOffset={6} className={shortcut ? 'flex items-center gap-2' : undefined}>
        {label}
        {shortcut && <kbd className="kbd h-4">{shortcut}</kbd>}
      </TooltipContent>
    </Tooltip>
  );
}
