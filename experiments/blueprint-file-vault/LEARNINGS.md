# blueprint/file-vault - run log

## Learnings (from building the R2 family, 0.1.7)

1. **SigV4 is pin-testable.** The signer reproduces the AWS published
   test vector exactly (f0e8bdb8...); a signing change that breaks
   the vector fails the test. The first bug was real: canonical URIs
   that encoded / as %2F broke the signature - slashes stay, path
   segments are encoded.
2. **The index lives in the store, not in object keys.** Metadata in
   keys means rename-by-key rewrites; one store record per object
   makes find a prefix scan.
3. **A presigned URL is a secret with a clock.** Anyone holding it
   can read the object for its window - hand it out like a
   credential.
4. **Absence is found:false.** rh_files_get for a missing key answers
   found:false, not an error - the exists() check is free.
5. **Honest limit: not live-probed.** The family is unit-tested
   against a stubbed fetch and the signer against the AWS vector, but
   no real bucket call has run yet - R2 credentials are unconfigured
   on this machine (verified 2026-08-31). First real run should be a
   put/get/delete round-trip on a scratch key.