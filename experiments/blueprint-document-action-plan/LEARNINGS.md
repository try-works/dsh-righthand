# blueprint/document-action-plan - run log

## Learnings (from building the extract/tasks/events bridge)

1. **The cite is the safety.** Every extracted obligation keeps the
   sentence that spawned it; without it the model's hallucination is
   unfalsifiable. The cite goes in the task detail.
2. **Two halves, both closed.** The task tracks the work, the event
   delivers the interruption; completing the task without cancelling
   the event leaves a ghost reminder firing at the deadline.
3. **Exactly-once is the events state flip.** rh_events_due returns
   and marks notified in one call; the caller never dedupes.
4. **Extract fails clean, so board atomically.** A malformed
   deadline fails the extraction call; never half-board a document
   on a partial parse.
5. **Honest limit:** all three families are suite-tested (stub LLM
   adapter, typed domain, events spec) but not yet live through an
   agent turn - the running profile predates them.