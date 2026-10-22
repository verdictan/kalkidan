import { useEffect, useState } from 'react';
import { GitFork, Lock, SquarePen } from 'lucide-react';
import type { API } from '../api/contracts';
import type { Session } from '../domain/conversation';
import {
  isReadOnly,
  readOnlyHelp,
  readOnlyReason,
  type ConversationOwnership,
} from '../domain/conversation-ownership';
import { Button } from './ui/button';

/**
 * Reads who owns a saved chat. A draft has no binding. The result changes after a sign-in to
 * another account, so it reads again when the account changes.
 */
export function useConversationOwnership(api: API, session: Session, open: boolean) {
  const [ownership, setOwnership] = useState<ConversationOwnership>({ state: 'unknown' });
  const [epoch, setEpoch] = useState(0);
  useEffect(() => api.onVerdictanChanged?.(() => setEpoch((value) => value + 1)), [api]);
  useEffect(() => {
    if (!open || session.id.startsWith('draft-') || typeof api.conversationOwnership !== 'function')
      return;
    let active = true;
    api.conversationOwnership(session.agent, session.id, session.hostId).then(
      (value) => active && setOwnership(value),
      // A failed read keeps the chat as it is. The launch still checks the binding.
      () => active && setOwnership({ state: 'unknown' }),
    );
    return () => {
      active = false;
    };
  }, [api, session.agent, session.id, session.hostId, open, epoch]);
  return ownership;
}

/**
 * Says why a chat is read-only: another account or organization owns it, or its agent is gone.
 * It offers a new conversation under the active account, and a fork. Nothing of this chat moves
 * to the new conversation. A fork continues from the history of this chat with the current
 * agent of the computer. When the agent of the chat is gone, Fork is the main action.
 */
export function ReadOnlyConversation({
  ownership,
  onStartNew,
  onFork,
}: {
  ownership: ConversationOwnership;
  onStartNew?: () => void;
  onFork?: () => void;
}) {
  if (!isReadOnly(ownership)) return null;
  return (
    <div className="chat-read-only" role="status" aria-label="Read-only conversation">
      <Lock className="size-3.5 shrink-0" aria-hidden="true" />
      <div className="grid min-w-0 flex-1 gap-0.5 text-xs">
        <span className="font-medium">{readOnlyReason(ownership)}</span>
        <span className="text-muted-foreground">{readOnlyHelp(ownership)}</span>
      </div>
      {onStartNew && (
        <Button size="sm" variant="outline" onClick={onStartNew}>
          <SquarePen /> Start a new conversation
        </Button>
      )}
      {onFork && (
        <Button
          size="sm"
          variant={ownership.state === 'agent_unavailable' ? 'default' : 'outline'}
          onClick={onFork}
        >
          <GitFork /> Fork chat
        </Button>
      )}
    </div>
  );
}
