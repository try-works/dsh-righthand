# blueprint/fx-ledger

> Hermes source: Business & Finance. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Multi-currency expense ledger over keyless rates: frankfurter.app supplies daily ECB rates, the budget-guard scan sums, the store converts.

## The recipe

1. fetch the daily rate.
2. store rate:<date>.
3. sum expenses per currency by prefix scan.
4. convert to the base currency and store the converted total.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| rate | guardedFetch | frankfurter, keyless |
| store | rh_store_put | rate:<date> |
| sum | store scan | expense:<ts> |
| convert | agent compute | totals in base currency |

## Limits

ECB rates are daily - intraday rates need a different source.