# blueprint/inbox-triage - run log

## Learnings (from the task-triage and events builds)

1. **Closed priority set.** rh_text_classify answers verbatim or
   errors - the priority labels cannot drift.
2. **The deadline is an event, not a detail.** A time-sensitive ask
   boards as a task AND schedules rh_events_create - the reminder
   bridge from document-action-plan.
3. **Ignore is a decision.** Recording it keeps the triage honest and
   the weekly review complete.