# blueprint/agent-notebook - run log

## Learnings (store live-verified 2026-08-31; text suite-tested)

1. **The store really is durable memory.** Grocery and workout
   scenarios round-tripped puts, updates, lists, gets and deletes
   against the live harness storage, then restored the baseline - the
   write counter (5 -> 11) is the audit trail.
2. **The prefix IS the search.** note:project:* enumerates a project;
   there is no free-text query. Slug discipline (date or project
   first) is what makes recall work.
3. **Compaction never replaces the source.** rh_text_summarise writes
   a summary field; the original text stays the source of truth.
   Compacting away the original is how memory rots.
4. **Values must be JSON-serializable.** Dates become ISO strings,
   nothing with functions; the store enforces it at the boundary.
5. **Absence is found:false.** The exists() check is free - never
   treat a missing note as an error.