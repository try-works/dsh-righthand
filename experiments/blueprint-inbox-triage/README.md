# blueprint/inbox-triage

> Hermes source: email/email-inbox-triage. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

## The recipe

1. **Capture**: inbox:<ts> items in the store.
2. **Classify**: rh_text_classify with a closed priority set
   (urgent/respond/later/ignore).
3. **Extract**: rh_text_extract { sender, ask, deadline }.
4. **Act**: urgent = task + reply now; respond = task; time-
   sensitive = task + rh_events_create at the deadline; later/ignore
   = a receipt only.
5. **Work**: the board runs oldest-open.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| classify | `rh_text_classify` | verbatim label, closed set |
| extract | `rh_text_extract` | ask + deadline |
| board | `rh_task_create` | one task per actionable item |
| schedule | `rh_events_create` | deadline events |

The reply is yours to write - the tools prioritize, they never draft
on your behalf. Ignore is a decision too: record it.