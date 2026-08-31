# blueprint/handoff-review

> Hermes source: sdlc-review. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Review task handoffs before they count: collect done tasks, verify each outcome against evidence, accept or bounce, receipt the verdict.

## The recipe

1. collect the done tasks.
2. verify each outcome against its evidence.
3. accept or bounce (with the reason on the task).
4. receipt the review.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| collect | rh_task_list | done + failed |
| verify | receipts / rh_run | outcome vs evidence |
| decide | rh_store_put | accept or bounce |
| route | guard ask | accept is a decision |

## Limits

verification is only as strong as the receipts the work left.