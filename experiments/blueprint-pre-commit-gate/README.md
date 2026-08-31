# blueprint/pre-commit-gate

> Every change ships through the same gate (Hermes requesting-code-
> review, righthand-native): rh_run executes the check chain, the store
> keeps one receipt per check, and ship-if-green is a rule. See
> `blueprint.json`.

## What this is

The check chain as a governed routine: lint, typecheck, tests, and the
secret scan run through rh_run; exit codes are the verdicts; receipts
are the audit; the guard holds the ship step until the receipts are
green.

## The recipe

1. **Run the chain**: one `rh_run` per check - pnpm lint, pnpm
   typecheck, pnpm test, and the secret-scan pattern over staged
   content. Collect mode, bounded output: keep the tail (last lines),
   not the full log.
2. **Receipt per check**: `rh_store_put { key: 'gate:' + changeId +
   ':' + check, value: { exitCode, ok, tail, at } }`. Exit 0 is green
   - whatever the warnings say.
3. **Gate verdict**: all green = pass; the receipt set IS the review
   evidence. Any red stops the change; the fix loop reruns only the
   failed checks (TDD is the same loop: red receipt, fix, green
   receipt).
4. **Ship behind the guard**: the release prefix carries an ask or
   deny rule; the receipts feed the policy.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| lint | `rh_run` pnpm lint | exit code is the verdict |
| types | `rh_run` pnpm typecheck | same |
| tests | `rh_run` pnpm test | same |
| scan | `rh_run` secret-scan pattern | in the chain, before anything leaves |
| receipt | `rh_store_put` | gate:<changeId>:<check> |
| ship | guard rule | ask/deny, fed by the receipts |

## Escalation

Golden the guard: agent-built guards derive facts with `guardFactsFor`
and pin them in a golden file - the plugin's own discipline for its 37
tools. The chain is local; CI or a Worker on the user's Cloudflare is
the documented next step.

## What tests pin

rh_run exit codes and stderr surface verbatim (live-verified
2026-08-31: exit 3 + stderr on failure); the guard deny/ask path and
the golden are pinned in the plugin suite; the secret-scan pattern ran
clean over every commit in this repo.