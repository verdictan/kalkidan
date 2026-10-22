/**
 * Ownership of a managed chat.
 *
 * A managed chat belongs to the account that started it. The binding names who is authorized
 * and who pays. After a switch to another account or organization, the chat stays read-only.
 * Its context and its usage stay with the original account. Kalkidan never moves them. The
 * user can start a new conversation under the active account.
 */

export type ConversationOwnership =
  | { state: 'current' | 'unmanaged' | 'unknown' }
  | {
      state: 'other';
      /** `user`: another person of the same organization. `organization`: another one. */
      scope: 'user' | 'organization';
    };

export interface OwnershipInput {
  /** The saved binding of the chat. Null when the chat has no managed binding. */
  binding: { organization_id: string; user_id: string } | null;
  /** The signed-in account. Undefined when no account is signed in. */
  account?: { organizationId?: string; userId?: string };
}

const sameId = (a: string | undefined, b: string | undefined) =>
  !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** Tells whether the signed-in account owns a chat. */
export function conversationOwnership({ binding, account }: OwnershipInput): ConversationOwnership {
  if (!binding) return { state: 'unmanaged' };
  if (!account?.organizationId || !account.userId) return { state: 'unknown' };
  const sameOrganization = sameId(binding.organization_id, account.organizationId);
  if (sameOrganization && sameId(binding.user_id, account.userId)) return { state: 'current' };
  return { state: 'other', scope: sameOrganization ? 'user' : 'organization' };
}

/** The text that says why a chat is read-only. Empty when the chat is not read-only. */
export function readOnlyReason(ownership: ConversationOwnership) {
  if (ownership.state !== 'other') return '';
  return ownership.scope === 'organization'
    ? 'This conversation belongs to another organization. It is read-only.'
    : 'This conversation belongs to another account. It is read-only.';
}

/** What stays with the original account. */
export const readOnlyDetail =
  'Its context and usage stay with that account. Start a new conversation to continue with the active account.';
