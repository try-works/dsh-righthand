# blueprint/weather-alert - run log

## Learnings

- the weather family is shipped and live-probed.
- events exactly-once is the state flip (reminder-flow).
- thresholds in the store, not settings (schema wall).

## Cloud test build (2026-08-31)

- Deployed rh-weather-alert WITH a cron trigger (0 8 * * *). /check
  returned 1 crossing under test thresholds; the scheduled handler
  computes and logs only.
- Boundary measured: a Worker checks on schedule but cannot hold the
  scheduler's memory - exactly-once delivery stays the agent's
  rh_events_due + rh_notify_send.