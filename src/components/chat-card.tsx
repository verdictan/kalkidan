import type { FormEventHandler, ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '../lib/utils';

/**
 * One card in the chat column: a refusal, an error, an approval or a question. Padding 12,
 * radius 12, a neutral border and no shadow. The head is the 16px icon and the 13/500 title.
 * The body and the actions use the full width under it. Only the icon has the tone color.
 * Actions are right aligned with the primary action last.
 */
export function ChatCard({
  tone = 'neutral',
  icon: Icon,
  title,
  children,
  actions,
  as: Element = 'section',
  label,
  role,
  tabIndex,
  onSubmit,
  className,
}: {
  tone?: 'danger' | 'warning' | 'neutral';
  icon: LucideIcon;
  title: ReactNode;
  /** The body: text with the class chat-card-body, details, fields. */
  children?: ReactNode;
  /** The buttons. Put a ghost button first with `mr-auto` to place it on the left. */
  actions?: ReactNode;
  as?: 'section' | 'div' | 'form';
  /** The accessible name of the card. */
  label?: string;
  role?: string;
  tabIndex?: number;
  onSubmit?: FormEventHandler<HTMLFormElement>;
  className?: string;
}) {
  return (
    <Element
      className={cn('chat-card', className)}
      data-tone={tone}
      aria-label={label}
      role={role}
      tabIndex={tabIndex}
      onSubmit={onSubmit as FormEventHandler<HTMLElement>}
    >
      <div className="chat-card-head">
        <Icon className="chat-card-icon" aria-hidden="true" />
        <h3 className="chat-card-title">{title}</h3>
      </div>
      {children}
      {actions && <div className="chat-card-actions">{actions}</div>}
    </Element>
  );
}
