# blueprint/pre-commit-gate - run log

## Learnings (live-verified checks + shipped guard discipline)

1. **Exit code is the verdict.** rh_run surfaces exit codes and
   stderr verbatim (live: exit 3 + stderr on failure); a check that
   prints warnings and exits 0 is green, whatever the words say.
2. **Receipts make the gate auditable.** One gate:<changeId>:<check>
   record per check means a red receipt is WHY the release did not
   happen - the fix loop reruns only the failed checks.
3. **The secret scan is a chain step.** The pattern over staged
   content ran clean on every commit in this repo; it belongs before
   anything leaves the machine, not as an afterthought.
4. **The guard already has the discipline.** deny/ask modes plus
   guardFactsFor and the permissions golden are shipped and pinned
   for the plugin's own 37 tools; an agent-built guard inherits the
   same shape.
5. **TDD is the same loop.** Run the failing test first (red
   receipt), fix, rerun (green receipt) - the gate records both.