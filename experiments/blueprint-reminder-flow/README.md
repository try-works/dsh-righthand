# blueprint/reminder-flow

> The agent as its own scheduler: rh_events_* checked every turn,
> rh_notify_send to interrupt yourself, one store receipt per delivery.
> See `blueprint.json` for the declarative spec.

## What this is

A turn-based reminder routine built from the events, notify and store
families. No new services: the agent loop is the clock, the events domain
is the state machine, ntfy.sh is the transport, the store is the audit.

## The recipe

1. **Create** the reminder: `rh_events_create { title, detail, at }`.
   State starts `pending`.
2. **Check every turn**: `rh_events_due { horizonHours: 1 }` returns the
   pending events whose time has come and marks them `notified` in the
   same call - the state flip is the exactly-once guarantee, not caller
   discipline.
3. **Interrupt yourself**: `rh_notify_send { message: title + detail }` to
   the default ntfy topic (settings `defaultNotifyTopic`; the topic name
   is the only secret - unguessable random string).
4. **Receipt**: `rh_store_put { key: 'reminder:<eventId>:<ts>', value:
   { eventId, at, notifiedAt } }` so a delivered reminder is a fact, not
   a memory.
5. **Free slots**: before creating, `rh_events_free { durationMinutes }`
   finds the next gaps within working hours 09:00-17:00.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| book | `rh_events_create` | one-off events; recurring = create-again-on-fire |
| poll | `rh_events_due` | run EVERY turn; returns and flips to notified |
| find a gap | `rh_events_free` | local-time working hours; uses exported `freeSlots` |
| deliver | `rh_notify_send` | ntfy.sh keyless; priority 1-5; auto-delete 24h |
| audit | `rh_store_put` / `rh_store_list` | one receipt per delivery |
| retract | `rh_events_cancel` | cancelled stays in the record - news too |

## Escalation

The local routine only fires on turns the agent actually runs. For
wake-from-sleep, the documented escalation is a Cloudflare cron Worker
(the user's own account) that calls the same due-check - not a built
primitive yet. The events family keeps its shape compatible with that:
`due` is idempotent and the state machine is the source of truth.

## What tests pin

The events family ships with `tests/events-notify.spec.ts`: exactly-once
due marking, state transitions, free-slot working-hours math, and the
notify publish path through the SSRF-guarded fetcher. Scenario receipts
were live-verified 2026-08-31 (see `docs/scenario-patterns.md`).