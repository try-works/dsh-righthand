# blueprint/rss-social-mirror

> Hermes source: Social Media. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Keyless social monitoring through RSS: fetch with a browser UA, parse, extract mentions, keep the window, digest material changes.

## The recipe

1. fetch the RSS with browser UA (the 403 workaround).
2. parse items.
3. extract mentions.
4. window + digest material changes.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| fetch | guardedFetch | UA + Accept headers |
| parse | local | entities before tags |
| extract | rh_text_extract | mention triples |
| digest | rh_text_summarise | material only |

## Limits

only platforms with public RSS - keyed social APIs stay out of scope.

## Cloud build

Deployed test Worker on the user's own Cloudflare account (workers.dev,
keyless): https://rh-rss-ladder.ambiens.workers.dev - `cloud/index.js` + `cloud/wrangler.jsonc`,
tested by `cloud/test.ts`, evidence in `cloud/evidence.json`,
learnings in `cloud/LEARNINGS.md`.

- Measured 2026-08-31: reddit 24 + lobsters 25 items after fixing the parser, dedupe held, PASS.
- Real finding: Reddit's .rss now answers Atom (<entry>), not RSS 2.0 (<item>) - parse both shapes or a 200 silently yields zero.