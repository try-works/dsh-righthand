# blueprint/file-vault

> R2 as the agent's file system with the store as the index: rh_files_*
> moves blobs, rh_store holds metadata, rh_files_share hands out
> time-boxed presigned URLs. The first blueprint on a real Cloudflare
> primitive. See `blueprint.json` for the declarative spec.

## What this is

The files family (Cloudflare R2, SigV4-signed) composed with the store
into a vault: objects in the bucket, metadata in the index, sharing as
presigned URLs.

## The recipe

1. **Credentials first**: `rh_credential_describe R2_ACCESS_KEY_ID` and
   `R2_SECRET_ACCESS_KEY` - the auth gate. `rh_settings_get` for
   `accountId` and `defaultR2Bucket`.
2. **Put**: `rh_files_put { key, content, contentType }` - text by
   default; set contentType for anything else.
3. **Index**: `rh_store_put { key: 'file:' + key, value: { contentType,
   size, tags, fetchedAt } }` - find by scanning the index, never the
   bucket; keep metadata out of object keys (rename-by-key is a rewrite).
4. **Share**: `rh_files_share { key, minutes: 60 }` returns a presigned
   GET URL valid that long (max 7 days) - treat the URL as a secret for
   its window.
5. **Delete**: `rh_files_delete` removes the blob AND its index record -
   otherwise the index lies.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| auth | `rh_credential_describe` | R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY |
| config | `rh_settings_get` | accountId, defaultR2Bucket |
| put/get | `rh_files_put` / `rh_files_get` | absent keys -> found: false |
| list | `rh_files_list` | bucket listing, not the index |
| share | `rh_files_share` | presigned GET, 60 min default, 7 day max |
| index | `rh_store_put` / `rh_store_list` | one record per object |
| delete | `rh_files_delete` + `rh_store_delete` | both places or the index lies |

## Escalation

Workers integration: the exported `createR2Client` / `signRequest` /
`presignGet` are injectable and vector-pinned, so an agent-built Worker
can reuse them verbatim. Bucket policy and TTLs stay the user's own
Cloudflare account's business.

## What tests pin

`tests/files.spec.ts` pins put/get/list/share/delete against a stubbed
fetch, and `sigv4.ts` reproduces the AWS published test vector exactly.
Honest limit: the family is built and unit-tested but not yet
live-probed against a real bucket (R2 credentials are unconfigured on
this machine as of 2026-08-31).