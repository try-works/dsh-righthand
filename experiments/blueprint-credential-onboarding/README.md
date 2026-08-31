# blueprint/credential-onboarding

> The first-run flow for the user's own Cloudflare facts: describe is
> the auth gate, set stores what is missing without ever echoing it,
> settings pin the account facts, and one store receipt records the
> onboarded state. See `blueprint.json` for the declarative spec.

## What this is

Every Cloudflare scenario (files, deploy, heartbeat-to-cron) starts
with this flow. It composes the secrets and settings families into a
checklist the agent can run before anything irreversible.

## The recipe

1. **Gate**: `rh_credential_describe` each ref the task needs -
   CLOUDFLARE_API_TOKEN for deploys, R2_ACCESS_KEY_ID +
   R2_SECRET_ACCESS_KEY for files. `configured: false` is the stop
   sign, and it is actionable: tell the user exactly which ref to set.
2. **Set**: through a supervised flow the user provides the secret; the
   agent calls `rh_credential_set` and receives `{ stored: true }` -
   the value never appears in any output.
3. **Pin the account facts**: `rh_settings_set { accountId, defaultZone,
   defaultR2Bucket }` - schema keys only.
4. **Receipt**: `rh_store_put { key: 'onboarding:' + ts, value: { refs:
   { 'R2_ACCESS_KEY_ID': true, ... }, at } }` so a token rotation later
   is a visible diff, not a mystery.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| gate | `rh_credential_describe` | configured/source/writable, no value |
| set | `rh_credential_set` | returns { stored: true } only |
| rotate | `rh_credential_unset` + set | receipt makes it a fact |
| pin | `rh_settings_set` | schema keys only (the wall) |
| record | `rh_store_put` | onboarding:<ts> receipt |

## Escalation

The supervised-login pattern of the harness (user types the secret,
the model never sees it) is the same shape the credential provider
already enforces. Nothing new to build - this blueprint is the
checklist.

## What tests pin

Live-verified 2026-08-31: a throwaway ref set -> described
configured:true (value absent) -> unset -> configured:false.
CLOUDFLARE_API_TOKEN and R2_ACCESS_KEY_ID are both configured:false on
this machine today - the gate genuinely stops Cloudflare scenarios at
step 1. The settings schema wall was verified the same day.