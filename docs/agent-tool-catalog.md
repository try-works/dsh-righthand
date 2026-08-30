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
1. Mu's identity tiers (Open/Caller/Account) and its `limit` per-day counts
   are **not applicable** here: righthand is a single user — the tools are
   built by that user's own agent and run locally or on the user's own
   Cloudflare account. There are no accounts to tier and nothing to ration.
   What *does* carry over is the **destructive marker**: an irreversible
   effect the agent's own tool descriptions could talk it into (a deploy, a
   delete, a DNS change) is the prompt-injection surface the guard exists
   for, and prefix-based allow/deny/ask already covers it — the marker just
   makes the reasoning explicit.
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
| `rh_notify_*` | notify_send/devices | ntfy.sh topic (keyless — the topic name is the only secret, no token) or web-push (self-generated VAPID); store device/topic registry in `rh_store` | small |
| `rh_events_*` | events_create/list/free | `rh_store` + Cloudflare cron trigger (or OS scheduler locally) | medium — scheduling is the hard half |

### Keyless data adapters (blueprint material — one pattern, many tools)

> Constraint (2026-08-30): third-party services are allowed **only when they
> need no API token or credentials** — keyless public endpoints. Anything
> that needs a key (Twilio, Resend, paid tiers) is out. All of these are
> keyless.

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
| mail_send / mail_inbox | needs a mail provider key (Resend/MailChannels) — violates the keyless rule; account-scoped reputation |
| sms_send / sms_history | Twilio-style key — violates the keyless rule |
| images_generate | Workers AI image gen is the natural fit — the user's own Cloudflare account, optional paid plugin |
| wallet_* (USDC on Base) | custodial payments, regulatory surface |
| chat/social/stream/blog/users | instance-local social graph — nothing to attach to in a personal harness |
| apps_create/build/fork | a whole hosting surface; closest righthand form is Cloudflare Workers deployment (`blueprint/vision-worker` shape), a phase-2 plugin |
| transit_* (TfL) | UK-only, keyed in parts; a data adapter if a user asks |

## Suggested build order

> Constraint (2026-08-30): TypeScript only, no Go. Single user — no accounts,
> no rationing, no identity tiers. Every tool is built by the user's own
> agent and runs locally or on the user's own Cloudflare account. The
> `requires`/`limit` axes from Mu are dropped; the `destructive` marker and
> the golden-file discipline stay.

1. **Guard upgrade**: `destructive: true` marker on guard rules + a
   `tests/permissions.golden` over all `rh_*` tools recording destructive
   flags and guard modes. Prefix-based allow/deny/ask stays — the marker
   documents *why* a prefix is guarded, and the golden catches drift.
2. **`rh_task_*` + `rh_text_*`** — both tiny over existing services, and
   together they cover Mu's most-used families (tasks, notes, text).
3. **One data-adapter blueprint** (weather or places as the demo) + the
   recipe that generates the rest, all running locally or as the user's own
   Workers.
4. **`rh_files_*` on R2** — the first family that is *actually on a
   Cloudflare primitive* (the user's own R2), the plugin's stated purpose.
5. `rh_events_*`, `rh_notify_*`, then the out-of-scope list as optional
   plugins.

## Incorporation decisions (from mu-repo-analysis.md)

> Constraints (2026-08-30): **TypeScript only — no Go.** Single user —
> **no accounts, no rationing**: nothing to tier, nothing to meter per-day.
> Every tool is built by the user's own agent and runs locally or on the
> user's own Cloudflare account. Mu lessons that presuppose a multi-user
> server (identity tiers, limits, quotas, wallets, address spaces) are out;
> the engineering discipline carries over.

The architecture read produced eleven lessons; these are the ones worth
incorporating now, each mapped to a concrete righthand change, in order.
Deliberately NOT incorporated below the fold.

### Incorporate now

1. **Permissions golden first** (Mu lesson 2). Record the answer before
   changing the model: `tests/permissions.golden`, one line per `rh_*` tool
   recording its **destructive flag** and guard mode. Any guard refactor
   that leaves the file unchanged is behaviour-preserving; any diff is the
   list of doors that moved.
2. **Guard rules gain a `destructive` marker** (lessons 2). Prefix-based
   allow/deny/ask stays; `destructive: true` documents *why* a prefix is
   guarded — irreversible effects (deploy, delete, DNS change) are the
   prompt-injection surface. The marker is declarative only: the enforcement
   is still the rule's mode. No identity tiers, no limits — there is one
   user and nothing to ration.
3. **Scope = catalogue** (lesson 10). The visible catalogue and the
   enforceable scope must be one mechanism: the SKILL.md and README tool
   tables must state what a guard rule gates, and the golden must derive
   from the same declaration — no second hand-kept list.
4. **`rh_task_*` family** (lesson 4). Tasks domain over the store:
   create/list/next/update/delete with a state machine; descriptions carry
   the "always say something" rule — a failed run is delivered like an
   answer.
5. **`rh_text_*` family** (lesson 7). summarise/extract/classify/translate
   over `ctx.llm`, reusing the digest summarizer's prompt discipline: roles
   stay roles, caps are deliberate, per-call failure contained.
6. **Settings hygiene** (lesson 11). Every settings key must have a
   consumer or go. The namespace holds the user's own Cloudflare account
   facts (`accountId`, `defaultZone`, `defaultScriptPrefix`) — no pricing,
   no limits.
7. **Data-adapter blueprint with the SSRF checklist** (lesson 6). The
   fetcher blueprint guidance must carry: block non-public destinations,
   revalidate every redirect hop, cap size and time. Adapters may call any
   **keyless** public endpoint — an API token requirement is the line that
   puts a service out of scope.

### Deliberately not incorporated

| Mu feature | Reason |
|---|---|
| Go services / handlers | righthand is TypeScript on the DSH harness |
| `requires` identity tiers (Open/Caller/Account) | single user — no accounts to tier |
| `limit` per-day counts / quota.json pricing | single user — nothing to ration, nothing to meter |
| Spec.Card renderers | the web GUI owns turn summaries; righthand outputs carry `fetchedAt` instead |
| held-state judge (agent/gate) | guard `ask` is the local judge; a full inbound queue needs a product surface |
| agents-as-accounts / inbox address space | a product, not a plugin — the DSH harness already is the agent host |
| wallet_* (USDC, x402) | payments/regulatory surface, absent by design |
| memory-as-history fix | already how the DSH agent loop works — only prompt-building tools inherit the rule |
| internal/ layering test | Cordis + the harness enforce the equivalent; the tool-to-tool rule goes in guidance instead |
| keyed third parties (Twilio, Resend, paid APIs) | the keyless rule: any service that requires an API token or credentials is out |

