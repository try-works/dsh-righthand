# blueprint/reminder-flow - run log

## Learnings (from building the events + notify families, 0.1.8)

1. **Exactly-once lives in the state flip.** rh_events_due returns and
   marks notified in the same call; the caller never has to remember
   what it already delivered. A missed turn leaves a pending record -
   visible, never silent.
2. **Working hours are local time.** freeSlots tests first assumed UTC
   and failed on a UTC+8 machine; rewritten with local Date
   constructors. Any scheduled feature inherits this trap.
3. **The notify topic is the only secret.** ntfy.sh is keyless;
   anything that guesses the topic can read it. Unguessable random
   string, and the publish still goes through the SSRF-guarded
   fetcher.
4. **One-off events only.** Recurring reminders are create-again-on-
   fire; a real scheduler (Cloudflare cron) is the documented
   escalation, not a built primitive.
5. **Empty calendars must yield slots (live-caught 2026-08-31).** The
   first live rh_events_free call after the restart returned [] with
   nothing booked: the slot loop only ran over busy events, so an empty
   calendar and the gap after the last event of a day were never
   reported. Fixed in 0.1.17 - freeSlots now scans each working day and
   reports every gap, including the trailing one.