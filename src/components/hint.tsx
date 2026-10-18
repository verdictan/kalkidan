import type { ReactElement } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
export function Hint({ label, children }: { label: string; children: ReactElement }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent sideOffset={6}>{label}</TooltipContent>
    </Tooltip>
  );
}
