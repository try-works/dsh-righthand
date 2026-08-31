# blueprint/rss-social-mirror CLOUD learnings log

> Cloud version of the rss-social-mirror blueprint. Deployed test
> build (workers.dev, keyless).

## Run context

| Field | Value |
|---|---|
| Worker | `cloud/index.js` - rh-rss-ladder, `GET /feed?src=`, `/health` |
| Deploy | wrangler 4.123.0, OAuth, workers.dev |
| URL | https://rh-rss-ladder.ambiens.workers.dev |
| Compat | 2026-08-31 |

## Measured (2026-08-31)

- First deploy: reddit count = 0, lobsters = 25, test PASSED on shape
  but the reddit half was empty - a real finding, not a pass.
- Root cause (measured locally too): Reddit's `.rss` endpoint now
  answers Atom (`application/atom+xml`, `<feed>/<entry>`), so an
  `<item>`-only parser yields zero items. It is FORMAT DRIFT, not CF
  egress blocking - the local fetch showed the same Atom.
- Fix: parse both `<item>` (RSS 2.0) and `<entry>` (Atom) shapes,
  including the `<link href>` attribute form and `<id>` guid.
  Redeployed: reddit = 24, lobsters = 25, dedupe held, PASS.

## Build learnings

- A feed parser that silently yields zero on a format drift is the
  worst failure mode: test asserts non-empty per source, or it lies
  by passing.
- The 403/429 ladder (browser UA + Accept header + one backoff retry)
  is in place but this run never needed a retry - Reddit answered 200
  Atom directly from CF egress.
- SSRF discipline: an allowlist of sources, never an arbitrary url
  parameter - the Worker fetches only the two known feeds.

## Blueprint guidance update

- New pitfall for the kit: PROBE THE FORMAT, NOT JUST THE STATUS -
  a 200 with the wrong element shape is a silent empty. The parser
  must handle RSS 2.0 and Atom both.