# blueprint/linked-notes

> Hermes source: llm-wiki. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

An interlinked markdown KB in the store: notes carry links, extract keeps the backlinks fresh, traversal is a prefix scan.

## The recipe

1. write a note.
2. extract its links and store backlinks on the targets.
3. traverse the graph by prefix scan.
4. summarize hub notes into digests.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| write | rh_store_put | note:<slug> { text, links } |
| extract | rh_text_extract | backlink triples |
| traverse | rh_store_list | prefix scan |
| digest | rh_text_summarise | hub notes |

## Limits

no transitive queries - the KB is for recall and audit, not analytics.