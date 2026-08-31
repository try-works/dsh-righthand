# blueprint/red-green-loop

> Hermes source: test-driven-development. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

TDD enforced by receipts: the failing test runs first (red receipt), the fix runs the same command to green, refactor re-runs it again.

## The recipe

1. write the failing test.
2. run it - the red receipt is required before any fix.
3. fix until the same command is green.
4. refactor and re-run, then the gate.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| red | rh_run | failing test first |
| receipt | rh_store_put | tdd:<case>:red |
| green | rh_run | same command |
| refactor | rh_run + gate | re-run after refactor |

## Limits

one case per loop keeps the receipts meaningful.