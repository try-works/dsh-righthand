# blueprint/health-check-registry

> Hermes source: Networking. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Named checks as data: one store record per check (command + threshold), heartbeat runs the registry, streak failures alert once.

## The recipe

1. register each check with its command and threshold.
2. run the registry.
3. receipt per check.
4. failure streak: notify once.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| register | rh_store_put | check:<name> |
| run | rh_run | one per check |
| receipt | rh_store_put | check:<name>:<ts> |
| alert | rh_notify_send | alert-once |

## Limits

checks run when the agent runs - the cron escalation is documented, not built.