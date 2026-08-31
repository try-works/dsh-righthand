# blueprint/browser-session-log

> Hermes source: browser. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Browsing sessions with evidence: one receipt per step (url, action, finding), a session summary, and the records feed the weekly review.

## The recipe

1. record each step as it happens (url, action, finding).
2. keep evidence per finding.
3. summarize the session.
4. the records feed the weekly review.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| browse | browser tools | the harness's own |
| receipt | rh_store_put | browse:<session>:<n> |
| summary | rh_text_summarise | session report |
| review | weekly-review | the records are the week |

## Limits

the browser tools do the browsing; the kit is the evidence discipline.