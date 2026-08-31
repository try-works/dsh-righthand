# blueprint/job-tracker

> Hermes source: jobs / job-search. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Applications as a board with follow-up events: log the application, board a task, schedule the follow-up, record the outcome either way.

## The recipe

1. log the application with the posting text.
2. classify fit (strong/medium/long-shot).
3. board a task and schedule the follow-up event.
4. outcome: done or failed with the result field saying why.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| log | rh_store_put + rh_task_create | app:<slug> |
| fit | rh_text_classify | verbatim labels |
| follow-up | rh_events_create | at the agreed date |
| outcome | rh_task_update | failed keeps the reason |

## Limits

no job-board integration - the store is the board.