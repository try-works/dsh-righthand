# blueprint/agent-notebook

> Durable agent memory over the store: note:<slug> records, prefix-scan
> recall, and LLM escalation only where it pays - summarise to compact,
> extract for structured recall. See `blueprint.json` for the
> declarative spec.

## What this is

The notes pattern from the catalogue (Mu notes_add/get/list/delete
mapped onto rh_store_*), plus the text family as the compaction and
structure layer. Survives restarts and context compaction by design -
the store is the memory, not the conversation.

## The recipe

1. **Write**: `rh_store_put { key: 'note:' + slug, value: { text, tags,
   at } }` - slug sorts well when it starts with a date or project.
2. **Read**: `rh_store_get { key }` - `{ found: false }` is the absence
   signal, not an error.
3. **Scan**: `rh_store_list` + a prefix filter IS the search -
   `note:project:*` enumerates a project.
4. **Compact**: when a note passes a cap, `rh_text_summarise` the text
   and store the short form in a `summary` field - keep the original as
   the source of truth.
5. **Structured recall**: `rh_text_extract { text, schema: { dates: [],
   people: [] } }` over one or more notes returns one conforming object.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| write | `rh_store_put` | note:<slug>, JSON-serializable only |
| read | `rh_store_get` | found:false = absent |
| search | `rh_store_list` | prefix filter is the query |
| compact | `rh_text_summarise` | summary field, original kept |
| recall | `rh_text_extract` | JSON Schema in, one object out |

## Escalation

Free-text search needs an index: the documented escalation is a
Cloudflare KV index rebuilt on write, or the research-radar kit's
rolling window. Prefix scan is the built reality and is enough for
slug-disciplined notes.

## What tests pin

Store CRUD and the write counter are pinned in
`tests/dsh-native-tools.spec.ts` and were live-verified 2026-08-31
(grocery and workout scenarios round-tripped, then cleaned back to
baseline). Text verbs are pinned with a stub LLM adapter.