# blueprint/env-audit

> Hermes source: DevOps. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Toolchain drift as receipts: version commands for node/pnpm/git run through rh_run, one receipt per tool, diff against the previous snapshot.

## The recipe

1. run version commands (collect, bounded).
2. receipt per tool.
3. diff against the previous snapshot.
4. summarize the drift.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| run | rh_run | node/pnpm/git --version |
| receipt | rh_store_put | env:<ts>:<tool> |
| diff | store scan | by tool name |
| note | rh_text_summarise | the drift |

## Limits

local toolchain only - remote environments need their own audit run.