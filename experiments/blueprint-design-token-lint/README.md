# blueprint/design-token-lint

> Hermes source: design-md. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Token spec validation as a gate step: run the validator, receipt the verdict, red blocks the design change, the fix loop reruns only it.

## The recipe

1. run the validator over the token spec.
2. receipt the verdict (exit + tail).
3. red blocks the change - the fix loop reruns only the validator.
4. green: the gate passes.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| lint | rh_run | validator script |
| receipt | rh_store_put | lint:<spec>:<ts> |
| gate | pre-commit-gate | red blocks |
| fix | rh_run | rerun only the validator |

## Limits

validates the spec file, not the rendered design - rendering checks are a different gate.