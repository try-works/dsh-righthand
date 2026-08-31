# blueprint/debug-loop - run log

## Learnings (exec + store, live-verified)

1. **The failing tail is the evidence.** rh_run's bounded collect
   returned exit 3 + stderr verbatim in the live run - never reword
   or truncate the reproduction.
2. **Verify with the SAME command.** A different probe proves a
   different thing; the loop is reproduce -> fix -> same command.
3. **One hypothesis per fix.** The phase receipts show which
   hypothesis actually worked - the fix summary goes on the bug
   record.