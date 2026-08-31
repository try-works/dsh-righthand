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