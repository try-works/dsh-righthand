# blueprint/merge-arbiter

> Hermes source: agent-merge-conflict-arbiter. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Neutral resolution of merge conflicts between two agents: capture the diff, extract both intents, propose a merge, verify with the gate.

## The recipe

1. capture the conflict diff.
2. extract each side's intent and cite.
3. propose a resolution that honors both.
4. apply, verify with the same tests, gate the result.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| diff | rh_run | git diff --conflict |
| extract | rh_text_extract | intent + cite per side |
| apply | rh_run | the proposed merge |
| verify | rh_run + gate | tests then gate |

## Limits

semantic conflicts still need a human eye - the kit resolves what the diff shows.