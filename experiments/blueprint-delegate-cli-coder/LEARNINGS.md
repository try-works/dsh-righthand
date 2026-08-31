# blueprint/delegate-cli-coder - run log

## Learnings (exec + guard + gate composition)

1. **The brief is the contract.** One written outcome per task - the
   receipt records what was asked, not just what ran.
2. **Long runs are background.** rh_run_bg reports status/exit only
   (live-verified empty output tail) - poll the job, do not wait on
   the turn.
3. **Review the diff, not the output.** The pre-commit-gate chain
   (lint/typecheck/test/scan) is the reviewer; the coder's output is
   only evidence.
4. **Guard ask on invoke.** Delegation stays a decision the policy
   function makes per call.