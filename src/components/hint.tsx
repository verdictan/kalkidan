import { useId, type ReactElement } from 'react';
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
  const reasonId = useId();
  return (
    <Tooltip>
      <TooltipTrigger asChild>
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
      <TooltipContent sideOffset={6}>{label}</TooltipContent>
    </Tooltip>
  );
}
