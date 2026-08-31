# blueprint/budget-guard - run log

## Learnings (store live-verified 2026-08-31; classify suite-tested)

1. **The cap lives in the store because of the wall.** rh_settings_set
   accepted an unregistered key (applied:true) and rh_settings_get
   never returned it - live-verified. A cap in settings would look
   written and silently disappear; budget:cap in the store round-
   trips.
2. **Scan-and-sum is the aggregation.** The workout scenario summed
   13.3 km across two keys with list + get + add; the budget sum is
   the same loop over expense:*.
3. **Categorize is one verb.** rh_text_classify answers with a label
   verbatim from the set plus confidence; uncategorized expenses stay
   category-less until the model runs - the loop tolerates it.
4. **Warn-once needs its own record.** budget:warned:<ts> is the
   dedupe; without it every turn above 80 percent re-notifies.