# blueprint/deck-pipeline

> Hermes source: powerpoint. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Decks as artifacts: python-pptx builds the deck, R2 publishes it, a presigned link ships it.

## The recipe

1. build the deck from the source text.
2. exit 0 gates the put.
3. publish, index, share.
4. notify the link.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| build | rh_run | python-pptx |
| gate | exit code | 0 = the deck exists |
| publish | rh_files_put + rh_store_put | contentType |
| share | rh_files_share + rh_notify_send | the link |

## Limits

local python tooling; design polish is the agent's craft.