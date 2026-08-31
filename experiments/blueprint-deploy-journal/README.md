# blueprint/deploy-journal

> Hermes source: DevOps. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Deploys with a paper trail: before-receipt, the deploy command, smoke checks, after-receipt, and a revert path from the undo trail.

## The recipe

1. write the before-receipt (what will change).
2. deploy via rh_run.
3. smoke-check with the same command.
4. after-receipt; red smokes revert from the undo trail.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| before | rh_store_put | deploy:<id>:before |
| deploy | rh_run | guard-gated |
| smoke | rh_run | same command each time |
| revert | undo trail | from the receipts |

## Limits

no CD - the journal is local; CI/Worker is the escalation.