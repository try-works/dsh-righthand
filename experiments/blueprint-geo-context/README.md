# blueprint/geo-context

> A place query becomes agent context: geocode, then elevation, weather,
> air and nearby at those coordinates - cached in rh_store so repeated
> questions stay free. See `blueprint.json` for the declarative spec.

## What this is

The composition of the two shipped data-adapter families (places,
weather) into one context record per place. Both providers are keyless;
the store cache is what keeps the pattern polite.

## The recipe

1. **Geocode**: `rh_places_geocode { query }` - take the first hit, but
   confirm it is the intended place (results are importance-ranked, not
   exact-match).
2. **Enrich in parallel**: at the hit's lat/lon run `rh_places_elevation`,
   `rh_weather_forecast`, `rh_weather_air` - three keyless calls, all
   through the SSRF-guarded fetcher.
3. **Around-me**: `rh_places_nearby { query: 'cafe', latitude, longitude,
   radiusKm: 1 }` for the what-is-near question; results come back with
   a computed `distanceKm`, nearest first.
4. **Cache**: `rh_store_put { key: 'geo:' + placeId, value: { place,
   elevation, weather, air, nearby, fetchedAt } }`. Freshness rule:
   weather is stale after 30 min, elevation basically never - one
   record, `fetchedAt` is the TTL clock.
5. **Reuse**: a later ask for the same place reads the cache; only the
   stale slices are re-fetched.

## Tool matrix

| Step | Tool | Provider |
|---|---|---|
| geocode | `rh_places_geocode` | Nominatim/OSM (keyless, UA required) |
| reverse | `rh_places_address` | Nominatim/OSM (misses surface as errors) |
| elevation | `rh_places_elevation` | Open-Meteo (keyless) |
| weather | `rh_weather_forecast` / `rh_weather_air` | Open-Meteo (keyless) |
| nearby | `rh_places_nearby` | Nominatim bounded search + client haversine |
| cache | `rh_store_get` / `rh_store_put` | storageDomain |

## Escalation

Same recipe, more providers: any keyless adapter built from
`blueprint/data-adapter` (hazards, food, markets...) slots into step 2.
The SSRF checklist travels with it - every request revalidates every
redirect hop.

## What tests pin

Both families ship with real-captured-response fixtures
(`tests/places.spec.ts`, `tests/weather.spec.ts`): the normalizers, the
viewbox math, and the guarded-fetch path. Endpoints were probed live
2026-08-31: Nominatim search/reverse and Open-Meteo elevation answer
200, no key, sub-second.