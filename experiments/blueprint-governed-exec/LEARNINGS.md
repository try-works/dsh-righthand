# blueprint/governed-exec - run log

## Learnings (live-verified 2026-08-31 through the agent-facing tools)

1. **rh_run collects, rh_run_bg does not.** Live: curl through rh_run
   returned HTTP headers + exit 0; a failing node -e returned exit 3
   with stderr. A background job settled completed exit 0 with an
   EMPTY output tail - status and exit only. Collect mode for
   answers, background for fire-and-forget.
2. **The auth gate is one describe call.** CLOUDFLARE_API_TOKEN and
   R2_ACCESS_KEY_ID were both configured:false; the Cloudflare
   scenarios stop at step 1 with actionable info. describe never
   echoes the value.
3. **The settings schema wall is real.** rh_settings_set accepted an
   unregistered key (applied: true) and rh_settings_get never
   returned it. Custom knobs belong in rh_store, not settings -
   unless the schema registers them.
4. **Receipts round-trip exactly.** Digest scenario: rh_run parsed
   stdout JSON, stored a receipt with fresh-story diff, read it back
   found:true, deleted it - store restored to baseline. The receipt
   pattern from docs/scenario-patterns.md is the same one here.
5. **argv arrays only.** No shell operators, pipes or redirects - the
   caller composes commands; the guard sees the exact argv that runs.