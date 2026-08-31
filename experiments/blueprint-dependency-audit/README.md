# blueprint/dependency-audit

> Hermes source: Security. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Dependency vulnerabilities as receipts: run the audit, receipt exit + tail, notify once on high severity, re-audit after the fix.

## The recipe

1. run the audit (exit code is the verdict).
2. receipt the result.
3. high severity: notify once.
4. fix, re-audit, receipt again.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| audit | rh_run | pnpm audit / npm audit |
| receipt | rh_store_put | audit:<repo>:<ts> |
| alert | rh_notify_send | alert-once |
| verify | rh_run | re-audit |

## Limits

audit tools see the lockfile - unpublished sources need a different check.