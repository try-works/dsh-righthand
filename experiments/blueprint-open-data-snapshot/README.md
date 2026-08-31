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

## Cloud build

Deployed test Worker on the user's own Cloudflare account (workers.dev,
keyless): https://rh-quakes.ambiens.workers.dev - `cloud/index.js` + `cloud/wrangler.jsonc`,
tested by `cloud/test.ts`, evidence in `cloud/evidence.json`,
learnings in `cloud/LEARNINGS.md`.

- Measured 2026-08-31: /snapshot?days=1&minmag=2.5 -> 43 USGS events, ids match features, PASS.
- Template split: remote normalize, local remember - the previous snapshot and the diff live in rh_store.