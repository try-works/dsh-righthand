# blueprint/citation-graph

> Hermes source: grounded-citations (extension). Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Claim trails linked into a queryable graph: extract triples, store nodes and source edges, traverse by prefix scan.

## The recipe

1. extract claim triples.
2. store one node per claim and one edge per source.
3. dedupe claims by text.
4. compose answers by traversing the trails.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| extract | rh_text_extract | claim schema |
| store | rh_store_put | graph:<docId>:<n> |
| query | rh_store_list | prefix scan |
| compose | agent | only trailed claims |

## Limits

no transitive queries; the graph is for audit and recall, not analytics.