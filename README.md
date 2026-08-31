# @try-works/dsh-righthand

A DeepSeek Harness plugin providing DSH-native **righthand tools** — a durable
KV store, credential/settings management, governed command execution, and a
tool guard. Every tool is built on the harness's own services
(`storageDomain`, `credentials`, `settings`, `subprocess`, `jobs`, `tools`),
not hand-rolled primitives.

The plugin also ships **blueprint guidance** — eighty-four named recipes for the agent-built tools this plugin exists to compose, seventy-five of them committed kits (see [Blueprints](#blueprints) below) — plus a packaged skill, a settings namespace, and an optional tool guard.

## Install

```bash
dsh plugin --profile <profile> add @try-works/dsh-righthand
```

Or apply the overlay directly:

```bash
dsh --profile <profile> --patch ./cordis.patch.yml
```

## Tools

| Tool | Family | Backing service |
|---|---|---|
| `rh_store_put` / `rh_store_get` / `rh_store_delete` / `rh_store_list` | store | `ctx.storageDomain` (domain KV) |
| `rh_task_create` / `rh_task_list` / `rh_task_next` / `rh_task_update` / `rh_task_delete` | tasks | `ctx.storageDomain` (typed `righthand_tasks` domain; state machine open → done/failed) |
| `rh_text_summarise` / `rh_text_extract` / `rh_text_classify` / `rh_text_translate` | text | `ctx.llm` (one model call per verb) |
| `rh_weather_forecast` / `rh_weather_air` | weather | Open-Meteo (keyless), every request through the SSRF-guarded fetcher |
| `rh_places_geocode` / `rh_places_address` / `rh_places_elevation` / `rh_places_nearby` | places | Nominatim/OSM + Open-Meteo (keyless; User-Agent per Nominatim's 1 req/s usage policy) |
| `rh_files_put` / `rh_files_get` / `rh_files_list` / `rh_files_share` / `rh_files_delete` | files | Cloudflare R2 (S3-compatible, SigV4-signed; credentials from `R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`, bucket from settings) |
| `rh_events_create` / `rh_events_due` / `rh_events_list` / `rh_events_free` / `rh_events_cancel` | events | `ctx.storageDomain` (typed `righthand_events` domain; the agent is the scheduler — `rh_events_due` runs each turn) |
| `rh_notify_send` | notify | ntfy.sh (keyless — the topic name is the only secret) |
| `rh_credential_describe` / `rh_credential_set` / `rh_credential_unset` | secrets | `ctx.credentials` (values never echoed) |
| `rh_settings_get` / `rh_settings_set` | secrets | `ctx.settings` (namespace `righthand`) |
| `rh_run` | exec | `ctx.subprocess` (collect mode, bounded output) |
| `rh_run_bg` | exec | `ctx.jobs` + `ctx.subprocess` (background job) |
| (policy) | guard | `ctx.tools` `tools/pre-execute` |

## Configuration

```yaml
# cordis.patch.yml
- insert:
    - id: dsh-righthand
      name: '@try-works/dsh-righthand'
      config:
        rules:
          - toolPrefix: 'rh_'
            mode: 'ask'
            ask: (args) => args?.force === true
```

Guard modes: `allow` (pass through), `deny` (block with an error), `ask`
(defer to the policy function). Omitted rules leave the guard inert.

Rules may also declare `destructive: true` — a documentation flag for
irreversible effects (deploy, delete, DNS change). It does not change
enforcement; it records *why* the prefix is gated, and
`tests/permissions.golden` records every `rh_*` tool's derived guard facts so
guard changes are never silent (run `UPDATE_GOLDEN=1 pnpm test` to
re-baseline deliberately).

## Settings

Namespace "righthand" (registered by the secrets family):

| Key | Default | Meaning |
|---|---|---|
| `accountId` | "" | Cloudflare account id used by righthand Cloudflare tools |
| `defaultScriptPrefix` | "rh-" | default name prefix for generated workers/scripts |
| `defaultZone` | "" | default Cloudflare zone |
| `defaultR2Bucket` | "" | default R2 bucket for `rh_files_*` |
| `defaultNotifyTopic` | "" | default ntfy topic for `rh_notify_send` |

`rh_settings_get` returns the resolved values; `rh_settings_set` merges a
partial patch (persisted by the harness settings provider). Schema wall:
updates with keys the schema does not define are accepted but never come
back from `rh_settings_get` — register new keys in the plugin schema, or
keep ad-hoc knobs in `rh_store`.

## Blueprints

Blueprint guidance lives under `experiments/<blueprint>/` — each a
`blueprint.json` spec plus a runnable template kit (`run.ts` + `test.ts`,
`LEARNINGS.md`, and for the cloud-tested ones a `cloud/` Worker). They
describe the tools this plugin composes; the daily-digest kit is the
canonical example of the current DSH-native form (tool-to-tool via
`ctx.tools.execute`, synthesis via `ctx.llm`, deliverables via `ctx.fs`).

| Blueprint | What it builds |
|---|---|
| `blueprint/daily-digest` | Collect sources, summarize, send on a schedule — extractive locally, LLM synthesis as escalation |
| `blueprint/data-adapter` | Wrap one keyless public API as a tool family: guarded fetch, normalize, one tool per query. Worked examples ship in the plugin: `rh_weather_*`, `rh_places_*` |
| `blueprint/reminder-flow` | The agent as its own scheduler: `rh_events_*` checked each turn, `rh_notify_send` delivery, one store receipt per event — exactly-once via the state flip |
| `blueprint/geo-context` | A place query becomes agent context: geocode, then elevation + weather + air + nearby at those coordinates, TTL-cached in `rh_store` |
| `blueprint/governed-exec` | Every high-impact command as a governed, receipted step: guard gates the prefix, `rh_run` collects, the store keeps the before/after undo trail |
| `blueprint/file-vault` | R2 as the agent's file system with the store as the index: `rh_files_*` blobs + metadata records + time-boxed presigned shares |
| `blueprint/task-triage` | An unstructured inbox becomes a task board: classify + extract + board, oldest-open work loop, failed tasks record why |
| `blueprint/heartbeat` | The uptime pattern generalized: `rh_run` checks, `uptime:*` receipts, success-rate scans, notify once per failure streak |
| `blueprint/agent-notebook` | Durable agent memory: `note:<slug>` records, prefix-scan recall, summarise-as-compaction, extract for structured recall |
| `blueprint/credential-onboarding` | First-run checklist for the user's Cloudflare facts: describe gates, set never echoes, settings pin, one onboarding receipt |
| `blueprint/budget-guard` | Expenses categorized by `rh_text_classify`, window sums by scan, cap in the store (not settings — the schema wall), warn at 80% |
| `blueprint/price-watch` | Watch a product/flight/listing price: keyless adapter fetch, `rh_text_extract` the price, store history + target, notify once per crossing (Hermes product-price-monitor) |
| `blueprint/document-action-plan` | Documents and meetings become plans that act: extract cited obligations, board tasks, schedule deadline reminders, deliver via ntfy (Hermes document/meeting-to-action-items) |
| `blueprint/weekly-review` | The weekly reset: scan done/failed tasks, delivered events and receipts, synthesize, store a chained next-week plan (Hermes weekly-review-planning) |
| `blueprint/pre-commit-gate` | Every change ships through the same gate: lint/typecheck/test/secret-scan via `rh_run`, one receipt per check, guard holds the ship step (Hermes requesting-code-review) |
| `blueprint/blocked-page-recovery` | The escalation ladder when a fetch fails — backoff, browser UA, header fixes, alternate endpoint, browser tools, clean give-up (Hermes blocked-page-recovery) |
| `blueprint/paper-digest` | Keyless arXiv digest: Atom API adapter (live-probed), abstract summarising, rolling store window, diff-by-id (Hermes arxiv) — **cloud-tested**: rh-arxiv.ambiens.workers.dev |
| `blueprint/company-watch` | Watch named companies for material news: keyless sources, extracted mention triples, rolling window, alert on new claims only (Hermes competitor-news-monitor) |
| `blueprint/citation-trail` | Every claim carries its source: extract claim/source/quote triples, store the trail, assert only trailed claims (Hermes grounded-citations) |
| `blueprint/inbox-triage` | Triage any inbox: closed priority labels, extracted asks, follow-up tasks + deadline events, ignore recorded too (Hermes email-inbox-triage) |
| `blueprint/codebase-audit` | Inspect a repo with numbers: metric commands via `rh_run`, per-measure receipts, a shape note, diffable snapshots (Hermes codebase-inspection) |
| `blueprint/dogfood-session` | Exploratory QA of your own app: evidence per finding (steps/expected/actual), severity labels, one session report (Hermes dogfood) |
| `blueprint/debug-loop` | The 4-phase root-cause loop — reproduce, evidence, hypothesize, verify — every phase a receipt (Hermes systematic-debugging) |
| `blueprint/artifact-publish` | Render an artifact, publish to R2, index it, share a presigned link, notify (Hermes claude-design / architecture-diagram / p5js et al) |
| `blueprint/delegate-cli-coder` | Delegate a bounded coding task to a CLI coder: brief, guard-gated invoke, receipts, diff reviewed by the pre-commit gate (Hermes claude-code / codex / opencode) |
| `blueprint/routes-eta` | OSRM keyless routing + places endpoints + ETA reminder events (Hermes maps) |
| `blueprint/video-digest` | yt-dlp transcripts via rh_run, chunked summarising, store digests (Hermes youtube-content) |
| `blueprint/topic-radar` | Many keyless feeds on one topic: extract mentions, dedupe by url, digest (Hermes news) |
| `blueprint/author-watch` | Follow an author's new arXiv papers, diff by id, summarise only the new (Hermes arxiv) |
| `blueprint/market-signals` | Keyless prediction-market odds history + threshold crossing alerts (Hermes prediction-markets) |
| `blueprint/open-data-snapshot` | Keyless civic datasets as diffable snapshots with a change note (Hermes open-data) — **cloud-tested**: rh-quakes.ambiens.workers.dev |
| `blueprint/page-watch` | Hash-diff a page each run, alert once on change with the delta (Hermes web-monitoring) — **cloud-tested**: rh-page-watch.ambiens.workers.dev |
| `blueprint/fx-ledger` | Keyless ECB rates via frankfurter + budget-guard scan-and-sum conversion (Hermes finance) |
| `blueprint/weather-alert` | Forecast thresholds become reminder events at the crossing time (Hermes weather) — **cloud-tested**: rh-weather-alert.ambiens.workers.dev |
| `blueprint/citation-graph` | Claim trails linked into a queryable graph, prefix-scan traversal (Hermes grounded-citations) |
| `blueprint/mail-flow` | Local himalaya CLI mail + the inbox-triage pattern, credentials never in the plugin (Hermes himalaya) |
| `blueprint/obsidian-vault` | The notebook pattern over a real vault: scan, index, recall, compact (Hermes obsidian) |
| `blueprint/habit-tracker` | Streaks as store records with daily cue events and exactly-once delivery (Hermes fitness) |
| `blueprint/meal-planner` | Recipes + extracted ingredients + grocery list + prep reminders (Hermes grocery/recipes) |
| `blueprint/job-tracker` | Applications board with fit labels and follow-up events (Hermes jobs) |
| `blueprint/trip-plan` | Geocode destinations, forecast at dates, itinerary events, briefing note (Hermes travel) |
| `blueprint/draft-queue` | Drafts with a verified tone shift before release via notify/files (Hermes Communication) |
| `blueprint/translate-docs` | Chunked rh_text_translate batches, reassembled and published via files (Hermes Translation) |
| `blueprint/linked-notes` | Interlinked markdown KB with extracted backlinks, prefix-scan traversal (Hermes llm-wiki) |
| `blueprint/device-ping` | Local device heartbeats via rh_run with streak alerts (Hermes Smart Home) |
| `blueprint/gh-flow` | gh CLI steps as receipts, guard ask on push, gate on the diff (Hermes github) |
| `blueprint/red-green-loop` | TDD enforced by red/green receipts, same command every run (Hermes test-driven-development) |
| `blueprint/spike-lab` | Throwaway experiments with a recorded keep-or-throw verdict (Hermes spike) |
| `blueprint/parallel-cleanup` | Fan-out cleanup of independent pieces, gate on the combined diff (Hermes simplify-code) |
| `blueprint/cdp-debug` | Node --inspect in background + CDP over curl, no PTY needed (Hermes node-inspect-debugger) |
| `blueprint/merge-arbiter` | Extract both conflict sides' intents, propose a neutral merge, gate verifies (Hermes merge-arbiter) |
| `blueprint/cli-ops` | Any CLI operated safely: guard ask on mutations, receipts, verify (Hermes antigravity-cli) |
| `blueprint/design-token-lint` | Token spec validation as a gate step with receipts (Hermes design-md) |
| `blueprint/skill-authoring` | Author packaged dsh skills: frontmatter, reference body, ctx.skills, release (Hermes skill-authoring) |
| `blueprint/handoff-review` | Adjudicate task handoffs: verify each outcome against evidence, accept or bounce (Hermes sdlc-review) |
| `blueprint/media-fetch` | Keyless Wikimedia Commons media into R2 with presigned sharing (Hermes gif-search) |
| `blueprint/image-pipeline` | ffmpeg/ImageMagick transforms, exit-0 gate, R2 publish, presigned link (Hermes Media) |
| `blueprint/audio-analysis` | Audio metrics as receipts with a library note (Hermes songsee) |
| `blueprint/video-ascii` | ASCII video renders to R2 with presigned sharing (Hermes ascii-video) |
| `blueprint/manim-render` | Manim renders to R2 with presigned sharing (Hermes manim-video) |
| `blueprint/design-snapshot` | Capture a site's design tokens into dated store snapshots + a reference artifact (Hermes claude-design) |
| `blueprint/office-docs` | pandoc/python-docx pipelines: convert, extract fields, publish (Hermes docx) |
| `blueprint/pdf-pipeline` | PDF extract/OCR/merge via CLI with receipts (Hermes pdf) |
| `blueprint/spreadsheet-tools` | Sheets as diffable snapshots with a change note (Hermes xlsx) |
| `blueprint/deck-pipeline` | python-pptx decks to R2 with presigned sharing (Hermes powerpoint) |
| `blueprint/invoice-tracker` | Extract due dates from invoices, reminder events at the due date (Hermes finance) |
| `blueprint/deploy-journal` | Deploy before/after receipts, smoke checks, revert from the undo trail (Hermes DevOps) |
| `blueprint/env-audit` | Toolchain versions as diffable receipts (Hermes DevOps) |
| `blueprint/dependency-audit` | Audit receipts + notify on high severity, re-audit after fix (Hermes Security) |
| `blueprint/secret-sweep` | Periodic secret scans as receipts, a hit blocks the gate (Hermes Security) |
| `blueprint/style-pass` | Verified tone shifts: classify, rewrite, re-classify, store the pair (Hermes humanizer) |
| `blueprint/health-check-registry` | Named checks as store data run by the heartbeat (Hermes Networking) |
| `blueprint/rss-social-mirror` | Keyless social monitoring via RSS with the 403 ladder (Hermes Social Media) — **cloud-tested**: rh-rss-ladder.ambiens.workers.dev |
| `blueprint/transit-status` | Keyless status feeds as per-line heartbeats (Hermes transit) |
| `blueprint/browser-session-log` | Browsing evidence receipts feeding the weekly review (Hermes browser) |
| (phase 5) `rh_files_*` on R2 | The first family on an actual Cloudflare primitive: S3-compatible API, SigV4 signing pinned to the AWS test vector, credentials from the credential provider |
| `blueprint/research-radar` | Multi-source research over a rolling window (Reddit, X, YouTube, HN, Polymarket, web): score, dedupe, synthesize with citations |
| `blueprint/web-scraper` | Fetch a page, extract title/headings/links/text, make it searchable — static HTML first, render/vision as escalation |
| `blueprint/vision-worker` | Cloudflare Worker exposing kimi-k2.6 vision: route image requests for text-only models, return a versioned `VisionEnvelope` |
| `blueprint/vision-qa-assistant` | Answer questions about images for a text-only model — hash-cache locally, Workers AI vision as the semantic path |
| `blueprint/inbound-webhook-pipeline` | Receive → validate → run job → store → notify, with idempotency-key dedupe as the load-bearing invariant |
| `blueprint/event-sourced-store` | Tool store where every mutation is an event: govern, checksum, append offset-addressable events, catch up by version |
| `blueprint/governed-registry` | Register a tool format; every write runs the governed flow: validate → normalize → checksum → index → summarize |
| `blueprint/mcp-tool-surface` | Deterministic + AI-backed tools behind a stateless MCP surface with normalized LLM output |
| `blueprint/session-watcher` | Poll DSH sessions, evaluate a condition (new publish / builder idle / cadence), message a target session |

Analyses of the [micro.mu](https://github.com/micro/mu) project this plugin
learns from: [`docs/agent-tool-catalog.md`](docs/agent-tool-catalog.md) (tool
families worth adding, from the tools catalogue + permission commit) and
[`docs/mu-repo-analysis.md`](docs/mu-repo-analysis.md) (architecture lessons
from the whole repo — single-source specs, golden permissions, layering,
held-state gates, SSRF guarding).

[`docs/scenario-patterns.md`](docs/scenario-patterns.md) is the guidance
built by actually running the tools: key-prefix conventions, the receipt
pattern, undo trails, the settings schema wall, credential auth gates, and
exec collect-vs-background — each pattern live-verified against the real
harness services.

## Packaged skill

The plugin ships the `dsh-righthand` skill
(`skills/dsh-righthand/SKILL.md`, the dsh-plugin packaged-skill standard):
tool-reference tables, store/credential/settings semantics, guard modes, and
service availability. It registers via `ctx.skills` on mount, so the agent's
skill catalog lists it automatically.

## Use cases

Everything below runs through the harness's own services; nothing is
hand-rolled.

**Durable agent memory / task board.** Store task cards under `task:<slug>`
and let `rh_store_list` enumerate them across restarts and context
compaction — no project files touched. Complete by overwriting, clean up
with `rh_store_delete`.

**Pre-deploy gate.** Before any deploy: `rh_credential_describe` asserts the
API token exists, `rh_settings_get` asserts the account/zone, `rh_run` runs
tests + build, `rh_store_put` records a deploy receipt, and a guard rule
gates the actual deploy tool behind `mode: 'ask'`.

**Secret onboarding.** `rh_credential_set` stores a key through the
credential provider (the value is never echoed back); `rh_credential_describe`
reports configured state + source; rotation is unset-then-set.

**Daily digests.** The agent fetches sources and stores them under
`digest:<date>` (see `blueprint/daily-digest`), diffing days with
`rh_store_get` and rendering MDX deliverables through `ctx.fs`.

**CI-lite.** `rh_run_bg` starts a long build as an owner-scoped background
job; its id + status live in the store so a later turn can poll and collect.

**Governed exec.** Any high-impact command can be fronted by a guard rule
(`deny` to block a prefix, `ask` to require a policy function's approval),
so the agent cannot deploy or destroy without the gate.

## Service availability

The store, task and events families need `ctx.storageDomain`, which the web
profile provides (`storage` + `storage-json` + `storage-domain` rows). In a
profile without it — e.g. the headless bundle — those fourteen tools stay
dormant and the other twenty-three tools (secrets, settings, exec, text,
weather, places, files, notify) still register; the plugin never fails the
boot.

## Development

```bash
pnpm install
pnpm test        # boots the real harness services and executes every tool
pnpm typecheck
pnpm build       # tsc -> lib/ (prepack runs this automatically)
```

## License

Apache-2.0
