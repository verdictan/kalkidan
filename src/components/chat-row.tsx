import type { HTMLAttributes, ReactNode, Ref } from 'react';
import { agentLabel } from '../config/agents';
import { fullTime, relativeTime } from '../lib/relative-time';
import type { Session } from '../types';
import { ChatStatusDot, type SessionActivityState } from './activity-dot';
import { AgentIcon } from './ui/agent-icon';
import { EntityIcon } from './ui/entity-icon';

/**
 * One row for one chat, the same on every page that lists chats: a 28px tile at the page edge,
 * the title, then "Agent · folder · time". The ⋯ menu shows on hover. The row is 48px high and
 * its hover fill goes 8px past the text edges.
 */
export function ChatRow({
  session,
  activity,
  folder,
  project,
  onOpen,
  menu,
  meta,
  trailing,
  icon,
  current = false,
  label,
  ref,
  ...rest
}: Omit<HTMLAttributes<HTMLDivElement>, 'onClick'> & {
  /** A context menu trigger sets the ref and the pointer and key handlers of the row. */
  ref?: Ref<HTMLDivElement>;
  session: Session;
  /** The live state of the chat, for the status dot. */
  activity?: SessionActivityState;
  /** The code folder of the chat. */
  folder?: string;
  /** The project of the chat, for lists that hold more than one project. */
  project?: string;
  onOpen: (session: Session) => void;
  /** The ⋯ menu of the row. It shows on hover and on focus. */
  menu?: ReactNode;
  /** Replaces "Agent · folder · time" under the title. */
  meta?: ReactNode;
  /** Controls before the menu, such as "Restore". They always show. */
  trailing?: ReactNode;
  /** Replaces the agent tile. */
  icon?: ReactNode;
  /** The chat that shows now. */
  current?: boolean;
  /** The accessible name of the open button. */
  label?: string;
}) {
  const title = session.organization?.title || session.title;
  const when = relativeTime(session.updatedAt);
  return (
    <div
      {...rest}
      ref={ref}
      className={['chat-row row-hover', rest.className].filter(Boolean).join(' ')}
      data-current={current || undefined}
    >
      <button
        type="button"
        className="chat-row-open"
        title={title}
        aria-label={label || title}
        aria-current={current ? 'page' : undefined}
        onClick={() => onOpen(session)}
      >
        {icon || (
          <EntityIcon>
            <AgentIcon agent={session.agent} />
          </EntityIcon>
        )}
        <span className="chat-row-text">
          <span className="chat-row-title">
            <span className="truncate">{title}</span>
            <ChatStatusDot session={session} live={activity} />
          </span>
          <span className="chat-row-meta">
            {meta ?? (
              <>
                {[agentLabel(session.agent), project, folder].filter(Boolean).join(' · ')}
                {when && (
                  <>
                    {' · '}
                    <time dateTime={session.updatedAt} title={fullTime(session.updatedAt)}>
                      {when}
                    </time>
                  </>
                )}
              </>
            )}
          </span>
        </span>
      </button>
      {trailing && <div className="chat-row-trailing">{trailing}</div>}
      {menu && <div className="chat-row-menu">{menu}</div>}
    </div>
  );
}
