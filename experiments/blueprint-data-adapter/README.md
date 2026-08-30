# blueprint/data-adapter

> Wrap one keyless public API as a righthand tool family. See `blueprint.json`
> for the declarative spec and `LEARNINGS.md` for the run log.

## What this is

The recipe for the keyless data adapters from the catalog
(weather, places, flights, hazards, food, markets, routes, maps, news):
probe the endpoint live, capture a real response as a fixture, normalize to
a stable shape, and expose one tool per query — every request through the
SSRF-guarded fetcher.

The **worked example ships in the plugin itself**: `src/weather-tools.ts`
(`rh_weather_forecast` + `rh_weather_air` over Open-Meteo, keyless) and
`tests/weather.spec.ts` (fixture + guard + tool tests).

## The recipe

1. **Probe the endpoint live** (keyless only) and record what it answered.
2. **Capture a real response as a fixture** for the normalizer test.
3. **Normalize** the wire JSON to a stable shape — callers see the shape,
   not the provider.
4. **One tool per query**, all through `guardedFetch`.
5. **Optional escalation**: TTL-cache responses in `rh_store`.

## The SSRF checklist (guardedFetch)

- public destinations only: loopback, RFC1918 private, ULA, link-local
  (including the 169.254.169.254 metadata address), multicast, unspecified
  are refused;
- **every redirect hop** revalidated, not just the first URL;
- response size (2 MiB) and time (10 s) capped;
- a DNS answer mixing public and private records is blocked.

## Keyless rule

A service that requires an API token or credentials is out of scope for
this recipe - the token requirement is what makes an adapter something
else.

