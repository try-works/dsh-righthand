# blueprint/artifact-publish - run log

## Learnings (files family + file-vault)

1. **contentType at put time.** Text is the default; a diagram
   published as text/plain renders wrong and the fix is a re-put.
2. **The presigned URL is a secret with a clock.** Share it, then it
   is gone - the notify carries the link once.
3. **Exit 0 gates the put.** rh_run verifies the artifact exists
   before rh_files_put - no empty uploads.
4. **Honest limit:** the R2 family is unit-tested and vector-pinned
   but not yet live-probed against a real bucket (credentials
   unconfigured as of 2026-08-31).