# blueprint/weather-alert CLOUD learnings log

> Cloud version of the weather-alert blueprint. Deployed test build
> (workers.dev, keyless) WITH a cron trigger.

## Run context

| Field | Value |
|---|---|
| Worker | `cloud/index.js` - rh-weather-alert, `GET /check`, `/health` |
| Deploy | wrangler 4.123.0, OAuth, workers.dev |
| URL | https://rh-weather-alert.ambiens.workers.dev |
| Cron | `0 8 * * *` (scheduled handler deployed) |
| Compat | 2026-08-31 |

## Measured (2026-08-31)

- `/check` with test thresholds -> 1 crossing (wind 15.8 vs 0),
  timezone GMT, PASS. The crossing shape { param, value, threshold,
  at } is what the agent turns into an rh_events_create reminder.
- The cron trigger deployed cleanly; the scheduled handler runs the
  same check with defaults and logs. THE BOUNDARY: the Worker computes
  crossings, it does NOT deliver - delivery stays the agent's
  rh_events_due + rh_notify_send (exactly-once is a state flip in the
  harness store, which a stateless Worker cannot fake).

## Build learnings

- Thresholds arrive per request (query params) or via env vars in
  the scheduled path - no secrets, no bindings, no state.
- ctx.waitUntil is the right place for the scheduled work (no
  response to race); best-practices rule applied.

## Blueprint guidance update

- The cron half is now MEASURED, not just documented: a Worker can
  check on schedule; it cannot be the scheduler's memory. The kit's
  escalation line upgrades from 'documented' to 'built + boundary
  measured'.