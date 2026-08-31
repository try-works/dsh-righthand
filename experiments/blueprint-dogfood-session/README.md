# blueprint/dogfood-session

> Hermes source: software-development/dogfood. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

## The recipe

1. **Poke**: browser tools or rh_run curl against your own app.
2. **Evidence**: per finding, dogfood:<session>:<n> { steps, expected,
   actual } - steps recorded BEFORE the fix, or the repro evaporates.
3. **Severity**: rh_text_classify with the closed set
   (blocker/major/minor/nit).
4. **Report**: rh_text_summarise the session; blocker-level findings
   notify once (alert-once record).

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| poke | browser tools / `rh_run` | the app under test |
| evidence | `rh_store_put` | dogfood:<session>:<n> |
| severity | `rh_text_classify` | verbatim labels |
| report | `rh_text_summarise` + `rh_notify_send` | blocker alert-once |

Actual vs expected is the evidence - opinion is not. The records feed
the weekly review.