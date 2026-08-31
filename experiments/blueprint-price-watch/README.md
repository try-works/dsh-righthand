# blueprint/price-watch

> Watch a product, flight, or listing price and alert once per crossing
> (Hermes product-price-monitor, righthand-native). See `blueprint.json`
> for the declarative spec.

## What this is

The data-adapter recipe plus one LLM verb plus the alert pattern: a
keyless fetcher per source, rh_text_extract for the price, the store for
history and target, ntfy for the crossing alert.

## The recipe

1. **Adapter**: build the source fetcher from `blueprint/data-adapter`
   (probe -> fixture -> normalize). A source that needs an API token is
   out of scope.
2. **Poll**: fetch the listing text, then `rh_text_extract { text,
   schema: { price, currency, title } }` - one model call per poll.
3. **History**: `rh_store_put { key: 'price:' + slug + ':' + ts, value:
   { price, currency, at } }`; the target lives beside it at
   `price:<slug>:target` so a poll is one get + one put.
4. **Compare**: crossing = latest price below the target.
5. **Alert once**: on crossing, `rh_notify_send` and record
   `price:<slug>:alerted` so the next poll does not re-fire. The
   history scan doubles as the trend.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| adapter | guardedFetch (data-adapter recipe) | keyless sources only |
| extract | `rh_text_extract` | schema-in, object-out |
| history | `rh_store_put` | price:<slug>:<ts> |
| target | `rh_store_get` / `rh_store_put` | price:<slug>:target |
| alert | `rh_notify_send` | ntfy.sh keyless |
| alert-once | `rh_store_put` | price:<slug>:alerted |

## Escalation

Polling cadence is the same gap as heartbeat: the agent polls when it
runs; a Cloudflare cron Worker (documented, not built) makes it
server-side. Anti-bot walls are the real risk - probe first and record
UA/cookie requirements in the adapter's learnings.

## What tests pin

The extract verb is pinned with a stub LLM adapter (clean errors on
parse failure); the store history and warn-once patterns are the ones
live-verified in the heartbeat and budget runs. Honest limit: no
keyless price adapter is instantiated yet - the recipe is the kit.