// A one-time handoff from the page that starts a chat to the chat view that opens next.
// Example: "Ask an agent about this page" starts a draft and attaches the page.

export interface PendingDraft {
  /** Text for the composer. */
  prompt?: string;
  /** Doc pages to attach to the first message. */
  docIds?: string[];
  /** The project that owns the doc pages. */
  groupId?: string;
  /** A board item to link to the chat. */
  taskId?: string;
}

const drafts = new Map<string, PendingDraft>();

/** `key` is the session key: `${agent}:${id}`. */
export function setPendingDraft(key: string, draft: PendingDraft) {
  drafts.set(key, draft);
}

/** Returns the draft once and removes it. */
export function takePendingDraft(key: string): PendingDraft | undefined {
  const draft = drafts.get(key);
  drafts.delete(key);
  return draft;
}
