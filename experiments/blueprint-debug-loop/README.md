# blueprint/debug-loop

> Hermes source: software-development/systematic-debugging. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

## The recipe (4 phases, every one a receipt)

1. **Reproduce**: rh_run the failing command; exit code + tail are the
   evidence - never truncate them away.
2. **Evidence**: store the exact output under debug:<bugId>:repro.
3. **Hypothesize**: rh_text_extract { symptom, trigger, error } from
   the evidence - one hypothesis per fix.
4. **Fix, verify**: rerun the SAME command that reproduced; green ends
   the loop; the fix summary goes on the bug record.

## Tool matrix

| Phase | Tool | Notes |
|---|---|---|
| reproduce | `rh_run` | exit code verbatim |
| evidence | `rh_store_put` | debug:<bugId>:repro |
| hypothesize | `rh_text_extract` | symptom facts |
| verify | `rh_run` | same command until green |

Understand before fixing: the receipts show which hypothesis worked.