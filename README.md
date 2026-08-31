# @try-works/dsh-righthand

A DeepSeek Harness plugin providing DSH-native **righthand tools** — a durable
KV store, credential/settings management, governed command execution, and a
tool guard. Every tool is built on the harness's own services
(`storageDomain`, `credentials`, `settings`, `subprocess`, `jobs`, `tools`),
not hand-rolled primitives.

The plugin also ships **blueprint guidance** — ten named recipes for the agent-built tools this plugin exists to compose (see [Blueprints](#blueprints) below) — plus a packaged skill, a settings namespace, and an optional tool guard.

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
