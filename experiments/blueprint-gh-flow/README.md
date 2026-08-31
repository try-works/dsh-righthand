# blueprint/gh-flow

> Hermes source: github. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

The issue-to-merge path as receipts: gh CLI steps through rh_run, one receipt per step, guard ask on push, the pre-commit gate reviews the diff.

## The recipe

1. open the issue and branch.
2. commit (gate receipts from pre-commit-gate).
3. push behind the guard.
4. open the PR, review the diff, merge with a receipt.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| branch | rh_run | gh issue + branch |
| commit | rh_run | after the gate |
| push | rh_run + guard | ask on push |
| merge | rh_run | receipt closes the loop |

## Limits

no CI - the gate is local; a Worker or CI is the documented escalation.