/**
 * The limits of the event buffer of a managed runtime. See docs/event-buffer.md.
 *
 * The buffer has two parts:
 * - The evidence buffer in the memory of the gateway. Kalkidan reads it to show the policy,
 *   usage, and audit state of each request. Verdictan sets its capacity and expiry. The poll
 *   reply states the expiry, and Kalkidan refuses a reply with a different value.
 * - The durable event queue on disk. It keeps policy, usage, and audit events until the Verdictan
 *   API accepts them. Kalkidan sets its disk limit for each gateway that it starts.
 */
export const eventBufferLimits = {
  /** Events that the gateway keeps in memory for one session. Verdictan sets this value. */
  eventsPerSession: 256,
  /** Sessions that have events in the memory of one gateway. Verdictan sets this value. */
  sessions: 128,
  /** Seconds that the gateway keeps an event in memory. Verdictan sets this value. */
  expirySeconds: 900,
  /** Events in one poll reply. */
  eventsPerPage: 100,
  /** Request rows that Kalkidan keeps for one conversation. The oldest row goes first. */
  rowsPerConversation: 300,
  /**
   * Proposal: the disk limit of the durable event queue of a gateway that Kalkidan starts.
   * Verdictan uses 1 GiB when no value is set. Events on disk do not expire. When the queue is
   * full, the gateway refuses new requests until the API accepts the stored events.
   */
  diskBytes: 256 * 1024 * 1024,
} as const;

/** The environment that sets the disk limit of the durable event queue. */
export function eventBufferEnvironment() {
  return { VERDICTAN_EVENT_WAL_MAX_BYTES: String(eventBufferLimits.diskBytes) };
}
