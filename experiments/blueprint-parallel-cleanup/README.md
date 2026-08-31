# blueprint/parallel-cleanup

> Hermes source: simplify-code. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Fan-out cleanup of recent changes: split into independent pieces, clean each in parallel, gate the combined diff, receipts per piece.

## The recipe

1. split the recent changes into independent pieces.
2. fan out the cleanup, one piece per lane.
3. receipt per piece.
4. gate the combined diff before it ships.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| split | agent | independent pieces only |
| run | rh_run | one lane each |
| receipt | rh_store_put | cleanup:<changeId>:<piece> |
| gate | pre-commit-gate | combined diff |

## Limits

the harness workflow tool runs the fan-out - this kit documents the shape.