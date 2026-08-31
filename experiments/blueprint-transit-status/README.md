# blueprint/transit-status

> Hermes source: transit. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Transit status as heartbeats: keyless status feeds per operator, one receipt per line, delay thresholds alert once.

## The recipe

1. fetch the operator's status feed.
2. normalize per line.
3. store receipts.
4. threshold crossing: notify once.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| fetch | guardedFetch | keyless feeds |
| store | rh_store_put | status:<line>:<ts> |
| threshold | rh_store_get | per-line targets |
| alert | rh_notify_send | alert-once |

## Limits

coverage equals the operators' public feeds - keyed APIs stay out.