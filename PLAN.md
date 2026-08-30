# PLAN — dsh-righthand: turn the research into a working DSH plugin

## 0. What this is

This is the **implementation plan** for `dsh-righthand` — a DSH plugin that lets the agent build, compose, index, and reuse **tools on Cloudflare primitives** (Workers, Durable Objects, Agents, Workflows, etc.).

It is intentionally **thin on rationale**: the full design, decisions, and tradeoffs live in [`RESEARCH.md`](./RESEARCH.md) (35 sections). The **experiments** under [`experiments/`](./experiments/) are the proof-of-work for the local-first half — five blueprints built and run (research-radar, web-scraper, inbound-webhook, daily-digest, vision-qa), each with its own `LEARNINGS.md`.

**Reading order before implementing:**
1. `RESEARCH.md` §4 (verbs), §5 (packages), §7 (milestones) — the build shape.
2. `RESEARCH.md` §15–§17 — the cloud-side memory/registry (the durable core).
3. `RESEARCH.md` §25, §27–§31 — UI, starters, metadata, blueprints.
4. `RESEARCH.md` §35 — the native DSH surface to lean on (and never rebuild).
5. `experiments/*/LEARNINGS.md` — what the local implementations actually hit.

---

## 1. Ground rules (non-negotiable, from the research)

1. **TypeScript-first** (RESEARCH §19.3). All authored artifacts are TypeScript; erasable-only; Python only inside Sandbox containers as third-party tooling.
2. **Proposal ≠ deploy** (RESEARCH §4, §6). `cf_define`/`cf_draft` validate locally and store a draft. `cf_deploy`/`cf_delete` are approval-gated. The plugin never deploys silently.
3. **Deploy paths — REST-API-first** (RESEARCH §18.2, §24, measured surface in §9d). (a) `cloudflare` REST API (OAuth token or `CLOUDFLARE_API_TOKEN`) is the deployable path today; (b) `wrangler` subprocess once installed; (c) `cf` CLI is auth-bootstrap + read-only introspection only (its `cf workers …` verbs are API-IDs, not runnable in v0.0.5). A provider can implement any subset; `cf_status` reports which are live.
4. **`ctx.credentials` is the single auth truth** (RESEARCH §6, §24). Settings carry `accountId`; the token is `credentialRef('CLOUDFLARE_API_TOKEN')`, resolved per operation, never rendered.
5. **Local-first, cloud-optional** (RESEARCH §26, §34). Every starter/blueprint runs locally with zero account; cloud is an escalation, and the escalation point is documented per entity (`local_limits`/`cloud_limits`).
6. **Reuse-before-build** (RESEARCH §27). The gate checks Native (§35) → Primitives → Tools → Blueprints → external inspiration (§19.1 `righthand-inspiration`) before authoring anything new.
7. **Durable memory is the one native gap righthand fills** (RESEARCH §15, §35.5). Tools/history follow the user across workspaces/devices via the Cloudflare registry — not the DSH process.
8. **i18n: English + Chinese, with a toggle.** Every permanent, user-visible string — tool `description`, `parameters.*.description`, `render()` text, error messages, and any future UI slot — must ship both English and Simplified Chinese (zh-CN) and be selected at runtime by a persisted locale. English is the canonical source string; zh is a maintained translation, never a machine fallback. The toggle is a settings value (`righthand.locale: 'en' | 'zh-CN'`) — today it is read/written via `rh_settings_get/set` and there is no UI, so the setting is the toggle's single source of truth; when `ui-righthand` (deliverable #8) lands, it reads and writes the same namespace and renders a visible en/zh switch. All strings go through a `t(key)`-style catalog (i18n module, §4 package layout) — no bare literals in tool bodies or renderers.

---

## 2. Architecture in one paragraph

A thin **DSH plugin** exposes `cf_*` tools to the agent; a **Cloudflare registry** (D1 index + Artifacts source/history + R2 logs + DO state) is the durable, account-scoped memory; **Cloudflare primitives** are the execution substrate; and **DSH Code Mode** (`run_code`) is the agent's local programming surface. The agent authors a `spec` (schema + entry code), the plugin validates/bundles/deploys it, and the registry makes it forkable, searchable, and reusable from any device.

Full diagram: RESEARCH §17.

---

## 3. Deliverables (what \"done\" means)

| # | Deliverable | Where specified |
|---|---|---|
| 1 | `ctx.righthand` service seam + `righthand-local` provider | RESEARCH §5 (packages 1–2) |
| 2 | `tool-righthand` — the `cf_*` model-facing tools | RESEARCH §4, §5 (package 3) |
| 3 | Cloudflare registry (D1 + Artifacts + R2 + DO) | RESEARCH §15–§16 |
| 4 | Starter kit (~10 substrate primitives + capability tier) | RESEARCH §27.4, §28–§29 |
| 5 | Blueprints (web-scraper, webhook, daily-digest, vision-qa, research-radar) with template kits | RESEARCH §31, §32 + `experiments/` |
| 6 | Metadata index (keywords/use_cases/capabilities → Vectorize) | RESEARCH §30 |
| 7 | Native surface + recommended-plugins index in the registry | RESEARCH §35 |
| 8 | UI (registry browser: Native | Primitives | Tools | Blueprints + settings/domain picker) | RESEARCH §25 |
| 9 | Vendored Cloudflare skills + `righthand-*` guidance skills | RESEARCH §18, §19 |
| 10 | Approval/policy + background jobs + progress/telemetry | RESEARCH §6, §25 |

