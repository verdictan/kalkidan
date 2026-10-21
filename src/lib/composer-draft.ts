/**
 * The composer text after the chat accepts a message into the transcript. The message is in the
 * transcript, so it leaves the composer. Text that the user changed while the message was
 * sending stays, so no draft is lost.
 */
export function composerAfterSubmit(current: string, sent: string) {
  return current.trim() === sent.trim() ? '' : current;
}

/** The composer attachments after a submit. Attachments added during the send stay. */
export function contextsAfterSubmit<T>(current: T[], sent: readonly T[]) {
  return current.filter((context) => !sent.includes(context));
}
