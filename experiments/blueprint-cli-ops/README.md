# blueprint/cli-ops

> Hermes source: antigravity-cli. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Any CLI operated safely: mutating subcommands behind guard ask, one receipt per invocation, verification with the same command.

## The recipe

1. identify the subcommand and its effect.
2. gate mutating subcommands behind ask.
3. run and receipt (exit + tail).
4. verify with the same command.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| gate | guard rule | ask on mutations |
| run | rh_run | argv array |
| receipt | rh_store_put | ops:<tool>:<ts> |
| verify | rh_run | same command |

## Limits

interactive TUIs are out - collect mode has no TTY.