---

## 4. Package layout (mirrors RESEARCH §5, expanded)

```
packages/righthand/
  righthand/                    # ctx.righthand service definition (seam + verbs)
  righthand-local/              # provider: subprocess + wrangler + esbuild + local dev
  righthand-registry/           # D1 index + Artifacts client + R2 logs + DO state
  righthand-sdk/                # cloudflare npm SDK wrapper (control plane)
  righthand-wrangler/           # wrangler subprocess provider (deploy/delete/dev)
  righthand-cfcli/              # cf CLI provider: auth bootstrap + read-only introspection (future workers verbs)
  tool-righthand/               # cf_* model tools + catalog + live registration
  tool-righthand-starters/      # the starter primitives + template kits
  tool-righthand-blueprints/    # blueprint specs + template kits + LEARNINGS
  subagent-righthand-agents/    # Cloudflare Agents -> subagents (tier 3)
  tool-righthand-workflows/     # Workflow/Queue/Cron verbs (tier 3)
  ui-righthand/                 # slots + settings + registry browser (client)
```

Repo wiring follows `adding-a-package.md` (RESEARCH §5): `package.json` invariants, `tsconfig.json`, `src/index.ts`, `README.md` with Model Experience + Known Limitations; register each in `tsconfig.host.json` references; add `./packages/righthand/*/src` to `tsconfig.base.json`.

---

## 5. The tool surface (verbs, RESEARCH §4 + §12 + §19.2 + §27.7)

**Core verbs (tier 1 — always shipped):**

| Verb | Purpose | Approval |
|---|---|---|
| `cf_define` | validate + store a draft (name/kind/description/schema/entryCode) | none (local) |
| `cf_draft` | Mode B: prompt → toolsmith/Workers AI → proposal | none (proposal) |
| `cf_deploy` | bundle + deploy; background job | **approval-gated** |
| `cf_invoke` | call a deployed tool, parse canonical result | none (read/call) |
| `cf_describe` | list/inspect catalog + logs + versions | none (read) |
| `cf_delete` | remove script + registry row + unregister | **approval-gated** |
| `cf_status` | auth/account/quota/plugin health + recommended-plugin presence | none (read) |

**Registry + reuse verbs (tier 2 — search, versioning, instantiation):**

| Verb | Purpose |
|---|---|
| `cf_search` | metadata/semantic search across native/primitives/tools/blueprints |
| `cf_suggest` | gate verdict + recommended starter/blueprint + why (pre-checks Native, RESEARCH §35.4) |
| `cf_fork` / `cf_edit` / `cf_promote` / `cf_rollback` | version graph (RESEARCH §16) |
| `cf_instantiate` | blueprint → generated composed tool + tests (RESEARCH §31.2) |
| `cf_blueprint --expand` / `--list` | read/expand blueprints without deploying |
| `cf_advise` | toolsmith consult for primitive selection (RESEARCH §19.2) |

**Workflow verbs (tier 3 — async/orchestration):** `cf_schedule`, `cf_trigger_workflow`, `cf_enqueue`.

Every verb has `presentCall`/`presentResult` cards (RESEARCH §25.1) and a `tools/pre-execute` policy hook for the gated ones (RESEARCH §6.1).

---

## 6. Milestones (expanded from RESEARCH §7)

### M0 — Skeleton + local validation (no account)

- [ ] `ctx.righthand` seam + `righthand-local` provider with **mocked** subprocess/wrangler.
- [ ] `cf_define` local validation (TS syntax, schema shape, manifest shape) + `ctx.storage` draft persistence.
- [ ] Unit tests green with zero Cloudflare account.
- **Proven by:** the experiments already showed the local path works (`experiments/*/run*.ts` run with no account/installs).

### M1 — Worker round-trip (real deploy)

- [ ] `cf_deploy` (SDK-first) + `cf_invoke` + `cf_describe` + `cf_delete` against a real `workers.dev` script.
- [ ] `ctx.credentials` token resolution + `cf_status` auth/account read.
- [ ] Background deploy via `ctx.jobs`.
- **Gate:** approval on deploy/delete (RESEARCH §6.1).

### M2 — Registry + durability (the durable core)

- [ ] `righthand-registry`: D1 index + Artifacts source/history + R2 logs.
- [ ] Fork/edit/promote/rollback + lineage (RESEARCH §16).
- [ ] Self-documenting `TOOL.md` regenerated on every mutation (RESEARCH §20).

