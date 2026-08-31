# blueprint/geo-context - run log

## Learnings (from live probes + the places family, 0.1.9)

1. **Both providers are genuinely keyless.** Live probes 2026-08-31:
   Nominatim /search and /reverse and Open-Meteo /v1/elevation all
   answer 200, no key, sub-second.
2. **Nominatim needs a User-Agent and patience.** Its usage policy
   requires an identifying UA (guardedFetch init.headers carries it)
   and agent-paced 1 req/s. The cache is what keeps a geo-context
   pipeline inside that.
3. **Reverse misses are HTTP 200 with an error body.**
   { error: "Unable to geocode" } - the tool surfaces it as a clean
   error instead of a zeroed place.
4. **Nearby means bounded search + client-side distance.** viewbox of
   left,top,right,bottom (lon,lat pairs) + bounded=1; Nominatim
   returns no distance, so distanceKm is computed with haversine and
   results are sorted nearest first. Bounded results are relevance-
   ranked, not strict-radius - a pub can answer a cafe query inside
   the box.
5. **Output schemas reject null.** Absent pollutants/fields must be
   omitted, not null - the weather/air family already learned this;
   the geo-context record inherits it.