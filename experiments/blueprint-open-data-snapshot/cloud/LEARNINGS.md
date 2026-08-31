# blueprint/open-data-snapshot CLOUD learnings log

> Cloud version of the open-data-snapshot blueprint. Deployed test
> build (workers.dev, keyless).

## Run context

| Field | Value |
|---|---|
| Worker | `cloud/index.js` - rh-quakes, `GET /snapshot?days=&minmag=`, `/health` |
| Deploy | wrangler 4.123.0, OAuth, workers.dev |
| URL | https://rh-quakes.ambiens.workers.dev |
| Compat | 2026-08-31 |

## Measured (2026-08-31)

- `/snapshot?days=1&minmag=2.5` -> 43 features, ids length equals
  feature count, PASS.
- USGS is the canonical keyless open-data endpoint - no key, stable
  GeoJSON, event ids (us7000td3c etc.) that survive re-fetches, so the
  caller's snapshot diff is a set difference on ids.
- The worker normalizes to { id, place, mag, time, url, lon, lat,
  depthKm } - the wire shape stays USGS's, the tool shape is ours
  (the data-adapter invariant, now measured on cloud).

## Build learnings

- The snapshot itself is stateless; the PREVIOUS snapshot (and the
  diff) lives in the caller's rh_store - the Worker never needs KV.
  That split is the template: normalize remote, remember local.

## Blueprint guidance update

- Cloud turns the fetch+normalize half of the kit into an endpoint;
  the diff-and-note half stays where the store is. A scheduled
  handler could re-fetch on cron, but the value is in the caller
  diffing - same guidance as paper-digest.