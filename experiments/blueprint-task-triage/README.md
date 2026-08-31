# blueprint/task-triage

> An unstructured inbox becomes a task board: classify, extract, board,
> work the oldest-open loop, and let failed tasks say why. See
> `blueprint.json` for the declarative spec.

## What this is

The composition of the tasks and text families. Tasks give the state
machine (open -> done/failed) and the deterministic work loop; text gives
the LLM verbs that turn prose into boardable cards.

## The recipe

1. **Capture**: `rh_store_put { key: 'inbox:' + slug, value: { text, at } }`.
2. **Classify**: `rh_text_classify { text, labels: ['bug', 'feature', 'question'] }`
   returns a label verbatim from the set plus 0-1 confidence.
3. **Extract**: `rh_text_extract { text, schema: { due, owner, amount } }`
   returns one object conforming to the schema - parse failures are clean
   errors, never raw prose.
4. **Board**: `rh_task_create { title, detail }` - one task per item; keep
   the extracted fields in the detail.
5. **Work loop**: `rh_task_next` returns the OLDEST open task - the loop
   is deterministic, not a choice. Finish with `rh_task_update` state
   done; a task that cannot run is updated failed with a `result` saying
   what was tried and what broke - the record stays.
6. **Report**: weekly, `rh_task_list { state: 'done' }` +
   `rh_text_summarise` over the titles and results.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| capture | `rh_store_put` | inbox: prefix |
| classify | `rh_text_classify` | verbatim label + confidence |
| extract | `rh_text_extract` | JSON Schema in, one object out |
| board | `rh_task_create` | typed tasks domain |
| work | `rh_task_next` / `rh_task_update` | oldest open first |
| report | `rh_task_list` + `rh_text_summarise` | done + failed, not silent |

## Escalation

Same verbs, heavier pipeline: classify everything first, batch-extract,
then board - one model call per verb keeps failures contained. A failed
task's `result` field is the audit: never delete the evidence.

## What tests pin

The tasks domain state machine and next-ordering are pinned in
`tests/dsh-native-tools.spec.ts`; the text verbs are pinned with a stub
LLM adapter (clean error on parse failure, verbatim labels). Honest
limit: the text family runs on the harness default model unless the
plugin config says otherwise.