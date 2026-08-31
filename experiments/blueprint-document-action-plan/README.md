# blueprint/document-action-plan

> A document or meeting note becomes a plan that acts: extract cited
> obligations, board each as a task, schedule each deadline as a
> reminder, and deliver through ntfy (Hermes document-to-action-items /
> meeting-action-items, righthand-native). See `blueprint.json`.

## What this is

The bridge between three families: text extraction turns prose into
structure, tasks track the work, events deliver the interruption at the
deadline. The citation is the load-bearing field.

## The recipe

1. **Extract**: `rh_text_extract { text, schema: { obligations: [{ cite,
   action, owner, deadline }] } }` - each obligation keeps the sentence
   that spawned it.
2. **Board**: `rh_task_create` per obligation; the cite goes in the
   detail so the task stays falsifiable.
3. **Schedule**: `rh_events_create` per deadline - at = the ISO
   deadline, title = the action. The event is the interruption half;
   the task is the work half.
4. **Deliver**: each turn `rh_events_due` returns what has come due and
   marks it notified (exactly-once by state flip), then
   `rh_notify_send` the due items.
5. **Close**: when the work is done, complete the task AND cancel the
   event - two halves, both closed.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| extract | `rh_text_extract` | obligations schema, cite required |
| board | `rh_task_create` | one task per obligation |
| schedule | `rh_events_create` | one event per deadline |
| deliver | `rh_events_due` + `rh_notify_send` | exactly-once, per turn |
| close | `rh_task_update` + `rh_events_cancel` | both halves |

## Escalation

Hallucinated obligations are the failure mode - the cite is what lets
the user check each one against the source. For long documents, extract
in chunks and dedupe by cite before boarding.

## What tests pin

All three families are suite-tested: extract (stub LLM adapter, clean
parse errors), the task state machine, and events exactly-once. Honest
limit: none of the three has run through a live agent turn yet - the
running profile predates them.