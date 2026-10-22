import { useEffect, useState } from 'react';
import { GitFork, Lock, SquarePen } from 'lucide-react';
import type { API } from '../api/contracts';
import type { Session } from '../domain/conversation';
import {
  readOnlyDetail,
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
 * Says why a chat of another account or organization is read-only, and offers a new
 * conversation under the active account. Nothing of this chat moves to the new one. A fork
 * continues from the history of this chat with the current agent of the computer.
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
  if (ownership.state !== 'other') return null;
  return (
    <div className="chat-read-only" role="status" aria-label="Read-only conversation">
      <Lock className="size-3.5 shrink-0" aria-hidden="true" />
      <div className="grid min-w-0 flex-1 gap-0.5 text-xs">
        <span className="font-medium">{readOnlyReason(ownership)}</span>
        <span className="text-muted-foreground">{readOnlyDetail}</span>
      </div>
      {onStartNew && (
        <Button size="sm" variant="outline" onClick={onStartNew}>
          <SquarePen /> Start a new conversation
        </Button>
      )}
      {onFork && (
        <Button size="sm" variant="outline" onClick={onFork}>
          <GitFork /> Fork chat
        </Button>
      )}
    </div>
  );
}
