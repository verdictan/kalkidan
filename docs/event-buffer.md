# Event buffer of managed agents

A managed gateway buffers the policy, usage, and audit events of each request. Kalkidan reads
these events to show the state of each request in a conversation. This page gives the limits of
the buffer and what happens when it is full.

The code that sets and checks these limits is in `electron/verdictan/event-buffer.ts`.

## Parts of the buffer

The buffer has two parts:

1. **Evidence buffer (memory).** The gateway keeps recent events in memory. Kalkidan polls them
   every 2 seconds. Verdictan owns this part (`cli/src/gateway/desktop-events.ts`).
2. **Durable event queue (disk).** The gateway writes each policy, usage, and audit event to disk
   before it sends the event to the Verdictan API. An event stays on disk until the API accepts
   it. Verdictan owns this part (`cli/src/gateway/event-wal.ts`). Kalkidan sets its disk limit.

## Limits

| Limit                                                  | Value       | Owner     | Status                                                            |
| ------------------------------------------------------ | ----------- | --------- | ----------------------------------------------------------------- |
| Events in memory for each session                      | 256         | Verdictan | Current value                                                     |
| Sessions in memory for each gateway                    | 128         | Verdictan | Current value                                                     |
| Expiry of an event in memory                           | 900 seconds | Verdictan | Contract value. Kalkidan refuses a poll reply with another value. |
| Events in one poll reply                               | 100         | Verdictan | Contract value                                                    |
| Request rows that Kalkidan keeps for each conversation | 300         | Kalkidan  | Current value                                                     |
| Disk limit of the durable event queue                  | 256 MiB     | Kalkidan  | **Proposal.** Verdictan uses 1 GiB when no value is set.          |
| Expiry of an event on disk                             | None        | Verdictan | Audit and usage events stay until the API accepts them.           |

Kalkidan sets the disk limit with `VERDICTAN_EVENT_WAL_MAX_BYTES` for each gateway that it starts.
The limit applies on this computer and on each SSH host. Each request in progress reserves 2 MiB
of the limit until its events are on disk, so 256 MiB allows at most 128 requests at the same
time. This value is a product decision.
Change `eventBufferLimits.diskBytes` and this table together.

## Behavior when a part is full

**Evidence buffer.** When a session has more than 256 events, the gateway deletes the oldest
event. When an event is older than 900 seconds, the gateway deletes it. A poll that asks for a
deleted event gets `gap: true` and `reconciliation_required: true`. Kalkidan then reads the
authoritative snapshot from the Verdictan API. Kalkidan never guesses a missing event. A row
without data stays unknown. It never shows as allowed or as free usage. When a conversation has
more than 300 rows, Kalkidan deletes the oldest row.

**Durable event queue.** When the queue is full, the gateway refuses new requests with HTTP 503
(`audit.wal_unavailable`). Its readiness reply has the code `desktop.event_buffer_full`
(Verdictan CLI after 0.6.10). Kalkidan shows this message:

> The event buffer on _computer_ is full. New requests stop until Verdictan receives the stored
> events. Check the network connection of _computer_, then try again.

The gateway never deletes an undelivered audit or usage event to make space. Requests start
again when the API accepts the stored events. A Verdictan CLI of version 0.6.10 or earlier reports
a full queue as `desktop.readiness_blocked`.

## Tests

- `tests/event-buffer.test.ts`: the limits, a full evidence buffer, expiry, the row limit of a
  conversation, and the message for a full queue.
- `tests/verdictan-gateway.test.ts`: the disk limit goes to the gateway, and Kalkidan relays
  `desktop.event_buffer_full`.
- Verdictan `cli/src/gateway/desktop-events.test.ts` and
  `cli/src/kernel/runtime/gateway-router.test.ts`: eviction, gaps, expiry, and the readiness code
  for a full queue.
