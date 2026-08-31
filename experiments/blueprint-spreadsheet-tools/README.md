# blueprint/spreadsheet-tools

> Hermes source: xlsx. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Tabular data as diffable snapshots: read sheets via CLI, store normalized rows, diff against the previous snapshot, summarize the change.

## The recipe

1. read the sheet into normalized rows.
2. store the snapshot.
3. diff against the previous snapshot.
4. summarize what changed.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| read | rh_run | openpyxl / csvkit |
| store | rh_store_put | data:<sheet>:<ts> |
| diff | store scan | stable row keys |
| note | rh_text_summarise | the delta |

## Limits

no formulas evaluation - the kit moves data, the spreadsheet computes.