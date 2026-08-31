# blueprint/codebase-audit - run log

## Learnings (exec patterns, live-verified 2026-08-31)

1. **Exit code is the verdict.** rh_run surfaces exit codes and
   stderr verbatim; a missing metric tool is a red receipt, not a
   guessed number.
2. **Receipts per measure.** One record per command means a partial
   run is still evidence - the audit never has to be all-or-nothing.
3. **A snapshot means nothing alone.** The diff against the previous
   audit:<repo>:<ts> is the report.