### M3 — Starters + blueprints + template kits

- [ ] Starter kit (§27.4) + capability tier (§28–§29) each with a **runnable template kit** (`entry.ts`+`schema.ts`+`test.ts`+`README`, RESEARCH §31.8).
- [ ] Blueprints (web-scraper, webhook, daily-digest, vision-qa) with `run.ts`+`test.ts`+`LEARNINGS.md` (the experiments' files become the shipped kits).
- [ ] `cf_instantiate` + `cf_blueprint --expand`. `research-radar` (RESEARCH §32) is the flagship blueprint.

### M4 — Metadata + native index + UI

- [ ] §30 metadata (keywords/use_cases/capabilities) → Vectorize + D1 fallback.
- [ ] Native surface (§35) + recommended-plugins (§35.3a) index in the registry.
- [ ] UI: settings (domain picker + auth status) + registry browser with **Native | Primitives | Tools | Blueprints** tabs + tool detail + runs (RESEARCH §25).
- [ ] `righthand-*` skills shipped (§19.1), incl. `righthand-inspiration` (Hermes + source repo + Cloudflare skills as research reference).

### M5 — Durable Object kind

- [ ] DO (SQLite) template + `cf_invoke` over a stubbed DO route + migration handling (RESEARCH §6.4, append-only).

### M6 — Cloudflare Agents + Workflows

- [ ] Agents SDK kind as a *tool*, then as a `ctx.subagents` provider (RESEARCH §5 package 4).
- [ ] Workflows/Queues/Cron verbs (RESEARCH §5 package 5).
- [ ] REST provider variant + progressive-disclosure polish (`ctx.tools.restrict()`).

### M7 — Sharing + hub (future, RESEARCH §22)

- [ ] Grants/quotas + shared-with-me + hub surface (deferred; the registry is already multi-tenant-ready).

---

## 7. What the experiments already proved (and where the code lives)

| Experiment | Proved | Ship as |
|---|---|---|
| `experiments/research-radar/` | multi-source keyless research pipeline (HN/Reddit-RSS/GitHub/arXiv/Google News RSS/Polymarket), entity grounding, relevance-first scoring, Jaccard dedupe, grounded synthesis | blueprint `research-radar` (§32) + template kit `run3.ts`/`run4.ts` |
| `experiments/blueprint-web-scraper/` | fetch → extract → keyed-index → search; politeness/robots gap; selector brittleness | blueprint `web-scraper` (§31.3) |
| `experiments/blueprint-inbound-webhook/` | validate → idempotency dedupe → store → notify; idempotency key is the invariant | blueprint `inbound-webhook-pipeline` (§31.3) |
| `experiments/blueprint-daily-digest/` | gather → extractive summarize → emit; extractive ≠ synthesis; HN selector stale | blueprint `daily-digest` (§31.3) |
| `experiments/blueprint-vision-qa/` | file → hash → cache/recall; no semantic vision locally; vision vs recall are separate escalations | blueprint `vision-qa-assistant` (§31.3) |

Each experiment's `LEARNINGS.md` records build/run/after learnings **and** the per-implementation `local_limits`/`cloud_limits` — those two lists become the shipped template-kit header comments (RESEARCH §31.8).

---

## 8. Test strategy (the experiments set the bar)

1. **Every blueprint ships tests** (RESEARCH §32.6): grounding/alias unit cases, adapter contract tests, dedupe/scoring assertions, and a local end-to-end run. `cf_instantiate` emits the same tests.
2. **Template kits are executable in CI with zero account** — a template that doesn't run locally is a doc, not a template (RESEARCH §31.8 rule 1).
3. **Cloud tests are approval-gated and use a throwaway account/zone**; `cf_delete` is always exercised in the same suite that `cf_deploy`s.
4. **Verification checklist** (RESEARCH §32.7) applies to `research-radar`: no off-entity item passes grounding, narrative splits flagged, citations resolve.
5. **Regression:** the five experiment folders stay under `experiments/` as disposable fixtures; deleting them must not affect the shipped package.

---

## 9. Definition of done (per milestone)

Each milestone closes when:
- [ ] its verbs/tools are registered and model-callable (Code Mode: `tools.<name>(args)`),
- [ ] its entities ship a runnable TypeScript template kit + tests, local-first, zero account,
- [ ] gated verbs go through the shared approval hook (`tools/pre-execute`),
- [ ] every authored entity carries `local_limits`/`cloud_limits` + §30 metadata,
- [ ] `LEARNINGS.md` (or a run-log) records build/run/after learnings for anything non-trivial,
- [ ] the registry browser surfaces it (Native | Primitives | Tools | Blueprints) with search.

---

## 9a. DSH/Cordis best practices (non-negotiable implementation discipline)

Every package must follow the harness idioms verified in `D:\deepseek-harness`; a PR that ignores these is not done even if it works.

1. **Plugin shape** (RESEARCH §1): `export const name`, `export const inject`, `export function apply(ctx)` — **no default export**. Services register through `ctx.provide`/`ctx.accessor`; effects through `ctx.effect` so teardown is tied to the fiber and HMR-safe.
2. **Lifecycle discipline**: every resource (live tool registration, provider, listener, timer, job handle) is returned from `ctx.effect` (or registered through a `Service`), never leaked. Mirror `tool-cordis`: it registers each tool + provider inside `apply(ctx)` with effect-scoped cleanup.
3. **Approval, not ad-hoc**: deploy/delete use the `tools/pre-execute` waterfall returning `{ kind: 'ask' | 'allow' | 'deny' }`, plus `ctx.tools.guard()` for the monotonic deny (verified API: `guard(guard: ToolGuard): () => void`, synchronous, returns a string to deny). Never bake policy into the tool body.
4. **Canonical errors**: tool failures return the DSH `isError` shape with a model-feedable message (not a raw stack). Map Cloudflare 401/403/404/429/>=500 and DO 1101-style runtime errors to it (RESEARCH §6.5).
5. **Trust stance (README, à la tool-cordis)**: DSH sandboxes *harness-side* operations; the deployed Worker is a **separate trust domain the user owns**. State this explicitly — never imply the plugin sandboxes authored tool code.
6. **Provider seam**: `ctx.righthand` is the interface; `righthand-local` is one provider; `righthand-sdk` is the other. Providers are **swappable** behind the same seam (`ctx.inject` the seam, register the provider in the app bundle) — no provider-specific types leak into `tool-righthand`.
7. **Progressive disclosure**: per-tool registration grows the prompt; use `ctx.tools.restrict()` + tool-search from day one (not bolted on later). Keep `cf_define`'s own schema tight (RESEARCH §6.6).
8. **Deterministic builds**: pin wrangler/esbuild + `compatibility_date`; store generated manifest + entry so deploy/delete are replayable/idempotent (RESEARCH §6.3).
## 9b. Concrete specifications (the parts the sketch left abstract)

### Settings namespace `righthand` (via `@deepseek-ai/schemastery` Config, RESEARCH §5)

```
accountId: string                # Cloudflare account for deploys (no secret)
apiTokenRef: credentialRef       # -> CLOUDFLARE_API_TOKEN (single truth, §1 rule 4)
defaultZoneId?: string           # optional workers.dev / custom domain target
allowDeploy: boolean             # false => cf_deploy/cf_delete hard-denied
allowDelete: boolean             # independent kill-switch for teardown
allowDynamicWorkflows: boolean   # beta gate (RESEARCH §14.6 step 5)
region?: string                  # e.g. 'auto' or 'eeur' for DO placement
templateKitBase?: string         # where local template kits unpack (default: workspace .righthand/)
```

### Registry D1 schema sketch (RESEARCH §15.2, the authoritative index)

```sql
tools(id TEXT PK, name TEXT, kind TEXT, status TEXT, schema_json TEXT, entry_code TEXT,
      manifest_json TEXT, deploy_version_id TEXT, invoke_target TEXT,
      domain TEXT, tag TEXT, version INT, owner TEXT, created_at INT, updated_at INT);
versions(tool_id TEXT, version INT, manifest_json TEXT, entry_code TEXT, created_at INT,
         PRIMARY KEY(tool_id, version));
runs(id INTEGER PK, tool_id TEXT, caller TEXT, status TEXT, started_at INT, duration_ms INT,
     input_digest TEXT, output_digest TEXT, error TEXT, r2_log_key TEXT);
lineage(tool_id TEXT PK, forks_from TEXT, blueprint TEXT, ingredients_json TEXT);
metadata(entity_id TEXT PK, kind TEXT, keywords_json TEXT, use_cases_json TEXT,
         capabilities_json TEXT, embedding_updated_at INT);
```

(Full index/history/home table: RESEARCH §16.4. Artifacts hold source + version graph; R2 holds logs; DO holds per-tool state.)

### Per-milestone acceptance criteria (the M-ladder, gated)

| Milestone | Closes only when |
|---|---|
| M0 | `cf_define` validates + persists a draft with **zero network**; mocked wrangler tests green; `ctx.righthand` seam has no provider-specific imports |
| M1 | a real `workers.dev` script is define→deploy→invoke→delete'd end-to-end; `cf_delete` exercised in the same suite; deploy/delete return `ask` without `allowDeploy` |
| M2 | the D1 index + Artifacts + R2 store a full round-trip; fork/edit/promote/rollback produce a verifiable lineage; `TOOL.md` regenerates on every mutation |
| M3 | every starter/blueprint ships a **runnable** template kit (local, zero account) + tests; the five experiment folders' code is promoted, not rewritten |
| M4 | metadata search returns the right entity across all four tabs; native + recommended-plugin index refreshes from `cordis_inspect_query`; UI R1–R3 land |
| M5 | a DO tool deploys with a `new_sqlite_classes` migration and `cf_invoke` reads/writes state across two calls |
| M6 | an Agent deploys and answers via `routeAgent`/`callable`; a Workflow instance is created, polled, and completes; Queue/Cron verbs fire |
| M7 | a grant lets a second identity list+invoke (not mutate) a shared tool; revoke takes effect |

## 9c. Practical DSH-plugin build mechanics (reference repos)

Two working DSH plugins are the concrete references for every step below. **Do not guess the wiring — copy it from these.**

| Repo | What it demonstrates | Copy this for dsh-righthand |
|---|---|---|
| `D:\DEV\dsh-cloudflare` | skills + slash commands + MCP bundle (Codex parity) | `plugin.json` manifest shape, `cordis.patch.yml`, `src/index.ts` (`name/inject/apply`), skill provider (`src/skills.ts`), slash commands (`src/commands.ts`), `files` + `peerDependencies` |
| `D:\DEV\dsh-paper-design` | MCP bridge → native `paper_*` tools, schema normalization, attachments, prompt sections, OAuth | `ctx.tools.register` with `output.schema`+`render`, `ctx.effect(async function* () {...})` lifecycle, `assertSupportedJsonSchema` normalization, `ctx.logger`, `exec.signal`/`exec.deferContext`, `file:` devDeps wiring |

### 9c.1 The plugin entry (canonical shape, from both repos)

```ts
// src/index.ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-tools'      // activates ctx.tools augmentation
import type {} from '@deepseek-ai/dsh-commands'    // activates ctx.commands augmentation
import type {} from '@deepseek-ai/dsh-skill'       // activates ctx.skills augmentation
import type {} from '@deepseek-ai/dsh-settings'    // activates ctx.settings augmentation

export const name = 'dsh-righthand'
export const inject = ['tools', 'skills', 'commands', 'settings', 'credentials', 'storage', 'jobs']

export function apply(ctx: Context): void {
  // 1) tool registration lives in an effect so teardown is fiber-scoped
  ctx.effect(async function* () {
    yield ctx.tools.register(defineTool({ /* cf_define */ }))
    yield ctx.tools.register(defineTool({ /* cf_deploy */ }))
    // ... every cf_* verb
  })

  // 2) settings namespace + skill provider + slash commands (mirror the repos)
  ctx.plugin(settingsNamespace)   // Config via @deepseek-ai/schemastery
  ctx.plugin(righthandSkills)     // righthand-* skills (§19)
  ctx.plugin(righthandCommands)   // /righthand, /rh status
}
```

### 9c.2 Registering a model tool (from paper-design `src/index.ts`)

```ts
const tool = defineTool({
  name: 'cf_define',
  description: 'Validate + store a tool draft. No deploy.',
  parameters: { type: 'object', properties: { name: {type:'string'}, kind: {type:'string'}, /* ... */ }, required: ['name','kind'] },
  output: {
    schema: { type: 'object', properties: { toolId: {type:'string'} }, additionalProperties: false },
    render: (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }],
  },
  async execute(args, exec) {
    // canonical error shape; exec.signal for cancellation
    const result = await doDefine(args, exec.signal)
    return result;
  },
});
```

Key discipline from paper-design: normalize any inbound schema through `assertSupportedJsonSchema` **before** registering (the harness rejects `format/pattern/minLength/maxLength/minimum/maximum/minItems` and does not support `anyOf`); coerce raw args to a plain record in `execute`; use `exec.deferContext` when a result carries image/rich content that must reach the parent agent.

### 9c.3 The bundle manifest (`plugin.json` + `cordis.patch.yml`)

From `dsh-cloudflare`, the repo ships:

- `plugin.json` — name/version/description/author/license/keywords + `interface` (displayName, category, capabilities, defaultPrompt) + `skills`/`mcpServers` paths. dsh-righthand adds `tools` (its starters) and `blueprints` paths.
- `cordis.patch.yml` — the insertion patch that mounts the plugin over the profile root, using a `cordis:group` realm so the bundle can compose without service collisions. dsh-righthand ships its own patch: a `righthand` group that mounts `@try-works/dsh-righthand/src/index.ts` + the provider (`righthand-local` or `righthand-sdk`).

### 9c.4 Local dev wiring (the paper-design `devDependencies` trick)

To develop against the harness checkout without publishing, point `devDependencies` at `file:` paths into `D:\deepseek-harness` (exactly as `dsh-paper-design/package.json` does):

```json
"devDependencies": {
  "@deepseek-ai/cordis": "file:D:/deepseek-harness/vendor/cordis",
  "@deepseek-ai/dsh-tools": "file:D:/deepseek-harness/packages/core/tools",
  "@deepseek-ai/dsh-skill": "file:D:/deepseek-harness/packages/skill/skill",
  "@deepseek-ai/dsh-commands": "file:D:/deepseek-harness/packages/interaction/commands",
  "@deepseek-ai/dsh-credentials": "file:D:/deepseek-harness/packages/credentials/credentials",
  "@deepseek-ai/dsh-settings": "file:D:/deepseek-harness/packages/settings/settings",
  "@deepseek-ai/dsh-storage": "file:D:/deepseek-harness/packages/storage/storage",
  "@deepseek-ai/dsh-jobs": "file:D:/deepseek-harness/packages/jobs/jobs"
}
```

(`peerDependencies` stay semver ranges as in `dsh-cloudflare`; only `devDependencies` use `file:` for local typechecking/running. Verify the exact package paths against `D:\deepseek-harness` — the paper repo's list is the reference, not a promise.)

### 9c.5 The build/test loop

```
pnpm install            # resolves file: devDeps into the harness checkout
pnpm typecheck          # tsc --noEmit over src/ + tests/ (paper-design uses this)
pnpm vitest             # unit tests (mock subprocess/wrangler — M0 needs no account)
pnpm build              # bundle for the plugin (follow dsh-cloudflare's scripts)
```

Then mount in the harness the same way the reference repos are mounted (their `cordis.patch.yml` + `plugin.json` describe the install shape): `dsh plugin add <path-or-url>` or the profile patch, then restart the GUI and verify `/righthand` + `cf_status` appear.

### 9c.6 Acceptance for this section (what "practically buildable" means)

- [ ] `src/index.ts` compiles against the harness `file:` devDeps with zero type errors.
- [ ] `plugin.json` + `cordis.patch.yml` present and valid (copy shape from dsh-cloudflare; copy `cordis:group` realm from paper-design).
- [ ] `cf_status` registers, runs, and reports (local-only, no account) — the first milestone gate.
- [ ] `vitest` unit tests pass for the M0 verbs with mocked subprocess/wrangler.

## 9d. Deploy paths — what actually works (measured, not assumed)

Probed in this workspace across cf **v0.0.5 → v0.6.0** (the user updated the CLI mid-test). Findings are version-tagged because the surface changed.

| Claim | v0.0.5 reality | v0.6.0 reality |
|---|---|---|
| `cf workers scripts list` | ❌ `Unknown arguments: workers, scripts, list` (only 10 read-only groups) | ✅ recognized as a verb, but `No authentication token found` — the workers verbs exist, auth is the blocker |
| `cf schema --list` lists `cf workers …` | ✅ API operation IDs only | ✅ same, plus `cf agent-context workers` emits the full runnable Workers surface |
| `cf auth login --force` | ✅ OAuth works, token to `~/.cf/config.toml` | ❌ built-in OAuth **callback listener times out** on `localhost:8877` (broken twice) — needs the self-hosted PKCE fallback (§9e.4) |
| `cf accounts/dns/zones` | ✅ runnable | ✅ runnable (verified `cf zones list`, `cf dns records list`) |
| credential storage | `~/.cf/config.toml` | Wrangler-style `<configDir>/config/default.toml` (keyring-first, plaintext fallback) — **not** the old file |

**Therefore the deployable control planes are:**

1. **`cloudflare` REST API driven directly** (the real path today) — OAuth token from `~/.cf/config.toml` (or `CLOUDFLARE_API_TOKEN`) against `PUT /accounts/{id}/workers/scripts/{name}/content` + `POST …/deployments`. The `cf schema` output gives the exact REST shapes. This is what the `righthand-sdk` provider wraps.
2. **`wrangler`** — the only CLI that actually deploys Workers today. Needs npm install (was blocked by sandbox EPERM; now unblocked with full access) or a pre-existing global install.
3. **`cf` CLI** — v0.6.0 *has* the workers verbs but its OAuth callback is broken; once auth lands (self-hosted PKCE), it becomes a full deploy path. Until then: auth bootstrap + read-only introspection.

**Provider mapping (corrected):**

| Provider package | Backing path | Status today |
|---|---|---|
| `righthand-sdk` | `cloudflare` REST API (OAuth token or API token) | ✅ deployable now |
| `righthand-wrangler` | wrangler subprocess | ✅ once installed (npm/g globals) |
| `righthand-cfcli` | `cf` CLI subprocess | ⚠️ workers verbs exist in v0.6.0 but auth callback broken → ship PKCE + keep as soon-ready seam |

**Implication for the plan:** drop the assumption that `cf` CLI deploys; treat `cf_status`'s deploy-path report as: SDK REST reachable → wrangler present → cf CLI workers-ready (future). The REST-API-first provider is the unblocked, token-transparent path that satisfies §1 rule 3's `ctx.credentials` single-truth (the OAuth token is read from disk once and held in memory, never rendered; an API token is preferred long-term).

### Deploy mechanics (REST-API path, to be coded into `righthand-sdk`)

```
# 1. upload bundle (module format: index.js + manifest metadata)
PUT /accounts/{account_id}/workers/scripts/{script_name}/content

# 2. promote to production
POST /accounts/{account_id}/workers/scripts/{script_name}/deployments  # ?force=true to skip queued-versions gate

# 3. invoke
GET https://{script_name}.{account_subdomain}.workers.dev/...   # or a test.<zone> route

# 4. teardown
DELETE /accounts/{account_id}/workers/scripts/{script_name}     # ?force=true
```

The `cf schema workers scripts content-update` / `deployments-create` / `get` / `list` / `delete` / `search` outputs document the exact REST paths and params for these verbs — use them as the source of truth for the SDK provider, not the non-runnable CLI spelling.

## 9e. Cloudflare Code Mode MCP — instructions for the installing agent

**Audience:** the DSH agent that installs `dsh-righthand` (and any agent using it). The plugin ships the official Cloudflare MCP server so the agent can drive 2,500+ Cloudflare endpoints programmatically instead of shelling out to `wrangler` for everything. This section is the exact usage contract, measured against the live endpoint `https://mcp.cloudflare.com/mcp`.

### 9e.1 What the MCP is

| Item | Value |
|---|---|
| Endpoint | `https://mcp.cloudflare.com/mcp` (Streamable HTTP, protocol `2024-11-05`) |
| Identity | `cloudflare-api` v0.1.0 (verified via `initialize`) |
| Tools | `docs` (search Cloudflare documentation), `search` (query the pre-resolved OpenAPI spec), `execute` (run async JS against the Cloudflare API) |
| Auth | OAuth bearer token (from `cf auth login` or `wrangler login`), or `CLOUDFLARE_API_TOKEN`; the `execute` tool pre-sets `accountId` |
| Transport | POST `{jsonrpc:'2.0', id, method, params}` with `Accept: application/json, text/event-stream`; session tracked via `mcp-session-id` response header |
| Manifest | the `dsh-cloudflare` plugin ships `.mcp.json` with `cloudflare-api` at this URL; DSH mounts it as one `@deepseek-ai/dsh-mcp-client` instance |

### 9e.2 The three tools (and when to use each)

| Tool | Input | Use when |
|---|---|---|
| `docs` | `query` (string) | you need *current* docs/limits/pricing before writing code |
| `search` | `code` (async arrow fn, `spec` global) | you need the **exact REST path/params/requestBody** for an endpoint (e.g. multipart upload contract) |
| `execute` | `code` (async arrow fn, `cloudflare.request()` + `accountId` global) | you need to **call** the API — list/create/update/delete resources |

**Critical contract for `execute`** (verified in this workspace):

```ts
// available globals inside execute()'s code:
declare const cloudflare: {
  request<T>(opts: { method: 'GET'|'POST'|'PUT'|'PATCH'|'DELETE'; path: string;
    query?: Record<string, string|number|boolean|undefined>; body?: unknown;
    contentType?: string; rawBody?: boolean }): Promise<{
    success: boolean; status: number; result: T; errors: {code:number;message:string}[];
    messages: {code:number;message:string}[]; result_info?: {...} }>;
};
declare const accountId: string;  // pre-set to the authed account
// your code must be: async () => { ... return cloudflare.request({...}) }
// JSON bodies: pass body as an OBJECT + contentType:'application/json'
//   (passing JSON.stringify(...) as body returns error 9207 'Request body is invalid')
// multipart: body is the raw string + contentType:'multipart/form-data; boundary=...' + rawBody:true
```

**The one gotcha that wastes the most time** — uploading a Worker script is **multipart/form-data**, not a bare body (verified: sending a bare JS body returns `10021 SyntaxError`). The contract from `search`:

```
PUT /accounts/{account_id}/workers/scripts/{script_name}/content
  Content-Type: multipart/form-data; boundary=----B
  part "metadata" (application/json): { "main_module": "worker.js" }  // module syntax
                                      //  or { "body_part": "worker.js" } // service-worker syntax
  part "files" (application/javascript+module, filename "worker.js"): <the ES module source>
// then promote:
POST /accounts/{account_id}/workers/scripts/{script_name}/deployments   // ?force=true
```

### 9e.3 The minimal MCP client (what `righthand-sdk` wraps)

The plugin must ship a client that mirrors `dsh-paper-design/src/mcp-client.ts` (minimal Streamable HTTP subset: `initialize` → `tools/list` → `tools/call`), because the official endpoint returns **SSE** for `tools/call` (the result is a `data:` line inside an `event:` stream, not plain JSON). The pattern that works:

```ts
async function rpc(method: string, params?: unknown) {
  const res = await fetch(MCP_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json',
               'accept': 'application/json, text/event-stream',
               'authorization': 'Bearer ' + token,  // token resolved per-op via credentialRef
               ...(sessionId ? { 'mcp-session-id': sessionId } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }) });
  const sid = res.headers.get('mcp-session-id'); if (sid) sessionId = sid;
  const text = await res.text();
  if (text.startsWith('event:')) {  // SSE: parse the data: line
    const dataLine = text.split(/\r?\n/).find(l => l.startsWith('data:'));
    return JSON.parse(dataLine.slice(5).trim());
  }
  return JSON.parse(text);
}
```

### 9e.4 Auth story (the part that bites)

1. **API token is the long-term answer** (rotation-safe, `credentialRef('CLOUDFLARE_API_TOKEN')`, never rendered). Scopes needed: `Workers Scripts:Edit` (or the broader `Workers R2/KV/D1` edit scopes for the full registry).
2. **OAuth is the bootstrap** — `cf auth login` or `wrangler login`. Measured gotchas in this workspace:
   - The **cf CLI's own OAuth callback listener was broken** (timed out on `localhost:8877` twice, across v0.0.5 *and* v0.6.0). A **self-hosted PKCE flow** (bind `127.0.0.1:8877`, catch the code, exchange at `https://dash.cloudflare.com/oauth2/token`, write `access_token`/`refresh_token`/`expires_at`/`scopes`) is the reliable fallback — ship it as a plugin utility.
   - `wrangler`'s token works for `wrangler deploy` but **not** for direct REST calls (OAuth grants are client-scoped); the MCP's `execute` tool, however, accepts the token via `Authorization: Bearer` (verified: `initialize` + `tools/list` succeed).
   - cf v0.6.0 stores credentials Wrangler-style (`<configDir>/config/default.toml`, keyring-first with plaintext fallback), **not** the v0.0.5 `~/.cf/config.toml`. The plugin must read **both** locations.
   - **The OAuth token expires in 1h** (`expires_in: 3600`); the MCP returns `insufficient_scope` when it's actually just *expired*. Refresh it non-interactively with the `refresh_token` grant at `https://dash.cloudflare.com/oauth2/token` (`grant_type=refresh_token&refresh_token=...&client_id=cbca97e7-...`), then rewrite the config file. Ship this as a `cf_refresh` utility — the agent must never re-auth interactively just because the hour elapsed.
3. **`cf_status` must report which path is live** — REST reachable → MCP reachable → wrangler present → cf CLI workers-ready — so the agent never guesses.

### 9e.5 Canonical agent workflow (what the installing agent actually does)

```
1. Auth check          cf_status / cf auth whoami  → token? accountId? scopes?
2. Find the endpoint   MCP search:  spec.paths['/accounts/{account_id}/workers/scripts/{n}/content'].put
3. Read current docs   MCP docs:  "workers script upload module format"
4. Upload the script   MCP execute: multipart PUT …/content  (metadata.main_module + files part)
5. Promote             MCP execute: POST …/deployments?force=true
6. Verify              curl https://{name}.{account}.workers.dev/… (or the test.<zone> route)
7. Register/teardown   cf_delete → MCP execute: DELETE …/scripts/{name}?force=true
```

**This is the exact loop the five blueprint cloud-tests exercise** — each `experiments/<blueprint>/` folder gets a `cloud/deploy.mjs` that runs steps 1–7 against the MCP, plus a `LEARNINGS.md` recording what the cloud path added/changed vs the local run.

### 9e.6 Acceptance for this section

- [ ] `righthand-sdk` calls `initialize` + `tools/list` + `tools/call(execute)` against `https://mcp.cloudflare.com/mcp` with zero hardcoded secrets (token via `credentialRef`).
- [ ] The multipart `content` upload + `deployments` promote is exercised end-to-end in a test (proven contract above).
- [ ] The PKCE self-host fallback is shipped and tested (cf CLI callback was the real blocker).
- [ ] `cf_status` reports all four paths and the agent-facing docs (README/`TOOL.md`) contain this exact §9e walkthrough.

## 10. Order of attack (recommended)

1. **M0 → M1** (skeleton + Worker round-trip): the smallest thing that proves the plugin can define→deploy→invoke→delete a tool.
2. **M2** (registry): durability is the differentiator — do it before breadth.
3. **M3** (starters + blueprints): ship the already-proven experiments as template kits, not new code.
4. **M4** (metadata + native index + UI): make reuse visible.
5. **M5/M6** (DO, Agents, Workflows): substrate breadth after the core loop is solid — DO first, then Agents, then Workflows (RESEARCH §14.6 order).
6. **M7** (sharing): last; the registry is already shaped for it.

---

## 11. References

- Background + full design: [`RESEARCH.md`](./RESEARCH.md)
- Diagrams: [`DIAGRAMS.md`](./DIAGRAMS.md)
- Experiments + learnings: [`experiments/`](./experiments/) (5 blueprint folders, each with `LEARNINGS.md`)
- Source repo studied: <https://github.com/mvanhorn/last30days-skill/>
- Inspiration reference (research only, not to install): <https://hermes-agent.nousresearch.com/docs/skills/>
- DSH harness checkout: `D:\deepseek-harness` (patterns to copy: `tool-cordis`, `tool-bash`, `jobs`, `credentials`, `storage`, `subagent`)