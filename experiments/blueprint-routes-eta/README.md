# blueprint/routes-eta

> Hermes source: maps. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Routes and ETAs from the keyless OSRM public server, composed with places for endpoints and events for ETA reminders.

## The recipe

1. geocode origin and destination.
2. request the route from OSRM and normalize duration + distance.
3. cache the route with fetchedAt.
4. schedule an ETA event at the arrival time.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| geocode | rh_places_geocode | confirm the first hit |
| route | guardedFetch | OSRM keyless, light use |
| schedule | rh_events_create | ETA reminder |
| audit | rh_store_put | route:<from>-<to>:<ts> |

## Limits

no live traffic; cache discipline is the cost of the keyless public server.