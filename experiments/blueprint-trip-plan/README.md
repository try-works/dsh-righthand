# blueprint/trip-plan

> Hermes source: travel. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

An itinerary from places and weather: geocode destinations, check the forecast at the dates, schedule itinerary events, store the trip and a briefing note.

## The recipe

1. geocode each destination.
2. fetch the forecast for the travel dates.
3. schedule the itinerary as events.
4. store the trip and summarize a packing briefing.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| plan | rh_places_geocode | confirm first hits |
| weather | rh_weather_forecast | keyless |
| schedule | rh_events_create | itinerary events |
| brief | rh_text_summarise + rh_store_put | trip:<slug> |

## Limits

no booking - the kit plans, it does not buy.