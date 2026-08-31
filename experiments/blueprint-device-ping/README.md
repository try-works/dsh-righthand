# blueprint/device-ping

> Hermes source: Smart Home. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Local device heartbeats: ping through rh_run, one receipt per device, alert once on a failure streak - the heartbeat pattern on the user's own network.

## The recipe

1. register the device with its host.
2. ping on the cadence.
3. receipt per ping.
4. failure streak: notify once.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| register | rh_store_put | device:<name> |
| ping | rh_run | collect, exit code |
| receipt | rh_store_put | device:<name>:<ts> |
| alert | rh_notify_send | alert-once |

## Limits

LAN only - devices behind NAT/firewalls answer or they do not.