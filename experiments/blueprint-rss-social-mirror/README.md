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