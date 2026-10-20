import { Asterisk, SquareTerminal } from 'lucide-react';
import { cn } from '@/lib/utils';

/** One icon per agent, used in rows, menus, settings and search. */
export function AgentIcon({ agent, className }: { agent: string; className?: string }) {
  const Icon = agent === 'claude' ? Asterisk : SquareTerminal;
  return <Icon className={cn('size-4', className)} aria-hidden="true" />;
}
