# blueprint/habit-tracker

> Hermes source: fitness. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Streaks with reminders: one store record per habit-day, a daily cue event, the due check delivers, a miss is a record not a failure.

## The recipe

1. log the habit for today.
2. scan the streak (consecutive dates).
3. schedule tomorrow's cue event.
4. due check delivers and marks notified - a missed day stays a gap in the record.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| log | rh_store_put | habit:<name>:<date> |
| streak | store scan | consecutive dates |
| cue | rh_events_create | daily, working hours |
| deliver | rh_events_due + rh_notify_send | exactly-once |

## Limits

delivery fires only on turns the agent runs - same cadence gap as reminder-flow.