# blueprint/style-pass

> Hermes source: humanizer. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Tone shifts that verify: classify the current tone, the agent rewrites, classify again, store the before/after pair as evidence.

## The recipe

1. classify the current tone against the closed set.
2. rewrite (the agent's work).
3. classify again - the label must move.
4. store both versions as the evidence.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| classify | rh_text_classify | verbatim tone labels |
| rewrite | agent | tools verify only |
| verify | rh_text_classify | the shift |
| store | rh_store_put | before/after pair |

## Limits

style judgment is the model's; the kit makes it measurable.