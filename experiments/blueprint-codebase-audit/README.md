# blueprint/codebase-audit

> Hermes source: software-development/codebase-inspection. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

## The recipe

1. **Measure**: rh_run pygount/cloc/git log stats - one command per
   measure, bounded collect.
2. **Receipt**: audit:<repo>:<ts> per measure { exitCode, tail }.
3. **Shape note**: rh_text_summarise over the measures (languages,
   LOC, ratios, churn).
4. **Diff**: the snapshot only means something next to the previous
   one.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| measure | `rh_run` | pygount, cloc, git stats |
| receipt | `rh_store_put` | audit:<repo>:<ts> |
| note | `rh_text_summarise` | the shape, one paragraph |

A missing tool is a red receipt, not a guessed number. Exit code is
the verdict.