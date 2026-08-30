---
name: dsh-righthand
description: Use when a task needs the righthand toolkit — durable key-value storage (rh_store_*), credential and settings management (rh_credential_* / rh_settings_*), governed command execution (rh_run / rh_run_bg), or its tool guard policy. Covers tool reference, guard semantics, and service availability.
---

# dsh-righthand

The righthand toolkit: DSH-native tools over the harness's own services. Use this skill as the **tool reference** when any `rh_*` tool applies.

## Tool families

| Family | Tools | Backing service | Use when |
|--------|-------|-----------------|----------|
| store | `rh_store_put` / `rh_store_get` / `rh_store_delete` / `rh_store_list` | `ctx.storageDomain` (domain KV) | The task needs durable state across turns: a catalog, counter, cache, or note. Prefer this over files for structured JSON records. |
| secrets | `rh_credential_describe` / `rh_credential_set` / `rh_credential_unset` | `ctx.credentials` | The task must check, store, or remove a credential reference (e.g. `CLOUDFLARE_API_TOKEN`). Values are written durably and **never echoed back**. |
| settings | `rh_settings_get` / `rh_settings_set` | `ctx.settings` (namespace `righthand`) | Reading or patching righthand settings (`accountId`, `defaultZone`, `defaultScriptPrefix`). |
| exec | `rh_run` / `rh_run_bg` | `ctx.subprocess` + `ctx.jobs` | Running one command (argv array, no shell interpretation). `rh_run` collects bounded output; `rh_run_bg` starts an owner-scoped background job and returns its id. |
| guard | (policy, not a tool) | `ctx.tools` `tools/pre-execute` | Configured via plugin config `rules`; gates tools by name prefix with `allow` / `deny` / `ask` modes. |

## Store semantics

- One domain `righthand_store`: a `rows` table (string key → JSON value + timestamp) and a global write counter.
- `rh_store_get` returns `{ found, key, value?, updatedAt? }` — `found: false` means the key is absent, not an error.
- Writes are durable (backend flush before commit) and serialized on one write chain; values must be JSON-serializable.

## Credential semantics

- `rh_credential_describe` reports `configured`, `source`, `writable` — never the value.
- `rh_credential_set` requires a non-empty value and returns only `{ ref, stored: true }`.
- References are POSIX env-var style names (uppercase, e.g. `CLOUDFLARE_API_TOKEN`).

## Settings namespace `righthand`

| Key | Default | Meaning |
|-----|---------|---------|
| `accountId` | `""` | Cloudflare account id used by righthand Cloudflare tools |
| `defaultScriptPrefix` | `"rh-"` | default name prefix for generated workers/scripts |
| `defaultZone` | `""` | default Cloudflare zone |

## Guard policy

Rules come from the plugin config (`rules: [{ toolPrefix, mode, ask?, destructive? }]`). `deny` throws before dispatch; `ask` defers to the policy function (return true to allow); `allow` passes through. Tools matching no rule are unaffected. Prefixes match by prefix — `rh_run` also covers `rh_run_bg`.

`destructive: true` is a documentation flag for irreversible effects (deploy, delete, DNS change); it never changes enforcement, only records why a prefix is gated. `tests/permissions.golden` records every tool's derived guard facts; a guard change that moves a fact fails the test until re-baselined (`UPDATE_GOLDEN=1 pnpm test`).

## Service availability

- **web profile**: all twelve tools register (`storageDomain` is provided by the web app rows).
- **other profiles** (e.g. headless): the store family stays dormant; the other seven tools still register. The plugin never fails the boot.
