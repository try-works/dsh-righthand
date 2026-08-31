# blueprint/weather-alert

> Hermes source: weather. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Forecast thresholds become reminders: check the forecast, schedule an event at the crossing time, deliver through the reminder flow.

## The recipe

1. fetch the forecast.
2. compare against the stored thresholds.
3. on crossing: create an event at the forecast time.
4. the due check delivers it and marks it notified.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| forecast | rh_weather_forecast | keyless Open-Meteo |
| thresholds | rh_store_get | weather:<place>:thresholds |
| schedule | rh_events_create | at the crossing time |
| deliver | rh_events_due + rh_notify_send | exactly-once |

## Limits

forecast accuracy is the ceiling - alerts are only as good as the model.

## Cloud build

Deployed test Worker on the user's own Cloudflare account (workers.dev,
keyless): https://rh-weather-alert.ambiens.workers.dev - `cloud/index.js` + `cloud/wrangler.jsonc`,
tested by `cloud/test.ts`, evidence in `cloud/evidence.json`,
learnings in `cloud/LEARNINGS.md`.

- Measured 2026-08-31: /check returned 1 crossing (wind 15.8 vs 0), timezone GMT; cron trigger '0 8 * * *' deployed.
- Boundary measured: the Worker computes crossings; delivery stays the agent's rh_events_due + rh_notify_send (exactly-once needs the store).