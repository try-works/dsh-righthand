# blueprint/cdp-debug

> Hermes source: node-inspect-debugger. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Debug a Node process over CDP without a PTY: start --inspect in the background, curl the CDP HTTP endpoints, capture, kill the job.

## The recipe

1. start the process with --inspect in the background.
2. curl the /json list to find the target.
3. drive the debugger over CDP HTTP.
4. capture findings, kill the job.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| start | rh_run_bg | node --inspect |
| list | rh_run | curl :9229/json |
| inspect | rh_run | CDP over HTTP |
| stop | job_kill | clean up the port |

## Limits

no interactive stepping - HTTP CDP covers snapshots and evals, not a live REPL.