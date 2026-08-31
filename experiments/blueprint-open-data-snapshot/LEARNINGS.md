# blueprint/open-data-snapshot - run log

## Learnings

- the data-adapter recipe (shipped) is the fetch half.
- USGS earthquake GeoJSON is the canonical keyless example from the catalogue.
- diffable snapshots make the weekly review see change, not bulk.

## Cloud test build (2026-08-31)

- Deployed rh-quakes; /snapshot?days=1&minmag=2.5 -> 43 events with
  stable ids - the snapshot diff is a set difference on ids, measured
  end to end.
- Stateless template confirmed: the Worker returns the snapshot, the
  previous snapshot lives in rh_store.