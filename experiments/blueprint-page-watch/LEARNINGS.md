# blueprint/page-watch - run log

## Learnings

- price-watch without the price - the hash is the signal.
- guardedFetch size caps bound the fetch.

## Cloud test build (2026-08-31)

- Deployed rh-page-watch. Two /watch runs produced the same SHA-256
  (461395b5...) - WebCrypto works in Workers and the normalization
  makes fingerprints stable.
- Template split measured: remote fingerprint, local diff (the
  previous hash + alert live in rh_store).