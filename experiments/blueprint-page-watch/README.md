# blueprint/page-watch

> Hermes source: web-monitoring. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Watch a page for change: fetch through guardedFetch, hash the normalized body, alert once on change with the delta.

## The recipe

1. fetch the page.
2. normalize (strip volatile bits) and hash.
3. compare with the previous hash.
4. on change: extract the delta, notify once, store the new hash.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| fetch | guardedFetch | SSRF checklist |
| hash | agent-side | after normalization |
| compare | rh_store_get | page:<slug>:last |
| alert | rh_notify_send | alert-once |

## Limits

javascript-rendered pages need the browser tools instead of a plain fetch.

## Cloud build

Deployed test Worker on the user's own Cloudflare account (workers.dev,
keyless): https://rh-page-watch.ambiens.workers.dev - `cloud/index.js` + `cloud/wrangler.jsonc`,
tested by `cloud/test.ts`, evidence in `cloud/evidence.json`,
learnings in `cloud/LEARNINGS.md`.

- Measured 2026-08-31: two /watch runs produced the same SHA-256 (461395b5...), 399 bytes, PASS - the fingerprint is stable.
- Template split: remote fingerprint, local diff - the previous hash and the alert live in the caller's rh_store.