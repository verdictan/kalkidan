// Preferences for new chats that Settings › General shows. The chat view reads them.

/** The access of a new chat: 'read' is "Read only", 'edit' is "Can edit files". */
export type ChatAccess = 'read' | 'edit';

export const newChatAccessKey = 'kalkidan-new-chat-access';
export const enterToSendKey = 'kalkidan-enter-to-send';
const changeEvent = 'kalkidan-chat-preferences';

/**
 * The access that a new chat starts with. The default is "Read only". A choice that the user
 * made for one code folder in the composer comes before this default.
 */
export function readNewChatAccess(): ChatAccess {
  try {
    return localStorage.getItem(newChatAccessKey) === 'edit' ? 'edit' : 'read';
  } catch {
    return 'read';
  }
}

/**
 * The access of a new chat in the composers: the Settings choice when the user made one, else
 * "Can edit" (each chat edits its own branch copy).
 */
export function newChatAccess(): ChatAccess {
  try {
    return localStorage.getItem(newChatAccessKey) === 'read' ? 'read' : 'edit';
  } catch {
    return 'edit';
  }
}

export function saveNewChatAccess(value: ChatAccess) {
  try {
    localStorage.setItem(newChatAccessKey, value);
  } catch {
    /* The choice applies for this run only. */
  }
  window.dispatchEvent(new Event(changeEvent));
}

/**
 * True when Enter sends the message and Shift+Enter adds a line. False when Enter adds a line
 * and ⌘Enter (Ctrl+Enter) sends. The default is true.
 */
export function readEnterToSend(): boolean {
  try {
    return localStorage.getItem(enterToSendKey) !== 'false';
  } catch {
    return true;
  }
}

export function saveEnterToSend(value: boolean) {
  try {
    localStorage.setItem(enterToSendKey, String(value));
  } catch {
    /* The choice applies for this run only. */
  }
  window.dispatchEvent(new Event(changeEvent));
}

/** Calls `listener` when a chat preference changes. Returns a function that stops it. */
export function onChatPreferencesChange(listener: () => void) {
  window.addEventListener(changeEvent, listener);
  return () => window.removeEventListener(changeEvent, listener);
}
