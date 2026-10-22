import { mkdir } from 'node:fs/promises';

/**
 * The limits of the event buffer of a managed runtime. See docs/event-buffer.md.
 *
 * The buffer has two parts:
 * - The evidence buffer in the memory of the gateway. Kalkidan reads it to show the policy,
 *   usage, and audit state of each request. Verdictan sets its capacity and expiry. The poll
 *   reply states the expiry, and Kalkidan refuses a reply with a different value.
 * - The durable event queue on disk. It keeps policy, usage, and audit events until the Verdictan
 *   API accepts them. Kalkidan sets its disk limit, expiry, and behavior when full for each
 *   gateway that it starts.
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
  /** Disk limit of the durable event queue of each gateway that Kalkidan starts: 200 MB. */
  diskBytes: 200_000_000,
  /** Seconds that a policy decision or trail event stays on disk without delivery: 30 days. */
  diskExpirySeconds: 30 * 86400,
  /**
   * When the queue is nearly full, the gateway removes the oldest policy decision and trail
   * events. Usage records stay until Verdictan receives them. Kalkidan shows a warning.
   */
  fullPolicy: 'drop_oldest_non_usage',
} as const;

/** The environment that sets the folder and the limits of the durable event queue of a gateway. */
export function eventBufferEnvironment(directory?: string): Record<string, string> {
  return {
    ...(directory ? { VERDICTAN_EVENT_WAL_DATA_DIR: directory } : {}),
    VERDICTAN_EVENT_WAL_MAX_BYTES: String(eventBufferLimits.diskBytes),
    VERDICTAN_EVENT_WAL_FULL_POLICY: eventBufferLimits.fullPolicy,
    VERDICTAN_EVENT_WAL_MAX_AGE_SECONDS: String(eventBufferLimits.diskExpirySeconds),
  };
}

/**
 * Make the private folder of the event queue. Kalkidan does not move a queue from the temporary
 * folder of an earlier version: a Verdictan gateway outside Kalkidan can use that queue too, and
 * its events must not leave with the credentials of Kalkidan.
 */
export async function prepareEventDirectory(directory: string) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
}

/** The removed-event counts of the durable event queue in an evidence poll reply. */
export function parseEventBuffer(value: unknown): { dropped: number; expired: number } | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const data = value as Record<string, unknown>;
  const count = (field: unknown) =>
    Number.isSafeInteger(field) && (field as number) >= 0 ? (field as number) : 0;
  return { dropped: count(data.dropped_events), expired: count(data.expired_events) };
}
