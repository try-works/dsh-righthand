# Agent tool catalog — analysis of micro.mu/tools + the permission commit

Source material:
- https://micro.mu/tools — the Mu tool catalogue (~30 services, ~130 methods,
  every method an agent-callable tool).
- https://github.com/micro/mu/commit/4933862770d706f6c56e0ab2af287070811fc52d —
  "five permission flags become two": the permission-model commit.

## What the commit teaches (apply to guard-tools)

The commit collapses five declared flags into two derived facts:

| Mu model | Meaning |
|---|---|
| `Requires: Open` | anybody, including nobody at all |
| `Requires: Caller` | somebody — a funded wallet counts; enough for anything scoped to "theirs" (own notes, own files) |
| `Requires: Account` | a real account, not just a wallet — requests made *on somebody's behalf* (fetch any URL you name) or spending a shared reputation (mail.Send); "rationing needs somebody to ration" |
| `Destructive` | an irreversible effect nobody asked for; the flag exists because tool *descriptions* are attacker-controlled text, so a tool that holds one is a prompt-injection surface |

Lessons for righthand's guard:
1. guard rules today are prefix-based allow/deny/ask; the Mu model adds two
   orthogonal axes — **identity tiers** (Open/Caller/Account) and a
   **destructive marker** — worth porting as optional rule fields.
2. **Golden-file the derived permissions** (`test/permissions.golden`):
   baseline every tool's permission from the derived policy and let the test
   fail when one changes. The commit's own debugging is the guidance: the
   golden first recorded *nothing* (registering a service is not deriving its
   tools), then recorded only the derived policy (and missed the exact
   distinction being collapsed), then recorded prices (failed on test order).
   It now records permissions alone, sees the change, and is stable.
   Righthand equivalent: a `tests/permissions.golden` over every `rh_*` tool.

## Tool families Mu ships, mapped onto righthand primitives

Legend: **have** = the harness/righthand already provides this;
**add** = a new righthand family worth building; **data** = a keyless-API
adapter (blueprint material); **skip** = instance-local social or
third-party-keyed, out of scope for the core plugin.

### Already provided (no work — document as guidance, don't rebuild)

| Mu | Righthand/harness equivalent |
|---|---|
| shell_run / shell_write | `rh_run` / `rh_run_bg` + `ctx.fs` write tools |
| web_fetch / web_search / browser_read / browser_shot | harness `web_search` + browser tools + `blueprint/web-scraper` |
| notes_add/get/list/delete | `rh_store_*` (the notes pattern, scenario 2) |
| tasks_create/list/update/next | `rh_store_*` task board (documented use case) — candidate for a typed `rh_task_*` family |
| recall_list/search/conversation | harness session services (`session-query-sqlite`, `session` projection) |
| docs_write/read/list | `ctx.fs` read/write/edit tools (store keyed index is the delta) |

### New righthand families worth adding (core plugin)

| Family | Mu analogue | Backing | Effort |
|---|---|---|---|
| `rh_task_*` | tasks_* | `rh_store` domain `tasks` (state machine: open → done, `tasks_next`) | small — the store family already proves the pattern |
| `rh_text_*` | text_classify / text_extract / text_summarise / text_translate | `ctx.llm` (same route as digest summaries) | small — JSON-constrained prompts, one tool per verb |
| `rh_files_*` | files_put/get/list/share | Cloudflare R2 (put → object URL; share → public/private toggle) | medium — first real "Cloudflare primitive" family |
| `rh_notify_*` | notify_send/devices | ntfy.sh topic (keyless) or web-push; store device/topic registry in `rh_store` | small |
| `rh_events_*` | events_create/list/free | `rh_store` + Cloudflare cron trigger (or OS scheduler locally) | medium — scheduling is the hard half |

### Keyless data adapters (blueprint material — one pattern, many tools)

These are all the same shape as `blueprint/daily-digest` + `research-radar`
adapters: a keyless HTTP API, a probe + fixture test, normalize, cache in
`rh_store`, optional LLM summarization. One `blueprint/data-adapter` recipe
would generate the whole set.

| Mu | Keyless source |
|---|---|
| weather_air / weather_forecast / weather_history / weather_marine | Open-Meteo (no key) |
| places_geocode / places_address / places_elevation / places_nearby / places_search | Nominatim (OSM), no key |
| flights_airport / flights_overhead / flights_track | OpenSky Network (anonymous tier) |
| hazards_quakes / hazards_alerts / hazards_floods | USGS / GDACS / UK EA flood API |
| food_product / food_search | Open Food Facts (no key) |
| markets_convert / markets_list | CoinGecko / exchangerate APIs (free tier) |
| routes_directions / routes_eta / routes_nearest | OSRM public server |
| maps_tile / maps_area | static tile URLs (OSM) |
| prayer_times / prayer_qibla | computed locally (astronomical) or Aladhan API |
| news_list / news_read / news_search | RSS + index (the daily-digest fetcher generalised) |

### Out of scope for the core plugin (note in guidance, don't build)

| Mu | Why skip |
|---|---|
| mail_send / mail_inbox | needs a mail provider key (Resend/MailChannels); account-scoped reputation |
| sms_send / sms_history | Twilio-style key |
| images_generate | Workers AI image gen is the natural fit — paid, optional plugin |
| wallet_* (USDC on Base) | custodial payments, regulatory surface |
| chat/social/stream/blog/users | instance-local social graph — nothing to attach to in a personal harness |
| apps_create/build/fork | a whole hosting surface; closest righthand form is Cloudflare Workers deployment (`blueprint/vision-worker` shape), a phase-2 plugin |
| transit_* (TfL) | UK-only, keyed in parts; a data adapter if a user asks |

## Suggested build order

1. **Permission upgrade in guard-tools** (the commit's lesson): optional
   `requires: open|caller|account` + `destructive: true` rule fields + a
   `tests/permissions.golden` over all `rh_*` tools. Smallest change, directly
   from the commit.
2. **`rh_task_*` + `rh_text_*`** — both tiny over existing services, and
   together they cover Mu's most-used families (tasks, notes, text).
3. **One data-adapter blueprint** (weather or places as the demo) + the
   recipe that generates the rest.
4. **`rh_files_*` on R2** — the first family that is *actually on a
   Cloudflare primitive*, the plugin's stated purpose.
5. `rh_events_*`, `rh_notify_*`, then the out-of-scope list as optional
   plugins.

