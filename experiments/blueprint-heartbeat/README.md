# blueprint/heartbeat

> The uptime pattern generalized: run a check, keep a receipt, scan for
> the success rate, and interrupt yourself when a streak of failures
> crosses the threshold. See `blueprint.json` for the declarative spec.

## What this is

The exec family plus the receipt discipline from
`docs/scenario-patterns.md`, with notify as the alarm. No new services:
the check is any command, the store is the log, ntfy is the siren.

## The recipe

1. **Check**: `rh_run { argv: ['curl', '-sI', '-m', '10', 'https://example.com'] }`
   - collect mode returns exit code + bounded output (headers, not
   bodies).
2. **Receipt**: `rh_store_put { key: 'uptime:' + ts, value: { ok:
   exitCode === 0, ms, at } }`.
3. **Scan**: `rh_store_list` + get the last N `uptime:*` keys; success
   rate = ok / total.
4. **Alert on streak**: when the last N consecutive receipts are all
   failures, `rh_notify_send` once and record the sent alert
   (`alert:uptime:<ts>`) so the next turn does not re-alert.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| check | `rh_run` | collect mode; curl -sI/-sf are shell-free |
| long check | `rh_run_bg` | status/exit only - no captured stdout |
| receipt | `rh_store_put` | uptime:<ts> |
| scan | `rh_store_list` / `rh_store_get` | last N, success rate |
| alert | `rh_notify_send` | ntfy.sh keyless |
| alert-once | `rh_store_put` | alert:uptime:<ts> record |

## Escalation

Cadence: on-demand checks run when the agent runs; the documented
escalation is a Cloudflare cron Worker calling the same check+receipt
routine - not a built primitive yet (same shape as reminder-flow).

## What tests pin

Live-verified 2026-08-31: `rh_run` curl returned HTTP 200 headers with
exit 0; a failing `node -e` returned exit 3 with stderr; a background
job settled completed exit 0 with an empty output tail. Exit codes and
stderr surface exactly as the command produced them.