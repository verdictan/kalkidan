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

| Limit                                                  | Value                            | Owner     | Status                                                              |
| ------------------------------------------------------ | -------------------------------- | --------- | ------------------------------------------------------------------- |
| Events in memory for each session                      | 256                              | Verdictan | Current value                                                       |
| Sessions in memory for each gateway                    | 128                              | Verdictan | Current value                                                       |
| Expiry of an event in memory                           | 900 seconds                      | Verdictan | Contract value. Kalkidan refuses a poll reply with another value.   |
| Events in one poll reply                               | 100                              | Verdictan | Contract value                                                      |
| Request rows that Kalkidan keeps for each conversation | 300                              | Kalkidan  | Current value                                                       |
| Disk limit of the durable event queue                  | 200 MB (200,000,000 bytes)       | Kalkidan  | Product decision. Verdictan uses 1 GiB when no value is set.        |
| Expiry of a policy decision or trail event on disk     | 30 days                          | Kalkidan  | Product decision. Usage records do not expire.                      |
| Behavior when the disk queue is full                   | Drop the oldest non-usage events | Kalkidan  | Product decision. Usage records stay until Verdictan receives them. |

Kalkidan sets these values for each gateway that it starts, on this computer and on each SSH
host:

- `VERDICTAN_EVENT_WAL_DATA_DIR=~/.kalkidan/runtime/verdictan/events` (a private folder). Undelivered
  usage records then survive a restart. Without it, Verdictan keeps the queue in the temporary
  folder of the system, which the system can clear. Kalkidan does not move a queue from the
  temporary folder, because a Verdictan gateway outside Kalkidan can use it too.
- `VERDICTAN_EVENT_WAL_MAX_BYTES=200000000`
- `VERDICTAN_EVENT_WAL_FULL_POLICY=drop_oldest_non_usage`
- `VERDICTAN_EVENT_WAL_MAX_AGE_SECONDS=2592000`

Change `eventBufferLimits` and this table together. A Verdictan CLI of version 0.6.10 or earlier
does not read the folder, the policy, or the age. It keeps every event in the temporary folder and
refuses requests when full. CLI 0.6.11 reads all of them.

## Behavior when a part is full

**Evidence buffer.** When a session has more than 256 events, the gateway deletes the oldest
event. When an event is older than 900 seconds, the gateway deletes it. A poll that asks for a
deleted event gets `gap: true` and `reconciliation_required: true`. Kalkidan then reads the
authoritative snapshot from the Verdictan API. Kalkidan never guesses a missing event. A row
without data stays unknown. It never shows as allowed or as free usage. When a conversation has
more than 300 rows, Kalkidan deletes the oldest row.

**Durable event queue.** The gateway keeps one segment (16 MiB) and eight requests (16 MiB) of
the 200 MB free. When the queue reaches that space, the gateway removes its oldest segment:

1. It copies the usage records of the segment to the end of the queue. Usage records are
   `spend`, `ua_complete`, `ai_usage`, and events of an unknown kind.
2. It removes the policy `decision` and `trail` events of the segment without delivery.

The oldest non-usage events go first. A policy decision or trail event that is older than 30 days
when it reaches the head of the queue is also removed. A usage record is never removed before
Verdictan receives it.

The evidence poll reply reports the removed events in `event_buffer`. When the gateway removes
events during a conversation, Kalkidan shows this warning under the managed run:

> Verdictan did not receive _N_ policy records, because the event buffer was full. Usage records
> stay until Verdictan receives them. Check the network connection.

The counts are for the whole queue, which all sessions on the computer share. So Kalkidan warns
only for removals after the first poll of the conversation.

When the queue holds only usage records, the gateway cannot free space. It then refuses new
requests with HTTP 503, and its readiness reply has the code `desktop.event_buffer_full`.
Kalkidan shows this message:

> The event buffer on _computer_ is full. New requests stop until Verdictan receives the stored
> events. Check the network connection of _computer_, then try again.

A crash while the gateway copies usage records can send a usage record two times. The Verdictan
API accepts each event ID one time.

## Tests

- `tests/event-buffer.test.ts`: the limits, a full evidence buffer, expiry, the row limit of a
  conversation, the warning for removed events, and the message for a full queue.
- `tests/verdictan-gateway.test.ts`: the disk limit goes to the gateway, and Kalkidan relays
  `desktop.event_buffer_full`.
- Verdictan `cli/src/gateway/event-wal.test.ts`: the policy removes the oldest decision and
  trail events, keeps each usage record one time, expires old non-usage events, and does not
  rewrite a queue that holds only usage records.
- Verdictan `cli/src/gateway/event-delivery.test.ts`: the delivery worker applies the policy.
- Verdictan `cli/src/gateway/desktop-events.test.ts` and
  `cli/src/kernel/runtime/gateway-router.test.ts`: eviction, gaps, expiry, `event_buffer` in the
  poll reply, and the readiness code for a full queue.
