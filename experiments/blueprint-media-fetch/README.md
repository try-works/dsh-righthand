# blueprint/media-fetch

> Hermes source: gif-search. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Keyless media search and storage: Wikimedia Commons API supplies images without a key, R2 stores the binaries, the store indexes them, presigned links share them.

## The recipe

1. search Commons for the media.
2. fetch the file bytes.
3. put to R2 and index in the store.
4. share via a presigned link.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| search | guardedFetch | Commons API, keyless |
| fetch | guardedFetch | binary bytes |
| store | rh_files_put + rh_store_put | blob + index |
| share | rh_files_share | presigned link |

## Limits

only keyless media sources; attribution rides in the index record.