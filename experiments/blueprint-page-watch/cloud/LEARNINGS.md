# blueprint/page-watch CLOUD learnings log

> Cloud version of the page-watch blueprint. Deployed test build
> (workers.dev, keyless).

## Run context

| Field | Value |
|---|---|
| Worker | `cloud/index.js` - rh-page-watch, `GET /watch?url=`, `/health` |
| Deploy | wrangler 4.123.0, OAuth, workers.dev |
| URL | https://rh-page-watch.ambiens.workers.dev |
| Compat | 2026-08-31 |

## Measured (2026-08-31)

- Two `/watch?url=example` runs produced the SAME SHA-256
  (461395b5...), 399 bytes after normalization, title 'Example
  Domain' - the fingerprint is stable, which is the whole game.
- WebCrypto `crypto.subtle.digest('SHA-256', ...)` works in Workers
  with no flag or binding.
- SSRF discipline: an allowlist of pages, never an arbitrary url
  parameter - same rule as the rss mirror.

## Build learnings

- Stateless BY DESIGN: the Worker returns the fingerprint; the
  PREVIOUS hash lives in the caller's rh_store, and the alert fires
  there (page-watch step 3-4 stay local). A Worker with KV could
  hold the previous hash, but the template keeps memory where the
  agent already has it.
- Volatile bits (scripts, styles, comments, whitespace) must be
  stripped BEFORE hashing or every run looks changed.

## Blueprint guidance update

- The kit's split is now measured: remote fingerprint, local diff.
  The KV escalation (previous-hash binding) is documented as
  optional, not required.