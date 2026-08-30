# DSH-native tools — learnings log

> Self-built tools on the harness's OWN services, verified by mounting the real providers and invoking each tool's `execute()` path. Not read-verified — executed.

## What I built (all in `src/`)

| Module | Tools | Native service it wraps |
|---|---|---|
| `store-tools.ts` | `rh_store_put/get/delete/list` | `ctx.storageDomain` (domain KV: table + global counter) |
| `secrets-tools.ts` | `rh_credential_describe/set/unset`, `rh_settings_get/set` | `ctx.credentials` + `ctx.settings` |
| `exec-tools.ts` | `rh_run`, `rh_run_bg` | `ctx.subprocess` + `ctx.jobs` |
| `guard-tools.ts` | (policy, not a tool) | `ctx.tools` `tools/pre-execute` |

## Test results (mine — `tests/dsh-native-tools.spec.ts`, 7/7 pass)

Booted a real `Context` with: `SystemPrompt` + `ToolRuntime` + `Storage` hub + `storage-json` + `storage-domain` + `credentials-local` + `settings-file` + `jobs-local` + `subprocess-local`, then mounted each tool plugin and called `ctx.tools.execute(...)`.

1. `rh_store_put/get/delete/list` round-trips a JSON value durably through the domain KV.
2. The domain's **global singleton** increments a write counter across puts (writes=1 then writes=2).
3. `rh_credential_set` stores a secret; `rh_credential_describe` reports `configured` + source WITHOUT the value (asserted the secret string never appears in any output).
4. `rh_settings_get` returns schema defaults (`rh-` prefix); `rh_settings_set` merges a patch and re-reads it.
5. `rh_run` runs `node --version` → exit 0 + stdout matching `/v\d+/`.
6. `rh_run_bg` starts a `ctx.jobs` background job that settles `completed`.
7. `guard-tools` denies a `rh_deny_` tool through `tools/pre-execute` (result `isError: true`).

## Learnings during build (mine — where the harness corrected my notes)

1. **The real `ctx.storage` is a storage HUB, not `ctx.storage.sql`.** My §9.2 notes said `ctx.storage.sql` (that is the Cloudflare DO's storage, not the harness). The harness `ctx.storage` exposes named backends (`backend.register('json', ...)`) with a `kv` facet; the ergonomic layer is `ctx.storageDomain` → `defineDomain` + `domain.table('rows').put/get/delete/keys()` + `domain.global.get()/set()`. Records are validated by **zod** (not schemastery) at the durable-read boundary.
2. **`domain.table(name)` returns a handle; there is no `domain.tables.<name>` object.** And the table verb is `put`, not `set`. My first pass guessed the API and the execute() returned `Cannot read properties of undefined (reading 'set')` — the real API corrected it.
3. **`ctx.jobs.start` refuses until a controller is attached** (`attachController('name')`), exactly like `tool-jobs`. My first `rh_run_bg` would have been rejected without it.
4. **`ctx.plugin()` accepts function/class/`{apply}` plugins uniformly**, and `Service` subclasses (`LocalCredentialProvider`, `FileSettingsProvider`, `LocalJobRegistry`, `Storage`, `ToolRuntime`, `SystemPrompt`) are directly pluggable — the `file:` devDeps + pnpm `overrides`/`linkWorkspacePackages` recipe (from `dsh-paper-design`) is the right way to test against the real runtime.
5. **`tools/pre-execute` with `{prepend: true}` + a throw is the clean deny gate** — the tool never dispatches and the result is `isError`. No wrapper needed.
6. **Cordis Contexts cannot have arbitrary properties set on them** (`cannot set property without provide`). Observability must go through a real service/`provide`, not a monkey-patched field.
7. **Subprocess env scrubbing is built in**: the seam exports `scrubbedParentEnv()` (strips `KEY/PASSWORD/SECRET/TOKEN` + `DSH_*`), so a plugin spawning a CLI gets secret hygiene for free.

## Fits dsh-righthand as

- These are the **generic DSH-native primitives** the Cloudflare tools will build on: the durable tool catalog is `rh_store_*` over `storageDomain`; auth is `rh_credential_*`; deploy/invoke is `rh_run`/`rh_run_bg` over subprocess+jobs; high-impact gates are `guard-tools`.
- The **test harness** (`tests/dsh-native-tools.spec.ts`) is the reusable mount pattern for every future tool module.