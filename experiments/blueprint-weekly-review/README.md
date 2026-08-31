# blueprint/weekly-review

> The weekly reset (Hermes weekly-review-planning, righthand-native):
> scan what actually happened, synthesize it, store the next-week plan
> as a chained note. See `blueprint.json`.

## What this is

The retrospective as a build: every family leaves receipts, and the
review reads them. Failed tasks and cancelled events are the gold -
they say what was tried and what was retracted.

## The recipe

1. **Collect**: `rh_task_list { state: 'done' }` and `{ state:
   'failed' }`, `rh_events_list` (notified + cancelled), and a scan of
   the receipt prefixes for the week (digest:, deploy:, uptime:, ...).
2. **Synthesize**: `rh_text_summarise` over the collected facts - what
   shipped, what stalled and why. Failed tasks carry their `result`
   field; use it.
3. **Plan**: the next-week commitments as a short list (summarise or
   hand-written).
4. **Store**: `rh_store_put { key: 'note:review:' + week, value: {
   done, failed, delivered, plan, at } }` - chained: each review reads
   the previous one's plan and answers it.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| collect | `rh_task_list` / `rh_events_list` / `rh_store_list` | the week's evidence |
| synthesize | `rh_text_summarise` | failed results included |
| plan | `rh_text_summarise` or hand-written | next-week commitments |
| store | `rh_store_put` | note:review:<week>, chained |

## Escalation

Answer-the-plan: each review reads the previous plan and grades it -
what got done, what slipped, why. That chain is the agent's durable
self-assessment; nothing new to build.

## What tests pin

Task list ordering and states, events states, and summarise are
suite-tested; store receipts round-trip live (verified 2026-08-31).
The review is only as true as the receipts - invisible work stays
invisible.