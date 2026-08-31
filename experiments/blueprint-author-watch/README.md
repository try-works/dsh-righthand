# blueprint/author-watch

> Hermes source: arxiv (variant). Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Follow an author's new papers: query the keyless arXiv API, diff by id, summarise the new ones, store the window.

## The recipe

1. query arXiv by author (plus a category filter when names collide).
2. diff the window by arxiv id.
3. summarise only the new papers.
4. store + notify once.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| query | guardedFetch | arxiv API, keyless |
| diff | store scan | by arxiv id |
| condense | rh_text_summarise | new abstracts only |
| deliver | rh_notify_send | alert-once |

## Limits

arXiv covers preprints only; other venues need their own keyless adapter.