# blueprint/citation-trail - run log

## Learnings (from the extract verb's shipped discipline)

1. **The quote is the check.** A cite without the quoted sentence is
   unfalsifiable - the schema requires all three: claim, source,
   quote.
2. **Extract fails clean.** A malformed parse is a clean error;
   nothing is asserted from a partial extraction.
3. **The trail is per answer.** trail:<docId>:<n> stores beside the
   answer, so an audit can replay which claim came from where.