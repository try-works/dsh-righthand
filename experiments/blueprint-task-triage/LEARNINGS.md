# blueprint/task-triage - run log

## Learnings (from building the tasks + text families, 0.1.4/0.1.5)

1. **The work loop is deterministic.** rh_task_next is the oldest open
   task - not the most important, not a model choice. Triage quality
   lives in the classify step, not in picking what to do next.
2. **A failed task still talks.** Update it failed with a result
   saying what was tried and what broke; the state machine keeps the
   record, the caller never deletes evidence.
3. **Classify is verbatim or error.** The model must answer with a
   label exactly from the given set plus 0-1 confidence; anything
   outside the set is a clean error, not a guess. This is what keeps
   the board's categories closed.
4. **Extract is schema-in, object-out.** It takes a JSON Schema and
   returns one conforming object; parse failures surface as a clean
   error, never raw prose - the caller never parses the model.
5. **One model call per verb, failures contained.** Each text verb is
   its own call; one failing call does not take down the board.
6. **Honest limit:** tasks and text are suite-tested (typed domain +
   stub LLM adapter) but not yet exercised through a live agent turn -
   the running profile predates both families.