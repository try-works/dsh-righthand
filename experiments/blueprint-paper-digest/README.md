# blueprint/paper-digest

> Hermes source: research/arxiv. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

## The recipe

1. **Adapter**: export.arxiv.org/api/query (Atom XML, keyless, live-
   probed 2026-08-31: 200, no key). Probe -> fixture -> parse entries
   (title, summary, published, authors, abs link).
2. **Condense**: rh_text_summarise each abstract to one sentence.
3. **Store**: digest:<query>:<date> { entries } - the rolling window.
4. **Deliver**: rh_notify_send once; the next run diffs by arxiv id.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| fetch | guardedFetch | Atom XML, not JSON |
| parse | XML parse (parseListXml precedent) | entry elements |
| condense | `rh_text_summarise` | one sentence per abstract |
| store | `rh_store_put` | digest:<query>:<date> |
| deliver | `rh_notify_send` | alert-once record |

Query syntax: search_query=all:term, sortBy=submittedDate&sortOrder=
descending. The redirect export.arxiv.org -> arxiv.org/api is a
redirect hop guardedFetch revalidates.