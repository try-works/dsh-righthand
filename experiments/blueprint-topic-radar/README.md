# blueprint/topic-radar

> Hermes source: news / news-aggregator. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Many keyless feeds on one topic, ranked and deduped into a digest: fetch, extract mentions, dedupe by url, summarise, notify.

## The recipe

1. fetch N keyless feeds.
2. extract topic mentions per item.
3. dedupe by url across feeds.
4. rank, summarise, store the digest, notify once.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| fetch | guardedFetch | keyless feeds only |
| extract | rh_text_extract | mention triples |
| dedupe | store scan | by url |
| digest | rh_text_summarise + rh_notify_send | alert-once |

## Limits

keyless sources only; a topic with no public feed stays invisible.