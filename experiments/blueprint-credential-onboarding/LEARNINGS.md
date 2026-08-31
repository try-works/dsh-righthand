# blueprint/credential-onboarding - run log

## Learnings (live-verified 2026-08-31)

1. **The value really never comes back.** A throwaway ref round-
   tripped set -> describe { configured: true, source: file } ->
   unset -> { configured: false }; no output contained the secret.
2. **The gate is real today.** CLOUDFLARE_API_TOKEN and
   R2_ACCESS_KEY_ID are both configured:false on this machine - every
   Cloudflare scenario honestly stops at step 1 until the user sets
   them. describe makes that stop actionable.
3. **The settings schema wall.** rh_settings_set accepted an
   unregistered key with applied:true and rh_settings_get never
   returned it. Onboarding pins only schema keys (accountId,
   defaultZone, defaultR2Bucket, defaultNotifyTopic); anything else
   belongs in the store.
4. **Rotations are facts.** unset + set plus an onboarding receipt
   turns a token rotation from a mystery into a diff.