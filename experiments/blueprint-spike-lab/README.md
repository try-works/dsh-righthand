# blueprint/spike-lab

> Hermes source: spike. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Throwaway experiments with a verdict: run the spike, receipt the evidence, record the keep-or-throw decision, clean up after.

## The recipe

1. name the spike and state the question.
2. run the experiment.
3. receipt the evidence.
4. decide keep-or-throw with the reason, then clean up.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| run | rh_run | bounded collect |
| evidence | rh_store_put | spike:<id>:<n> |
| decide | rh_store_put | the verdict |
| cleanup | rh_store_delete | throwaway keys |

## Limits

time-boxed by nature - a spike that becomes a feature graduates to a real kit.