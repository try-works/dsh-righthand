# blueprint/price-watch - run log

## Learnings (from the shipped adapter recipe + live alert patterns)

1. **The adapter half already has a recipe.** blueprint/data-adapter
   ships with two worked examples (weather, places) and the SSRF
   checklist; a price source is the same shape - probe, fixture,
   normalize. A token requirement puts the source out of scope.
2. **Extract is schema-in, object-out.** rh_text_extract pulls
   { price, currency, title } from listing text with one contained
   model call; parse failures are clean errors, never a wrong price.
3. **Warn-once is a record.** heartbeat and budget-guard already
   learned: without price:<slug>:alerted, every poll below target
   re-notifies. The record is the dedupe.
4. **History is the trend.** One record per poll makes the price
   curve a prefix scan - no separate chart, no extra tool.
5. **Honest limit:** no keyless price adapter is instantiated yet;
   the kit is the recipe, and the first poll should be a fixture
   test before it is a real listing.