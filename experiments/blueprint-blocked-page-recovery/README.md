# blueprint/blocked-page-recovery

> Hermes source: web/blocked-page-recovery. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

## The ladder

1. **Record**: every failure is a receipt - code, URL, at.
2. **Retry with backoff**: a 429 is a rate limit, not a wall.
3. **Browser User-Agent**: Reddit's JSON API 403s while its RSS answers
   a browser UA (learned in daily-digest).
4. **Header fixes**: Accept: application/rss+xml where the default is
   rejected.
5. **Different endpoint**: HN's HTML dropped titlelink; its Algolia JSON
   still works.
6. **Mirror or archive**: the public copy of a walled page.
7. **Browser tools**: the harness's full browser is the final rung.
8. **Give up cleanly**: the receipt records why, and the answer says so.

## Tool matrix

| Rung | Tool | Notes |
|---|---|---|
| record | `rh_store_put` | fetch-fail:<source>:<ts> |
| retry | guardedFetch | 429 backoff before switching |
| headers | guardedFetch init.headers | UA + Accept |
| recover | guardedFetch | alternate endpoint |
| final | browser tools | last rung, then give up |

Paywalls are not a technical wall: summarize what is visible, never
fabricate what is not.