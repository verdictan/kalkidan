// The Chats lists (All chats, project Chats, the code folder page) are gone: the sidebar tree
// and search find a chat. These helpers stay for the callers that open archived chats.

/** The storage key of the saved view for one list. */
export const sessionViewKey = (key: string) => `kalkidan.sessionView.${key}`;
/** Saves one view of a list, such as 'archived', and tells an open list. */
export function showSessionScope(key: string, scope: string) {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(sessionViewKey(key)) || 'null');
    localStorage.setItem(
      sessionViewKey(key),
      JSON.stringify({ ...(saved && typeof saved === 'object' ? saved : {}), scope }),
    );
  } catch {
    // Storage is not available. The event below still tells an open list.
  }
  window.dispatchEvent(new CustomEvent('kalkidan-session-scope', { detail: { key, scope } }));
}
/** Shows the archived chats of a list, for example from the "View archived" toast action. */
export function viewArchivedSessions(key: string) {
  showSessionScope(key, 'archived');
}
