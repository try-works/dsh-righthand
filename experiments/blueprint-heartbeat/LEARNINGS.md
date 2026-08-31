# blueprint/heartbeat - run log

## Learnings (live-verified 2026-08-31 through the agent-facing tools)

1. **Collect mode is the answer path.** rh_run curl returned HTTP 200
   headers with exit 0; a failing node -e returned exit 3 with stderr
   verbatim. The command's own exit code IS the health signal - ok =
   exitCode === 0, nothing else to infer.
2. **Background is status-only.** A rh_run_bg job settled completed
   exit 0 with an EMPTY output tail. For a heartbeat the output is
   usually the evidence - use rh_run, keep the probe output small
   (headers, not bodies).
3. **Alert-once needs its own record.** Without alert:uptime:<ts> the
   next turn sees the same failing streak and re-alerts. The record
   is the dedupe.
4. **Shell-free probes only.** argv arrays mean no pipes or
   redirects; curl -sI and curl -sf are the forms that fit. Timeouts
   belong in the command (-m 10), not the tool.
5. **The receipt is the aggregation unit.** Success rate over a
   window = scan uptime:* + count ok / total. The scan IS the query -
   there is no other one.