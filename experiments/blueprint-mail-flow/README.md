# blueprint/mail-flow

> Hermes source: himalaya. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

A local-credentials mail workflow: the himalaya CLI reads the user's own mailbox, the triage pattern prioritizes, tasks and events carry the follow-ups.

## The recipe

1. list the mailbox via rh_run (collect mode).
2. classify each thread into the closed priority set.
3. extract the ask and deadline.
4. board follow-ups as tasks and schedule the time-sensitive ones as events.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| fetch | rh_run | himalaya list, bounded |
| triage | rh_text_classify + rh_text_extract | inbox-triage pattern |
| board | rh_task_create + rh_events_create | tasks + deadline events |
| reply | agent | the agent drafts, tools never do |

## Limits

IMAP/SMTP setup is the user's local himalaya config - nothing keyed enters the plugin.