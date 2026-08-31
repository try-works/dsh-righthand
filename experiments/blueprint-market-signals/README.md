# blueprint/market-signals

> Hermes source: prediction-markets. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Keyless prediction-market odds into a signal: fetch public Polymarket data, store the odds history, alert on threshold crossings.

## The recipe

1. fetch the market's current odds.
2. append the history record.
3. compare against the stored target.
4. on crossing: notify once and record the alert.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| fetch | guardedFetch | public API, keyless |
| history | rh_store_put | odds:<market>:<ts> |
| target | rh_store_get | beside the history |
| alert | rh_notify_send | alert-once record |

## Limits

keyless endpoints only; a market that needs a key is out of scope.