import type { ReactElement } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
// A disabled button gets no pointer events, so its tooltip never opens. Wrap a
// disabled child in a focusable span that receives hover and focus instead.
// Set `disabled` when the child does not have a `disabled` prop itself.
export function Hint({
  label,
  disabled: disabledProp,
  children,
}: {
  label: string;
  disabled?: boolean;
  children: ReactElement;
}) {
  const disabled = disabledProp ?? !!(children.props as { disabled?: boolean }).disabled;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {disabled ? (
          <span
            className="hint-disabled"
            role="button"
            tabIndex={0}
            aria-disabled="true"
            aria-label={label}
          >
            {children}
          </span>
        ) : (
          children
        )}
      </TooltipTrigger>
      <TooltipContent sideOffset={6}>{label}</TooltipContent>
    </Tooltip>
  );
}
