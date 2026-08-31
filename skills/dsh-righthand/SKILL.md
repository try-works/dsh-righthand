---
name: dsh-righthand
description: Use when a task needs the righthand toolkit — durable key-value storage (rh_store_*), a task board (rh_task_*), reminders (rh_events_*), credential and settings management (rh_credential_* / rh_settings_*), governed command execution (rh_run / rh_run_bg), language work (rh_text_*), weather/air data (rh_weather_*), places data (rh_places_*), R2 file tools (rh_files_*), ntfy push (rh_notify_send), or its tool guard policy. Covers tool reference, guard semantics, and service availability.
---

# dsh-righthand

The righthand toolkit: DSH-native tools over the harness's own services. Use this skill as the **tool reference** when any `rh_*` tool applies.

## Tool families

| Family | Tools | Backing service | Use when |
|--------|-------|-----------------|----------|
| store | `rh_store_put` / `rh_store_get` / `rh_store_delete` / `rh_store_list` | `ctx.storageDomain` (domain KV) | The task needs durable state across turns: a catalog, counter, cache, or note. Prefer this over files for structured JSON records. |
| tasks | `rh_task_create` / `rh_task_list` / `rh_task_next` / `rh_task_update` / `rh_task_delete` | `ctx.storageDomain` (typed `righthand_tasks` domain) | A task board with a state machine (open → done/failed). `rh_task_next` is the oldest open task — what to work on now. A failed task's `result` records what went wrong: a task that cannot run is still recorded, never silently dropped. |
| secrets | `rh_credential_describe` / `rh_credential_set` / `rh_credential_unset` | `ctx.credentials` | The task must check, store, or remove a credential reference (e.g. `CLOUDFLARE_API_TOKEN`). Values are written durably and **never echoed back**. |
| settings | `rh_settings_get` / `rh_settings_set` | `ctx.settings` (namespace `righthand`) | Reading or patching righthand settings (`accountId`, `defaultZone`, `defaultScriptPrefix`). |
| exec | `rh_run` / `rh_run_bg` | `ctx.subprocess` + `ctx.jobs` | Running one command (argv array, no shell interpretation). `rh_run` collects bounded output; `rh_run_bg` starts an owner-scoped background job and returns its id. |
| text | `rh_text_summarise` / `rh_text_extract` / `rh_text_classify` / `rh_text_translate` | `ctx.llm` (one model call per verb) | Language work: shorten, turn into JSON matching a schema, sort into your labels with confidence, or translate preserving formatting. |
| weather | `rh_weather_forecast` / `rh_weather_air` | Open-Meteo (keyless) via the SSRF-guarded fetcher | Current conditions + 3-day min/max, or PM2.5/PM10/AQI, for a lat/lon. Keyless only — anything needing an API token is out of scope. |
| places | `rh_places_geocode` / `rh_places_address` / `rh_places_elevation` / `rh_places_nearby` | Nominatim/OSM + Open-Meteo (both keyless) via the SSRF-guarded fetcher | Geocode text to places, reverse a lat/lon to an address, get elevation, or find what is near a point — `rh_places_geocode` covers keyword search too. |
| files | `rh_files_put` / `rh_files_get` / `rh_files_list` / `rh_files_share` / `rh_files_delete` | Cloudflare R2 (the user's own account) | Store/read/list/share/delete objects in an R2 bucket. `rh_files_share` returns a presigned download URL valid for N minutes (default 60, max 7 days) — anyone with the URL can read it for that window. |
| events | `rh_events_create` / `rh_events_due` / `rh_events_list` / `rh_events_free` / `rh_events_cancel` | `ctx.storageDomain` (typed `righthand_events` domain) | Reminders. The agent IS the scheduler: `rh_events_due` each turn returns pending events whose time has come and marks them notified — delivered exactly once, never silently dropped. `rh_events_free` finds free slots within local working hours 09:00–17:00. |
| notify | `rh_notify_send` | ntfy.sh (keyless) | Interrupt yourself on your own devices: publish to a topic; subscribed devices receive it. The topic name is the only secret — use an unguessable one. |
| guard | (policy, not a tool) | `ctx.tools` `tools/pre-execute` | Configured via plugin config `rules`; gates tools by name prefix with `allow` / `deny` / `ask` modes. |

## Store semantics

- One domain `righthand_store`: a `rows` table (string key → JSON value + timestamp) and a global write counter.
- `rh_store_get` returns `{ found, key, value?, updatedAt? }` — `found: false` means the key is absent, not an error.
- Writes are durable (backend flush before commit) and serialized on one write chain; values must be JSON-serializable.
- The key prefix IS the collection (`task:`, `digest:`, `run:`, `uptime:`, `deploy:`); `rh_store_list` + a prefix filter is the query language. See `docs/scenario-patterns.md` for the conventions, the receipt pattern and undo trails.
- Build, then keep one receipt key per run (`{ ...result, fetchedAt }`) — the store is the agent's durable trail; delete scenario keys when a run is only a test.

## Events semantics

- One domain `righthand_events`; states `pending` → `notified` (or `cancelled`).
- `rh_events_due` is the per-turn check: pending events with `at <= now` are returned once and marked notified, so a missed turn leaves a visible record, never silence.
- `rh_events_free` works in local time, working hours 09:00–17:00; durations are in minutes.
- One-off events only; a real scheduler (Cloudflare cron) is the documented escalation.

## Notify semantics

- Keyless publish to ntfy.sh; the topic name is the only secret (choose an unguessable one, like a random string).
- Priority 1–5; title optional; auto-delete after 24h. Publishing goes through the SSRF-guarded fetcher.

## Files semantics

- Cloudflare R2, the user's own account: accountId from settings, credentials `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY` from the credential provider, bucket from settings `defaultR2Bucket` (or plugin config).
- Every request is SigV4-signed (region `auto`); the signer is pinned to the AWS published test vector.
- Content is text (`text/plain` default, override with `contentType`); `rh_files_get` returns `found: false` for absent keys, not an error.
- `rh_files_share` presigns a GET — treat the URL as a secret for its validity window.

## Places semantics

- Two keyless providers: Nominatim (geocoding, reverse, nearby) and Open-Meteo (elevation). No tokens; requests carry a User-Agent because Nominatim's public usage policy requires one — respect the 1 req/s limit, agent-paced calls only.
- The wire shape is the provider's; the tool shape is `{ name, lat, lon, displayName, category, type, address }`. Search tools return a root array.
- `rh_places_nearby` bounds the query with a viewbox (`bounded=1`) and attaches a computed `distanceKm`, sorted nearest first.
- A reverse geocode miss surfaces as a clean error, not a zeroed place.

## Weather semantics

- Keyless only: Open-Meteo, no token. Every request goes through `guardedFetch` — public destinations only (loopback/private/link-local/multicast refused), every redirect hop revalidated, size and time capped.
- Results are normalized to a stable shape (the wire JSON is the provider's; callers see ours).
- Output schemas reject `null` — absent pollutant values are omitted, not null.

## Text semantics

- One model call per verb; each call's failure is contained (the other tools are unaffected).
- `rh_text_extract` takes a JSON Schema and the model returns one object conforming to it — parse failures surface as a clean error, not raw prose.
- `rh_text_classify` returns a label verbatim from the given set plus a 0–1 confidence; a label outside the set is an error.
- Provider/model come from plugin config (`provider`/`model`, default the harness default model).

## Task semantics

- One domain `righthand_tasks`: a `tasks` table keyed by generated task id (`t-...`).
- States: `open` → `done` | `failed`. `rh_task_next` returns the oldest open task; nothing open returns `{ found: false }`.
- `rh_task_update` takes a state and/or a `result` — a failed task should carry what was tried and what went wrong, so the record says what happened.
- `rh_task_list` sorts open first (oldest first), then done, then failed; `state` filters.

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
| `defaultR2Bucket` | `""` | default R2 bucket for `rh_files_*` |
| `defaultNotifyTopic` | `""` | default ntfy topic for `rh_notify_send` |

Schema wall: `rh_settings_set` accepts keys the schema does not define, but `rh_settings_get` never returns them — an unregistered key looks written and silently disappears. Register new keys in the schema (a plugin change) or keep ad-hoc knobs in `rh_store`.

## Guard policy

Rules come from the plugin config (`rules: [{ toolPrefix, mode, ask?, destructive? }]`). `deny` throws before dispatch; `ask` defers to the policy function (return true to allow); `allow` passes through. Tools matching no rule are unaffected. Prefixes match by prefix — `rh_run` also covers `rh_run_bg`.

`destructive: true` is a documentation flag for irreversible effects (deploy, delete, DNS change); it never changes enforcement, only records why a prefix is gated. `tests/permissions.golden` records every tool's derived guard facts; a guard change that moves a fact fails the test until re-baselined (`UPDATE_GOLDEN=1 pnpm test`).

## Service availability

- **web profile**: all thirty-seven tools register (`storageDomain` is provided by the web app rows).
- **other profiles** (e.g. headless): the store, task and events families stay dormant (no `storageDomain`); the other twenty-three tools (secrets, settings, exec, text, weather, places, files, notify) still register. The plugin never fails the boot.

## Composition blueprints

Repo guidance kits under `experiments/` (each a `blueprint.json` spec + recipe + learnings) for composing the tools into routines. Committed kits: `blueprint/daily-digest` (collect → summarize → send), `blueprint/data-adapter` (wrap a keyless API; worked examples `rh_weather_*` / `rh_places_*`), `blueprint/reminder-flow` (events + notify + receipts), `blueprint/geo-context` (places + weather + store cache), `blueprint/governed-exec` (guard + receipts + undo trails), `blueprint/file-vault` (R2 + store index + presigned shares), `blueprint/task-triage` (classify + extract + board, oldest-open loop), `blueprint/heartbeat` (checks + receipts + streak alerts), `blueprint/agent-notebook` (note:<slug> memory + compaction), `blueprint/credential-onboarding` (auth gates + account facts + receipt), `blueprint/budget-guard` (categorized expenses + store-held cap + warn-once). The README catalogues nine more for future builds; `docs/scenario-patterns.md` holds the live-tested recipes.
