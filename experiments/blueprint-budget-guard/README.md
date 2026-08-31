# blueprint/budget-guard

> A personal budget with an LLM categorizer: expense receipts in the
> store, classify each one into your categories, keep the cap in the
> store (NOT settings - the schema wall), and warn at 80 percent, not
> after. See `blueprint.json` for the declarative spec.

## What this is

The store-scan aggregation pattern (workout scenario, live-verified)
plus one LLM verb for categorization and notify for the warning. The
star learning: the budget cap lives in rh_store because unregistered
settings keys are accepted on write and never come back on read.

## The recipe

1. **Log**: `rh_store_put { key: 'expense:' + ts, value: { amount,
   note } }`.
2. **Categorize**: `rh_text_classify { text: note, labels: ['food',
   'transport', 'home', 'other'] }` - verbatim label + confidence;
   overwrite the record with the category.
3. **Sum**: `rh_store_list` the window prefix, `rh_store_get` each,
   add the amounts. There is no query language - the scan IS the
   query.
4. **Cap**: `rh_store_get { key: 'budget:cap' }` - the cap lives in
   the store, not settings (schema wall, live-verified).
5. **Warn**: at 80 percent, `rh_notify_send` once and record
   `budget:warned:<ts>` so the next turn does not re-warn.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| log | `rh_store_put` | expense:<ts> |
| categorize | `rh_text_classify` | verbatim label + confidence |
| sum | `rh_store_list` / `rh_store_get` | prefix scan + add |
| cap | `rh_store_get` | budget:cap - the store, not settings |
| warn | `rh_notify_send` | ntfy.sh keyless |
| warn-once | `rh_store_put` | budget:warned:<ts> record |

## Escalation

Multi-currency: a keyless rates adapter built from
`blueprint/data-adapter` (markets row in the catalogue) feeds the
conversion before the sum. The categorize verb stays the same.

## What tests pin

The scan-and-sum pattern is live-verified (workout scenario summed
13.3 km across two keys). The schema wall is live-verified:
rh_settings_set accepted an unregistered key with applied:true and
rh_settings_get never returned it. The classify verb is pinned with a
stub LLM adapter.