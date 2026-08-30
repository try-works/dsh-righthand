# blueprint/data-adapter — run log (2026-08-30)

## Outcome

Built the recipe as the weather family in the plugin (src/weather-tools.ts,
tests/weather.spec.ts). Both Open-Meteo endpoints probed live:
/v1/forecast and /v1/air-quality answer 200, no key, sub-second. The
family ships two tools; the same recipe generates the rest of the keyless
set from the catalog.

## Learnings

1. **The SSRF guard has to revalidate every redirect hop.** The Mu
   safefetch lesson: validating the first URL is not enough. A redirect
   onto a private address must fail even when the first host was public.
   guardedFetch loops manually with redirect manual, so every hop goes
   through the same resolve + IP check. Tested with a private-address
   redirect.
2. **A DNS answer can mix public and private records — block if ANY is
   private.** lookup with all true returns the set; one bad record
   poisons the answer.
3. **The wire shape is the provider's, the tool shape is ours.**
   normalizeForecast and normalizeAir map the Open-Meteo JSON to stable
   fields; a fixture captured from a real response pins the mapping. The
   caller never sees current_weather_units or temperature_2m_max.
4. **fetch cannot pin the resolved IP — document the residual window.**
   The guard resolves, validates, then fetches by hostname; a
   resolve-then-rebind window remains (the same trade Mu's non-proxy mode
   makes). For the fixed, keyless endpoints this blueprint targets the
   allowlisted host is the practical control; the harness's own web tools
   are the fully-guarded path for arbitrary URLs.
5. **Injectable deps make the guard testable without a network.**
   guardedFetch takes fetchImpl and resolve; tests drive redirects
   and private answers directly, the tool-level test stubs the globals.
6. **Tool output schemas reject null** (type number is number or
   undefined): the normalizer's null for absent pollutants must be
   spread conditionally into the tool return.

## Blueprint changes to make

- The catalog's adapter list (weather, places, flights, hazards, food,
  markets, routes, maps, news) is instantiable from this recipe as-is;
  each needs only its endpoint probe + normalizer + fixture.

