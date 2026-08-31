# blueprint/delegate-cli-coder

> Hermes source: autonomous-ai-agents/claude-code, codex, opencode. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

## The recipe

1. **Brief**: one written brief, one outcome - the contract.
2. **Gate**: guard ask on the invoke step - delegation stays a
   decision, not a reflex.
3. **Run**: rh_run the CLI coder with the brief (rh_run_bg for long
   runs - status only, poll).
4. **Receipt**: delegate:<taskId> { brief, exitCode, tail }.
5. **Review**: the pre-commit-gate chain on the DIFF, not the run
   output - red loops with a follow-up brief, green merges.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| brief | `rh_store_put` | delegate:<taskId> |
| gate | guard ask | invoke is a decision |
| run | `rh_run` / `rh_run_bg` | long = bg + poll |
| review | pre-commit-gate | the diff, not the output |

The CLI coder's own credentials stay local to its config - nothing
keyed enters the plugin.