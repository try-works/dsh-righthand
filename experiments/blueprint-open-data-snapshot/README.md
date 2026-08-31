# blueprint/open-data-snapshot

> Hermes source: civic-data / open-data. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Keyless government and civic datasets as diffable snapshots: fetch, normalize, store, diff against the previous snapshot, summarize the change.

## The recipe

1. fetch the dataset endpoint.
2. normalize to the stable shape (data-adapter recipe).
3. store the snapshot.
4. diff against the previous snapshot and summarize the change.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| fetch | guardedFetch | keyless only |
| normalize | data-adapter recipe | stable shape |
| store | rh_store_put | snapshot:<source>:<ts> |
| diff | store scan + note | rh_text_summarise |

## Limits

only sources reachable keyless; refresh cadence is agent-paced.