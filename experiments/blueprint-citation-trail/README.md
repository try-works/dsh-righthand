# blueprint/citation-trail

> Hermes source: research/grounded-citations. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

## The recipe

1. **Extract**: rh_text_extract { claim, source, quote } triples from
   the working text.
2. **Store**: trail:<docId>:<n> - one record per claim.
3. **Compose**: the answer asserts only trailed claims.
4. **Flag**: a claim without a record is flagged, never asserted.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| extract | `rh_text_extract` | claim schema, quote required |
| store | `rh_store_put` | trail:<docId>:<n> |
| assert | the agent | only trailed claims |

The quote is the check: a cite without a quote is unfalsifiable.
Dedupe identical claims before storing; a partial parse fails clean
and nothing gets asserted from it.