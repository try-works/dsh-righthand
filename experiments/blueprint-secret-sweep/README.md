# blueprint/secret-sweep

> Hermes source: Security. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Periodic secret scans as receipts: run the scan pattern over repos, receipt per repo, a hit notifies once and blocks the ship gate.

## The recipe

1. run the scan pattern.
2. receipt the result (clean or hits).
3. a hit: notify once and block the gate.
4. fix, rescan, receipt.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| scan | rh_run | the pattern over the tree |
| receipt | rh_store_put | sweep:<repo>:<ts> |
| alert | rh_notify_send | alert-once |
| gate | pre-commit-gate | a hit blocks |

## Limits

pattern-based - a novel secret shape needs a new pattern first.