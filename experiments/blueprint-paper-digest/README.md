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

## Cloud build

Deployed test Worker on the user's own Cloudflare account (workers.dev,
keyless): https://rh-arxiv.ambiens.workers.dev - `cloud/index.js` + `cloud/wrangler.jsonc`,
tested by `cloud/test.ts`, evidence in `cloud/evidence.json`,
learnings in `cloud/LEARNINGS.md`.

- Measured 2026-08-31: /papers?q=agent&n=5 -> 5 entries, unique arxiv ids, PASS - arXiv works from CF egress.
- Template split: the Worker normalizes (fetch + Atom parse + JSON out); the rolling window and the diff stay in the caller's rh_store.