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

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Checks the owner IDs that an SSH host returns. Null when the chat has no binding.
 * Throws for any other shape, so that a bad answer never hides or changes the owner.
 */
export function remoteOwner(value: unknown): OwnershipInput['binding'] {
  if (value === null) return null;
  const record = value as Record<string, unknown> | undefined;
  if (
    !record ||
    typeof record !== 'object' ||
    typeof record.organization_id !== 'string' ||
    typeof record.user_id !== 'string' ||
    !uuidPattern.test(record.organization_id) ||
    !uuidPattern.test(record.user_id)
  )
    throw new Error('Invalid conversation owner.');
  return { organization_id: record.organization_id, user_id: record.user_id };
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
