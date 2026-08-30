# RESEARCH.md — dsh-righthand

**Plugin name:** `dsh-righthand` (npm scope `@deepseek-ai/dsh-righthand`), matching this workspace folder.
**Goal:** a DeepSeek Harness (DSH) plugin where the agent itself builds *reusable tools* that run on Cloudflare primitives — Workers, Durable Objects, Agents, and so on. The agent authors tool code in-session, and the harness turns that into a durable, callable tool backed by Cloudflare.

**Status:** research complete. This document is the findings + a concrete, grounded implementation plan. No plugin code has been written yet.

---

## 0. Short answer

This is achievable, and DSH has already solved the hard *in-process* half of the problem. The closest in-repo precedent is **`packages/extensions/tool-cordis`** — "the self-referential Cordis toolset": the model *defines* a package, *runs* it, *stops* it, and *undefines* it, all through a small set of model-facing tools (`cordis_define`, `cordis_run`, `cordis_stop`, `cordis_undefine`, `cordis_inspect`).

The Cloudflare plugin is the same shape with one change of substrate:

- **tool-cordis** evaluates model code in a Node `vm` sandbox inside the DSH process (ephemeral, process-local, no real isolation).
- **dsh-righthand** evaluates/model-checks model code locally, then **deploys it to Cloudflare** (durable, real isolation, real persistence), and registers a callable stub tool that invokes the deployed thing.

The recommended architecture is a plugin *family* (matching DSH's "seam + provider + consumer" convention):

```
packages/righthand/
  righthand/                        # Service Definition: ctx.righthand (deploy/invoke/describe/delete catalog)
  righthand-local/                  # Provider: shells out to wrangler via ctx.subprocess + ctx.credentials
  tool-righthand/                   # Consumer: model-facing verbs (cf_define / cf_deploy / cf_invoke / cf_describe / cf_delete)
  subagent-righthand-agents/        # (phase 2) map Cloudflare Agents SDK -> ctx.subagents provider
  # optional later:
  #   righthand-rest/               # alternative provider using the Workers REST API instead of the wrangler CLI
  #   ui-righthand/                 # browser card/renderer for define/deploy/invoke states
```

Package names follow DSH convention (`@deepseek-ai/dsh-righthand`, `@deepseek-ai/dsh-righthand-local`, `@deepseek-ai/dsh-tool-righthand`, `@deepseek-ai/dsh-subagent-righthand-agents`). Everything else (auth, subprocess, background jobs, durable catalog storage, approval gating, Code Mode reachability) is already provided by existing DSH seams.

---

## 1. How a DSH plugin is made (the extension model to build against)

DSH is a Cordis microkernel. A plugin is a namespace module with **no default export** (`docs/postmortem/0001-acp-default-export-drops-inject.md`):

```ts
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

export const name = 'righthand-tool'   // required
export const inject = ['tools', 'righthand']  // optional service deps

export function apply(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'cf_invoke',
    description: '...',
    parameters: { /* schema; args are TYPE-INFERRED in execute */ },
    output: {
      schema: { type: 'object', /* ... */ },
      render: (args, value) => [{ type: 'text', text: /* prose */ }],
    },
    async execute(args, exec) {
      // return one canonical JSON value; honor exec.signal
    },
  }))
}
```

Key facts that shape the design (from `docs/cookbook/adding-a-tool.md` and `docs/cookbook/extension-cookbook.md`):

- **Registration is effect-scoped.** `ctx.tools.register()` in `apply()` means "dispose the plugin fiber → tool unregisters." For a *durable* tool catalog that must survive DSH restart, the plugin re-registers from persisted storage on every `apply()`.
- **Schemas flow into the system prompt automatically.** Registering a tool is enough for the model to see it; no manual prompt surgery.
- **Code Mode reaches every tool for free.** Every registered tool becomes `await tools.<name>(args)` inside `run_code`, with a generated typed `ToolArgsMap`/`ToolOutputMap`. So `cf_invoke` gets a typed programmatic surface with zero extra work.
- **The canonical-value contract.** `execute` returns one lossless-JSON value; `output.render` produces model-facing prose. UI cards (`presentCall`/`presentResult`) are separate, pure, replay-safe functions.
- **Execution policy is decoupled.** Allow/deny/ask belongs in a `tools/pre-execute` hook or `ctx.tools.guard()`, *not* baked into the tool. Deploy/delete should be gated here (see §6.4).
- **Long-running work** goes through `ctx.jobs.start({ kind, label, owner: exec.agent, run })` — a deploy (bundle + upload, possibly slow) is exactly this pattern, with a returned `{ kind: 'background', jobId }` handle.

### Services to reuse (from `docs/capability-seams.md`)

> **API reference:** `HARNESS-APIS.md` (repo root) is the authoritative, build-oriented reference for every service a tool plugin can use — exact signatures from the service source, return shapes, build gotchas, and per-entry verification status (✅ executed by `tests/dsh-native-tools.spec.ts` / `experiments/blueprint-*`; 📖 read from source). The table below is the abbreviated map; the reference has the call-level detail.


| Seam (`ctx.*`) | What it gives |
|---|---|
| `ctx.subprocess` | Run `npx wrangler ...` (or `npx esbuild ...`) with full argv, collect mode, tree-scoped `terminate()`. This is the sanctioned way to run external CLIs. `dsh-tool-bash`/`dsh-tool-pwsh` are the consumer template. |
| `ctx.credentials` | Store `CLOUDFLARE_API_TOKEN` / account id as references, resolve **per operation** (rotation-safe). Never put secrets in settings/cordis.yml. |
| `ctx.settings` | Register a `righthand` namespace schema (account id, default script name prefix, default compatibility date, allow-deploy toggle). |
| `ctx.storage` / `ctx.storageDomain` | Persist the tool catalog (name → manifest + deployed id + invoke contract). `storage-sqlite` / `storage-json` backends exist. |
| `ctx.jobs` | Background deploy/invoke polling, owner-scoped, cancellable, with notices. |
| `ctx.subagents` | The provider registry to map **Cloudflare Agents** into DSH subagent delegation (phase 2). `subagent-acp`/`-codex`/`-claude-code` are the out-of-process templates. |
| `ctx.dynamicCordisRunner` + `tool-cordis` | The direct architectural precedent for "model defines code, harness executes it." |
| `ctx.approval` / `tools/pre-execute` | One-shot human approval before a destructive/paid deploy. |

| `ctx.tools.register` + `ctx.tools.execute` | The real runtime: `register(defineTool({...}))` and `execute({callId,name,arguments,signal})` return `{isError,value,content}`. |
| `ctx.effect` / `ctx.inject` / `ctx.provide` | Lifecycle fibers; `ctx.plugin()` accepts function/class/`{apply}` plugins uniformly. |

**Correction from building (2026-08-18, `tests/dsh-native-tools.spec.ts` 7/7 pass):** the table above came from reading `docs/capability-seams.md`; I built tools against the *real* services and three notes were wrong or incomplete:

1. **`ctx.storage` is a storage HUB, not `ctx.storage.sql`.** The harness hub exposes named backends (`backend.register('json', …)` → `kv` facet). The ergonomic layer is `ctx.storageDomain` → `defineDomain` (zod record schemas) → `domain.table('rows').put/get/delete/keys()` + `domain.global.get()/set()`. There is no `domain.tables.<name>` object and the verb is `put`, not `set` — the execute() error corrected this.
2. **`ctx.jobs.start` refuses until `attachController(name)`** is called (the `tool-jobs` pattern) — otherwise no producer may start work.
3. **Secrets never leak by construction**: `ctx.credentials.describe` returns `{configured, source, writable}` (no value); `ctx.subprocess` ships `scrubbedParentEnv()` (strips `KEY/PASSWORD/SECRET/TOKEN` + `DSH_*`).

Built-and-used tool modules (each with entry + tests + LEARNINGS in `src/`): `store-tools.ts` (`rh_store_put/get/delete/list` over storageDomain), `secrets-tools.ts` (`rh_credential_describe/set/unset` + `rh_settings_get/set`), `exec-tools.ts` (`rh_run`/`rh_run_bg` over subprocess+jobs), `guard-tools.ts` (`tools/pre-execute` deny gate). Test recipe: `file:` devDeps into `D:\deepseek-harness` + pnpm `overrides`/`linkWorkspacePackages` (from `dsh-paper-design`), then `new Context()` + `ctx.plugin(<Service class>)` + `ctx.tools.execute(...)`.


### Package authoring mechanics

From `docs/cookbook/adding-a-package.md`: a new group `packages/righthand/*` is allowed (a pure container directory); each package needs `package.json` invariants (`private: true`, version matching root, `type: module`, the `@deepseek-ai/cordis` peer+dev dep, `@deepseek-ai/schemastery` in `dependencies` when a Config is used), a `tsconfig.json`, `src/index.ts`, `README.md` with the gated "Model Experience" and "Known Limitations and Deferred Work" sections, and registration in `tsconfig.host.json` (one aggregate only — Host).

---

## 2. Prior art (as requested, one of several references)

### 2.1 DSH `tool-cordis` — the in-repo pattern to mirror

`packages/extensions/tool-cordis/README.md` is the single most important reference. Its five verbs:

- `cordis_inspect` — read-only report of live services/plugins/tools/dynamic packages.
- `cordis_define` — record a package (name, purpose, host `code` and/or browser `client` half) after **syntax-checking both halves; nothing runs yet**.
- `cordis_run` — evaluate the host half in the vm sandbox.
- `cordis_stop` — dispose to quiescence; definition survives.
- `cordis_undefine` — stop + forget; the conversation card remains as a record.

The workflow, trust stance, and UX decisions transfer almost verbatim to Cloudflare:

- Define first (validate, don't execute), then an explicit run/deploy step — **never** execute on define.
- Mint a stable `dyn-<n>` / tool id that rides the canonical result **and** the durable presentation metadata so UI cards can address later verbs on replay.
- Definitions are session-scoped and controllable; a UI shows a "start" control.
- **Trust stance**: "the sandbox isolates globals but is not a security boundary… Treat this toolset like bash access." For Cloudflare the equivalent statement is *stronger* (a deploy costs money and creates live infrastructure), so the deploy verb should default to approval-gated.

**What's different (and why this is a new plugin, not a fork):** tool-cordis runs code *inside* DSH with no persistence and no real isolation. dsh-righthand persists the tool outside the process, gives it real isolation (Workers sandbox, DO storage), and must handle bundling, account/zone state, migrations for DO/Agents, remote invoke URLs, and teardown of deployed artifacts.

### 2.2 Ambiens (`D:/DEV/ambiens`) — the Cloudflare operational reference

Ambiens is a large Cloudflare-native platform. Useful takeaways, with file evidence:

- **Full binding vocabulary in production** (`wrangler.jsonc`): `assets`, `observability`, `migrations` (`new_sqlite_classes` for DOs), `durable_objects.bindings`, `r2_buckets`, `queues`, `workflows`, `d1_databases`, `ai`, per-`env` overrides for staging/production. This is a realistic manifest template for generated tools.
- **Cloudflare Agents SDK in production** (`apps/api-worker/src/worker.ts:2149`): `const { routeAgentRequest } = await import("agents");` at the Worker `fetch` entry, with `SummaryGeneratorAgent` / `PolicyManagerAgent` registered as SQLite DO classes (`apps/agents/src/*`).
- **A Node test shim for the Agents SDK** (`apps/agents/src/agent-stub.ts`): a mock `Agent` class + mock SQL storage + a `callable` decorator stub so agent code can be unit-tested outside Workers. This is the right shape for the plugin's own offline model-check/test step.
- **Auth gotcha** (`.recursive/memory/skills/availability/cloudflare-cli-and-skills.md`): `wrangler login` is unreliable in this environment; the working flow is OAuth via the `cf` CLI, then `CLOUDFLARE_API_TOKEN` env var. For DSH the cleaner path is a **scoped API token** held in `ctx.credentials` (see §6.4).
- **DO gotcha**: responses returned from a Durable Object have **immutable headers** — copy headers into a new `Response` rather than mutating (`error 1101` otherwise).
- **Workers Builds / worker loaders**: Ambiens uses `worker_loaders` and dynamic `Workflow`s (`@cloudflare/dynamic-workflows`), evidence that programmatic per-tool script bundling is a real, supported path.
- **`@cloudflare/playwright`** in deps — Cloudflare now offers browser automation on Workers; a candidate primitive for a future "web automation tool."

Ambiens is useful as *one of several* references and should not be copied wholesale: it is a product monolith (better-auth, TanStack UI, D1 auth), whereas dsh-righthand is a narrow harness extension. But the deep mine (2026-08, full source pass over `apps/api-worker`, `apps/agents`, `apps/workers`, `packages/artifacts`, `packages/agent-sdk`, `packages/ai`, `packages/domain`, `.recursive/memory`) surfaced **concrete, copyable subsystems**. Every claim below was **verified by running Ambiens' own tests** (unless marked "read-verified" — production code/docs with no unit test).

**Test-run evidence (2026-08-18, `npx vitest run`):** 142 tests passed (streaming-utils, artifacts, inbox-fanout, moonshot-client, prebuilt-relay-packages, agents) + 92 tests passed (artifacts e2e/integration, agent-sdk client, digest-consumer, domain, relays).

**Self-built evidence (2026-08-18, built from scratch in `experiments/proto-*`, NOT Ambiens' tests):** the four copyable subsystems were each rebuilt by me, tested by me, and (for the core trio) deployed and exercised live. See §2.2.0 below; experiment dirs: `proto-durable-stream`, `proto-artifact-registry`, `proto-write-flow`, `proto-mcp-server`, `proto-ai-normalize`, `proto-composed-worker` (live at `https://rh-proto-composed.ambiens.workers.dev`).

#### 2.2.0 Built-and-used by me (stronger than read-verified — see experiment dirs)

The following were **constructed by me and used**, each with its own test entry + LEARNINGS.md. "Used" means a real request/round-trip, not just a passing assertion:

| Subsystem | Built as | Tested by | Used live |
|---|---|---|---|
| Durable offset streams | `proto-durable-stream/stream-utils.ts` | 8/8 groups (offset sort, SSE, headers, ETag, waiter) | ✅ in the DO event log |
| Artifact registry + validator + sha256 | `proto-artifact-registry/artifact-registry.ts` | register/duplicate/history/deprecate/unregister/semver-resolve; strict/assisted; sha256 known-value | ✅ served at `/registry` |
| 9-step governed write flow | `proto-write-flow/write-flow.ts` | 6 cases (success/update/permission-reject/validation-reject/unknown) | ✅ `/write` 200/422 live |
| Stateless MCP server + SSE client | `proto-mcp-server/mcp.ts` | init/list/call/schema-reject/unknown + HTTP round-trip with token ctx | local HTTP round-trip |
| Workers AI normalization | `proto-ai-normalize/ai-normalize.ts` | 11 response shapes | (pure fn; used by ask-ai/vision/digest) |

Key **new** learnings from building (not in Ambiens' tests): DO state must be explicitly loaded from `state.storage` (in-memory array is per-isolate — hit and fixed live); wrangler only bundles inside the worker project dir (copy primitives into `src/lib` or publish as a package); Key **new** learnings from building (not in Ambiens' tests): DO state must be explicitly loaded from `state.storage` (in-memory array is per-isolate — hit and fixed live); wrangler only bundles inside the worker project dir (copy primitives into `src/lib` or publish as a package); the catch-up filter is a plain string compare that only works because offsets are fixed-width.

**Template kits + composition blueprints (added 2026-08-19):** each primitive now ships guidance (`README.md` in its `experiments/proto-*/` dir — what it is, how to run with zero installs, when to use each piece, local-vs-cloud limits) in addition to the entry + test + LEARNINGS. Three composition blueprints wire the primitives together, each verified local (run.ts + test.ts both pass):

| Blueprint | Composes | What it demonstrates | Verified |
|---|---|---|---|
| `experiments/blueprint-event-sourced-store` | durable-stream + artifact-registry + write-flow | version = offset; governed writes; checksummed commits; catch-up by `compareOffset` | ✅ run.ts + test.ts |
| `experiments/blueprint-governed-registry` | artifact-registry + write-flow | register → reject violation → governed edit; the 9-step ledger; `validation_failed` reporting | ✅ run.ts + test.ts |
| `experiments/blueprint-mcp-tool-surface` | mcp-server + ai-normalize | stateless MCP surface for deterministic + AI tools; one normalized AI shape; schema rejection → JSON-RPC error | ✅ run.ts + test.ts |

Each blueprint ships the full §31.8 kit: `blueprint.json` (declarative recipe) + `README.md` (run local/cloud + escalation) + `run.ts` + `test.ts` + `LEARNINGS.md`.

#### 2.2.1 Durable streams — offset-addressable event logs (new primitive for §9.2 / §29) ✅ built-and-used (see §2.2.0)

`apps/api-worker/src/streaming-utils.ts` is a self-contained, dependency-free streaming layer (`streaming-utils.test.ts`: 15+ `it` blocks — offsets, SSE, headers, ETag, waiter all pass):

- **Lexicographically sortable offsets** `v1_${ts.padStart(16,'0')}_${seq.padStart(8,'0')}` → SQLite `ORDER BY offset ASC` catch-up reads. Tests: "creates lexicographically sortable offsets", "round-trips offset creation", "compares offsets correctly", "checks range boundaries".
- **Unified stream protocol**: `Stream-Next-Offset` / `Stream-Up-To-Date` / `Stream-Closed` headers; SSE `event: data` (JSON) vs `event: control` (metadata). Tests: "builds minimal/full headers", "encodes basic SSE event", "handles multiline data", "encodes control event".
- **Long-poll waiters**: `createStreamWaiter` (30s timeout) + `cleanupStreamWaiter`. Tests: "resolves when resolved", "rejects on timeout", "cleans up timer".
- **ETag from offsets**: `createETag(channelId, start, end)`. Tests: "round-trips ETag", "throws on invalid ETag".

#### 2.2.2 Artifact governance = the tool-registry + edit-flow pattern (§4.1 / §16 / §20) ✅ built-and-used (see §2.2.0)

`packages/artifacts/` implements the "versioned, forkable, validated tool store":

- **Format registry** (`registry.ts`): register (rejects duplicate `formatId`), version history by prefix, deprecate, unregister. Tests PASS: "prevents overwriting existing format definitions", "allows different versions with different formatIds", "tracks deprecated status in history", "tracks multiple versions of the same format prefix", "supports deprecate and unregister".
- **Validator** (`validation.ts`): strict vs assisted modes; JSON (Zod), Markdown (frontmatter+Zod), binary (R2 pointer). Tests PASS: "turns unrecognized keys into warnings in assisted mode" / "errors in strict mode", "still rejects missing required fields in assisted mode", "detects binary files and validates size limits", "requires R2 pointer for large files in strict mode", "validates R2 pointer schema".
- **9-step governed write flow** (`write-flow.ts`): validate → normalize → commit → reindex → summarize → emit. Tests PASS: "executes write flow successfully", "rejects write for insufficient permissions", "infers formats from registry path patterns".
- **SHA-256 checksums** (`crypto.ts`): 64-hex, deterministic, matches known value (tests PASS). **Repair system** (`repair-system.ts`): JSONL repair-instruction ledger. **Ownership** (`ownership.ts`): per-file ownership + role write-permission checks (tests PASS).

#### 2.2.3 The recursive-memory system — a template for dsh-righthand's guidance/skills (§19 / §35) 🔍 read-verified (docs, not code)

Ambiens ships an operational skill-memory discipline (`.recursive/memory/`): a router (`skills/SKILLS.md`) → four shards (`availability/`, `usage/`, `issues/`, `patterns/`), each doc frontmatter-typed (`Type`, `Status`, `Scope`, `Owns-Paths`, `Watch-Paths`, `Source-Runs`, `Validated-At-Commit`, `Tags`). Promotion boundary (`patterns/phase8-skill-memory-promotion.md`): capture run-local first, promote only what is reusable-across-runs + changes-behavior + not-noise. Docs-mirroring (`usage/cloudflare-docs-mirroring.md`): prefer `developers.cloudflare.com/llms.txt` + `llms-full.txt` over HTML. *(These are docs — read-verified, not test-executed.)*

#### 2.2.4 Agents SDK + MCP + Workers AI, in production (§9.3 / §12.5 / §28) ✅ test-verified (agents, AI) + 🔍 read-verified (MCP)

- **Agents SDK** (`apps/agents/src/agents-production.ts`): `class X extends Agent<Env, State>` + `@callable()` + `setState`, SQLite-backed. **Node stub** (`agent-stub.ts`) mocks `Agent`/callable for offline tests. `agents.test.ts` PASS.
- **Workers AI normalization** (`packages/ai/src/moonshot-client.ts`): `extractChatCompletionText` handles `response`/`output_text`/`text`/`refusal`/nested `result`/`choices[].message.content`. Tests PASS: "reads OpenAI-style choices content", "reads nested result wrappers and content arrays", "reads responses-api style output arrays", "reads object-form message content".
- **MCP server** (`apps/agents/src/mcp-server.ts`): stateless — `new McpServer` per request, `registerTool(name, {description, inputSchema: z.object(...)}, handler)`, context via `extra`. *(Read-verified; no dedicated mcp-server test found.)*

#### 2.2.5 Measured DO/auth gotchas (§22 / §24) 🔍 read-verified (production code + memory docs)

- **DO response headers are immutable** — `worker.ts` `addSecurityHeaders(response)` (line 2090): `new Headers(response.headers)` → `new Response(response.body, {status, statusText, headers})`. Applied to DO-fetched + asset responses. The memory doc attributes the original 500s (error 1101) to mutating headers directly. *(Production code + doc, read-verified.)*
- **better-auth bundling** (`better-auth-patterns.md`): `better-auth/adapters/memory` → **undefined** in Wrangler esbuild; use scoped `@better-auth/memory-adapter` / `@better-auth/drizzle-adapter`; **factory-per-request** (not isolate-serializable); **no `redirectURI`** config. *(Doc, read-verified; `auth.test.ts` exists.)*

#### 2.2.6 Browser automation + Dynamic Workflows (§14.3 / §28) ✅ test-verified (workflows) + 🔍 read-verified (browser)

- **Dynamic Workflows** (`relay-workflow-loader.ts`): `createDynamicWorkflowEntrypoint` + `wrapWorkflowBinding` + `worker_loaders` binding; source loaded at runtime (`mainModule` + `modules`). `relay-workflow-loader.test.ts` PASS (mocks the SDK, verifies binding + entrypoint).
- **`@cloudflare/playwright`** (`x-feed-browser-session.ts`): `acquire(binding, {keep_alive: 600000})` → `connect(binding, sessionId)`, fallback on busy/expired, `newContext({storageState, userAgent})`. *(Production code in 5 worktrees; **no unit test** — read-verified only.)*

#### 2.2.7 Cross-cutting: rate limiting, correlation IDs, inbox fan-out, relay packages (§27 / §29) ✅ test-verified

- **Rate limit + correlation + error envelope** (`middleware.ts`): `X-RateLimit-Limit/Remaining/Reset` headers, `correlationId` (`req_${time36}_${uuid6}`), structured error `{error, code, details, correlationId, status, timestamp}`. Tests PASS: "rate limits repeated agent-triggered relay runs" (asserts 429 `code: "rate_limited"`), middleware-logging tests.
- **Inbox fan-out** (`packages/domain/src/inbox-fanout.ts`): plain async fn targeting a DO via `idFromName(agentId)` + internal `__infra` route. `inbox-fanout.test.ts` PASS.
- **Prebuilt relay packages** (`packages/relay-runtime/src/prebuilt-relay-packages.ts`): declarative `{seed, configSchema, capabilities, validateConfig, execute}` (validateConfig throws 422). `prebuilt-relay-packages.test.ts` PASS. This is a second, test-verified confirmation that the §31 blueprint schema is the right abstraction.

**Net:** Ambiens is a working implementation of *four things dsh-righthand has only designed*: the versioned tool registry (§2.2.2), the skill-memory guidance layer (§2.2.3), the durable event-log primitive (§2.2.1), and the governed edit pipeline (§2.2.2). The 11 test-verified subsystems are safe to mine as templates; the 7 read-verified items (docs + production patterns) should be treated as "confirmed by inspection, not by execution" and re-tested when the plugin actually uses them.


### 2.3 Other references worth mining during implementation

- **`packages/shell/tool-bash`** — the production-grade three-package tool template (Service Definition `dsh-subprocess` + provider `dsh-subprocess-local` + consumer `dsh-tool-bash`), including the background-job producer.
- **`packages/subagent/subagent-*`** — provider-seam template for the Cloudflare Agents phase.
- **`packages/web/tool-web`** — the tool family that owns "stable model-facing names over swappable providers" (`ctx.web` seam), the same seam shape proposed here as `ctx.righthand`.
- **Cloudflare's own `agents` repo / skills** (the `agents-sdk`, `durable-objects`, `workers-best-practices`, `sandbox-sdk` skills referenced in Ambiens) — load these before writing generated-code templates.

---

## 3. Cloudflare primitives, current state

Research snapshot (web + Ambiens). The four first-class "tool substrates" and what they're good for:

| Primitive | Good for | Key facts |
|---|---|---|
| **Workers** | Stateless one-shot tools (JSON-in/JSON-out compute, fetch, transforms) | Global, cheap, cold-start; `fetch(request, env, ctx)` entry; bindings declared in `wrangler.jsonc`. |
| **Durable Objects** | Stateful tools (counters, locks, sessions, work queues) | SQLite-backed storage is **GA, 10 GB/object**; `ctx.storage.sql`; `new_sqlite_classes` migrations. Strong per-object consistency + RPC. |
| **Agents (SDK)** | Long-lived AI agents as tools | npm package **`agents`**; `Agent` class extends `DurableObject`; `routeAgentRequest(request, env)`; `callable` methods; `setState`/`getState`; `schedule`/`scheduleEvery`; built-in WebSocket/RPC. |
| **Workflows** | Durable multi-step tools (retries, sleeps, human-in-the-loop) | `WorkflowEntrypoint` with `step`; trigger via API/binding; `@cloudflare/dynamic-workflows` exists for dynamically-authored steps. |
| **Queues** | Async fire-and-forget tool invocations | Producer/consumer bindings. |
| **Cron** | Scheduled reusable tools | `triggers.crons` in config. |
| **Containers** | Arbitrary runtimes/images (beta) | Public beta; fallback when Node/Workers is insufficient. |
| KV / R2 / D1 / AI | Tool data + model inference | Secondary: KV for small state, R2 for blobs, D1 for relational, `AI` binding for LLM/inference. |

### Programmatic deploy options (the crux of "agent builds tools")

1. **`wrangler` as a subprocess (recommended v1).** Shell out via `ctx.subprocess` to `npx wrangler deploy` with a generated `wrangler.jsonc` + entry file in a per-tool temp dir. Pros: uses the exact same, battle-tested path as Ambiens; supports *everything* (DOs, Agents, Workflows, bindings, migrations); no SDK surface drift. Cons: slower (CLI startup), output parsing, version skew with the globally installed wrangler.
2. **`wrangler` programmatic API** (`import { deploy } from '@cloudflare/wrangler'`, `unstable_dev` for local). Faster in-process, but the API surface is less stable and less complete for exotic bindings. Good v2 optimization for the common Worker case.
3. **Workers REST API (new beta) / simplified deploy SDK.** Cloudflare shipped a "new, simpler REST API for Workers" (beta) and an IaC/SDK push (June–Sept 2025). Cleanest for *pure Workers* uploads without a local wrangler, but DO/Agents/Workflow binding provisioning still leans on wrangler or the broader API. Best reserved for the `righthand-rest` provider variant.

**Recommendation:** v1 = one provider (`righthand-local`) that drives `wrangler` through `ctx.subprocess`, with `ctx.credentials` supplying `CLOUDFLARE_API_TOKEN`. Abstract behind `ctx.righthand` so a REST provider can drop in later.

---

## 4. The core design: how "agent builds a reusable tool" works

### 4.1 Two registries

1. **Durable catalog** (persisted in `ctx.storage`): rows like `{ toolId, kind: 'worker'|'do'|'agent'|'workflow', name, description, schema, manifest, entryCode, deployStatus, deployedVersionId, invokeTarget, createdAt, updatedAt }`. This is what survives DSH restart.
2. **Live tool registration** (effect-scoped `ctx.tools.register`): on plugin `apply()`, read the catalog and register one *invoke* tool per deployed row (or one generic `cf_invoke {toolId, args}` dispatcher — see §4.3), so the catalog becomes model-visible immediately after restart.

### 4.2 The five verbs (mirroring tool-cordis)

| Verb | Behavior |
|---|---|
| `cf_define` | Accept `name`, `kind`, `description`, `schema` (JSON Schema for the tool's parameters), and the `entryCode` (+ optional `manifest` overrides). **Validate locally**: TS syntax/type check, schema validity, manifest shape. Store a draft. No network, no deploy. Returns `toolId`. |
| `cf_deploy` | Bundle the entry (esbuild, `bundle: true`, target `esnext`), generate `wrangler.jsonc`, write to a per-tool dir, run `wrangler deploy`. Register as a background job (`ctx.jobs`) because it can take seconds. On success, persist `deployedVersionId` + `invokeTarget` and hot-register the invoke surface. |
| `cf_invoke` | Call the deployed tool. For Workers: `fetch(invokeTarget, { method:'POST', body: JSON.stringify(args) })`. For DO/Agents: RPC or a stubbed fetch route. Parse the canonical JSON result into the tool's `output.schema`. |
| `cf_describe` | Read-only: list catalog entries with status; inspect logs/version for one id (optionally via `wrangler tail`/`deployments list`). |
| `cf_delete` | `wrangler delete` the script (and clean bindings/migrations where applicable), remove the catalog row, unregister the live tool. Approval-gated. |

### 4.3 Per-tool registration vs. a generic dispatcher

The honest tradeoff:

- **One invoke tool per deployed row** (`cf_invoke_<toolId>`): gives the model a first-class schema per tool, typed `tools.cf_invoke_x(args)` in Code Mode, per-tool allow/deny policy, and per-tool progressive disclosure via `ctx.tools.restrict()`. Cost: many schemas in the system prompt (mitigate with the tool-search/progressive-disclosure seam).
- **One generic dispatcher** `cf_invoke { toolId, args }`: fixed schema cost, but the inner `args` is a free-form JSON blob (weaker validation/typing) and no per-tool policy.

Recommendation: **start with per-tool registration** (it matches how tool-cordis/mcp register tools, and gives the strongest model + Code Mode experience), and add a generic dispatcher as a fallback for very large catalogs. DSH's `ctx.tools.restrict()` keeps presentation/lookup/execution aligned for progressive disclosure.

### 4.4 The "reusable tool" contract (what the agent authors)

The agent writes a small, convention-constrained module. Example (Worker kind):

```ts
// entry.ts — generated tool
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const args = await request.json()
    const result = { /* compute */ }
    return Response.json(result)
  },
}
```

The `cf_define` schema parameter is the tool's *own* parameters JSON Schema, used (a) to type `cf_invoke` and (b) to generate a small runtime validator inside the deployed bundle, so remote args are validated at the edge too.

For Durable Objects / Agents, the generated manifest includes the class name + `new_sqlite_classes` migration; the entry re-exports the DO/Agent class and a `fetch` route that forwards to it (or `routeAgentRequest` for Agents). The agent authors the class body; the plugin generates the boilerplate (class export, bindings, migration tag, entry wiring) so the model cannot get the plumbing wrong.

---

## 5. Proposed package-by-package breakdown

### Phase 1 (MVP): Worker + DO + invoke loop

1. **`packages/righthand/righthand`** — `ctx.righthand` Service Definition:
   - `define(spec)` (local validation)
   - `deploy(toolId, { signal })` → returns a deploy handle/status
   - `invoke(toolId, args, { signal })` → `{ value }` | typed failure
   - `describe(toolId?)`, `remove(toolId)`, `list()`
   - config via `ctx.settings` namespace `righthand` + `ctx.credentials` refs.
2. **`packages/righthand/righthand-local`** — provider implementing the seam over `ctx.subprocess` + `wrangler` + `esbuild`. Owns: temp-dir layout, manifest generation, bundling, deploy, delete, invoke-URL resolution, log/tail capture.
3. **`packages/righthand/tool-righthand`** — the model-facing `cf_*` tools (define/deploy/invoke/describe/delete), catalog persistence via `ctx.storage`, live per-tool registration on `apply()`, background deploy via `ctx.jobs`, and `presentCall`/`presentResult` cards. Includes a `tools/pre-execute` policy hook for deploy/delete approval.

### Phase 2

4. **`packages/righthand/subagent-righthand-agents`** — a `ctx.subagents` provider whose `start()` deploys/boots a Cloudflare Agent and maps its RPC surface onto the `SubagentRuntime` request/result contract (or, simpler first cut, exposes Cloudflare Agents as *tools* with a session-id argument rather than as full subagents).
5. **`packages/righthand/tool-righthand-workflows`** — Workflow + Queue + Cron verbs (`cf_schedule`, `cf_trigger_workflow`, `cf_enqueue`).
6. **`packages/righthand/ui-righthand`** (client, optional) — a `cordis_define`-style keyed card showing deploy status, live logs tail, and a run/invoke control.

### Repo wiring (from `adding-a-package.md`)

Each package: `package.json` (invariants), `tsconfig.json`, `src/index.ts`, `README.md` (Model Experience + Known Limitations gated sections). Register each in `tsconfig.host.json` references. New group needs the `./packages/righthand/*/src` wildcard added to `tsconfig.base.json`. `@deepseek-ai/schemastery` in `dependencies` for the settings `Config`.

---

## 6. Key risks and decisions

1. **Deploy = privilege + spend.** A tool that deploys live infra is high-impact. Gate `cf_deploy`/`cf_delete` behind `ctx.approval` (return `ask` from a `tools/pre-execute` hook, or `ctx.tools.guard()` for a monotonic deny), and reflect `allow-deploy` in the `righthand` settings namespace. Never bake policy into the tool body.
2. **Credential handling.** Follow the credentials doctrine: settings carry `accountId`; the API token lives behind `credentialRef('CLOUDFLARE_API_TOKEN')`, resolved per operation, never rendered. Prefer a scoped API token (single account/zone, Workers:Edit/Delete) over the OAuth flow documented in Ambiens; keep the `cf`-CLI OAuth path as a documented fallback.
3. **Bundling determinism.** Pin wrangler/esbuild versions and a `compatibility_date`; a tool built today must deploy six months later. Store the generated manifest + entry in the catalog so `cf_deploy`/`cf_delete` are replayable/idempotent even after code edits.
4. **DO/Agent migrations are append-only.** `new_sqlite_classes` migrations cannot be cleanly undone; `cf_delete` should delete the *script* but leave stale migration history documented (and use `deleted_classes` when safe). This is the one place Cloudflare teardown is not perfectly reversible.
5. **Invoke latency/error surfacing.** Map Cloudflare error responses (4xx/5xx, DO 1101-style runtime errors, cold starts) into the DSH `isError` canonical shape with a model-feedable message. Use `exec.signal` to cancel in-flight invokes; `wrangler tail`/`deployments` feeds `cf_describe` diagnostics.
6. **Progressive disclosure / prompt bloat.** Per-tool registration grows the system prompt. Use `ctx.tools.restrict()` + tool-search when catalogs grow; keep `cf_define`'s own schema tight.
7. **Sandboxing the authored code is the *author's* concern, not DSH's.** DSH sandboxes the *harness-side* operations (subprocess spawn, filesystem), but the deployed Worker is a separate trust domain the user owns. State this clearly in the README trust stance (à la tool-cordis).
8. **Local dev without an account.** Offer a `wrangler dev --local`/`unstable_dev` mode so the agent can smoke-test a tool before a real deploy (nice-to-have, phase 1.5).

---

## 7. Suggested milestone sequence

> **Superseded** by [`PLAN.md`](./PLAN.md) §6 (M0–M7), which is the canonical, current milestone ladder. Kept here as the original sketch: the PLAN adds the registry (M2), starters/blueprints (M3), metadata+UI (M4), and reorders DO breadth to M5.

1. `ctx.righthand` seam + `righthand-local` provider + unit tests with a **mocked** subprocess/wrangler (no account needed).
2. `tool-righthand` verbs with `storage-json` catalog; define→deploy→invoke→delete round-trip against a real `workers.dev` script.
3. Durable Object kind (SQLite) + `cf_invoke` over a stubbed DO route; migration handling.
4. Approval/policy hook + background-job deploys + UI cards.
5. Cloudflare Agents kind (`agents` SDK) as a *tool*; then as a `ctx.subagents` provider.
6. Workflows/Queues/Cron verbs; REST provider variant; progressive-disclosure polish.

---

## 8. Primary source files to read during implementation

**DSH**
- `packages/extensions/tool-cordis/src/index.ts`, `README.md` (the pattern)
- `packages/extensions/cordis-host-runner/src/index.ts`, `sandbox.ts` (define/validate/run lifecycle)
- `packages/shell/tool-bash` + `packages/subprocess/subprocess*` (subprocess tool template)
- `packages/core/tools` (`defineTool`, extension points), `docs/cookbook/adding-a-tool.md`
- `packages/jobs/jobs` + `docs/subsystems/jobs.md` (background deploy)
- `packages/credentials/credentials` + `packages/settings/settings` (config/secrets)
- `packages/storage/storage` + `packages/storage/storage-domain` (catalog persistence)
- `packages/subagent/subagent` + `subagent-acp`/`subagent-codex` (Cloudflare Agents phase)
- `docs/cookbook/adding-a-package.md`, `docs/development.md`, `docs/capability-seams.md`

**Ambiens (one of several references)**
- `wrangler.jsonc` (full binding vocabulary)
- `apps/agents/src/agent-stub.ts` (Agents SDK shim)
- `apps/agents/src/summary-generator-agent.ts` / `policy-manager-agent.ts` (real Agent classes)
- `apps/api-worker/src/worker.ts` (routeAgentRequest wiring)
- `.recursive/memory/skills/availability/cloudflare-cli-and-skills.md` (auth + DO gotchas)

**Cloudflare (current)**
- Agents SDK: <https://developers.cloudflare.com/agents/> and <https://github.com/cloudflare/agents>
- Durable Objects SQLite: <https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/>
- Workflows: <https://developers.cloudflare.com/workflows/>
- Programmatic deploy: wrangler API (`@cloudflare/wrangler`), new Workers REST API (beta), <https://developers.cloudflare.com/workers/platform/infrastructure-as-code/>
- Containers (beta): <https://blog.cloudflare.com/containers-are-available-in-public-beta-for-simple-global-and-programmable>

---

## 9. Example tools the agent would compose

These are the *kinds* of reusable tools a user asks for in plain language, the Cloudflare substrate each maps to, and what the agent actually authors. Every example follows the same contract: a **parameters JSON Schema** (drives the registered invoke tool's typing + edge validation) plus a small **entry module** (the only thing that differs per kind).

### 9.1 Stateless → Worker

**User asks:** "build me a `slugify` tool I can reuse anywhere."
**Substrate:** Worker. One-shot, pure compute, no state.

**Authored entry** (`entry.ts`):

```ts
export default {
  async fetch(request: Request): Promise<Response> {
    const { text, separator } = await request.json()
    const slug = text
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, separator ?? '-')
      .replace(/^-+|-+$/g, '')
    return Response.json({ slug })
  },
}
```

**Parameters schema** (`cf_define.schema`):

```json
{
  "type": "object",
  "properties": {
    "text":      { "type": "string", "description": "Input string to slugify." },
    "separator": { "type": "string", "default": "-" }
  },
  "required": ["text"]
}
```

### 9.2 Stateful → Durable Object (SQLite)

**User asks:** "make a `kv_store` tool — a shared key/value store with counters I can bump across sessions."
**Substrate:** Durable Object with SQLite storage (GA, 10 GB/object). Survives restarts, globally consistent.

**Authored entry** (`entry.ts`) — the agent writes only the class; the plugin generates the binding + migration:

```ts
import { DurableObject } from 'cloudflare:workers'

export class KvStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env)
    this.ctx.storage.sql.exec(`CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, value TEXT)`)
  }
  async get(key) {
    const rows = this.ctx.storage.sql.exec('SELECT value FROM kv WHERE key = ?', key).toArray()
    return rows[0] ? JSON.parse(rows[0].value) : null
  }
  async set(key, value) {
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO kv (key, value) VALUES (?, ?)', key, JSON.stringify(value))
    return { ok: true }
  }
  async bump(key, delta) {
    const cur = (await this.get(key)) ?? 0
    const next = cur + (delta ?? 1)
    await this.set(key, next)
    return { value: next }
  }
}
```

The plugin-generated manifest includes the class name + `new_sqlite_classes` migration and a generated `fetch` route that dispatches `/rpc` to `get`/`set`/`bump`.

### 9.3 Stateful + AI → Cloudflare Agent (SDK)

**User asks:** "make a `meeting_summarizer` tool that keeps memory of past meetings and summarizes new notes against it."
**Substrate:** Cloudflare Agents SDK — a Durable Object that holds state and can call LLMs. Long-lived, addressable by id, supports scheduling (e.g. weekly digest).

**Authored entry** (`entry.ts`):

```ts
import { Agent, callable } from 'agents'

export class MeetingSummarizer extends Agent {
  @callable
  async summarize(notes: string): Promise<{ summary: string; topics: string[] }> {
    const history = (this.state.history as string[]) ?? []
    const summary = await this.runModel({ notes, history })   // env.AI or fetch to an LLM
    this.setState({ history: [...history, notes].slice(-20) })
    return summary
  }
}
```

The plugin-generated entry wires `routeAgentRequest(request, env)` and exposes the `callable` methods over RPC, so `cf_invoke` becomes a remote method call. This kind is also the bridge to **full subagent delegation** in phase 2 (§5.4).

### 9.4 Durable multi-step → Workflow

**User asks:** "make an `onboard_user` tool that sends an email, waits up to 48h for a reply, then reports."
**Substrate:** Workflow — survives process restarts, has `step`/`sleep`, human-in-the-loop wait.

**Authored entry** (`entry.ts`):

```ts
import { WorkflowEntrypoint, WorkflowStep, WorkflowEvent } from 'cloudflare:workers'

export class OnboardUser extends WorkflowEntrypoint {
  async run(event, step) {
    const email = await step.do('send-welcome', () => sendEmail(event.payload.email))
    const reply = await step.waitForEvent('user-replied', { timeout: '48 hours' })
    return step.do('report', () => ({ email, replied: reply !== null }))
  }
}
```

### 9.5 The "composable tool" catalog shape

Every composed tool is one durable catalog row. The agent sees and reuses them as first-class, typed tools:

```
cf_describe() ->
  cf_invoke_kv_store    Durable Object   ready     "shared key/value store with counters"
  cf_invoke_slugify     Worker           ready     "slugify a string"
  cf_invoke_summarizer  Agent            ready     "summarize meetings with memory"
  cf_invoke_onboard     Workflow         running   "onboard a user with email + reply wait"
```

---

## 10. How the agent composes them — the workflow

The composition loop mirrors `tool-cordis`: **define (validate, don't run) → deploy (explicit, approval-gated) → invoke → iterate → reuse**. Two layers of composition are what make it "reusable":

1. **Tool-to-tool** (an agent *writes* a tool; any later session *calls* it), and
2. **Primitive-to-tool** (one composed tool can bind/chain other Cloudflare primitives — e.g. a Worker that calls a DO, a Queue that fans out to Workers, a Workflow that orchestrates an Agent).

### 10.1 End-to-end walkthrough (creating `kv_store`)

**Step 0 — capability check.** The user asks for a reusable Cloudflare tool. The agent first reads `cf_describe` (list existing tools + account readiness) and confirms `CLOUDFLARE_API_TOKEN` is configured (a `describe()` on the credential, never the value).

**Step 1 — `cf_define`.** The agent submits `name`, `kind: "do"`, `description`, the parameters `schema`, and the `entryCode`. The plugin validates locally: TS syntax/type check, schema validity, manifest shape, and (for DO/Agent) that the class is exported and the migration tag is well-formed. **Nothing runs, no network, no deploy.** Result: a minted `toolId` (e.g. `righthand-3`), with status `draft`.

**Step 2 — `cf_deploy`.** The plugin bundles the entry (esbuild), generates `wrangler.jsonc`, and deploys via `ctx.subprocess`. Because deploy can take seconds, it runs as a `ctx.jobs` background job with a returned `{ kind: 'background', jobId }` handle. The agent can poll or move on. **Policy:** this verb is approval-gated (a `tools/pre-execute` hook returns `ask` → one-shot human approval via `ctx.approval`). On success the row flips to `ready`, `deployedVersionId` + `invokeTarget` are persisted, and the invoke tool is hot-registered.

**Step 3 — smoke test via `cf_invoke`.** The agent exercises the now-typed tool, in Native mode or from `run_code`:

```ts
await tools.cf_invoke_kv_store({ op: 'set', key: 'hits', value: 0 })
await tools.cf_invoke_kv_store({ op: 'bump', key: 'hits' })   // -> { value: 1 }
```

**Step 4 — iterate.** The agent edits `entryCode` and re-runs `cf_deploy` (idempotent, versioned; §6.3). `cf_describe` with `wrangler tail`/`deployments list` shows errors when a smoke test fails.

**Step 5 — reuse.** The tool is durable (persisted in `ctx.storage`, re-registered on every harness restart). In any later session the same agent (or a different one) just calls `cf_invoke_kv_store` — or composes it into another tool.

### 10.2 Composition patterns the workflow enables

| Pattern | How it's expressed | Example |
|---|---|---|
| **Direct reuse** | Call a previously composed tool | "slugify every title in this JSON." |
| **Chain (tool → tool)** | One composed tool calls another via its `invokeTarget` (or the agent orchestrates both from DSH) | "enqueue a job" → queue → "summarize result." |
| **Fan-out** | A composed Worker writes to a Queue; N consumer Workers each call a shared DO | "scrape these 50 URLs, dedupe into `kv_store`." |
| **Orchestration** | A composed Workflow `step`s through other tools' HTTP/RPC endpoints | "onboard user: validate (Worker) → wait (Workflow) → summarize (Agent)." |
| **Scheduling** | Cron trigger / `scheduleEvery` on an Agent/DO | "rebuild the index every hour." |
| **Full delegation** | (phase 2) expose a composed Cloudflare Agent as a DSH subagent via `ctx.subagents` | "delegate this research to `meeting_summarizer` as a child agent." |

### 10.3 What the agent literally sees at each step

**Before any tool exists** (system prompt): the five `cf_*` verbs only.

**After `cf_deploy` succeeds**: `cf_invoke_kv_store` appears with its parameters schema — so the model can call it with correct typed arguments, and `run_code` exposes `tools.cf_invoke_kv_store(args)`.

**On restart**: the catalog is re-read from storage and every `ready` tool is re-registered before the first turn — durability with no user action.

**Policy note:** `cf_define` is cheap and non-destructive (no approval), `cf_invoke` is ordinary (policy-configurable), `cf_deploy`/`cf_delete` are high-impact (approval-gated by default). That gradient is what makes self-service composition safe.

---

## 11. Composition principles (design takeaways)

1. **One schema, two validations.** The `cf_define` parameters schema drives both the DSH-side invoke tool typing AND a generated edge validator in the deployed bundle — the tool cannot be called with malformed args on either side.
2. **The agent writes a class, not plumbing.** The plugin generates bindings, migration tags, dispatch routes, and RPC wiring. The model's surface area is deliberately small (a `fetch` handler, a DO/Agent class, or a Workflow `run`), which keeps generated code deployable.
3. **Draft → deploy is an explicit, separated step.** Validation never executes; execution never validates silently. This mirrors tool-cordis and prevents accidental spend.
4. **Every tool is an addressable, versioned artifact.** `invokeTarget` + `deployedVersionId` make composition and rollback concrete rather than prose.
5. **Reuse is a registry, not a conversation.** The durable catalog is the source of truth; conversation history is only a record. This is the difference between "a tool the agent wrote once" and "a reusable platform tool."

---

## 12. Two authoring modes: "write it" vs. "prompt Cloudflare"

The earlier sections assumed the DSH agent *writes* tool code itself. But the request asks for a second, higher-leverage mode: the DSH agent **prompts Cloudflare**, and something on Cloudflare (an Agent, or Workers AI) *proposes or creates* the tool, which the DSH agent then tests and iterates on. Both modes are real, both are needed, and they share one backend.

**The honest answer to "an Agent or a Workers AI?":** those are two different *engines*, but neither one can "create a deployable tool" by itself — creation is always a **deploy** step in the loop, and the DSH plugin owns that step in both modes.

| Engine | What it actually does | Can it create a tool? |
|---|---|---|
| **Workers AI** (`env.AI.run(model, {...})`) | A stateless model-inference binding: text in → text/JSON out. No tools, no state, no code execution. | Only *propose* — it returns a plan, a JSON Schema, or a code string. It cannot run or deploy anything. |
| **Cloudflare Agent** (`agents` SDK class) | A stateful Durable Object with an LLM loop, memory, tools, scheduling, and RPC. | *Propose + build + host* — but "build" means it can emit/write code; actually *deploying* that code still needs a deploy action (wrangler or the REST API) somewhere. |

So the clean decomposition is: **Workers AI = cheap proposer; Agent = stateful builder/reviewer; wrangler/REST API = the only thing that actually deploys.** The DSH plugin is the orchestrator that owns the deploy step and, critically, the *test/iterate feedback loop* — which is exactly what the DSH agent is best at.

---

### 12.1 Mode A — the DSH agent writes the tool (already covered in §9–§10)

DSH authoring: `cf_define` with `entryCode` written by the DSH model, `cf_deploy`, `cf_invoke` to test, iterate. Full control, no Cloudflare-side reasoning. This is the "hand-written" path.

### 12.2 Mode B — the DSH agent *prompts Cloudflare*, which proposes/creates

This is the mode the request describes. The DSH agent delegates the *authoring* to a Cloudflare-side brain, then takes back ownership for *testing and iterating*.

```
DSH agent                    Cloudflare (edge)
---------                    -------------------
1. cf_draft(prompt)  ------> 2. an Agent (or Workers AI) reasons about the prompt
                                and emits: name, kind, JSON Schema, entryCode,
                                and a wrangler manifest fragment
3. receives a PROPOSAL    <--
   (name/schema/code/manifest, status = 'proposed', NOT deployed)
4. review + iterate on      5. (optional) re-prompt to revise the proposal
   the proposal in-session
6. cf_deploy(proposalId) -->  7. wrangler/REST API actually deploys it
                                (the proposal code becomes a real Worker/DO/Agent)
8. cf_invoke(...)        --->  9. runs on Cloudflare
10. read result/logs    <--
11. test more, then loop back to 4 or 6 (iterate)
```

The key property: **proposal and deploy are separate, and the DSH agent sits between them.** Cloudflare can propose and even host, but the DSH agent is the one that decides when a proposal is good enough to deploy, and it is the one running the test/iterate loop.

### 12.3 Where the Cloudflare "brain" actually lives (two implementations)

**Option B1 — one durable "toolsmith" Agent (recommended).** A single Cloudflare Agent deployed once by the plugin (a bootstrap step), exposed as the `toolsmith` tool. It keeps a memory of every tool built so far, so proposals improve and stay consistent.

```ts
// toolsmith Agent (authored once, generated by the plugin's bootstrap)
import { Agent, callable } from 'agents'

export class Toolsmith extends Agent {
  @callable
  async propose(spec: string): Promise<ToolProposal> {
    // uses this.run() / env.AI to reason, then returns a structured proposal
    const history = this.state.proposals ?? []
    const proposal = await this.reason(spec, history)   // -> { name, kind, schema, entryCode, manifest }
    this.setState({ proposals: [...history, proposal].slice(-50) })
    return proposal
  }
}
```

**Option B2 — a stateless Workers AI "proposer" Worker.** Cheaper (no DO), but no memory between calls; the DSH agent must resend context. Good for one-shot drafts, weak for iteration across sessions.

**Which to pick:** B1 when the user wants a persistent collaborator that remembers past tools; B2 as the zero-state fallback. The plugin can offer both behind one `cf_draft` verb (`engine: "agent" | "workers-ai"`).

### 12.4 The new verbs this mode adds

| Verb | Behavior |
|---|---|
| `cf_draft(prompt, { engine? })` | Send a natural-language tool request to the toolsmith Agent / Workers AI. Returns a **proposal** (name, kind, schema, entryCode, manifest) with status `proposed`. **Nothing is deployed.** |
| `cf_revise(proposalId, feedback)` | Ask Cloudflare to revise an existing proposal (add a param, change a return shape, fix a bug). Returns a new proposal revision. |
| `cf_adopt(proposalId)` | Promote a proposal to a local draft the DSH agent can edit directly (bridges Mode B → Mode A). |
| `cf_deploy(proposalId)` | (unchanged) deploy the proposal's code for real. |
| `cf_invoke` / `cf_describe` / `cf_delete` | (unchanged) the test/iterate/reuse surface. |

So Mode B is not a different plugin — it is Mode A with a **`cf_draft` front door** in front of `cf_define`. The proposal is just a draft whose `entryCode` was written by Cloudflare instead of by the DSH model.

### 12.5 The "test and iterate" loop is the DSH agent's job — and this is the crux

The reason this architecture works is that **the DSH agent keeps the one thing Cloudflare cannot do well: grounded, tool-mediated verification.** The loop is:

```
cf_draft -> cf_deploy -> cf_invoke -> observe result/logs -> cf_revise (or cf_adopt + hand-edit) -> cf_deploy -> ...
```

The DSH agent tests with *its own* tools — `cf_invoke`, `cf_describe` (logs via wrangler tail), `run_code` assertions, even `subagent` review — and only the DSH agent sees the full session context, the user's files, and the other tools. Cloudflare proposes in the dark; DSH verifies in context. That division is the whole design.

### 12.6 Security/trust changes from Mode A

1. **Proposals are untrusted input.** Code from a Cloudflare LLM gets the same local validation as any `cf_define` submission (syntax, schema, manifest, exported class) before it is stored or deployable.
2. **Deploy stays approval-gated regardless of mode.** A Cloudflare-proposed tool is *still* a deploy: spend + live infra. Mode B adds no deploy bypass.
3. **The toolsmith Agent needs its own token scope** to emit code, but **not** a deploy token. Deploy stays on the DSH side (§6.4). Separating "can draft" from "can deploy" is the key safety property.
4. **Proposal provenance is recorded** (`proposedBy: "ambient" | "agent"`, engine, model, prompt) so a bad proposal is auditable and revertible.

### 12.7 Recursive creation (the "agent that builds its own tools" full picture)

The most interesting property: **the toolsmith Agent can itself be built by the DSH agent** — a bootstrap. Once deployed, it is just another row in the catalog, so the same verbs that manage `kv_store` manage `toolsmith`. The DSH agent can even ask the toolsmith to draft an *improved toolsmith* (add review criteria, a better schema), `cf_deploy` the revision, and `cf_invoke` the new one. This closes the loop the request describes: the DSH agent writes its own tool that writes its own tools.

---

## 13. Recommendation (short)

- Build **Mode A first** (the `cf_define`/deploy/invoke loop from §4–§7) — it is the foundation everything else needs.
- Then add **Mode B as a thin front door**: one bootstrap-deployed `toolsmith` Agent + a `cf_draft`/`cf_revise` pair that returns *proposals* into the existing draft pipeline. Workers AI (`env.AI.run`) is the stateless fallback engine.
- Keep **proposal ≠ deploy** and keep deploy approval-gated; that single invariant is what makes "the agent prompts Cloudflare to build tools" safe and correct.

---

## 14. Substrate map: how Workers / Durable Objects / Workflows / Dynamic Workflows fit tool-building

This is the layer that turns "the agent can author tools" into "the agent picks the *right* primitive." Every composed tool's `kind` field maps 1:1 to a Cloudflare runtime, and each runtime fits the define → deploy → invoke → test/iterate loop differently. The same verbs (§4.2) hide the differences; the plugin's per-kind codegen, invoke transport, and teardown are where the differences live.

### 14.1 The decision heuristic (what the agent / toolsmith is told to pick)

The choice reduces to four questions about the tool's *state* and *duration*:

```
Q1. Does it need state that survives between calls?
        no  -> Worker (stateless, one-shot)
        yes -> Q2
Q2. Is the state per-logical-object (strongly consistent, single-writer)?
        yes -> Durable Object (SQLite)
        no  -> Q3 (or KV/R2/D1 for plain data)
Q3. Is the work multi-step, long-running, retryable, or human-in-the-loop?
        yes -> Workflow (durable execution)
        no  -> Q4
Q4. Is the step graph itself decided at runtime (per-tenant / agent-generated)?
        yes -> Dynamic Workflow (definition loaded at runtime)
        no  -> ordinary Workflow (steps fixed in code)
Plus, independent of the above: does the tool need to *reason* or call LLMs?
        yes -> Cloudflare Agent (a DO + LLM loop; the "intelligent" primitive)
```

### 14.2 Per-primitive fit in the lifecycle

| Primitive | What the agent authors | What the plugin generates | How it's invoked | How it's tested | Teardown |
|---|---|---|---|---|---|
| **Worker** | a `fetch(request, env, ctx)` handler | `wrangler.jsonc` + esbuild bundle | HTTP POST to the worker URL | call → check JSON | delete script |
| **Durable Object** | a class extending `DurableObject` (methods + `ctx.storage.sql`) | script + `durable_objects` binding + `new_sqlite_classes` migration + RPC/route stub | RPC or fetch with object id | call → assert state persists across two calls | delete script; migration history stays (append-only) |
| **Workflow** | a `WorkflowEntrypoint.run(event, step)` with `step.do` / `step.waitForEvent` | script + `workflows` binding | `create()`/trigger → returns instance id; **async** | trigger → poll instance status → read step results | delete script + workflow binding |
| **Dynamic Workflow** | a workflow *definition* (steps as data/code), not a build-time class | a `worker_loaders` binding + `@cloudflare/dynamic-workflows` glue | create instance from the runtime-loaded definition | same as Workflow, but the definition can be revised **without a redeploy** | revoke the loader/definition entry; delete script |
| **Agent** | an `Agent` class with `callable` methods (DO + LLM loop) | script + `routeAgentRequest` + DO migration | RPC / AgentClient / fetch | call `callable` → check structured result | delete script; migration note |

The important consequence: **the `cf_*` verb surface is identical for all five.** Only the `kind` differs. That is what lets one agent compose across primitives without learning five tool systems.

### 14.3 Why Dynamic Workflows matters most for "prompt Cloudflare" mode

Regular Workflows have their step graph fixed at build time — changing it means a redeploy. **Dynamic Workflows** (open beta, part of Dynamic Workers) load the workflow definition at runtime through a **Worker Loader** binding. Concretely: the workflow's `run(event, step)` logic arrives as data/code from a loader, so the step graph can differ per tenant — or, in this plugin, **per agent-generated proposal**.

That closes a gap in Mode B (§12): instead of

```
prompt Cloudflare -> proposal -> DSH deploys -> test -> revise -> REDEPLOY -> ...
```

Dynamic Workflows make it possible to do

```
prompt Cloudflare -> Cloudflare emits a WORKFLOW DEFINITION -> loader serves it ->
DSH creates an instance -> test -> revise the DEFINITION -> new instance (no redeploy)
```

The redeploy disappears from the inner loop; only the *first* deploy of the loader-bearing Worker is needed. This is the same pattern Ambiens already uses in production (its `worker_loaders` binding + `RelayDynamicWorkflow` with `@cloudflare/dynamic-workflows`) — evidence the substrate is real, though still beta, so the plugin should treat it as an opt-in `kind: "dynamic-workflow"` rather than the default.

**Caveats to record (beta + limits):** Dynamic Workflows are in **open beta** (Dynamic Workers, 2026-03-24 changelog); the step graph a dynamic definition may express is not arbitrary code — it is still constrained by the Workflows durable-execution model (deterministic steps, `step` boundaries, serializable inputs). So "agent emits a workflow" is real, but the agent must emit a *well-formed workflow definition*, not arbitrary imperative code. The plugin validates that definition the same way it validates a `WorkflowEntrypoint`.

### 14.4 How the primitives compose (the nesting hierarchy)

The four primitives are not alternatives — they nest, and the composed tool is usually a *small graph* of them:

```
Agent (DO + LLM loop)
   |-- calls Workers (stateless compute)
   |-- calls other Agents (sub-agents, "agents as tools")
   |-- triggers Workflows (long jobs it supervises)

Workflow (durable execution)
   |-- step.do -> calls Workers / DOs / Agents via fetch / RPC / bindings
   |-- step.waitForEvent -> human-in-the-loop gate

Worker (stateless)
   |-- calls Durable Object stubs (state hand-off)
   |-- enqueues to Queues (fan-out)
   |-- triggers a Workflow instance (async)

Dynamic Workflow
   |-- wraps dynamically-supplied step definitions in the durable Workflow engine
   |-- per-tenant / per-proposal variation without redeploy
```

The tool-building feature exposes this as **bindings in the generated manifest**: a composed `kind: "workflow"` tool may declare `bindings` for the DOs and Workers its steps call, so the agent composes a workflow *from* tools it has already built — the registry becomes a dependency graph (§10.2), not just a list.

### 14.5 What this means for the plugin's design (updates to §5)

1. **`kind` is the dispatch key, not a free-form string.** A closed union: `worker`, `durable-object`, `workflow`, `dynamic-workflow`, `agent`. Each kind has its own codegen template, invoke transport, and teardown policy.
2. **One codegen package per kind** (or one `kind`-dispatched generator) — the boilerplate differences in §14.2 are the bulk of the generated code.
3. **Async invoke contract.** Workers/DOs/Agents are request-response; Workflows/Dynamic Workflows are *async* (create → poll status). The plugin must model both: `cf_invoke` returns `{ kind: 'value', value }` or `{ kind: 'workflow', instanceId, status }`, and `cf_describe` polls instance status/step results. This is a real change from the §4.2 sketch, which assumed request-response.
4. **Bindings make composition a first-class manifest feature.** A tool's generated `wrangler.jsonc` can reference the `invokeTarget`/DO names/Workflow names of other catalog tools, so "compose" is declarative rather than hand-wired.
5. **Beta gate for `dynamic-workflow`.** Keep it behind a settings flag (`allowDynamicWorkflows`) and pin the `@cloudflare/dynamic-workflows` + wrangler versions, because the surface is moving.

### 14.6 Recommended kind order (revised milestone order)

1. **Worker** — simplest; proves define/deploy/invoke/delete end-to-end.
2. **Durable Object** — adds migrations + stateful test assertions (call twice).
3. **Agent** — adds `routeAgentRequest` + `callable` RPC + the toolsmith (Mode B).
4. **Workflow** — adds the async create/poll invoke contract.
5. **Dynamic Workflow** — adds the worker-loader substrate and the no-redeploy inner loop (gated, beta).
6. **Queues/Cron/R2/D1/KV/AI** — binding-level add-ons after the five kinds are stable.

This ordering builds the invoke contract (sync → stateful → intelligent → async → dynamic) so each step only adds one new capability on top of the last.

---

## 15. The cloud-side memory: index, history, and cross-device reuse

Everything so far assumed a process-local catalog (§4.1). The requirement "reuse tools from any workspace, any device, as long as authenticated" moves the **source of truth into the user's Cloudflare account**. The DSH-side catalog becomes a cache; the authoritative registry lives in the cloud.

### 15.1 One "control plane" in the user's account

A single bootstrap-deployed Worker — `dsh-righthand-registry` — is the tool registry. It is itself just a `kind: "worker"` tool (bootstrapped by the plugin on first use), and it multiplexes four storage primitives by role:

| Cloudflare primitive | Role in the registry | Why |
|---|---|---|
| **D1** (relational SQLite) | The **index**: tools, versions, runs, tags, lineage, search | Queryable, indexed, cheap, survives restarts; good for "what tools exist, what can I invoke, what did I run." |
| **Artifacts** (git-compatible, beta) | The **source + history of record**: each tool's `entry.ts` / `schema.json` / `wrangler.jsonc` / `provenance.json` as a git repo; run history as commits | Versioning, branching, forking, diffing, rollback — for free, because it *is* git. |
| **R2** | Large blobs: logs, snapshots, binary results | Cheap object storage; D1 rows hold pointers (`log_ref`) to R2 keys. |
| **Durable Object** | Per-tool runtime state / locking / single-writer coordination | Only for tools that are themselves stateful; also a natural place for a per-tool "current version" lock. |

### 15.2 The data model (what the index stores)

```
tool        { id, name, kind, description, schema_ref, owner, lineage_parent_id, created_at, updated_at }
tool_version{ id, tool_id, git_ref, sha, entry_ref, manifest_ref,
              status: draft|proposed|deployed|retired,
              deployed_version_id, invoke_target, created_at }
run         { id, tool_id, version_id, workspace, device, status,
              args_digest, result_digest, log_ref, duration_ms, error, created_at }
tag         { name, tool_id, version_id }        # e.g. "stable", "v2", "production"
```

D1 holds the rows; **Artifacts holds the git repos** (one repo per tool, branch per version lineage, tag per promoted version); **R2 holds logs/snapshots** referenced by `run.log_ref`. The three are linked by `sha` / `git_ref` / `log_ref` pointers.

### 15.3 How the DSH agent reaches it from anywhere

1. The DSH plugin is installed in a workspace (same plugin, any machine).
2. On `apply()` it authenticates with `ctx.credentials` (`CLOUDFLARE_API_TOKEN` — the same token on any device resolves to the same account) and calls the registry's `GET /tools` + `GET /tools/:id/versions`.
3. It downloads the index and **re-registers every `deployed` tool** as a local `cf_invoke_<id>` surface (Code Mode typed, §1). Local `ctx.storage` holds a cache/mirror for offline fallback.
4. Invokes go straight to each tool's `invokeTarget` (a Cloudflare URL/RPC), so a tool behaves identically on every device — there is no local state to drift.
5. Every define/deploy/invoke/revision **writes back to the cloud index** (D1 row + Artifacts commit + R2 log), so the next device sees the full history.

**Identity model:** "as long as it is authenticated" = the Cloudflare token is the identity. Same token → same account → same registry → same tools and history. Read-only tokens can share the catalog without deploy rights; write tokens can define/deploy (still approval-gated locally).

### 15.4 What the agent can now do with the index

- **Discover**: `cf_search` / `cf_list` query D1 (name, kind, tag, description, even "most recently run").
- **Recall how to use**: each index entry carries the tool's `schema` + a `README.md` from Artifacts, so the invoke contract is self-describing.
- **Reuse**: call `cf_invoke_<id>` from any session/device; the registry records the run.
- **Audit**: `run` history (args/result digests + R2 logs) answers "what did I run, when, from where, and what happened."
- **Fork**: branch the tool's Artifacts repo → new tool id with `lineage_parent_id` (see §16).

---

## 16. Versioning, forking, and the two Code Modes

### 16.1 Forking = git branching (Artifacts makes this trivial)

Because tool source lives in Artifacts (git-compatible), "fork into a new version that can be modified" is exactly a branch:

```
cf_fork(toolId, name) ->
  1. checkout toolId's repo at its current ref
  2. create branch <name> (new tool_id, lineage_parent_id = toolId)
  3. D1: insert tool + tool_version (status=draft, git_ref=<branch>)
  4. return new toolId
```

```
cf_edit / cf_revise -> new commit on the branch   (modify)
cf_deploy(ref)     -> deploy a specific sha/branch/tag (versioned deploys)
cf_promote(tag)    -> tag a version ("stable")    (release management)
cf_rollback(toolId, tag) -> deploy an older tag   (undo)
```

A tool's full lineage (parent → forks → revisions) is a tree in the index, and every leaf is independently deployable and invokable. This is the reusable-tool "version graph" the request describes, implemented with primitives Cloudflare already provides rather than a bespoke VCS.

### 16.2 DSH's native Code Mode — the agent *programs* the tools

DSH's `run_code` already turns every registered tool into a typed `tools.<name>(args)` binding (§1). With the cloud registry, the agent can:

```ts
// in DSH Code Mode: discover + compose cloud tools as a program
const tools = await tools.cf_list({ tag: 'stable' })
for (const t of tools.items) {
  if (t.kind === 'worker') await tools[t.invoke]({ /* typed args */ })
}
const v2 = await tools.cf_fork({ tool_id: 'kv_store', name: 'kv_store_v2' })
```

So Code Mode is not just "call one tool" — it is the **composition and automation surface**: batch invokes, fork-and-test loops, regression harnesses that call every `stable`-tagged tool. The index must therefore be queryable *from code* (typed `cf_list`/`cf_search` returns), not just from chat.

### 16.3 Cloudflare's Code Mode — the tool *runs* code at the edge

Cloudflare has its own Code Mode (`createCodeTool`, plus a durable Code Mode runtime with execution history, rollback, and approvals — Dynamic Workers docs). Two integrations:

1. **Tools can be code executors.** A generated tool may wrap `createCodeTool()`, so invoking it runs agent-supplied code on Cloudflare with a sandbox and durable execution history. The tool authoring surface becomes: "build me a tool that executes X-shaped programs."
2. **The toolsmith (Mode B, §12) can build-and-test in the cloud.** Give the toolsmith agent Cloudflare's durable Code Mode runtime as its execution engine: it drafts code, runs it in a sandbox with its own recorded history, and the DSH agent reads that history through `cf_describe` — so even the *proposal testing* can happen on Cloudflare with durable, replayable records (which themselves are stored via Artifacts/R2 in the user's account).

**The clean split (record it):** DSH Code Mode = the user's agent composing/automating cloud tools locally; Cloudflare Code Mode = the *tools themselves* (or the toolsmith) executing code at the edge with durable history. They compose: the DSH agent writes a `run_code` program that `cf_fork`s a tool, invokes its code-executor, and reads back Cloudflare-side execution history.

### 16.4 Where "memory" and "history" each live (final answer)

| Thing | Home | Notes |
|---|---|---|
| Tool index (what exists, how to invoke) | **D1** (control plane) | authoritative; DSH caches it |
| Tool source + manifests + version graph | **Artifacts** (git repos) | fork/branch/commit/tag/rollback |
| Run history (what was run, when, where, result) | **D1 rows + R2 logs** | args/result digests for privacy, full logs in R2 |
| Per-tool runtime state | **Durable Object** | only for stateful tools |
| Proposals + provenance | **Artifacts + D1** | `proposedBy`, engine, model, prompt |

This satisfies "from any workspace, any device, as long as authenticated": the **cloud registry is the single source of truth**, the token is the identity, and both the DSH side and the Cloudflare side read/write the same index, so tools, versions, and history follow the user — not the machine.

---

## 17. Revised architecture summary (all layers together)

```
                        ┌─────────────────────────────────────────┐
                        │  DSH agent (any workspace / any device)  │
                        │  auth: CLOUDFLARE_API_TOKEN (credentials)│
                        └───────────────┬─────────────────────────┘
                                        │  cf_* tools  +  run_code (native Code Mode)
                                        ▼
        ┌────────────────────────────── dsh-righthand plugin ──────────────────────────────┐
        │  define / draft / revise / fork / deploy / invoke / describe / delete / search    │
        │  (approval-gated deploy; proposal ≠ deploy; catalog cache in ctx.storage)        │
        └───────┬───────────────────────────────────────────────────────────────────────────┘
                │ wrangler / REST API (deploy)      │ HTTP / RPC (invoke)      │ registry API
                ▼                                  ▼                          ▼
        Cloudflare Workers / DO / Agents / Workflows / Dynamic Workflows
                │
                ▼
        ┌────────────────── dsh-righthand-registry (user's Cloudflare account) ──────────────┐
        │  D1: tool/version/run/tag index     Artifacts: tool source + version graph + runs │
        │  R2: logs + snapshots               DO: per-tool state / locking                  │
        └────────────────────────────────────────────────────────────────────────────────────┘
```

The plugin is the **thin orchestrator**; the **cloud registry is the durable memory**; the **primitives are the execution substrate**; and the **two Code Modes** give the agent a local programming surface (DSH `run_code`) and an edge execution surface (Cloudflare `createCodeTool`). Every layer reads/writes the same index, which is what makes tools genuinely reusable — anywhere, any time, any purpose, any device.

---

## 18. Vendored Cloudflare skills — authoritative corrections and additions

A local DSH plugin repository (`D:/DEV/dsh-cloudflare/packages/dsh-cloudflare`) vendors the official Cloudflare skills (9 bundles, 1:1 parity with the Codex Cloudflare plugin, MIT) plus the official Cloudflare API MCP server (`https://mcp.cloudflare.com/mcp`). These are current, authoritative references — they **correct and supersede** several assumptions made from web snippets earlier in this document. This is the resource the dsh-righthand plugin should consume (see §18.4).

### 18.1 What the skills confirm, correct, and add

**Confirmed (matches earlier research):**
- Durable Objects: SQLite storage (10 GB/object), `ctx.storage.sql` + sync KV + transactions + point-in-time recovery + alarms; migrations are append-only and `deleted_classes` destroys data.
- Agents SDK: `Agent<Env, State>`, `routeAgentRequest(request, env)` (and the newer `routeAgent(request, env, "AgentName")`), `callable()` RPC, `setState`/`validateStateChange`, `schedule/scheduleEvery/cron`, email, MCP, task queue, `AIChatAgent` with `streamText` + `tools`.
- Workflows: `WorkflowEntrypoint.run(event, step)` with `step.do` (retries/timeouts/`NonRetryableError`), `step.sleep/sleepUntil`, `step.waitForEvent` (max 365d), instance create/get/status/pause/resume/terminate/restart/sendEvent; **params and step returns must be `Rpc.Serializable<T>`**; triggers from Worker/Queue/Cron/another Workflow; agent-to-workflow human-in-the-loop via `approveWorkflow/rejectWorkflow`.
- Cloudflare API (official SDK): `new Cloudflare({ apiToken })` (TS/Python/Go), auto-pagination, typed errors (401/403/404/429/>=500), token scopes (minimal permissions), rate limits (1200/5min). This is the **programmatic deploy surface** — better than wrangler-as-subprocess for the common path.

**Adds (new, previously unverified):**
- **Code Mode (experimental, `@cloudflare/codemode/ai`)** — the edge-side counterpart to DSH's `run_code`. Confirmed real: generates executable JS instead of tool calls, self-debugging/error recovery, wraps an agent's `tools`, requires `CodeModeProxy` + `globalOutbound` service bindings + a `worker_loaders` `LOADER` binding + `enable_ctx_exports` compat flag. This is how "tools run code at the edge" actually ships (see §16.3 — now grounded).
- **Sandbox SDK (`@cloudflare/sandbox`)** — `getSandbox(env.Sandbox, 'user-123')`, `exec()`, `runCode(code, { language: 'python'|'javascript'|'typescript' })`, files, `exposePort`, `destroy`; needs `containers` config + DO binding. This is the right place to **execute agent-authored tool code for testing inside Cloudflare** — safer and more reproducible than the DSH host.
- **Secrets Store (beta)** — account-level encrypted secrets, 100/account, 1024 bytes max, scope-based bindings (`workers`/`ai-gateway`). Better home for per-tool secrets than worker-level `wrangler secret put`.
- **Vectorize (GA)** — 10M vectors/index, dims <=1536, cosine/euclidean/dot, metadata filtering, namespaces, Workers AI integration. A ready-made substrate for "similar tool / RAG over tool history" search.
- **Pipelines (open beta)** — streams -> SQL transform -> R2 (Iceberg/Parquet). A substrate for event-driven tool telemetry/analytics.
- **AI Gateway** — caching/routing/observability for `env.AI.run` calls (e.g. `gateway: { id, skipCache, cacheTtl }`). Useful for the toolsmith's model calls.
- **D1 (GA)** — prepared statements, `batch()` atomic transactions, sessions (15 min), read replication, `PRAGMA foreign_keys`, migrations via `wrangler d1 migrations apply --remote`. The registry index backend (§15.2) is fully grounded.
- **Workers AI** — `env.AI.run("model", { prompt })` with optional `gateway`; confirmed as the cheap "proposer" engine (§12).
- **Queues / R2 / KV / Analytics Engine / email** — full supporting surface for tool telemetry, fan-out, and event history.

### 18.2 The most important correction: deploy via the official API SDK (not wrangler)

The skills make the programmatic path concrete and first-class: **`cloudflare` npm SDK (TS/Python/Go) with `apiToken`**. This means the §3 recommendation ("wrangler as subprocess v1") should be **reversed** for the common path:

- **Use the official SDK (`cloudflare`) for the 95% path**: upload script, manage bindings/migrations (via API), D1, R2, KV, Workflows, DOs, tail — all typed, paginated, rate-limited, in-process (no subprocess, no npx startup, no output parsing).
- **Keep wrangler as subprocess only as a fallback** for exotic operations the API does not yet expose (e.g. some dynamic-worker-loader provisioning) — not the default.

This is a meaningful simplification: the plugin becomes an SDK consumer, not a CLI wrapper. `ctx.subprocess` is still used for esbuild bundling and for local `wrangler dev` testing, but the deploy path is API-first.

### 18.3 The other corrections

1. **Route helper**: use `routeAgent(request, env, "AgentName")` (current) rather than the older `routeAgentRequest` (still present in Ambiens). Generated agent entries should use the current form.
2. **Code Mode wiring is now known exactly**: wrangler needs `compatibility_flags: ["experimental","enable_ctx_exports"]`, `worker_loaders: [{binding:"LOADER"}]`, `CodeModeProxy` + `globalOutbound` service bindings; the worker re-exports `CodeModeProxy` from `@cloudflare/codemode/ai` and defines `globalOutbound`; the agent calls `experimental_codemode({ prompt, tools, globalOutbound, loader, proxy })` then `streamText` with the wrapped tools. dsh-righthand's codegen must emit exactly this when a tool opts into edge code execution.
3. **Secrets**: prefer **Secrets Store (account-level)** for tool secrets shared across workers; keep `wrangler secret put` only for tool-private secrets. The registry can manage both via the API SDK.
4. **Vectorize as tool discovery index**: "similar tool / RAG over tool descriptions and history" is a first-class Vectorize use (10M vectors, metadata filter by kind/tag). Add `cf_search --semantic` as a Vectorize-backed query on the registry index (fallback to D1 LIKE when Vectorize is not provisioned).

### 18.4 How dsh-righthand should consume this

The dsh-cloudflare plugin is **not** the tool-building plugin — it is the **skills/MCP substrate** dsh-righthand should build on top of:

1. **Mount both plugins.** dsh-righthand (tool-building verbs) + dsh-cloudflare (cloudflare skill provider + `cloudflare-api` MCP client). The MCP server (`https://mcp.cloudflare.com/mcp`, OAuth with optional bearer token) gives live account access via `search()`/`execute()` — the plugin's registry Worker is effectively a private MCP server too (§15.1).
2. **The skills are the model's authoring knowledge.** Before `cf_define`/`cf_draft`, load the relevant skill (agents-sdk, durable-objects, workflows, sandbox-sdk, wrangler, api, workers-best-practices) so the model generates current, correct code — the skills themselves say "prefer retrieval over pre-trained knowledge."
3. **Sandbox SDK is the cloud test rig.** Execute agent-authored tool code in a `@cloudflare/sandbox` container for pre-deploy testing (instead of/in addition to DSH-local bundling): `runCode(code, { language })` with files + `exposePort`. Run history lands in Artifacts/R2 (§15).
4. **API SDK is the deploy path.** Replace wrangler-as-subprocess with the official SDK for upload/bindings/migrations/D1/R2/KV/Workflows/tail.
5. **Code Mode cross-link.** DSH `run_code` (compose locally) <-> Cloudflare `@cloudflare/codemode` (execute at edge) — both now precisely documented; the plugin's codegen emits the Cloudflare Code Mode wiring when a tool needs edge execution.

### 18.5 Updated substrate/deploy table (incorporating skills)

| Primitive | Authoring surface (from skills) | Deploy path | Notes |
|---|---|---|---|
| Worker | `export default { fetch }` | API SDK upload | stateless |
| Durable Object | `class X extends DurableObject` + `ctx.storage.sql` | API SDK + migrations (`new_sqlite_classes`) | append-only migrations |
| Agent | `class X extends Agent<Env,State>` + `callable()` | API SDK + `routeAgent` + migration | SQLite-backed state |
| Workflow | `class X extends WorkflowEntrypoint` + `step.do` | API SDK + `workflows` binding | `Rpc.Serializable<T>` |
| Dynamic Workflow | runtime-loaded definition via worker loader | API SDK + worker-loader provisioning (fallback: wrangler) | beta; loader binding |
| Edge code exec | `experimental_codemode` / `CodeModeProxy` | API SDK + `enable_ctx_exports` + services | wraps agent tools |
| Sandbox test | `@cloudflare/sandbox` `runCode` | containers + DO binding | Docker for local |
| Registry index | D1 prepared/batch | API SDK + `d1 migrations apply --remote` | §15 |
| Tool source/history | Artifacts (git) | API SDK | §15 |
| Tool discovery | Vectorize query | API SDK | semantic search |
| Tool secrets | Secrets Store | API SDK | account-level |

**Key sources (local, authoritative):** `D:/DEV/dsh-cloudflare/packages/dsh-cloudflare/skills/` — `agents-sdk/SKILL.md` + `references/{callable,codemode,state-scheduling,workflows,mcp,email,streaming-chat}.md`; `cloudflare/references/{agents-sdk,api,workflows,durable-objects,do-storage,d1,workers,vectorize,pipelines,secrets-store,ai-gateway,ai-search,analytics-engine}/*.md`; `building-mcp-server-on-cloudflare` (OAuth setup); `wrangler/SKILL.md`; `workers-best-practices`; `sandbox-sdk`; plus `plugin.json`/`.mcp.json` (the `mcp.cloudflare.com/mcp` endpoint).

---

## 19. Guidance: how the agent chooses the right primitive

The agent needs to know *which* Cloudflare primitive fits the tool it wants to build. There are two complementary sources, and the design uses **both** — they are not alternatives.

### 19.1 Source 1 — written guidance shipped as skills in dsh-righthand

The plugin bundles its own skills (using the `ctx.skills` provider pattern, exactly as `dsh-cloudflare` does — see §18.4). Unlike dsh-cloudflare's *product* skills (which teach the primitives), dsh-righthand's skills teach **the tool-building decision**:

**Skill set ("toolsmithing" guidance):**

| Skill | Content | When the model loads it |
|---|---|---|
| `righthand-primitive-selection` | The decision tree from §14.1 + the full per-primitive table (§14.2) + cost/latency/state tradeoffs + anti-patterns ("don't use a DO for a stateless transform") | Before any `cf_define` / `cf_draft` |
| `righthand-authoring` | The exact authoring contract per kind (what the agent writes vs. what the plugin generates), entry-module templates, schema authoring, validation rules | While writing `entryCode` |
| `righthand-testing` | The test/iterate loop (define → deploy → invoke → observe → revise), how to use `cf_describe` logs, Sandbox pre-testing, when to use each substrate in testing | Before/while iterating |
| `righthand-forking-versioning` | Version graph, `cf_fork`/`cf_edit`/`cf_promote`/`cf_rollback` semantics, when to fork vs revise | When modifying |
| `righthand-composition` | How tools call tools, bindings-as-dependencies, orchestration patterns (§10.2, §14.4) | When composing |
| `righthand-inspiration` | External skill catalogs as **reference for research and inspiration** — read what a skill does and *how* it does it at `https://hermes-agent.nousresearch.com/docs/skills/` (Hermes skills catalog + bundled skills), the source repo's `SKILL.md`/`CONCEPTS.md`, and the vendored Cloudflare skills (§18) — then **build an original tool** from those patterns | Before a novel build, when the request has no matching starter/blueprint |

Each skill is a `SKILL.md` + `references/` bundle, registered with `{ modelInvocable: true, userInvocable: true }`, and its frontmatter description is written so the model *loads it automatically* when it sees a tool-building task (same trigger-words approach as the vendored skills).

**`righthand-inspiration` (the research-and-inspiration reference)** deserves one extra note: it teaches the agent that tool ideas need not be invented from scratch — it can **search external skill catalogs for a matching use case, read them as research and inspiration, then build its own tool**. The Hermes catalog (`https://hermes-agent.nousresearch.com/docs/skills/`) is the named first stop because it is a large, searchable, open index of skills with real use cases (search/office/docs/coding/agents/…); the agent reads a skill's *capability, contract, and technique* purely as a **reference**, then authors an original Cloudflare tool (starter or blueprint) with a template kit (§31.8). The source repo (§32) and the vendored Cloudflare skills (§18) are the other two references. **Rules:** (a) the reference is *read-only* — the foreign skill is never installed, vendored, converted into a DSH skill, or run; (b) what is borrowed is *shape and approach*, never implementation, third-party runtime, or keys; (c) the output is a **tool**, authored TypeScript-first on Cloudflare primitives (same rule as §19.3 and §33).

**Advantages of written guidance:** zero network, deterministic, versioned with the plugin, always available. It is the **baseline** — the agent should not need to consult anything to pick a primitive for a standard request.

### 19.2 Source 2 — consulting a Cloudflare agent (the toolsmith)

For ambiguous, novel, or account-specific cases, the agent can ask the toolsmith Agent (§12.3) to **recommend a primitive** before drafting:

`
cf_advise(prompt)  // NEW verb
  -> "Recommend a Cloudflare primitive + draft shape for: <tool request>"
  -> returns { recommendation: { kind, rationale, cost/limits note }, proposal? }
`

The toolsmith can see account context (plan limits, existing bindings, quotas) that written guidance can't. It uses the same knowledge the skills encode (it's a Cloudflare Agent built with the agents-sdk skill) but can reason over the *specific* situation. Its recommendation is **advisory** — it feeds `cf_draft`/`cf_define`, never bypasses them.

**Why combine (not either/or):**

| Situation | Written skill | Toolsmith consult |
|---|---|---|
| Standard request ("slugify", "kv store", "cron job") | ✅ sufficient, fast, offline | unnecessary (but harmless) |
| Ambiguous / novel ("multi-tenant agent with human approvals") | ✅ narrows the tree | ✅ adds account-specific reasoning + limits awareness |
| Account-dependent (plan limits, existing bindings, quotas) | ❌ can't know | ✅ needed |
| Fully offline / no token | ✅ works | ❌ needs Cloudflare |

**Rule:** written skills are the first-line; `cf_advise` is for when the answer is not obvious from the skill, or when account context matters. The plugin surfaces `cf_advise` as cheap and read-only (proposal generation is a normal `cf_draft`), so the model isn't penalized for consulting.

### 19.3 Standing rule: TypeScript is the authoring language

**All authored artifacts — starters, blueprints, tools, entry code, adapters, and tests — are TypeScript.** Rationale: DSH itself runs on TypeScript, the plugin's tools are `ctx.tools.register(...)` TypeScript, and every Cloudflare primitive (Workers, Durable Objects, Agents, Workflows, dynamic Workflows, Sandbox) has first-class TypeScript support via the official `cloudflare`/`wrangler`/`@cloudflare/*` SDKs.

Consequences (verified):

- **Zero build step.** Node 24 runs `.ts` natively by type-stripping, and Cloudflare Workers accept erasable TypeScript under the `experimental` compatibility flag — the *same* erasable-only constraint (no `enum`/`namespace`, type annotations dropped at run) as DSH `run_code`. One constraint across the whole stack.
- **Python appears only inside Sandbox containers as third-party tooling** (e.g. the repo's `last30days.py` could run there unmodified), never as authored plugin/blueprint code. The source repo is *inspiration*; the blueprint re-implements in TypeScript.
- **External binaries stay binaries.** `yt-dlp`, `ffmpeg`, `whisper.cpp`, Playwright are tool invocations, not language choices — the local path calls them, it does not port them.
- **One test story.** Blueprint tests run under the same TS test runner as DSH/Cloudflare (`vitest`, `@cloudflare/vitest-pool-workers`), so starter/blueprint tests and tool tests share a single stack.

This rule is why the research-radar experiment shipped as a single `.ts` file (`run3.ts`/`run4.ts`) with no `package.json`, no tsc, no bundler — and it is the default for every starter the plugin packages.


---

## 20. Self-documentation: every tool carries its own living docs

The requirement "must know how to invoke and modify the tools it built" is solved by making **every tool self-documenting** — its documentation is part of its definition, updated on every mutation, and served to the agent from the registry. The docs are not prose that drifts from the code; they are **derived from + attached to** the tool's actual state.

### 20.1 The documentation model (a `TOOL.md` per tool, stored in Artifacts)

Each tool's Artifacts repo contains `TOOL.md` next to `entry.ts`, `schema.json`, `manifest.json`, `provenance.json`. `TOOL.md` is the canonical, model-facing documentation:

`md
# <name>  (<tool_id>)
- kind: worker | durable-object | agent | workflow | dynamic-workflow
- status: draft | proposed | deployed | retired
- version: <git ref> / <sha>  (promoted tags: stable, v2, ...)
- lineage: forked from <parent_id> (or "root")
- created: <ts>  ·  updated: <ts>

## Purpose
<one-paragraph description, written at define time>

## Invoke
- schema: <embedded or ref to schema.json>
- endpoint / RPC: <invokeTarget>
- auth: <token scope needed>
- async?: <sync | workflow-instance; how to poll>

## Arguments (from schema.json)
<parameters table: name, type, required, default, description>

## Returns (from output schema)
<result shape>

## Usage examples
<1-3 examples captured from real cf_invoke calls>

## Dependencies (bindings this tool declares on other tools/primitives)
<list: DO names, Worker URLs, Workflow names, queue/DB/KV/R2 refs>

## Test / iteration history
<last N runs: status, args digest, result digest, error>
<revision log: what changed per version>

## Known limitations / gotchas
<recorded by the agent as it iterates>
`

### 20.2 How it stays updated (the update contract)

The docs update **synchronously with every mutation**, by construction — the plugin regenerates the relevant `TOOL.md` sections from canonical state on every verb:

| Event | What updates in `TOOL.md` | Who writes it |
|---|---|---|
| `cf_define` | Purpose, kind, schema (Arguments/Returns), initial Dependencies | plugin (from spec) |
| `cf_draft` / `cf_advise` | Purpose/schema (proposal) + "proposed by <engine>" | plugin (from proposal) |
| `cf_deploy` | status → deployed, version ref/sha, invokeTarget, auth | plugin (from deploy result) |
| `cf_invoke` | Usage examples + Test/iteration history (run row) | plugin (from run record) |
| `cf_describe` | (no write; read-only) | — |
| `cf_edit` / `cf_revise` | revision log, version ref, updated ts, Purpose if changed | plugin (from diff) |
| `cf_fork` | lineage (forked from), new id, fresh history | plugin (from fork) |
| `cf_promote` | promoted tags | plugin (from tag) |
| `cf_rollback` | version ref → rolled-back sha, revision log entry | plugin (from rollback) |
| `cf_delete` | status → retired, retired ts (docs preserved) | plugin (from delete) |

The key property: **the plugin derives the doc sections from canonical state (schema, manifest, deploy result, run records) and appends agent-written prose (Purpose, limitations) only where a human/model authored it.** So the invoke contract can never drift from the schema — they are the same source rendered two ways. `cf_describe` (or a per-tool `cf_help`) then serves `TOOL.md` to the agent verbatim.

### 20.3 Serving the docs to the agent (three surfaces)

1. **`cf_describe` / `cf_help(toolId)`** — returns the full `TOOL.md`. The agent reads this before invoking or modifying a tool it hasn't touched recently (satisfies "know how to invoke and modify").
2. **`cf_list` / `cf_search`** — return the *summary* (purpose, kind, status, tags, last updated) so the agent can pick without loading full docs; `TOOL.md` head is the discovery snippet.
3. **Code Mode** — each registered `cf_invoke_<id>` already carries its schema in the system prompt (§1); `cf_help` is also callable from `run_code` for programs that need self-describing dispatch. Optionally, the invoke tool's description is auto-trimmed from `TOOL.md`'s Purpose line so the model sees a correct one-line description at all times.

### 20.4 Self-documentation is also the guidance for modification

The "how to modify" half of the requirement is served by the same `TOOL.md`:
- **Dependencies section** tells the agent what a modification touches (if a tool binds another tool, `cf_edit` shows the blast radius).
- **Revision log + version graph** tell it what changed and what to fork vs. revise (§16.1).
- **Known limitations / gotchas** are the accumulated iteration memory — the agent doesn't rediscover bugs on every session.
- After any `cf_edit`/`cf_revise`/`cf_deploy`, the plugin returns the *diff* of `TOOL.md` in the tool result, so the agent sees exactly what documentation changed with its modification — closing the loop that docs and code evolve together.

### 20.5 Storage + durability (ties into §15)

`TOOL.md` lives in the tool's **Artifacts repo** (git) — so docs are versioned, diffable, and fork with the tool automatically. The D1 index stores a **summary + last-modified** for fast listing; full docs are fetched from Artifacts on demand. Run history rows (which feed "Test / iteration history") are D1 + R2 logs per §15. When a tool is `cf_delete`d, its `TOOL.md` is preserved as retired (never deleted), so the agent can always audit what existed and why.

### 20.6 What this adds to the verb surface

| Verb | Addition |
|---|---|
| `cf_help(toolId)` | Return the tool's `TOOL.md` |
| `cf_describe` | Summary + optional full docs |
| `cf_advise` | Cloudflare-agent primitive recommendation (guidance, §19.2) |
| `cf_define`/`cf_draft` | Write initial Purpose/schema docs |
| all mutating verbs | Regenerate affected `TOOL.md` sections + return the doc diff |

---

## 21. Can the DSH agent write Cloudflare Code Mode code and create tools that way?

**Short answer: yes — but only one direction is the *create-tools* loop; the other is *executing* code. Both are supported, and the security boundary determines which one "creating tools that way" really is.**

Two distinct things are being conflated, and each has a precise answer:

### 21.1 Direction A — the DSH agent authors Cloudflare Code Mode code as a tool (fully supported)

The DSH agent can absolutely write the code that makes a tool execute code at the edge via Cloudflare Code Mode. This is just another `kind` (the "edge code exec" row of §18.5): the agent writes an `Agent` whose tools include `createCodeTool()` (or the `experimental_codemode` wrapper), and the plugin generates the exact wiring the vendored skill documents:

`ts
// entry.ts — DSH agent authors this; plugin emits the wrangler wiring
import { Agent, callable } from 'agents'
import { experimental_codemode as codemode } from '@cloudflare/codemode/ai'
import { streamText, tool } from 'ai'
import { z } from 'zod'

export class CodeRunner extends Agent {
  tools = {
    transform: tool({
      description: 'Transform data per the user request',
      parameters: z.object({ op: z.string(), input: z.any() }),
      execute: async ({ op, input }) => this.runTransform(op, input),
    }),
  }

  callTool(functionName: string, args: unknown[]) {
    return this.tools[functionName]?.execute?.(args, {
      abortSignal: new AbortController().signal, toolCallId: 'codemode', messages: [],
    })
  }

  async onChatMessage() {
    const { prompt, tools: wrappedTools } = await codemode({
      prompt: 'You are a code executor...', tools: this.tools,
      globalOutbound: this.env.globalOutbound, loader: this.env.LOADER,
      proxy: this.ctx.exports.CodeModeProxy({
        props: { binding: 'CodeRunner', name: this.name, callback: 'callTool' },
      }),
    })
    return this.streamText({ system: prompt, model: this.env.model, tools: wrappedTools })
  }
}
`

with the wrangler config the plugin generates (`compatibility_flags: ["experimental","enable_ctx_exports"]`, `worker_loaders` `LOADER`, `CodeModeProxy` + `globalOutbound` service bindings, and re-exports `CodeModeProxy` from `@cloudflare/codemode/ai`). The DSH agent writes the `entryCode` via `cf_define`/`cf_draft` exactly like any other tool; invoking it (`cf_invoke`) runs Code-Mode-generated code at the edge with self-debugging/error recovery and durable execution history readable via `cf_describe`.

So: **Direction A = "the DSH agent writes Cloudflare Code Mode code" is a normal tool-authoring path.** Nothing special is needed — the codemode integration is just the entry module of a `kind: "agent"` (edge-code-exec) tool.

### 21.2 Direction B — "create tools *that way*" (the edge code doing the create loop)

The second reading — the codemode code *itself* creates new tools — is a different thing. Cloudflare Code Mode executes code in a sandboxed context where `globalOutbound` filters outbound fetches and `callTool` dispatches to the agent's tools. That code can:

- ✅ **Propose**: run model logic, return a tool spec (`{ name, kind, schema, entryCode, manifest }`) as its result. This is exactly what the toolsmith does — and the toolsmith's own codemode integration can be authored by the DSH agent (Direction A applied to the toolsmith).
- ✅ **Execute**: call the agent's tools, orchestrate, self-debug.
- ⚠️ **Deploy**: only if the edge code holds a Cloudflare API token. The design deliberately keeps deploy tokens on the DSH side (§12.6, §6.4). So a *fully edge-driven create loop* requires granting a scoped deploy credential to the edge (e.g. via Secrets Store, §18.3) — technically possible, but it moves the approval gate into the cloud and should be an explicit, opt-in "edge deploy" mode, not the default.

### 21.3 The resulting division of labor (and the recursion)

| Who | Local (DSH) | Edge (Cloudflare) |
|---|---|---|
| `run_code` (DSH) | agent composes/automates cloud tools locally; forks; batch-invokes | — |
| `createCodeTool` / `experimental_codemode` | — | tool (or toolsmith) executes code at the edge, calls its tools, self-debugs |
| deploy loop | DSH owns it (approval-gated, API SDK) | edge can *propose*, not deploy (default) |

The recursion closes: the DSH agent writes the **toolsmith** as an edge-code-exec Agent (Direction A), deploys it, then asks the toolsmith to run codemode that *proposes* new tool specs; the DSH agent takes the proposal, tests it, and deploys. The DSH agent can even write a **better toolsmith** (better `tools`, `callTool` dispatch, `globalOutbound` policy), deploy the revision, and use it — so the code that writes the tools is itself a versioned, self-documented, forkable tool in the registry (§20).

**The one-line answer:** yes, the DSH agent can write Cloudflare Code Mode code and create tools through it — as long as "create" means *propose + execute* (which the codemode code does at the edge) with *deploy* staying in DSH (which keeps the approval gate). An opt-in "edge deploy" mode is possible via Secrets Store but moves the trust boundary, so it stays gated.

---

## 22. Sharing tools with other users (future: multi-tenancy)

"Let other users use my cloudtools" is a **multi-tenancy + authz** problem on top of the single-user registry (§15). It can ship in three escalating stages, and stage 2 requires exactly what the request anticipates: a web app with auth.

### 22.1 What changes: identity, grants, and a choke point

The single-user registry assumes `token == owner`. Multi-user requires three additions, all held in the existing D1 registry:

`
account      { id, cf_account_id, auth_identity }          # owner of tools
tool         { ...existing... }                            # unchanged
grant        { id, tool_id, grantee_account_id,
               scope: read | invoke | fork | co-own,
               quota: { calls_per_hour, budget_cap },
               status: pending | active | revoked,
               created_at, expires_at }
`

- **Identity**: each user authenticates with their own Cloudflare token (or, in stage 2, with app login). A user may have a Cloudflare account (`cf_account_id`) for hosting tools *and* an app identity for *using* shared tools — they can be separate.
- **Grants** are the authorization primitive: owner → grantee, scoped and quota'd, revocable.
- **The choke point**: all cross-user invocation flows through the registry, never directly to a tool's `invokeTarget`. This is what makes ACL + quota + billing + audit possible.

### 22.2 Stage 1 — no web app: token-scoped grants (v1, cheapest)

No UI; sharing is a verb in the plugin itself.

- `cf_share(toolId, grantee, { scope, quota })` — writes a `grant` row. `grantee` is a Cloudflare token identity (or the registry's account id).
- The grantee's `cf_list_shared()` shows tools shared with them; `cf_invoke` routes through the registry which checks ACL + quota.
- `cf_revoke()` / `cf_accept()` (opt-in accept, like a share link) handle lifecycle.

**Limits:** no discovery (you must already know the owner), no self-service, no nice UX. Good for "share with my team's tokens."

### 22.3 Stage 2 — the Righthand Hub web app with auth (the real answer)

This is the "web app with auth for righthand" the request anticipates. It is a small Cloudflare-native app — and, importantly, it is **just another set of dsh-righthand tools** (§22.6), so the system builds its own admin UI.

**Stack (all on Cloudflare, all things dsh-righthand already knows):**

| Concern | Choice | Why |
|---|---|---|
| Frontend | Workers static assets (React/Solid) | edge-served, scales to zero |
| Auth | **better-auth** + D1 adapter (the Ambiens-proven stack) + OAuth (GitHub/Google) + email OTP | robust, self-hostable, no vendor lock; passkeys optional |
| Sessions | better-auth cookies → short-lived registry tokens | the app issues registry JWTs scoped to the grantee's grants |
| Data | D1 (users, grants, quotas, audit) | same registry DB (§15) |
| API | the registry Worker + a new `hub` Worker (JSON API) | registry stays the single choke point |
| Payments/quotas (optional) | Cloudflare billing / Stripe via Workers | budget caps per grantee |

**The flow:**

`
1. Owner opens hub (app) → logs in (better-auth) → "Share tool X"
2. Owner enters grantee (email or OAuth identity) + scope + quota → grant row created
3. Grantee logs in → sees "shared with you" catalog (read from the same D1)
4. Grantee invokes → hub issues a short-lived registry token scoped to that grant
5. Registry checks grant (scope, quota, expiry) → forwards to the tool / denies
6. Everything (calls, results, quota spend) lands in D1 + R2 audit — owner sees it in the hub
`

**Why better-auth over Cloudflare Access/Zero Trust:** better-auth + D1 gives application-level identity that the registry can *check programmatically in a Worker*, with the ability to issue scoped tokens and record audit — which is exactly what a shared tool catalog needs. Cloudflare Access is a fine *network* gate (put it in front of the hub), but it doesn't produce the per-tool, per-call authorization the grants model requires. Use Access for the hub's own authn, better-auth for app identity + grants.

### 22.4 Stage 3 — a public marketplace (later)

Once grants exist, a directory is just: make `shared-by: owner, tag` public search (Vectorize, §18.3) + a `request access` flow + optional billing. The hub app already has everything needed; the marketplace is discovery + payments on top.

### 22.5 Security model (must be stated)

- **Owner pays**: quotas/budget caps on every grant; no grantee can spend unbounded on the owner's account.
- **Least privilege by scope**: `read` (docs only), `invoke` (call), `fork` (copy as their own), `co-own` (full). Default `invoke`.
- **Revocation is immediate**: registry checks `grant.status` on every proxied call (cache <= a few seconds).
- **Cross-account binding is explicit**: a shared tool that itself binds other tools/DOs/D1 must whitelist those dependencies in the grant (no transitive access silently).
- **Audit is append-only**: every proxied invoke is a `run` row with `grantee_id` — the same §15 run history, now per-user.

### 22.6 The recursion: the hub is a tool the agent builds

The most on-theme implementation: the Righthand Hub (stage 2) is itself a tool (or a small set of tools) authored through dsh-righthand — a Worker + D1 + better-auth app defined via `cf_define`, deployed via `cf_deploy`, documented by `TOOL.md`, forkable, versioned, and living in the same Artifacts repo. So the plugin's own sharing UI is just another self-documenting cloudtool in the registry — bootstrap without leaving the loop.

---

## 23. Think and Flue: harness frameworks as tool-authoring primitives

The request correctly notes that even though dsh-righthand builds **tools, not agents**, Cloudflare's two agent *harnesses* — **Think** and **Flue** — are useful. The precise relationship: they are not new deploy *substrates* (both run on Workers/DO/Workflows already), they are higher-level **authoring frameworks** that produce tool-shaped artifacts with batteries included. dsh-righthand should treat them as optional *authoring surfaces* over the same primitive `kind` set, not as new primitives.

### 23.1 What each is

**Cloudflare Think (`@cloudflare/think`, experimental)** — Cloudflare's own harness, shipped in the `cloudflare/agents` repo (`create-think` starter, v0.9.0). It is a layer over the Agents SDK + Workers AI. Its relevant sub-pieces:

- **Actions** — server-side tools with *idempotency, human approvals, authorization, and reply attachments* built in. This is essentially the cloudtool contract (§20) already realized: a tool that is idempotent, approval-gated, and authorized out of the box.
- **Code execution tool** — sandboxed code execution where `needsApproval` maps onto Cloudflare Code Mode (§21); this is a ready-made pre-deploy test/exec rig.
- **Messengers (`@cloudflare/think/messengers`)** — contracts for delivering messages (Chat SDK bridge, state agent) — a "tool with an inbox."
- **MCP exposure controls** (2026-07-22 changelog) — first-class way to expose Think tools over MCP.

**Flue (`@flue/sdk`, Astro team "withastro", Cloudflare-endorsed)** — "the sandbox agent framework / agent harness framework." TypeScript, headless, programmable, "like Claude Code but programmable." Flue 2.0 is described as "React for agents" — **hooks** are its composable unit. It has sandboxed execution, agent hooks, MCP, state, and a **Cloudflare deploy target (beta, "persisted schema boundary")**. Cloudflare's own blog frames it as the first of "more agent harnesses and frameworks on Cloudflare."

### 23.2 How they map onto dsh-righthand (they are authoring surfaces, not primitives)

The key distinction to preserve:

`
substrate (deployable unit)          authoring framework (how the agent writes it)
-------------------------------      ---------------------------------------------
Worker / Durable Object / Agent       raw entry.ts (fetch handler / DO class)     [Mode A, §12.2]
Workflow / Dynamic Workflow           raw WorkflowEntrypoint                       [Mode A]
Agent (Agents SDK)                    Think harness: actions + code exec + msg     [NEW]
Worker/DO/Agent (sandboxed)           Flue harness: hooks + sandbox + state        [NEW]
`

So two new **optional `kind` values**, both of which compile/deploy to the same Cloudflare substrates:

| `kind` | The agent authors | Plugin generates/deploys | Best for |
|---|---|---|---|
| `think-action` | a Think action (idempotent, approval-gated, authorized) | Think wiring onto an Agent + `routeAgent` | tools that need approvals/authorization/idempotency as first-class, without hand-rolling them |
| `flue-agent` | a Flue agent/hook with sandboxed steps | Flue Cloudflare deploy target (beta) + registry invoke stub | tools the user wants written in a higher-level, hook-composable harness; sandboxed step execution |

**Guidance rule (§19):** the primitive-selection skill gains one more branch — *"does the tool need approval/idempotency/authz (Think) or hook-composable sandboxed steps (Flue)? then use the harness instead of raw code."* The toolsmith can also *recommend* a harness (§19.2).

### 23.3 Three concrete uses (none of which require "an agent" in the user-facing sense)

1. **The toolsmith itself is best built on Think.** §12.3's toolsmith Agent needs actions (propose/revise), human approval for edge deploy (§21.2), authorization, and code execution for self-testing. Think gives all of that as its native building blocks — so `toolsmith` = a Think agent authored once by the DSH agent. This is the highest-leverage use.
2. **"Tool with approvals" is a free Think action.** A user who asks for "a tool that sends emails but asks me before sending" gets `kind: "think-action"` — the approval gate is the *framework*, not code the model must write correctly. Same for idempotent counters, authorized lookups.
3. **Flue is the "toolsmith in a sandbox" fallback.** If the user wants the toolsmith (or a tool) authored as composable hooks with sandboxed step execution — Flue is the cleaner authoring surface than raw Agents SDK, and Cloudflare now runs it. It also has its own MCP story, so a Flue tool can be exposed as MCP for other systems.

### 23.4 Caveats that keep them optional, not foundational

- **Maturity**: Think is *experimental*; Flue-on-Cloudflare is *beta* (with a "persisted schema boundary" note). Pin versions, gate both behind settings flags (like `dynamic-workflow` in §14.5), and never make them the only way to author a tool.
- **They are frameworks, not new substrate.** Both ultimately deploy Workers/DO/Workflows, so dsh-righthand's primitive model (§14) stays the deploy backbone; Think/Flue only change *how the agent writes* the artifact. Deploy path, invoke contract, teardown, and §20 self-documentation are unchanged.
- **Vendoring**: the local dsh-cloudflare skills do **not** yet contain Think/Flue references (checked). When implementing, add `think` / `flue` authoring skills to dsh-righthand's own skill set (§19.1), mirroring the `agents-sdk` skill's "prefer retrieval over pre-training" stance, and point them at `https://developers.cloudflare.com/agents/harnesses/think/` and `https://flueframework.com/docs/`.

### 23.5 Updated kind order (with harnesses)

1–5 unchanged (§14.6: Worker → DO → Agent → Workflow → Dynamic Workflow).
6. **`think-action`** — Think harness actions (approval/idempotency/authz + code exec).
7. **`flue-agent`** — Flue hooks + sandbox (beta-gated).
8. Queues/Cron/R2/D1/KV/AI/Vectorize — binding-level add-ons (§18.5).

Both harnesses are *authoring conveniences* over the same deployment spine — they make "build a tool that needs approvals" and "build a tool from composable sandboxed hooks" dramatically shorter, without changing what a tool *is* or how it is versioned, shared, and self-documented.

### 23.6 Review of the newly-added `think` / `flue` skills (dsh-cloudflare)

Both skills were added to `D:/DEV/dsh-cloudflare/packages/dsh-cloudflare/skills/` (single-file `SKILL.md` each, registered in `src/manifest.ts` with `hasResources: false`). Overall quality is high: correct, current, retrieval-biased, with solid anti-pattern lists. The review below is what the *other agent* (a maintainer/reviewer) should correct or add.

**Corrections (small, precision/consistency):**

1. **`think`: the `ai` binding in `wrangler.jsonc` is optional unless using Workers AI models.** The quick-start config always includes `"ai": { "binding": "AI" }`; if the model goes through AI Gateway or an external provider, that binding is unnecessary. Suggest annotating it as "only if using Workers AI (`@cf/...` ids)".
2. **`think`: routing helper — prefer the current `routeAgent(request, env)` and note the fallback.** The quick start uses `routeAgentRequest`; the vendored `agents-sdk` skill documents the newer `routeAgent(request, env, "AgentName")`. Both work; recommend the newer form with a one-line note that `routeAgentRequest` still works (matches §18.3).
3. **`flue`: `nodejs_compat` framing.** The skill says it is "required by Flue's runtime"; be precise that it is required only when the agent uses Node.js APIs (some sandbox/fs features), and that it can conflict with other compat flags — link the compat-flag guidance from `workers-best-practices`.
4. **`flue`: migration-identity claim is correct but should cite the rename hazard precisely.** "Renaming the function is a storage-identity change unless `agentName` pins it" — good; add the explicit `renamed_classes` migration step as the *required* follow-up, and note `deleted_classes` destroys data (matches `durable-objects` gotchas).

**Additions (integration hooks dsh-righthand needs):**

5. **A "tool vs. agent" decision line in `think`.** The skill is entirely about chat agents. dsh-righthand uses Think mainly for `kind: think-action` (§23.2) — actions with idempotency/approval/authz + code exec — plus the toolsmith. Add a short section: "using Think actions as tools" (idempotency keys, approval gates, authz via `Actions`) so the model knows Think is not only for chat.
6. **A `flue` note that Flue agents can be wrapped as tools.** The skill covers agents; add the pattern "expose a Flue agent's RPC as a `cf_invoke`-wrapped tool via the registry stub" — i.e. the dsh-righthand `flue-agent` kind (§23.2). This makes the harness directly useful to the tool-building loop.
7. **Retrieval-source freshness:** both skills list docs URLs; add a date/version-pin habit (e.g. "verified 2026-07 against Think v0.9 / Flue Cloudflare beta") to the retrieval-sources table, matching the "prefer retrieval" stance with an explicit freshness stamp.
8. **Cross-link to `agents-sdk` / `sandbox-sdk` / `wrangler`:** both skills reference these in Scope; make the cross-link a bolded first-line reminder (like the other vendored skills' "load X skill first" convention) so the model loads them proactively.

**Also confirmed correct (no change needed):**
- `think`: tool merge order, server-authoritative `setMessages`, `submitMessages` idempotency, ThinkWorkflow via `step.prompt`, SQLite `new_sqlite_classes` — all match current docs and the agents-sdk skill.
- `flue`: `'use agent'` + hooks API, per-agent DO generation + binding naming (camel-boundary), `.flue-vite.wrangler.jsonc` merge, append-only migrations + `renamed_classes`/`deleted_classes`, Durable Streams via `runFiber`/`stash`/`onFiberRecovered`, Cloudflare Computer vs Sandbox choice, private agents over service bindings, `@cloudflare/codemode` + `@cloudflare/shell` inside Flue — all internally consistent with the vendored agents-sdk/sandbox-sdk references.

**Bottom line:** nothing factually wrong that would mislead the agent; the additions (items 5–6) matter most for dsh-righthand, since they bridge the harnesses to the tool-building loop rather than leaving them as chat-agent-only knowledge.

---

## 24. Handling Cloudflare dependencies: wrangler, the cf CLI, and auth

The plugin *necessarily* depends on Cloudflare tooling. The question is **which** tool for **which** job, and how auth flows without leaking secrets or breaking on rotation. This section is the consolidated answer (it supersedes the earlier scattered notes: §3/§6/§18.2).

### 24.1 The dependency inventory (what the plugin actually needs)

| Dependency | Role in the plugin | Status / notes |
|---|---|---|
| `cloudflare` npm SDK (`new Cloudflare({ apiToken })`) | **Primary control-plane**: deploy/upload, bindings, migrations, D1, R2, KV, Vectorize, Workflows, tail, lists. | Official TS/Python/Go; typed errors; the §18.2 recommendation. |
| `wrangler` (via `npx wrangler`) | **Fallback only**: exotic ops the SDK does not yet expose (e.g. some dynamic-worker-loader provisioning); local dev (`wrangler dev --local` / `unstable_dev`); `wrangler secret put` for tool-private secrets. | Pinned version; NOT the deploy path for common tools. |
| `cf` CLI (unified Cloudflare CLI, new) | **Optional**: OAuth login / token refresh (`cf auth login`), account discovery, ~3000-API-operation escape hatch. | New; coexists with wrangler; `~/.cf/config.toml` is its config home. Use as a convenience, not a dependency. |
| `esbuild` | Bundle tool `entryCode` → deploy artifact. | Bundled as a dep (or via `wrangler bundle`). |
| `workers-ai-provider` / `agents` / `@cloudflare/think` / `@flue/sdk` | Model + harness deps only when a tool uses them (Think/Flue kinds, §23). | Optional, per-tool; not plugin-level. |
| `@cloudflare/sandbox` | Pre-deploy test rig (Sandbox SDK). | Optional; Docker for local dev. |

### 24.2 Auth strategy (the part that must be rotation-safe)

**Rule: never store a long-lived token in plugin settings; store a *reference* and resolve per operation.**

1. **Primary: `CLOUDFLARE_API_TOKEN` via `ctx.credentials`.** The plugin declares a credential ref `credentialRef('CLOUDFLARE_API_TOKEN')`. On every operation the provider resolves it **fresh** (rotation-safe: if the user rotates the token, the next call picks it up; no cached copy). Account id comes from settings (`accountId`) or is discovered via the SDK. Scope the token to what the plugin needs: Workers scripts, D1, R2, KV, Vectorize, Workflows, Durable Objects, Secrets Store. The docs in §15/§18 already establish that the same token on any device resolves to the same account — this is what makes the registry reachable from any workspace/device.
2. **Alternative: OAuth login via the `cf` CLI.** `cf auth login` writes `~/.cf/config.toml`. The plugin can *read* that config to discover the account/identity (it must never write secrets into it). The Ambiens memory notes `wrangler login` is unreliable in this environment; `cf auth login` is the more reliable OAuth path. But the SDK path (#1) is preferred because it is explicit, scriptable, and does not depend on a machine-local login state.
3. **What the plugin should never do**: prompt for a token interactively mid-run, echo tokens in logs, store tokens in `ctx.settings`, or shell out to `wrangler login` blindly. Interactive flows are acceptable only as a one-time onboarding step (see below), and only through `ctx.approval`-aware UI or a documented manual step.

### 24.3 Onboarding / first-run flow (the agent's checklist)

`
1. Check `cf_describe` / a new `cf_whoami`-style verb: is there a token + account already?
2. No token?  →  tell the user: "I need a Cloudflare API token with these scopes: …"
   - Offer both: paste a token (stored via ctx.credentials, DSH's secret store) OR run `cf auth login` in a terminal (plugin reads ~/.cf/config.toml afterwards).
3. Verify connectivity: SDK `GET /accounts` (or cf CLI whoami). Map 401/403 to a clear message ("token missing / insufficient scope").
4. Only then offer deploy verbs.
`

### 24.4 Where each piece lives (packaging)

- **Plugin code** depends on the SDK (`cloudflare`) and `esbuild` as regular deps (bundled).
- **wrangler / cf CLI are NOT bundled** — they are invoked via `ctx.subprocess` with `npx` (pin the version, e.g. `npx --yes wrangler`… with an exact tag) or detected on PATH. This keeps the plugin small and avoids version drift.
- **Fallback path is explicit and gated**: the provider tries the SDK first; if an operation is not in the SDK (e.g. dynamic worker-loader provisioning), it falls back to wrangler with a clear log line saying which path was used.
- **Auth material never ships with the plugin**: `CLOUDFLARE_API_TOKEN` lives only in DSH credentials; `~/.cf/config.toml` is machine-local.

### 24.5 The `cf` CLI question (your "maybe cf cli" — answered)

The unified `cf` CLI (Cloudflare's "one CLI for everything", ~3000 API operations, npm `@cloudflare/cli` / binary) is **new and positioned as the eventual successor to wrangler for the *full* platform**, while wrangler remains the Workers-specific deploy tool. For dsh-righthand:

- **Do not depend on it for v1.** The SDK covers the deploy path; adding a second CLI (wrangler + cf) multiplies version/coexist risk.
- **Use it optionally for auth bootstrap and account discovery** (`cf auth login`, reading `~/.cf/config.toml`), because it is the more reliable OAuth flow than `wrangler login` in this environment.
- **Revisit in a later milestone**: when the cf CLI's deploy surface stabilizes, it can replace the wrangler fallback (one CLI instead of two) while the SDK remains the primary programmatic path.

### 24.6 Failure/UX mapping (so the agent can act, not guess)

| Symptom | Likely cause | Plugin action |
|---|---|---|
| SDK 401 | token missing/expired/revoked | surface "auth needed" + onboarding flow (§24.3) |
| SDK 403 | token scope too narrow | list required scopes; suggest the user re-issue the token |
| SDK 429 | rate limit | back off (respect `Retry-After`), surface as retryable |
| DO 1101 / runtime error | tool code failure at edge (not auth) | surface the real error; suggest `cf_revise` |
| wrangler exit ≠ 0 | exotic op not in SDK | log the fallback path + the exit; suggest upgrading SDK pin |
| no network / offline | machine offline | fail with clear message; never block on a login prompt |

### 24.7 Bottom line

The plugin's Cloudflare dependency story is: **SDK-first for everything programmatic, wrangler as a pinned fallback for the SDK's gaps and for local dev, the cf CLI as an optional auth-bootstrap convenience (not a v1 dependency), and `ctx.credentials` as the single source of auth truth** — resolved per operation, rotation-safe, never stored in settings, and never echoed. This keeps the plugin small, the token out of the repo/logs, and the "any device, same account" property intact.

---

## 25. The plugin UI (user-facing surface in the DSH web GUI)

The DSH web GUI (apps/web + `dsh-client-*` packages) has a well-defined plugin-UI model. dsh-righthand should build its UI on those seams rather than a sidecar app — it renders inside the same shell, reuses session/tool plumbing, and the agent + user stay in one context. This section first pins the seams (25.1–25.3), then the screens (25.4–25.8), then the data flow (25.9) and a staged rollout (25.10).

### 25.1 The seams the plugin can use (verified in the harness)

| Seam | What it is | How dsh-righthand uses it |
|---|---|---|
| `ctx.slots` (slot registry, declaration-merged `SlotMap`) | Register components into named slots | Tool-catalog panel + domain picker + per-tool details |
| `sidebar.footer.action` (list slot) | Frame-wide bottom actions | Righthand button opening the catalog panel |
| `shell.overlay` (list slot) | Frame-wide floating layer above columns, click-through | The catalog/domain panel or drawer itself |
| `conversation.details.tool` | The right Details column tool seat (selected tool output renderer) | Rich renderer for `cf_*` calls — deploy/invoke results with structure |
| `tool.call.toolview` (keyed slot) | Atomic per-tool call view dispatched by wire tool name | Custom compact card for each `cf_*` tool inside the message flow |
| `sidebar.settings` / settings scopes | Settings panel sections | The domain picker + auth status + flags (allowDynamicWorkflows, etc.) |
| `ctx.commands.register` | Slash commands | `/righthand` to open the panel, `/rh list`, `/rh status` |
| Host remote service (a class extending `TypertRemoteService` with `@Remote` methods, like the `commands` package) | Host↔client typed RPC | The catalog/domain/status API the UI calls |
| `ctx.locale` | Per-plugin i18n dictionaries | `righthand` locale keys (en/zh) |
| `ctx.theme` | Theme tokens | Consistent styling via the shell's theme variables |

### 25.2 The pattern to copy: how existing UI plugins do it

- `packages/client/ui-tool` registers the `conversation.details.tool` seat and `tool.call.toolview`; dsh-righthand registers its own keyed tool views and details renderer the same way.
- `packages/client/ui-settings-general` injects into `sidebar.settings`; dsh-righthand injects a `RighthandSettings` section (domain picker + flags).
- The `commands` package shows the host remote-service shape: `class CommandRuntime extends TypertRemoteService`, methods decorated `@Remote`, client calls through the generated remote namespace. dsh-righthand ships a matching `RighthandRuntime` remote service (listTools, getTool, listRuns, domains, invoke, revise, …) — UI and agent share the same verbs.

### 25.3 UI principles (so the UI stays honest and cheap)

1. **Read-mostly by default**: browsing the catalog, docs, code, and history must be zero-approval, offline-friendly, cached. Mutations (deploy, delete, share, promote) go through the *same approval gate as the agent* — the UI never bypasses `tools/pre-execute`.
2. **The UI is a thin client over the same verbs**: it renders what the registry returns; it never re-implements tool logic. One source of truth = D1 registry + Artifacts (§15), served by the host remote service.
3. **Live-first**: pull-to-refresh + a lightweight subscribe (registry change events, §15.3) so the panel updates as the agent works.
4. **Keyboard + search**: filter tools by kind/status/tag/domain; Cmd-K-style search (semantic via Vectorize when available, §18.3).
5. **i18n from day one**: every permanent UI string ships English + Simplified Chinese (zh-CN) with a visible en/zh toggle in the panel header. English is the canonical string; zh is a maintained translation, never a machine-only fallback. The active locale persists in the `righthand` settings namespace (`locale: 'en' | 'zh-CN'`) — the same namespace the agent reads/writes via `rh_settings_get/set`, so UI and agent share one source of truth (no UI = the setting alone is the toggle). The model-facing tool surface applies the same rule to `description` / `parameters.*.description` / `render()` text — bare literals are banned in favor of a `t(key, locale)` catalog. See PLAN.md ground rule #8.

### 25.4 Screen 1 — domain & authorization (the thing you asked for)

Goal: *the user chooses which Cloudflare domain/account/region the agent may create tools under.*

- **Domain selector** (settings section + panel header): pick from the discovered Cloudflare accounts (§24.5 via `cf` CLI / SDK `GET /accounts`). Each tool is created under the active domain; the picker shows the current selection + scope summary.
- **Per-domain policy card**: allowed kinds (worker / do / agent / workflow / dynamic-workflow / think-action / flue-agent), allowed bindings (D1, R2, KV, Vectorize, AI, Secrets Store), quotas (max tools, per-tool CPU/limit), approval mode (every deploy / only delete).
- **Auth status row**: token present? scopes? last verified? links to onboarding (§24.3).
- The agent reads the same policy via `cf_advise`/settings — **UI and agent enforce the same domain contract.**

### 25.5 Screen 2 — the registry browser (primitives / tools / blueprints)

One browser, three entity kinds, one search. The catalog is no longer just deployed tools — it exposes everything the plugin knows about, so reuse-before-build (§27) is the visible default:

- **Tabs**: **Native** (harness services/tools/events/slots, §35) | **Primitives** (starters, §27–29) | **Tools** (deployed/registered tools) | **Blueprints** (recipes, §31).
- **List rows** show, per entity: name, kind badge, **Starter / Blueprint badge** when applicable, status (draft / proposed / deployed / local-ok / retired), domain, tag, version, last invoked, owner, plus **matched keywords/use_cases** when a search hit (§30).
- **Filter/search**: by kind, status, tag, domain, starter_tier, substrate; full-text + **semantic** (Vectorize over §30 metadata, D1 LIKE fallback). One query box searches all three tabs.
- **Row actions** (guarded by scope + approval): tools — invoke, open, fork, edit, promote, share, delete; starters — use, fork, edit, deploy; blueprints — expand, instantiate, fork, edit.
- **Detail navigation**: clicking a row opens the matching detail — tool detail (Screen 3), a starter's detail (schema, metadata, —fork this starter—), or a blueprint's detail (recipe, ingredients, expand/instantiate).
- **cf_suggest surface**: a pinned card in the browser showing the last suggestion (gate verdict + recommended starter/blueprint + why) so the user sees the reuse decision, not just its result (§27.7).
- **Empty state**: no tools yet — show the starters + a Mode A/B entry point instead of a blank list.

### 25.6 Screen 3 — tool detail (code / docs / versions / forks)

- **Tabs**: Overview | Code | Docs (`TOOL.md` §20) | Versions | Forks | Runs.
- **Overview**: schema, bindings, invoke target, status, owner, quota.
- **Code**: read-only syntax-highlighted `entryCode` (editable via a guarded edit action that goes through approval), copy to clipboard, download artifact.
- **Docs**: the living `TOOL.md` (from Artifacts), rendered; regenerate hint when stale.
- **Versions**: timeline of deploys; diff between versions; rollback (approval-gated).
- **Forks**: who forked from where (graph); fork button.
- **Runs**: execution history for this tool (see Screen 4).

### 25.7 Screen 4 — execution history

- **Per-tool + global run list**: timestamp, caller (agent/user), status, duration, input summary, output summary, error.
- **Per-run detail**: full JSON in/out, logs (R2 tail), error stack, retry / re-run (approval-gated).
- **Filters**: by tool, status, date range, caller. **Export**: JSON/CSV of a run or a range.

### 25.8 Screen 5 — sharing & hub (stage 2, §22)

- In the **registry browser row actions**: share opens the grant editor (grantee, scope, quota) — this is the future Righthand Hub surface, pre-figured in the plugin UI.
- Shared-with-me sub-list for grantees.

### 25.9 Data flow (UI ↔ host ↔ registry)

`
Web UI (React components in slots)                     Host (dsh-righthand)
-----------------------------------------------------------------------------------------
registry browser ── listNative() / listPrimitives() / listTools() / listBlueprints() ──► RighthandRuntime @Remote
                  (one query, three kinds, §25.5)          listPrimitives / listTools / listBlueprints
                                                         └─► registry Worker (D1) / Artifacts
starter/blueprint detail ── getStarter(id) / getBlueprint(id) ──► read Artifacts + D1 row
tool detail   ── ctx.remote.righthand.getTool(id) ──►   read Artifacts + D1 row
runs          ── ctx.remote.righthand.listRuns(filter)─► R2 log index
invoke/deploy/instantiate ── approval gate (tools/pre-execute) ──► same verb the agent uses
registry change events ──► UI subscribe (live refresh)
`

Everything the UI shows is what the agent's verbs already produce — the UI adds zero second sources of truth, and the approval gate is *shared*, not duplicated.

### 25.10 Staged rollout (aligns with the §7 sketch; the current ladder is PLAN.md M0–M7)

> **UI rollout is a parallel track** to the backend milestone ladder (`PLAN.md` M0–M7); label it R1–R4 to avoid reusing the M-numbers. R1–R3 land by PLAN M4; R4 is deferred to M7.

1. **R1**: Settings section (domain picker + auth status) + catalog panel (read-only list) over the host remote service. Zero approval surface.
2. **R2**: Tool detail (code + TOOL.md + versions) + runs list; keyed `tool.call.toolview` cards for `cf_*` calls in the message flow.
3. **R3**: Guarded actions (invoke / edit / promote / delete) through the shared approval gate; diff view; semantic search.
4. **R4 (§22)**: sharing + hub UI surfaces on top of the same registry.

### 25.11 What else the UI needs (things you asked to consider)

- **Entity surfaces**: starters, tools, and blueprints each get a detail view (schema + metadata + recipe for blueprints) and distinct badges in lists (§25.5).
- **Blueprint affordances**: expand recipe (read-only), instantiate (guarded), fork a blueprint before instantiating.
- **Metadata/health**: show keywords/use_cases/capabilities + cost_hint per entity (§30); show metadata freshness (re-embedded at last mutate).
- **Empty/onboarding state** — first-run: token + domain setup walkthrough; the browser defaults to the Primitives tab so reuse is the first thing seen.
- **Error surfacing** — map SDK 401/403/429/DO-1101 to user-readable banners (§24.6), retry buttons.
- **Status pills / badges** — draft / proposed / deployed / local-ok / retired, Starter / Blueprint badges, per-tool quota usage.
- **Search (Cmd-K style)** — across primitives, tools, blueprints, docs, and runs; keyboard-first; semantic via Vectorize when available.
- **Export/audit** — CSV/JSON export of runs; a who-invoked-what audit view (important for the sharing stage).
- **Locale** — en/zh dictionaries via `ctx.locale`.
- **Accessibility & theme** — follow the shell's theme variables and a11y conventions.
- **Diff/compare UX** — side-by-side version diff before promote/rollback (approval clarity).

### 25.12 Bottom line

The UI is not a sidecar app: it is a set of slot registrations (registry browser via `shell.overlay` + `sidebar.footer.action`, settings section, tool details seat, keyed tool views) over one host remote service (`RighthandRuntime`) that exposes the same verbs the agent uses. The registry browser now spans **primitives, tools, and blueprints** with one search, so reuse-before-build is the visible default. The user-facing additions that matter most beyond the obvious code/history: **the domain picker + per-domain policy** (your ask), **the onboarding/auth-status surface**, **guarded actions through the shared approval gate**, **starter/blueprint detail surfaces**, **run export/audit**, and **the sharing/hub surfaces** (§22) — all additive to the DSH shell, none of them a second app.

---

## 26. Can the primitives/tools run locally? (local emulation story)

Short answer: **yes for compute, partially for platform services — and the plugin should treat local as a first-class pre-deploy phase, not an afterthought.** This matters because a reusable cloudtool should be *safe to develop and iterate without an account*, and because the agent's test loop (§10) is much faster locally than deploy→invoke→tail.

### 26.1 What runs locally today (per primitive)

| Primitive | Local emulation | How | Notes / caveats |
|---|---|---|---|
| **Worker** (fetch handler) | Full | `wrangler dev` runs the real `workerd` runtime via Miniflare | Same runtime, real bindings emulation; the gold standard. |
| **Durable Objects** | Yes (Miniflare) | `wrangler dev` emulates DOs incl. SQLite-backed state | Historically some gaps; current Miniflare 4 is the maintained path. Test DO logic locally before deploy. |
| **Workflow** | Partial | orchestration runs locally, but `step.sleep`/`step.waitForEvent` + long timers are simplified | Use short simulated timers locally; real durations only in remote. |
| **Dynamic Workflow** | Partial | Loader runs locally; beta behavior may differ | Gate behind `allowDynamicWorkflows`; treat remote as source of truth. |
| **Think agent** | Yes | Think is an Agents-SDK DO → emulated like DOs locally | Verify streaming/session locally. |
| **Flue agent** | Yes | Flue Cloudflare target generates DOs → Miniflare | Same as DO row. |
| **AI (Workers AI)** | Remote-only by default | `wrangler dev --remote` uses live Workers AI | Local has no model weights; stub/mock models locally. |
| **Vectorize** | Remote-only | live index via `--remote` | Local emulation is limited; semantic search needs remote. |
| **D1** | Yes | local SQLite file via Miniflare | Local state is a local file; deploy applies migrations to remote. |
| **R2** | Yes | local emulation in Miniflare | Local bucket lives in `.wrangler`. |
| **KV** | Yes | local emulation | Same local-file model. |
| **Queues** | Partial | local emulation exists; delivery semantics differ | Test basic flows locally; verify ordering/delivery remotely. |
| **Cron / scheduled** | Partial | `wrangler dev` supports cron locally; schedule is emulated | Real cron only in remote. |
| **Secrets Store / secrets** | Remote-only | live via `--remote` | Secrets never exist locally; use `.dev.vars` for local values. |
| **Containers / Sandbox SDK** | Docker-required | Sandbox SDK needs Docker locally | Local sandbox = Docker; remote = Cloudflare containers. |
| **Service bindings / RPC** | Yes | local across the same `wrangler dev` session | Multiple workers emulated together. |

### 26.2 The two local modes and what the plugin should expose

1. **local (default)**: everything is emulated inside Miniflare on your machine; **no account, no token, no network needed** — ideal for the agent's fast validation loop and for offline work.
2. **remote (live bindings)**: local *compute* + real Cloudflare *services* (Workers AI, Vectorize, real D1/R2/KV, Secrets Store). Requires the token (same §24 auth) and hits real resources — **must go through the same approval gate as deploy.**

dsh-righthand should expose **both** as distinct verbs/statuses, because they are different trust levels:

`
cf_test    --local    # Miniflare, no account needed. Fast loop. (default for cf_test)
cf_test    --remote   # real services behind live bindings; approval-gated like deploy
`

### 26.3 How the plugin's pipeline uses local (the recommended loop)

`
cf_define / cf_draft ──► cf_test --local (no account) ──► deploy (approval) ──► cf_invoke / cf_describe
      ▲                     ▲                                 │
      └──── cf_revise ◄─────┘ (iterate locally again)         └─► cf_test --remote (only when bindings need real services)
`

1. **Author** → validate syntax/schema (already in §12).
2. **cf_test local**: boot the worker/DO/workflow in Miniflare; run the invoke contract against it; assert JSON-in/JSON-out. Zero account. Catch runtime errors before deploy.
3. **Deploy** (approval) → **cf_invoke** → **cf_describe** (tail).
4. If the tool needs Workers AI / Vectorize / real Secrets, run **cf_test remote** (approval-gated) *before* deploy to validate bindings against real services.

### 26.4 What local can't do (be explicit so the agent doesn't over-trust local)

- **No real model inference** (Workers AI) — local is stub/mock only; remote needed for real model quality/behavior.
- **No real Vectorize search** — index semantics validated remotely.
- **No real scheduling / long timers / queue delivery guarantees** — orchestration tested with simulated timers.
- **No real Secrets Store** — use `.dev.vars` for local values; never ship local secrets.
- **No real edge network semantics** (cold starts, regions, DO 1101-style runtime quirks) — those only appear remotely.
- **Miniflare is not production** for DO SQLite edge cases and Dynamic Workflows (beta) — validate, then deploy, then verify.

### 26.5 The local harness wrapper (what the plugin ships)

To make `cf_test` ergonomic, the plugin generates a small **local harness** alongside each tool (stored with the artifact, not deployed):

- a `wrangler dev`/`miniflare` config fragment + a **fixture driver** that calls the tool's invoke contract locally and asserts the output schema;
- `.dev.vars` template with placeholder local bindings (never real secrets);
- a `--remote` variant that flips to live bindings when the user/agent approves it;
- a `--watch` mode so the agent can iterate: edit entryCode → hot-reload → re-run assertions (the DSH-native fast loop, mirrored locally).

This is also where **Sandbox SDK** (§18.3) can fit: for code that must run in a real sandbox pre-deploy, `cf_test --sandbox` uses `@cloudflare/sandbox` + Docker locally and the same tool code remotely — a second, stronger test tier than plain Miniflare.

### 26.6 How this changes the verb surface and docs

- New verb **cf_test** (with local / remote / sandbox / watch), distinct from `cf_invoke` (which always targets the deployed tool).
- Tool status gains **local-ok** vs **deployed**: a tool can be locally-validated but not yet deployed — the catalog (§25.5) shows both.
- `TOOL.md` (§20) gains a **Test / iteration history** section that records which local mode was used and the last `cf_test` result.
- **Composition note**: tools composed of bindings to *other* tools (§10/§14.4) can be tested locally *together* in one `wrangler dev` session (service bindings are emulated) — so the composition loop also works offline.

### 26.7 Bottom line

Yes — Workers/DOs (incl. Think/Flue agents) and D1/R2/KV run locally in Miniflare with **no account needed**, which the plugin should use as its default pre-deploy test phase; AI/Vectorize/Secrets need remote live bindings (approval-gated like deploy); Workflows/Queues/Cron are emulated but simplified. The plugin's honest rule: **local proves the code; remote proves the platform — never confuse the two.**












---

## 27. When to use the plugin (the judgment layer) + starter tool primitives

The missing piece is a **gate**: not every task should create a tool. A tool is justified only when it pays back its own cost (authoring, deploy, registry, docs, ongoing maintenance). This section gives the agent a concrete decision rule, per-primitive guidance, a **starter toolkit** so the agent never builds from zero, and worked use cases.

### 27.1 The default is NO tool

The agent must be biased **against** building a tool unless the task clears the gate. A tool adds: authoring time, a deploy (approval + spend), a registry row, self-documentation, versioning, and future maintenance — cost the task may not repay. The correct default for a one-off, ad-hoc task is: **use existing tools (`run_code`, `ctx.subprocess`, the registry) directly, and do not create anything.**

### 27.2 The gate: ask these four questions before building

```
1. Reuse?     Does an existing tool (registry or starter kit) already do this?        → USE IT (fork/extend if 90%+ fits).
2. Repeat?    Will this exact operation recur across sessions/devices/agents?          → candidate.
3. Stateful?  Does it need memory, shared counters, scheduling, or long-running steps?  → candidate (stateless one-shot: still a candidate only if reusable).
4. Payback?   Is (times reused x time saved) > (build + deploy + maintain cost)?          → BUILD. Else do it inline.
```

Concretely: **one inline computation in one session = inline (no tool). The same computation the user asks for again next week, or that another tool should call = build it.** The rule of thumb: build for **reuse, persistence, or composition**, not for the current turn.

### 27.3 What each primitive can do, when to use it, and why (the selection guidance)

| Primitive | What it can do | Use when | Why / not |
|---|---|---|---|
| **Worker** | Stateless one-shot JSON-in/JSON-out compute, fetch, transforms | Pure function you'll reuse; no state | Cheapest, global, cold-start; use for slugify-class tools |
| **Durable Object** | Stateful, globally consistent, SQLite 10GB/obj | Shared kv/counters/queues/session state; anything that must survive restarts | The state primitive; DO=SQLite is the workhorse |
| **Agent (Agents SDK)** | Stateful + LLM loop, memory, tools, scheduling, RPC | Tools that need to think/summarize/plan with memory, or the toolsmith itself | Heavier; use only when the tool must call a model with state |
| **Workflow** | Durable multi-step: steps, sleep, waitForEvent, retries | Orchestration: onboard, reconcile, migrate, anything with human-in-the-loop waits | Survives restarts; the right primitive for long-running, multi-step jobs |
| **Dynamic Workflow** | Workflow whose definition is loaded at runtime (beta) | Tools where the workflow shape itself is data-driven / user-supplied | Beta; the Mode B target (§14.3) |
| **Think action** | Idempotent, approval-gated, authorized action + code exec | Tools needing approvals/authz/idempotency out of the box | The harness does the gate, not your code (§23) |
| **Flue agent** | Hook-composable, sandboxed steps (beta) | Tools you want authored as composable hooks with sandboxed execution | Beta; higher-level authoring convenience (§23) |
| **Bindings (D1/R2/KV/Vectorize/AI/Secrets/Queue/Cron)** | Data, search, models, secrets, async delivery, schedules | Attached to any kind as add-ons | Choose per need: D1=relational, R2=objects, KV=flags, Vectorize=semantic search, AI=models, Secrets=credentials, Queue=async, Cron=schedule |

### 27.4 The starter toolkit: fundamental primitives packaged with the plugin

dsh-righthand should ship a small set of **built-in, ready-to-use tools** (pre-defined entry code + schema + docs, still deployed/forkable like any tool). The agent starts by *using* these, then extends, forks, or replaces them. This kills the empty-registry cold start and demonstrates every substrate.

| Starter tool | Substrate | What it does | Typical use case |
|---|---|---|---|
| righthand/kv | Durable Object | Typed get/set/delete/increment/expire key-value store | Session memory, feature flags, counters, cache shared across devices |
| righthand/queue | Queue + DO | Enqueue tasks, process async, dedupe | Fire-and-forget jobs, webhooks, backpressure |
| righthand/scheduler | Cron + DO | Schedule one-off/recurring calls with payload | Reminders, digests, cleanup jobs |
| righthand/transform | Worker | Pure transforms: slugify, normalize, encode, hash, validate | The reusable stateless utility |
| righthand/vector-store | Vectorize + D1 | Store/search embeddings, metadata filter | Semantic search over docs/tools/history (§18.3) |
| righthand/ask-ai | Agent | Call a model with a prompt + optional memory | The tool-that-thinks building block (Workers AI / AI Gateway) |
| righthand/workflow-runner | Dynamic Workflow | Run a user/agent-supplied workflow definition | Data-driven orchestration; Mode B output target |
| righthand/approve | Think action | Human approval-gated action with idempotency | Do-X-but-ask-me-first tools (§23) |
| righthand/sandbox-run | Sandbox SDK | Run untrusted code in a sandbox | Code interpreters, eval, third-party scripts |
| righthand/webhook | Worker + Queue | Receive a webhook, validate, store, fan-out | Integrations, inbound events |

These are **starting points, not a closed set** — every one is forkable and editable (§16), and the catalog (§25.5) presents them with use / fork / edit actions. The agent's mental model: **start from righthand/kv and add a bump that expires** rather than authoring a DO from scratch.

**Each starter also ships a template kit** (`entry.ts` + `schema.ts` + `test.ts` + `README`) — runnable locally with zero account/installs, per the template-kit contract (§31.8). The starter table above is the *index*; the template is the *artifact* the agent actually forks.

### 27.5 Worked examples with use cases (what to build, and what NOT to build)

**Build (clears the gate):**

- *Remember this preference across all my devices* → righthand/kv (or fork it): state + cross-device, reused constantly.
- *Every Friday summarize the week's righthand runs and email me* → fork righthand/scheduler + righthand/ask-ai: recurring + composition.
- *When a GitHub webhook fires, validate it and run a deploy* → righthand/webhook + righthand/workflow-runner: inbound + multi-step.
- *Let me search my tool docs semantically* → righthand/vector-store (already packaged): Vectorize over TOOL.md docs.
- *A tool that sends an email but asks me first* → righthand/approve (Think action): approval is the framework, not your code.
- *Run this untrusted script safely* → righthand/sandbox-run: sandboxing.

**Do NOT build (fails the gate) — do inline instead:**

- *Slugify this one string now* → run_code one-liner. (Build righthand/transform only when it recurs.)
- *Look up this one fact* → web search / model, not a new tool.
- *Temporary debug counter for this session* → ctx.storage local cache, not a DO.
- *Parse this one file* → run_code; a parser tool is justified only if parsing recurs and is worth its own schema+deploy.

### 27.6 Local vs Cloudflare (run where? ties to §26)

- **Local (`cf_test --local`)**: always first — proves the code, zero account, fast. Also the *default runtime* for tools whose only state is the user's machine (no cross-device need): a one-user transform never has to deploy.
- **Cloudflare (deploy)**: when the tool must be (a) **reused across devices/sessions**, (b) **composed by other tools** (needs an invokeTarget), (c) **stateful/scheduled/async** beyond one process, or (d) **shared** (§22).
- **The decision is the same gate, applied to runtime**: *if it only ever runs for one user on one machine in one session, keep it local; if it crosses any of those boundaries, deploy it.*

### 27.7 How the guidance ships to the agent

- **Bundled skill**: righthand-when-to-build — the §27.2 gate + §27.3 table + starter-kit catalog, loaded before any build decision (§19.1).
- **cf_advise**: the toolsmith re-runs the gate with account-specific facts (cost, existing tools, quotas) when the bundled skill can't decide.
- **UI reinforcement**: the catalog's use / fork affordances (§25.5) make reuse the visible default, so the agent reaches for an existing tool first.
- **A new verb cf_suggest** (optional): given a task description, returns the gate verdict + recommended starter/primitive + a one-line reason — making the judgment explicit and auditable before any build.

### 27.8 Bottom line

**Default no-tool; build only for reuse, persistence, or composition; start from the packaged starter kit and fork before you author; run local by default and deploy only when the tool crosses device/session/composition/sharing boundaries.** The gate is the same four questions for build *and* runtime, and both the skill and cf_suggest make it legible to the agent so the decision never happens silently.


---

## 28. Extended starter kit: capability primitives (perception & retrieval)

Beyond the §27.4 substrate starters, a second tier of **capability primitives** fills gaps the host model may not have: image input, audio input, web search, and page rendering. The flagship is **righthand/vision**, which exists precisely so agents running on text-only LLMs can still consume images by delegating to a Cloudflare vision model.

### 28.1 The capability tier (additions to the starter kit)

| Starter tool | Substrate | What it does | Typical use case |
|---|---|---|---|
| righthand/vision | Worker + Workers AI (vision model) | image → structured description OR full extracted text (schema chooses mode) | **Text-only LLMs reading images**: screenshots, diagrams, photos, charts |
| righthand/ocr | Worker + Workers AI (vision, text-optimized) | image → raw text (preserves layout/table/order) | Extract text from PDFs/scans/screenshots; receipts; forms |
| righthand/transcribe | Worker + Workers AI (Whisper) | audio/video → transcript (with chunking) | Voice memos, meetings, podcast notes; captioning |
| righthand/web-search | Worker + AI Gateway web search | query → results (title/url/snippet/date) | Fresh facts, current events, citations |
| righthand/web-fetch | Worker (fetch + optional Browser Rendering) | url → clean text/markdown (auto: static fetch, JS-heavy → rendered) | Read a page's content; follow links; extract article body |
| righthand/browse | Browser Run / Kitesurf (agent-first browser) | url → interactive agent-driven browsing | Multi-step navigation, forms, auth-gated pages, screenshots |
| righthand/screenshot | Worker + Browser Rendering | url → PNG image (viewport/full-page) | Visual QA; archive a page as an image; feed into righthand/vision |

### 28.2 The vision tool (your exact idea, made concrete)

The point of righthand/vision is to **decouple image understanding from the host model's modalities**: a text-only LLM passes an image (or a URL/path) to the tool, and the tool runs a Cloudflare vision model at the edge and returns text.

**Why Workers AI**: the model (Moondream 3.1, Llama 3.2 11B Vision — verified on Workers AI) runs *on Cloudflare*, so the tool needs no external API key, and the plugin's existing Workers AI binding + auth path (§24) already covers it. No extra vendor dependency.

**Contract (schema):**

```json
{
  "type": "object",
  "properties": {
    "image": { "type": "string", "description": "Image as data URL / base64, or an https:// URL." },
    "mode": { "enum": ["description", "full_text", "qa"], "default": "description" },
    "question": { "type": "string", "description": "Required when mode=qa." }
  },
  "required": ["image"]
}
```

- **description** → one structured paragraph: what it is, key elements, layout, any text present.
- **full_text** → all text in reading order (this is what makes it an OCR fallback for text-only models).
- **qa** → answer a specific question about the image (charts: values; diagrams: relationships).

**Composition**: righthand/screenshot → righthand/vision = "screenshot this page and tell me what's on it" — two capability tools chained, both run on Cloudflare, neither needs the host model to see images.

### 28.3 Web search & fetch (the retrieval pair)

- **righthand/web-search** uses **AI Gateway's web search tool** (provider-native, e.g. Perplexity/Parallel, or search-first providers) so results come back with citations — better for agents than scraping a search engine. Falls back to a plain fetch of a search endpoint when AI Gateway web search isn't enabled.
- **righthand/web-fetch** has two paths: **static fetch** (fast, most pages) and **Browser Rendering** (JS-heavy SPAs, cookie walls) — chosen by a per-URL heuristic or an explicit render flag. Output is clean markdown/text, not raw HTML, so a text-only model can consume it directly.
- **righthand/browse** (Browser Run / Kitesurf) is the heavier tier: an agent-first browser for multi-step navigation (forms, login, dynamic apps). Keep it separate from web-fetch so the cheap path stays cheap.

### 28.4 OCR & transcription (the other perception gaps)

- **righthand/ocr** is righthand/vision specialized for text: runs the vision model with a text-preserving prompt (order, tables, columns) and returns plain text — covers PDFs, scans, receipts, forms, screenshots of code/errors.
- **righthand/transcribe** runs **Whisper-large-v3-turbo** on Workers AI with chunking (the documented pattern) — audio and video-in → transcript; the text-only-model analog of vision for audio.

### 28.5 Rules these primitives must obey

1. **Capability primitives are still normal tools**: same schema/invoke/doc/version/fork lifecycle (§20, §16); they just happen to ship pre-built. The agent forks righthand/vision into "read-my-dashboard-screenshot" the same way it forks righthand/kv.
2. **Mode is in the schema, not the model**: the tool's mode enum keeps prompt engineering *inside* the packaged tool, so the agent never hand-crafts model prompts at the call site.
3. **Perception tools are Workers AI-backed by default** (no external key), with an optional AI Gateway routing override so users can pick provider/model per tool — consistent with §24 and the ask-ai starter.
4. **Cost & approval**: vision/ocr/transcribe/search are *paid* Workers AI/AI Gateway calls; invoke is read-only but may incur cost, so these tools carry a cost_hint in their manifest and (like deploy) can be **quota-gated** per user/agent (§25.4 domain policy).
5. **Local note (§26)**: vision/ocr/transcribe/search are **remote-only** (Workers AI + live services); the agent uses cf_test --remote for them. web-fetch/browse/screenshot are remote too (network), so the capability tier is effectively a Cloudflare-runtime tier — which is exactly why it exists: to give text-only local models a *cloud* perception path.

### 28.6 Updated starter-kit shape

The starter kit is now two tiers: **substrate primitives** (§27.4: kv, queue, scheduler, transform, vector-store, ask-ai, workflow-runner, approve, sandbox-run, webhook) + **capability primitives** (§28.1: vision, ocr, transcribe, web-search, web-fetch, browse, screenshot). The catalog (§25.5) can show a **Starter** badge so reuse stays the visible default, and cf_suggest (§27.7) recommends from both tiers.

### 28.7 Bottom line

Yes — web search, web fetch, and a vision tool are all feasible and valuable, and the vision tool is exactly the right use of Workers AI: **give text-only agents an edge-hosted eye** via righthand/vision (description / full_text / qa modes), plus ocr and transcribe for the other perception gaps, web-search + web-fetch + browse + screenshot for retrieval, all packaged as normal forkable tools on the same lifecycle.


---

## 29. Remaining starter primitives (same substrates, nothing new)

Everything below is a **composition of the substrates we already have** (§14, §18.5) — no new Cloudflare services, no exotic betas. The point is to round out the kit so the agent almost never has to author a primitive from scratch. Each is one line: what it is, what substrate it uses, when it earns its keep.

### 29.1 State, limits & config

| Starter | Substrate | What / when |
|---|---|---|
| righthand/config | D1 + Worker | Typed, schema-validated settings & feature flags shared across tools/sessions — like kv but *structured* (kv is raw bytes; config enforces a schema). |
| righthand/counter | Durable Object | Atomic increment/decrement/read/reset with optional TTL and max — the building block for stats, quotas, streaks, usage meters. |
| righthand/rate-limit | Durable Object | Sliding-window limiter (per key, per minute/hour) — guards *other* tools from overuse; compose it in front of ask-ai/vision/search. |

### 29.2 Data & large objects

| Starter | Substrate | What / when |
|---|---|---|
| righthand/file | R2 + Worker | Put/get/list/delete blobs + presigned URLs — large files, binaries, artifacts. Complements kv (small values) with an object store. |
| righthand/cache | KV/R2 + Worker | Memoize a function result by input hash with TTL — expensive tool calls (search, model, fetch) don't repeat. |

### 29.3 Model outputs, structured

| Starter | Substrate | What / when |
|---|---|---|
| righthand/extract | Worker + Workers AI | text -> **validated JSON** (a schema you supply): entity/field extraction, form filling, document parsing. ask-ai is free-form; extract guarantees a shape. |
| righthand/classify | Worker + Workers AI | text -> label/triage/score (enum you supply): routing, moderation, intent, spam/priority. |
| righthand/embed | Worker + Workers AI | text/image -> vector — standalone embedding so tools can precompute vectors for righthand/vector-store. |

### 29.4 Outbound & notification

| Starter | Substrate | What / when |
|---|---|---|
| righthand/notify | Worker (+ Queue) | Fan a message out to webhooks/email/chat channels, retry on failure — the *outbound* complement to righthand/webhook (which is inbound). |

### 29.5 What NOT to add (already covered, or better as a composition)

- **A separate cron/timer tool** -> righthand/scheduler already covers Cron; DO alarms are a scheduler variant, not a new primitive.
- **A generic workflow runner** -> righthand/workflow-runner (Dynamic Workflow) already runs arbitrary step definitions; a hard-coded pipeline is just a fork of it.
- **A pub/sub / realtime room** -> genuinely useful, but it's an Agents-SDK room + DO, and most agents don't need it early — add it later as a fork, not now.
- **Anything requiring a new Cloudflare service** (email, browser, computer, pipelines, hyperdrive, WfP) -> out of scope for the starter kit per this design; each can be a *user* fork later, never a dependency of the core kit.

### 29.6 Full starter-kit rollup (final)

- **Substrate tier (§27.4)**: kv, queue, scheduler, transform, vector-store, ask-ai, workflow-runner, approve, sandbox-run, webhook.
- **Capability tier (§28.1)**: vision, ocr, transcribe, web-search, web-fetch, browse, screenshot.
- **State & limits (§29.1)**: config, counter, rate-limit.
- **Data (§29.2)**: file, cache.
- **Structured model (§29.3)**: extract, classify, embed.
- **Outbound (§29.4)**: notify.

That's **25 starters, all on five substrates (Worker / DO / Agent / Workflow / Dynamic Workflow) plus the standard bindings**, which is enough coverage that the agent's normal first move is fork-and-tune rather than author-from-scratch. Stop here — more starters would just be forks of these with different names.


---

## 30. Starter index metadata (keywords + use cases for discovery)

The starter kit is only useful if the agent *finds* the right primitive. So every tool in the registry — and every starter in particular — carries a **metadata block** designed for semantic + keyword search, not just a display name. This is what makes semantically-related discovery work (§18.3 Vectorize) and makes cf_search / cf_suggest / the catalog search (§25.5) actually good.

### 30.1 The metadata schema (one block per tool)

| Field | Purpose | Notes |
|---|---|---|
| name | canonical id | e.g. righthand/vision |
| kind | primitive kind (§14) | worker / do / agent / workflow / dynamic-workflow / think-action / flue-agent |
| description | one-paragraph what-it-does | the human + embedding-facing summary |
| keywords | free-form synonyms | **the critical field** — broad, colloquial, and technical terms alike |
| use_cases | verb-phrase scenarios | text-only LLM needs to read an image — matches *why* someone searches |
| capabilities | noun-verb capability tags | image-to-text, ocr, visual-qa, rate-limiting, kv, cron |
| inputs / outputs | expected types | image url, base64, text, json |
| cost_hint | paid / free / per-call | feeds the §27 gate and quota UI |
| runtime | local / cloudflare / hybrid | ties to §26 |
| substrate | array of concrete substrates | worker, do, workers-ai, d1, r2, kv, vectorize, queue, cron |
| starter_tier | substrate / capability / state / data / model / outbound | the §27–29 tier |
| forks_from | null or a starter name | lineage (§16) |
| related | array of names | explicit cross-links for the catalog's also-see |

### 30.2 How it feeds search (the discoverability pipeline)

1. **Embed at write time**: the plugin concatenates `description + keywords + use_cases + capabilities` into one embedding document and upserts it to Vectorize (§18.3), with name/kind/starter_tier/substrate as metadata filters. Plain-text fallback: D1 LIKE over keywords + use_cases.
2. **cf_search --semantic query** -> returns ranked starters with the *why* (matched keywords/use_cases) so the agent can see the match, not just the result.
3. **cf_suggest (task)** -> embeds the user's task sentence and returns the top-N starters + the gate verdict (§27.7) — the keyword field is what makes a loose request like 'I want it to look at this image' land on righthand/vision.
4. **Catalog search (§25.5)** -> the same query hits both Vectorize (semantic) and D1 (keyword), merged; the **Starter** badge + use_cases are shown in the row so the agent/user can decide in one glance.

### 30.3 Example metadata (concrete)

righthand/vision:

```json
{
  "name": "righthand/vision",
  "kind": "worker",
  "description": "Return a description, full extracted text, or a QA answer for an image.",
  "keywords": ["image", "vision", "ocr", "screenshot", "picture", "photo", "diagram", "chart", "multimodal", "describe", "see", "read-image"],
  "use_cases": ["text-only LLM needs to read an image", "describe a screenshot/diagram", "extract text from a photo", "answer a question about a chart"],
  "capabilities": ["image-to-text", "ocr", "visual-qa"],
  "inputs": ["image url", "base64 image", "data url"],
  "outputs": ["text", "json"],
  "cost_hint": "paid Workers AI inference",
  "runtime": "cloudflare",
  "substrate": ["worker", "workers-ai"],
  "starter_tier": "capability",
  "forks_from": null,
  "related": ["righthand/ocr", "righthand/screenshot", "righthand/transcribe"]
}
```

And righthand/kv (contrast — showing the field works for a state primitive too):

| Field | Value |
|---|---|
| keywords | store, save, get, key-value, kv, cache, flag, counter, state, shared, remember, persistent, across-devices |
| use_cases | remember a preference across devices, shared counter, feature flag, session memory, cross-session state |
| capabilities | key-value, increment, expire, persistent-state |
| inputs | key, value, ttl |
| outputs | value, json |
| cost_hint | free (DO runtime only) |
| substrate | do |
| starter_tier | substrate |
| related | righthand/config, righthand/counter, righthand/cache |

### 30.4 Rules for the metadata (so it stays searchable, not stale)

1. **Keywords are the author's contract**: when the DSH agent or toolsmith authors/forks a tool, it MUST write keywords + use_cases — the schema requires them (not optional). §20 self-documentation regenerates them alongside TOOL.md.
2. **Colloquial + technical**: keywords include what a *user* would say (see, look at, read this picture) and what an *agent* would say (image-to-text, ocr, multimodal) — discovery is for both.
3. **Re-embed on every mutating verb** (define/redefine/fork/edit/promote): the Vectorize row is part of the tool's canonical state, updated in the same transaction as the D1 row and Artifacts.
4. **related is curated, not automatic**: only link tools that genuinely compose (§10); never auto-link by substring match.
5. **Starter metadata ships with the plugin** (the 25 starters' blocks are bundled), so semantic search works on day one before the user builds anything.

### 30.5 Bottom line

Add a **keywords + use_cases + capabilities** metadata block to every tool (required), embed it into Vectorize at write time, and let cf_search / cf_suggest / the catalog all query the same index. The keywords field is what turns 'ask for something semantically related' into 'find righthand/vision' — and because starters ship with this metadata pre-filled, discovery works from the first session.


---

## 31. Blueprints: composable recipes for primitives

Starters are *atoms*; **blueprints** are the *molecules* — named recipes that wire two or more primitives together for a recurring goal. They answer the question "how do I build a web scraper?" (web-fetch + vision + vector-store, §31.3) before the agent has to figure out the composition itself. A blueprint is a **declarative spec**, not a deployed tool: it says *what to combine, how, and into what kind of tool*, and the agent can cf_instantiate it into a working tool.

### 31.1 Blueprint schema (one spec per blueprint)

| Field | Purpose |
|---|---|
| name | canonical id, e.g. blueprint/web-scraper |
| description | one-paragraph goal |
| keywords / use_cases | same discovery contract as tool metadata (§30) |
| ingredients | the starters/primitives it composes (with roles) |
| recipe | ordered composition steps — how they call each other, what passes between them |
| kind | the resulting tool kind (§14) |
| invoke_contract | the single input/output schema the composed tool exposes |
| config_variants | optional knobs (depth, rate-limit, model, output format) |
| cost_hint | aggregate cost of the composed tool |
| pitfalls | known failure modes / gotchas for this recipe |
| local_limits | what the **local** (in-repo, no-account) version cannot do — per-implementation, not per-ingredient |
| cloud_limits | what the **cloud** (CF-account) version still cannot do, or now costs |
| related | other blueprints or starters it extends |
| template | the **template code** shipped with it (entry file + test + LEARNINGS), see §31.8 — same template-kit contract as starters and tools |

### 31.2 How blueprints are used

1. **cf_blueprint --list / --search query** → same metadata index as starters (§30), plus a blueprint kind filter.
2. **cf_suggest (task)** → if the task matches a blueprint's keywords/use_cases better than a single starter, suggest the blueprint first (e.g. scrape that site → blueprint/web-scraper).
3. **cf_instantiate (blueprint, overrides)** → generates the composed tool: pulls the named starters' schemas, wires the recipe, emits the entry code + manifest, and registers it as a *new* forkable tool (lineage points at the blueprint + ingredients, §16).
4. **cf_blueprint --expand (blueprint)** → prints the full recipe + the generated entry so the agent can read, edit, or fork the *blueprint itself* before instantiating.

### 31.3 Example blueprints (the web scraper you named, plus a few)

**blueprint/web-scraper** — fetch a page, extract its content, and make it searchable.

| Field | Value |
|---|---|
| ingredients | righthand/web-fetch (retrieve; **render is cloud-only**), righthand/extract (text/title/headings/links) as the core; **optional** righthand/vision or righthand/ocr (image-heavy targets only); local keyed-index (title/heading-boosted token search) as the default, righthand/vector-store as the scale-up |
| recipe | web-fetch(url) → extract text+structure → keyed-index (local) or embed+upsert (cloud) → expose one scrape(url) call; vision/ocr only when the target is image-dominant |
| kind | worker |
| invoke_contract | { url, { render?, extract?: text|image, index?: local|vector, polite?: bool } } → { title, text, headings, links, images_text[]?, vector_id? } |
| cost_hint | fetch (free) + extract (free) + vision/vectorize (paid, optional) |
| pitfalls | JS-heavy pages need render (cloud Browser Run); **HTML selectors are brittle — probe live markup, never hardcode from memory**; robots.txt + per-domain throttle (politeness) are required, not optional; dedupe by URL hash before indexing |
| local_limits | static HTML only (no JS render); lexical keyed-index only (no semantic search); no vision/OCR; in-memory index lost on exit; politeness must be hand-rolled |
| cloud_limits | vision/OCR + Vectorize are paid per token/upsert; Browser Run render per-fetch + ToS-gray for logged-in targets; account quotas; politeness still required. **Measured (cloud):** module-global in-memory corpus is **per-isolate, not per-version** — sequential requests can hit a cold isolate and see an empty corpus; durability requires D1/DO/R2 |

**blueprint/inbound-webhook-pipeline** — receive an event, validate it, run a job, store the result, notify.

| Field | Value |
|---|---|
| ingredients | righthand/webhook (receive + validate), righthand/kv or righthand/file (store), righthand/notify (fan out); **optional** righthand/workflow-runner (scale-up for multi-step/durable runs) |
| recipe | webhook → validate payload → **idempotency-key dedupe** → store → notify; workflow-runner only when steps need retries/durability |
| invoke_contract | { idempotency_key, type, payload } → { accepted | duplicate | invalid }; the **idempotency_key is a required first-class field** |
| kind | worker (single-step) or worker + workflow (multi-step) |
| cost_hint | mostly free (DO/queue runtime) |
| pitfalls | idempotency key on inbound (dedupe retries) is the load-bearing invariant; **validate before any side effect** — a duplicate or malformed event must never reach notify |
| local_limits | in-memory store lost on exit; notify = file/console stand-in (no fan-out/retry/delivery guarantee); single-step only; 127.0.0.1 only (no real inbound traffic) |
| cloud_limits | Queues/Workflows/DO add durability but cost + cold start; fan-out needs retry policy; idempotency is STILL the caller's contract. **Measured (cloud):** in-isolate idempotency works (duplicate `evt-1` correctly rejected within one warm isolate), but the `seen` set is per-isolate — a duplicate on a different isolate is re-accepted; D1/DO-backed dedupe is the real guarantee |

**blueprint/daily-digest** — collect, summarize, and send on a schedule.

| Field | Value |
|---|---|
| ingredients | righthand/web-search or web-fetch (gather), righthand/ask-ai (**synthesis tier**) or **extractive** (local stand-in), righthand/notify (send); **optional** righthand/scheduler (cloud cron / OS scheduler — local is just a re-run) |
| recipe | gather sources → summarize (ask-ai for new prose; extractive ranks by term frequency locally) → notify |
| kind | worker (one-shot) or worker + cron (scheduled) |
| cost_hint | paid model + search (ask-ai tier); free (extractive + RSS) |
| pitfalls | cap sources; dedupe before summarize; timezone on the cron; **probe selector/markup before parsing** (HN dropped `titlelink`); extractive surfaces representative items but does NOT synthesize — say so |
| local_limits | one-shot only (no schedule — OS cron is the scheduler, not part of the tool); extractive ranks but does NOT synthesize; title-only for most sources (no snippet enrichment) |
| cloud_limits | ask-ai synthesis + web-search paid per token/query; cron adds cold start + account quotas; full-body enrichment via Browser Run per-fetch + ToS-gray. **Measured (cloud):** HN Algolia front_page works (10 items) but Google News RSS 503 from CF egress → news half empty; brittle HN HTML selector replaced with Algolia |

**blueprint/vision-qa-assistant** — answer questions about images/screenshots for a text-only model.

| Field | Value |
|---|---|
| ingredients | righthand/screenshot or righthand/file (get image; **normalize cross-platform paths**), righthand/vision (**cloud: Workers AI — the one semantic path**), righthand/vector-store (recall); the two escalations are **separate**: vision (Workers AI) vs recall (embeddings + Vectorize) |
| recipe | image in → image-hash cache → vision(qa) → optionally recall similar past images → answer; cache by **content hash**, not filename |
| kind | worker + workers-ai (+ vectorize for recall) |
| cost_hint | paid vision (+ paid embeddings for recall) |
| pitfalls | **no semantic vision locally** — image-hash caching is the local value-add, the answer needs a cloud model; cache answers by image hash; normalize Windows `file://` paths |
| local_limits | no semantic vision (read/hash/cache only); recall = in-memory array (no cross-image similarity); cross-platform path normalization required |
| cloud_limits | vision (Workers AI) + embeddings (Vectorize) are two SEPARATE paid escalations; per-image inference cost (hash-cache is the only guard); model accuracy/size caps vary. **Measured (cloud):** without `env.AI` binding the worker degrades to vision-lite (meta-only); content-hash cache dedupes within a warm isolate (cache HIT verified); real vision needs a paid Workers AI binding |

### 31.4 What a blueprint is NOT

- Not a deployed tool — instantiate turns it into one; expand shows the recipe without deploying.
- Not a new primitive — it adds no substrate; it only composes existing starters.
- Not a replacement for guidance — the §27 gate still decides *whether* to build; blueprints decide *how* once the answer is yes.

### 31.5 Rules

1. **Ingredients must exist**: a blueprint may only reference shipped starters or the user's own tools — cf_instantiate validates every ingredient resolves before generating code.
2. **Blueprint = schema, not code**: the recipe is declarative; the plugin (or toolsmith) generates the entry code at instantiate time, so blueprints stay readable and auditable.
3. **Blueprints are also metadata-indexed** (§30): same keywords/use_cases/capabilities contract, so cf_search/cf_suggest find them alongside starters.
4. **Blueprints ship with the plugin** (a starter set of ~6–10), and the agent/toolsmith can author new ones via cf_blueprint define — they live in the same registry/Artifacts as tools.
5. **Lineage**: instantiated tools record forks_from: blueprint/<name> + the ingredient list, so a blueprint upgrade can be traced back to its instances (§16).
6. **Every blueprint declares local + cloud limitations separately**: `local_limits` and `cloud_limits` are required fields (§31.1), written as two independent lists — the local version's limits (no JS render, in-memory store, no schedule, no semantic model, keyed/bot-gated sources) are *different in kind* from the cloud version's (paid models, account quotas, cold start, ToS-gray browser sessions). `cf_instantiate` and `cf_blueprint --expand` surface both, so the agent picks a runtime knowingly.

### 31.6 Local vs cloud limitations (required per blueprint)

Every blueprint documents its **two implementation limits individually** — the local (no-account, in-repo) version and the cloud (CF-account) version fail differently, so they are never collapsed into one list:

- **`local_limits`** — what the in-repo version cannot do: no JS render, in-memory storage, no schedule, no semantic model, keyed/bot-gated sources, missing binaries.
- **`cloud_limits`** — what the CF version still cannot do or now costs: paid models per token, account quotas, cold start, ToS-gray logged-in browser sessions, datacenter IP still blocked.

Example — blueprint/web-scraper:

| runtime | limitations |
|---|---|
| local | static HTML only (no JS render); lexical keyed-index only (no semantic search); no vision/OCR; in-memory index (lost on exit); politeness must be hand-rolled |
| cloud | vision/OCR + Vectorize are paid; Browser Run per-fetch + ToS-gray for logged-in sites; account quotas; politeness still required |

**Rule:** write the two lists independently — never as “local lacks X, cloud has everything.” Cloud unblocks *some* local dead-ends (§34.7) but adds cost, quota, and its own ToS limits. `cf_instantiate` and `cf_blueprint --expand` surface both lists so the agent picks a runtime knowingly.

### 31.7 Bottom line

Add a **blueprint** layer above starters: declarative recipes that compose primitives for recurring goals (web-scraper, webhook-pipeline, daily-digest, vision-qa-assistant, …), indexed by the same §30 metadata, turned into real tools via cf_instantiate. This is the answer to how-do-I-build-X — instead of re-deriving the composition, the agent expands and instantiates a blueprint, then forks the result.


### 31.7b Measured cloud results (blueprint cloud tests, 2026-08)

All five blueprints were deployed as Workers on `ambiens.workers.dev` (wrangler + OAuth) and exercised. The **cross-blueprint findings** that belong in the registry itself:

| Finding | Evidence | Consequence |
|---|---|---|
| **In-memory module-global state is per-isolate, not per-version** | web-scraper corpus + inbound-webhook idempotency + vision-qa cache all reset across isolates/cold starts | durability/idempotency must be D1/DO/R2-backed; in-memory is only a local/zero-account fallback |
| **Cloudflare egress is a *different* IP reputation, not a strictly better one** | StockTwits 403 local → 200 CF (one run) → 403 CF (next run, rotating); Google News 200 local → 503 CF; Reddit JSON 403 everywhere | treat bot-gated sources as intermittent: retry + graceful degradation + per-source error budget |
| **Reddit RSS strictly dominates Reddit JSON** | RSS 200 (intermittent), JSON 403 (always) | blueprint adapters must use RSS, never `.json`, for keyless Reddit |
| **`experimental` compatibility flag is not deployable without opt-in** | wrangler rejected it (code 10021) | strip runtime type annotations instead; keep `compatibility_date` current |
| **`wrangler check` is now a startup-profiling subcommand, not a config validator** (v4.123.0) | running it printed command help | validate config via deploy `--dry-run` or schema, not `wrangler check` |
| **Cloud is a strict superset only where local has *no* semantic path** | vision-qa: local vision-lite (meta only) → cloud Workers AI (real vision, paid binding) | the only blueprint where "cloud > local" is unambiguous; everywhere else it's reputation diversity + reachability |

### 31.8 Template code: every starter, tool, and blueprint ships with a starter kit

The registry is not specs alone — every entity kind ships **template code** the agent can read, run, and fork immediately. This is the general rule behind what the experiments proved: each blueprint was built as a runnable TypeScript file (`run.ts`) plus a `LEARNINGS.md`, no build step, no installs. That pattern is now the **template-kit contract** for all three kinds.

| Entity | Template kit it ships |
|---|---|
| **Starter** (e.g. righthand/kv) | `entry.ts` (the starter's own Worker/DO entry) + `schema.ts` + `test.ts` + `README` |
| **Tool** (deployed/forkable) | the registered `entryCode` + generated `manifest.json` + `TOOL.md` (§20) + its tests |
| **Blueprint** (e.g. blueprint/web-scraper) | `run.ts` (a working local instantiation) + `test.ts` + `LEARNINGS.md` + the declarative recipe |

**The template-kit contract (one shape everywhere):**

1. **Runnable as shipped** — the kit runs in local mode with zero account, zero installs (TypeScript on Node 24, erasable-only), so the agent can *execute* before it *modifies*. A template that doesn't run is a doc, not a template.
2. **Honest about what it can't do** — each kit carries its `local_limits`/`cloud_limits` (§31.6) as comments at the top of the entry file, so the agent sees the escalation point before it hits it.
3. **The test file is part of the kit** — `cf_instantiate` emits tests alongside entry code (§32.6), and the local template's `test.ts` is the same assertions, runnable against the local path.
4. **LEARNINGS.md accompanies blueprints** — the experiment's live-log pattern is now mandatory for blueprints: build/run/after learnings recorded in the kit itself (§32, §34.7), so the next fork inherits the gotchas. The measured experiment layout now ships the **full contract** per blueprint: `blueprint.json` (declarative §31.1 spec) + `README.md` (run local/cloud + escalation guidance) + `run.ts` + `test.ts` (local assertions) + `cloud/index.js` + `cloud/test.ts` (cloud assertions) + dual `LEARNINGS.md` (local + cloud), all in `experiments/<blueprint>/`.
5. **One source of truth, three surfaces** — the template code is *generated from* the same registry row as the schema/docs; editing the template is the same `cf_fork`/`cf_edit` flow as editing any tool (§16). No code lives outside the registry.

**Where the template code lives:** in Artifacts (the git-compatible store, §15.2) beside each entity's source — starter kits, tool source, and blueprint templates are all versioned, forkable, and diffable. The catalog (§25.5) surfaces them via the existing Code/docs tabs + a new **Template** action that opens the runnable file.



---

## 32. Advanced blueprint: last30days-style research tool

This is the **most complex blueprint** in the kit: a multi-source, multi-phase research tool modeled on `github.com/mvanhorn/last30days-skill` — an AI-agent skill that researches any topic across Reddit, X, YouTube, Hacker News, Polymarket, and the web, then synthesizes a grounded, cited summary. It is worth its own section because it exercises nearly every primitive, needs real guidance to run, and (matching the source repo's ethos) demands a heavy test + verification discipline.

### 32.1 What the source repo does, and what we preserve

- **Multi-source fan-out**: query Reddit, X, YouTube, HN (Algolia API), Polymarket (gamma API), and general web in parallel.
- **Scoring**: each hit is scored by relevance + recency (last-30-days window) + source weight (points/engagement/credibility).
- **Progressive source unlocking**: start with cheap/keyless sources; unlock more only as the error/result budget allows.
- **Error budget**: each source gets N failures before it is skipped for the run — one dead source must not kill the report.
- **Search loop**: a first pass finds seed terms, a second pass refines with those terms — iterative, not one-shot.
- **Grounded synthesis**: the final summary cites sources; every claim links back to a fetched item.
- **Test-heavy**: the repo ships extensive unit + integration tests; our blueprint makes that a *required* step, not an afterthought.

### 32.2 Blueprint metadata (per the §31 schema)

| Field | Value |
|---|---|
| name | blueprint/research-radar |
| description | Research a topic across Reddit, X, YouTube, HN, Polymarket, and the web over a rolling window, score + dedupe the results, and synthesize a grounded, cited summary. |
| keywords | research, report, trend, last 30 days, news, sentiment, market, community, reddit, twitter, x, youtube, hacker-news, hn, polymarket, web, summarize, cite, sources, due-diligence |
| use_cases | what are people saying about X, trend report on Y, community sentiment before launch, market/odds research, competitive intel, due diligence |
| kind | workflow (orchestration) + agent (synthesis) |
| runtime | local-first, cloudflare optional (see §34) |
| cost_hint | search (paid) + fetch (free) + transcript (paid) + model synthesis (paid) — budgeted per run |
| ingredients | web-search, web-fetch, transcribe, extract, embed, vector-store, ask-ai, workflow-runner, rate-limit, cache, config |
| pitfalls | rate limits per source; X/YouTube keyed APIs; hallucinated citations; stale cache; cost overrun on transcripts |
| local_limits | no full-body enrichment (reader/JS shells — headlines+snippets only); keyed/bot-gated sources blocked (DDG challenge, StockTwits 403, Brave key, Reddit `.json` IP-block); no semantic rerank locally (DSH agent is the synthesizer); **Reddit RSS is the canonical keyless path** (`.json` is blocked; RSS works, rate-limited ~15 recent) |
| cloud_limits | Browser Run / AI Search add per-fetch/model cost + quotas; logged-in sessions ToS-gray + need user refresh; datacenter egress can still be blocked; Workflows/DO add durability but cost + cold start vs one-shot local. **Measured (cloud):** StockTwits 403 local → 200 on CF egress (one run) but then 403 (dynamic/rotating IP reputation); Google News 503 from CF egress; Reddit RSS intermittently 200/403 (RSS strictly dominates `.json`, which is always 403) |

### 32.3 Ingredients: each source maps to a primitive (adapter table)

| Source | Primitive (adapter) | Keyless default | Keyed upgrade |
|---|---|---|---|
| Hacker News | web-fetch → `https://hn.algolia.com/api/v1/search?query=...` | yes (Algolia, keyless) | none needed |
| Reddit | web-fetch → `https://www.reddit.com/search.rss?q=...&sort=new&limit=15` (**RSS, not JSON**) | yes (RSS endpoint; `.json` is IP-blocked) | Reddit API (higher limits) |
| Polymarket | web-fetch → gamma API (`/events`, `/markets`) | yes | none needed |
| YouTube | web-search (`site:youtube.com`) + transcribe (video) | partial | YouTube Data API v3 |
| X / Twitter | web-search (`site:x.com` / `site:twitter.com`) | partial (search only) | X API v2 |
| General web | web-search + web-fetch (static/render) | yes | AI Gateway search provider |
| Dedupe/rank | embed + vector-store | yes | none |
| Synthesis | ask-ai (or extract for structured fields) | Workers AI | AI Gateway model override |
| Orchestration | workflow-runner (fan-out + steps + retries) | yes | none |
| Budget/limits | rate-limit + config + cache | yes | none |

### 32.4 The recipe (phases)

**Phase 0 — normalize + ground + budget.** Strip the *intent modifier* (trailing "invest"/"sentiment"/"bullish"/"bearish") to derive the **Primary entity** (`cloudflare`). Build a **ticker→company alias map** (NET→Cloudflare) and an **entity grounding** rule on the head token — accept the company name, accept the ticker *only* when the alias resolves AND the context is financial. Then decide the source set + per-source error budget + rolling window (default 30 days). Cache key = normalized query + window hash. All code is **TypeScript** (erasable syntax; Node 24 / Workers `experimental` strip types, so no build step).

**Phase 1 — fan-out search (parallel).** `workflow-runner` fans out one `step.do` per enabled source; each adapter calls its primitive (Algolia fetch, Reddit **RSS** fetch, Polymarket gamma fetch, web-search for X/YouTube/web). Each returns a normalized list of `{ id, url, title, snippet, date, source, raw_score }`.

**Phase 2 — fetch + enrich + score.** For top candidates per source: `web-fetch` (static, or `render:true` for JS pages) to get body text; `extract` pulls structured fields (author, date, engagement, claims); `transcribe` for YouTube videos. **If full-body enrichment is blocked** (Google News redirect shells, JS app shells), fall back to headline + snippet as the evidence unit and flag it. Compute `score = relevance·3 + recency·2 + log10(1+raw_score, capped) + source_weight` (relevance-first, engagement capped); drop anything outside the window, below threshold, or failing entity grounding.

**Phase 3 — dedupe + rank.** `embed` each kept item; `vector-store` upsert; query similarity to the topic to dedupe near-duplicates (same story across sources collapses to the strongest). **Local fallback:** a rule-based keyed dedupe (Jaccard ≥ 0.55 on title tokens, different source → keep highest score) is good enough when no embeddings are available. Rank the survivors by score.

**Phase 4 — synthesize (grounded).** `ask-ai` over the ranked, deduped items with a strict prompt: *every claim must carry a `[source-id]` citation; no unsourced assertion; flag low-confidence items; answer sentiment, never issue a buy/sell call.* **Local default:** the **DSH agent itself is the synthesizer** (it reads the evidence bundle and writes the report) — no local model needed; Ollama is an optional upgrade. Output a structured report: summary, key themes, sentiment/odds per source, notable claims, full source list. **For opinion/reputation questions, rebalance toward dissenting voices** — community/enthusiast sources systematically under-weight criticism, so the synthesizer must *actively* surface negative/contrarian sources, not just the highest-ranked.

**Phase 5 — verify + emit.** Re-check each citation resolves to a fetched item (no hallucinated URLs); attach the source list; write the report + run record (into kv/file/vector-store for later recall).

### 32.5 Guidance (how the agent should run it)

1. **Start keyless** — HN + Reddit + Polymarket + web work with zero API keys; X and YouTube full API are opt-in config upgrades. Progressive unlocking = don't require keys to get a useful first report.
2. **Budget before you run** — set `max_sources`, `max_items_per_source`, `max_transcripts`, and an `error_budget` per source. A 30-day trend report should not silently become a $5 transcript bill.
3. **Window matters** — "last 30 days" is the default; for fast-moving topics (crypto, AI) shrink to 7 days; for slow topics (regulation) widen to 90.
4. **Search loop** — if Phase 1 returns <N hits, run one refinement pass using terms extracted from the best hits before giving up; do not loop more than 2 passes.
5. **Citation is non-negotiable** — the synthesis prompt requires `[source-id]` on every claim, and Phase 5 verifies each id resolves. This is what separates a research tool from a vibes generator.
6. **Cache aggressively** — same query + same window returns the cached report (with a `stale_after` TTL); a one-hour-old report is usually fine and costs nothing.
7. **Match sources to question type** — a stock-sentiment question needs financial sources (Google News RSS, StockTwits, filings) more than HN/GitHub/arXiv (tech-community signal). The blueprint maps question-type → source-plan; do not run the fixed six-source set for every topic.
8. **Ground before you score** — entity grounding (Phase 0) must run *before* relevance scoring, or substring noise (`net`, `cloud`) pollutes the rank. Grounding is entity-specific: a brand (DeepSeek) is not its product (DeepSeek Harness); a ticker (NET) is not the company name (Cloudflare). Use the alias map + head-token rule for both.
9. **TypeScript, not Python** — authored adapters, tests, and entry code are TypeScript (DSH's language, first-class on Cloudflare). External binaries like `yt-dlp`/`ffmpeg` stay binaries; the repo's Python is inspiration only.

### 32.6 Testing steps (required — matching the source repo's discipline)

The blueprint ships with a test plan; `cf_instantiate` emits the tests alongside the entry code. Four layers:

1. **Adapter unit tests (mocked fixtures)** — each source adapter is tested against recorded fixtures (an Algolia JSON response, a Reddit RSS XML response, a Polymarket gamma response, a fake web-search result). Assert: URL construction, field normalization, error handling, empty-result handling. **No live network in unit tests.**
2. **Scoring & dedupe unit tests** — deterministic: given N scored items, assert ranking order, window filtering, and near-duplicate collapse. Property-style: score is monotonic in recency and relevance; dedupe is stable under input order. **Add grounding/alias cases:** bare `net` does NOT ground, `NET` + financial context DOES ground, `NET Stock Tanks...` (ticker-only) grounds via the alias map, off-entity `net earnings` (Loblaw) does not — and the same pattern for **brand vs product**: bare `deepseek` does NOT ground `deepseek harness`, while `deepseek-harness` / `dsh harness` DO.
3. **Synthesis prompt regression** — golden set of ranked items + known-good citations; assert the model output cites only real ids, carries no bare URLs, and includes all required sections. Run against a pinned model (and re-run on model change).
4. **Integration + end-to-end** — `cf_test --local` with a **mock source layer** (in-memory adapters returning the fixtures) validates the full Phase 0→5 pipeline offline; then `cf_test --remote` with **one** live keyless source (HN) validates real network + a real (but tiny) synthesis; finally a full `cf_test --remote` golden run against a fixed, frozen query and a manually-reviewed expected report.

### 32.7 Verification checklist (per run, and before promoting)

**Before instantiate:** ingredients resolve; config schema validates; test plan present.
**After instantiate (cf_test --local):** all 4 test layers pass against fixtures; pipeline completes with zero live calls.
**After cf_test --remote (small):** one keyless source returns real data; synthesis cites only returned items; cost stays under the run budget.
**Golden run:** the frozen-query report matches the manually-reviewed expectation within tolerance (same top themes, same top sources); citations resolve.
**Per production run (auto):** assert (a) every citation id exists in the fetched set, (b) window respected, (c) error budget consumed per source is logged, (d) cost_hint ≤ budget, (e) report persisted + indexed for recall, (f) **no off-entity item passed grounding** (spot-check the rank), (g) **timing/narrative splits are flagged, not silently resolved** (e.g. `tanks` vs `soars` headlines for the same ticker).
**Before promote (§16):** diff against previous version; re-run the synthesis regression on the pinned model; confirm no adapter regression in unit tests.

### 32.8 Config variants

| Variant | Change | Use when |
|---|---|---|
| `fast` | keyless sources only, no transcripts, 1 search pass | quick pulse check |
| `deep` | all sources + transcripts + 2 search passes + render:true | serious due diligence |
| `markets` | weight Polymarket + X highest | price/odds-sensitive research |
| `community` | weight Reddit + HN highest | product/community sentiment |
| `video` | YouTube-first + transcribe all | topic lives in video/podcasts |

### 32.9 Pitfalls (why this blueprint is complex)

- **X/YouTube are the hard sources** — keyless search is partial; full coverage needs API keys. The blueprint must degrade gracefully, not fail.
- **Hallucinated citations** — the single most common failure; mitigated by Phase 5 verify + the synthesis regression test.
- **Cost overrun** — transcripts and synthesis are the expensive parts; budget + progressive unlocking + cache are the controls.
- **Rate limits** — Reddit/YouTube/X will 429; the per-source error budget absorbs it and the run continues with the survivors.
- **Near-duplicate stories** — the same HN thread + Reddit thread + tweet about the same news; dedupe via embeddings collapses them, or the report reads as echo.
- **Stale cache vs. freshness** — default the TTL short for fast topics; expose `fresh` flag to bypass cache.
- **Ticker-name collision** — `NET` collides with the English word `net`; ground on the company name (head token) and use a ticker→company alias map, never a bare ticker substring.
- **Full-body enrichment is frequently blocked** — Google News redirects through a reader shell and Reddit returns JS shells; headline + snippet + targeted search is the resilient baseline, full-text is best-effort.
- **Rate limits come fast on Reddit RSS** — probe + run share the budget; add backoff and cache between probes and the real run.

### 32.10 Bottom line

`blueprint/research-radar` is the flagship complex blueprint: a **Workflow** orchestrating fan-out search over six sources (each an adapter over web-search/web-fetch/transcribe), **extract + embed + vector-store** for enrichment/dedupe/rank, **ask-ai** for grounded synthesis, and **rate-limit + cache + config** for cost/error control — with a four-layer test plan and a per-run + pre-promote verification checklist. It is the concrete proof that blueprints (§31) can encode not just *which* primitives to combine, but *how to run them safely, test them, and verify their output*.


---

## 33. Replacing last30days' third-party keys with Cloudflare primitives

The `last30days-skill` source table lists many third-party keyed services (Brave, Perplexity, ScrapeCreators, XAI/XQUIK, local `yt-dlp`/CLIs, browser-cookie sessions). dsh-righthand's **cloud** answer is: **none of those are required** — every dependency maps onto a Cloudflare primitive, so the blueprint can run on the user's own Cloudflare account with **zero third-party keys**. This section is the analysis of *how the Cloudflare path works*. It is not the only path: §34 defines the **local** implementation and makes local the default where it exists, with cloud as the opt-in escalation.

### 33.1 The four CF capabilities that absorb the keyed dependencies

| Keyed dependency | Cloudflare replacement | Why it works |
|---|---|---|
| Brave Search / Perplexity web search | **AI Search** (account-scoped, keyless) | Cloudflare-owned search index; billed to the CF account, no per-provider key |
| Perplexity Sonar / Search / Deep Research | **Workers AI** LLMs (DeepSeek R1 / Llama) + AI Search + our own synthesis phase | synthesis moves to a CF-owned model; no third-party LLM key |
| X/Twitter browser cookies, XQUIK/XAI keys, xiaohongshu-mcp local session | **Browser Run / Kitesurf** (remote, logged-in browser) | a logged-in session runs on Cloudflare's browser infrastructure; no cookie export, no local service |
| ScrapeCreators (TikTok/IG/Threads/Pinterest/LinkedIn/YT comments) | **Browser Run / Kitesurf** (logged-in scraping) | the same "browse while logged in" capability, unified under one CF binding |
| `brew install yt-dlp` + ffmpeg, arXiv/Techmeme CLIs | **Sandbox / Containers** (arbitrary Dockerfile) | any binary (`yt-dlp`, `ffmpeg`, curl scripts) runs in a CF container, no local install |
| keyed transcript services | **Workers AI Whisper** (`@cf/openai/whisper-large-v3-turbo`, chunked) | transcription is a CF model, no key |
| Bluesky app password (free, first-party) | **Browser Run** logged-in `bsky.app`, or keep the free app password as optional | even the free first-party credential can be replaced with a logged-in session |

### 33.2 Full substitution map (source by source)

| Source | last30days needs | Cloudflare replacement | Keyless? | Caveat |
|---|---|---|---|---|
| Reddit (+comments) | nothing (JSON endpoint) | web-fetch → `reddit.com/search.rss` (**RSS primary**; `.json` is IP-blocked both local and CF-egress) | yes | RSS returns ~15 recent + no comment depth; fallback AI Search `site:reddit.com` or Browser Run |
| Hacker News | nothing (Algolia) | web-fetch → `hn.algolia.com` | yes | clean, Worker-friendly |
| Polymarket | nothing (gamma API) | web-fetch → gamma `/events`, `/markets` | yes | clean |
| GitHub | nothing (search API) | web-fetch → `api.github.com` | yes | 10 req/min keyless (60 with CF-owned PAT if ever needed) |
| StockTwits | nothing (public JSON) | web-fetch → `api.stocktwits.com` | yes | semi-public; keep rate low |
| arXiv | free CLI (auto-installed) | web-fetch → `export.arxiv.org/api` (Atom) | yes | no CLI needed — it is just an HTTP export API |
| Techmeme | free CLI | AI Search `site:techmeme.com` or Browser Run scrape | yes | CLI was a workaround for a scrapeable page |
| X / Twitter | browser cookies or XQUIK/XAI key | Browser Run logged-in session; partial: AI Search `site:x.com` | yes (session) | full coverage needs a logged-in session; keyless search is partial |
| YouTube | `brew install yt-dlp` | Sandbox container running `yt-dlp`; transcript via Workers AI Whisper; search via AI Search `site:youtube.com` | yes | ToS gray area for downloads; prefer transcripts + search |
| Bluesky | app password | Browser Run logged-in `bsky.app`; optional free app password | yes (session) | search needs a session either way |
| TikTok / IG / Threads / Pinterest / LinkedIn / YT comments | ScrapeCreators key | Browser Run logged-in scraping per network | yes (session) | hardest tier; per-network selectors fragile; ToS gray area |
| Xiaohongshu (RED) | local x-mcp / xiaohongshu-mcp browser session | Browser Run logged-in `xiaohongshu.com` session | yes (session) | the local service becomes a remote CF session |
| DripStack | free public search API | web-fetch → public search API (no key) | yes | keep direct |
| Perplexity Sonar / Search / Deep Research | Perplexity/OpenRouter key | Workers AI LLM + AI Search + blueprint synthesis | yes | CF-owned model replaces the keyed LLM |
| Web search | Brave Search key | AI Search (keyless) or AI Gateway web search provider | yes | no Brave key needed |

### 33.3 The four tiers (replaces the repo's source table)

**Tier 1 — direct keyless fetch (no CF binding beyond web-fetch):** HN (Algolia), Reddit (JSON), Polymarket (gamma), GitHub, StockTwits, arXiv, DripStack. These are plain HTTP GETs with a normalizing adapter; the only cost is Workers egress.

**Tier 2 — CF search + fetch (no third-party key):** general web, X (partial), YouTube (search), Techmeme — via **AI Search** (`site:...` filters) then web-fetch. AI Search replaces Brave and Perplexity *search* outright.

**Tier 3 — CF browser (replaces cookies + ScrapeCreators + xiaohongshu-mcp):** X full, Bluesky, TikTok/IG/Threads/Pinterest/LinkedIn, XHS — via **Browser Run / Kitesurf** with logged-in sessions. One binding replaces three different key/cookie mechanisms.

**Tier 4 — CF compute + models (replaces local binaries + keyed LLMs/transcripts):** YouTube media via **Sandbox** (`yt-dlp`/`ffmpeg`), transcription via **Workers AI Whisper**, synthesis via **Workers AI** LLMs. Nothing is installed locally and no third-party model key exists.

### 33.4 Honest caveats ("no third-party key" does NOT mean "no constraints")

1. **ToS gray areas stay**: downloading YouTube video (`yt-dlp`) and scraping logged-in socials may violate those platforms' terms regardless of *where* it runs. The blueprint should prefer the non-downloading path (AI Search + Whisper on already-public transcripts) and treat Browser Run social scraping as an opt-in, clearly-labeled variant.
2. **Datacenter IP blocking is real**: Reddit `.json` and several socials block cloud datacenter egress. The adapter's fallback chain (direct fetch → AI Search site filter → Browser Run) is what makes the tier work, not any single endpoint.
3. **Sessions, not cookies**: Browser Run replaces cookie *export* with a *remote logged-in session* the user creates once; that session state must be persisted/refreshed (CF-side), and login events are user actions, not something the agent does silently.
4. **CF account limits replace provider quotas**: AI Search, Workers AI, Browser Run, and Sandbox all bill to the CF account and carry their own limits — so the §32.5 budget + error-budget guidance still applies, just against CF usage instead of provider keys.
5. **Keyless ≠ unlimited**: GitHub is 10 req/min keyless; Reddit/Polymarket rate-limit too. The per-source error budget (§32.4 Phase 0) is what keeps a dead source from killing the run.
6. **Keyless availability shifts over time** (measured live): Google News RSS ✓ (local) / 503 (CF egress), **Reddit RSS ✓ (the canonical path — `.json` is blocked both local and CF)** (rate-limited, ~15 recent), HN Algolia ✓, Polymarket gamma ✓, arXiv ✓, GitHub ✓, **StockTwits 403 local but ✓ 200 on CF egress** — but **DuckDuckGo HTML is bot-gated** (anomaly challenge) everywhere. Treat the source table as a living probe, not a fixed promise.
7. **Enrichment is the hard 30%**: fetching a *result* is easy; fetching the *body* of that result (Google News reader shells, JS app shells) is where keyless scraping stalls. The blueprint must ship a headline+snippet baseline and treat full-text as best-effort.
8. **TypeScript is the implementation language** for all Cloudflare-side adapters (Workers/DO/Workflows are TS-first); Python appears only inside Sandbox containers as third-party tooling, never as authored plugin code.

### 33.5 What the blueprint inherits (updates §32.3)

- **Search adapters** default to **AI Search** (replaces Brave/Perplexity search) with `site:` filters per source; web-fetch remains the retrieval layer.
- **Synthesis** defaults to **Workers AI** LLM (replaces Perplexity Sonar); a `model` config lets the user point at any CF-owned model or an AI Gateway route.
- **Transcription** defaults to **Workers AI Whisper** (replaces any keyed transcript service).
- **Social sources** move to a **Browser Run adapter** (one per network, logged-in) — this replaces cookies, ScrapeCreators, and the xiaohongshu-mcp local service with a single binding.
- **YouTube** moves to a **Sandbox adapter** (`yt-dlp`/`ffmpeg`) + Whisper, replacing the local `brew install yt-dlp`.
- **Progressive unlocking** now means: start with Tier 1+2 (keyless CF bindings); escalate to Browser Run / Sandbox only when a source genuinely needs it; never require a third-party key.

### 33.6 Bottom line

Every keyed/credentialed dependency in `last30days-skill` collapses onto **four Cloudflare capabilities** — AI Search (web search), Browser Run/Kitesurf (logged-in browsing + social scraping), Sandbox/Containers (arbitrary binaries like `yt-dlp`), and Workers AI (LLM synthesis + Whisper transcription) — plus the existing keyless HTTP APIs (HN/Reddit/Polymarket/GitHub/StockTwits/arXiv/DripStack) fetched directly. Result: `blueprint/research-radar` runs entirely on the user's Cloudflare account with **no third-party API keys**, at the cost of four honest caveats (ToS gray areas, datacenter IP blocking with a fallback chain, remote sessions instead of local cookies, and CF account limits replacing provider quotas).

---

## 34. Local vs cloud implementation (local-first, cloud optional)

`blueprint/research-radar` must not require Cloudflare cloud services. The same blueprint has **two interchangeable implementations** — **local** (run on the user's machine with the same tooling the source repo used) and **cloud** (run on Cloudflare primitives, §33). The user or agent chooses per run (or per source), and **local is the default where it exists**, because it is cheaper, avoids ToS/IP-blocking risk, and needs no account. Cloud is the opt-in escalation for durability, parallelism, cross-device use, and sharing (§27 boundaries).

### 34.1 The runtime contract (one blueprint, two backends)

The recipe in §32.4 is implementation-neutral. Each **adapter** in the ingredients table (§32.3) exposes the same normalized interface — `search(query)`, `fetch(url)`, `transcribe(media)`, `synthesize(items)` — and the blueprint binds each to a **local** or **cloud** backend via a per-adapter `backend` flag. The orchestration phase (`workflow-runner`) maps to a local executor or a Cloudflare Workflow, respectively. The agent never rewrites the recipe; it only selects the backend binding.

### 34.2 Default backend per ingredient

| Ingredient | Local default (where it exists) | Cloud (Cloudflare) | Notes |
|---|---|---|---|
| web-fetch | Node/browser fetch | Worker fetch / Browser Run | local is trivially available |
| web-search | AI Search is cloud-only — local default is the repo's provider (Brave) or a no-key heuristic | AI Search / AI Gateway search provider | cloud is genuinely better here; but see §34.4 |
| transcribe | local Whisper (via `whisper.cpp`) or `yt-dlp`'s subtitle path | Workers AI Whisper | local needs a model download; cloud is simpler |
| extract | local LLM (Ollama/llama.cpp) or rule-based | Workers AI LLM | local rule-based extract needs no model |
| embed / vector-store | local embeddings + in-process/sqlite vector store | Workers AI embeddings + Vectorize | local for privacy/offline |
| ask-ai (synthesis) | local LLM (Ollama) | Workers AI LLM | quality-vs-privacy tradeoff |
| workflow-runner | local async executor (in-process) | Cloudflare Workflows | local is simplest; cloud for long-running fan-out |
| yt-dlp / ffmpeg | **local binary** (`brew install yt-dlp`) — the source repo's approach | **Sandbox/Containers** (Dockerfile) | this is the exact case you called out: local-first, cloud as escape hatch |
| browser (social scraping) | local Playwright/Puppeteer with the user's own logged-in session | Browser Run / Kitesurf | local is the safer default for ToS-sensitive sources |
| cache / config / rate-limit | local files + in-memory | KV + D1 | trivially local |

### 34.3 When to choose local vs cloud

**Default local when:** privacy matters (unpublished data), the task is one-off, cost matters (no CF billing), a source is ToS-sensitive (logged-in scraping), or the user already has the local tools (`yt-dlp`, Ollama, Whisper, Playwright).

**Escalate to cloud when:** the tool must run cross-device/session (§15), the fan-out is large (parallel sources), the user wants to share the tool (§22), or the result must persist without the user's machine online.

**Hybrid is fine and often best:** local for ToS-sensitive sources (`yt-dlp`, social scraping) + cloud for search/synthesis/durability. The adapter model makes this a per-source choice, not an all-or-nothing switch.

### 34.4 Honest reconciliation with §33 ("zero keys")

- §33's **zero-third-party-keys** guarantee is a property of the **cloud** path only — it is true, but it comes at the cost of ToS gray areas, datacenter IP blocking, and CF account limits.
- The **local** path reintroduces a few local dependencies (e.g. `yt-dlp`, a local Whisper/LLM) but they are *installs, not third-party API keys*, and they run on the user's own hardware with the user's own sessions — which is exactly what the source repo does.
- For **web search** specifically, local has no clean keyless option: **verified** — DuckDuckGo HTML returns a bot challenge, Brave needs a key. The honest local defaults are (a) Google News RSS for news/finance (works keyless), (b) Brave for general web (third-party key), or (c) cloud AI Search. Every other ingredient has a genuinely local option.
- The blueprint's **metadata** should say `runtime: local-first, cloudflare optional` (§34.5) so `cf_suggest` and the §27 gate do not push cloud where local suffices.

### 34.5 Config surface (what the user/agent selects)

| Key | Values | Default | Meaning |
|---|---|---|---|
| `runtime` | `local` / `cloud` / `hybrid` | `local` | top-level default for all adapters |
| `backend.<adapter>` | `local` / `cloud` / `auto` | `auto` (resolve local-first) | per-ingredient override, e.g. `backend.ytdlp = local` |
| `local.search` | `brave` / `heuristic` | `heuristic` | which local search path (§34.4) |
| `local.llm` | `ollama` / `llama.cpp` / `none` | `none` (rule-based extract) | local synthesis quality |
| `local.browser` | `playwright` / `puppeteer` / `none` | `none` (skip ToS-sensitive sources) | opt-in for social scraping |
| `cloud.*` | (same knobs as §33.5) | — | cloud bindings + budget |

### 34.6 Bottom line

`blueprint/research-radar` is **local-first**: it runs the same recipe with local tooling (`yt-dlp`, local Whisper/LLM, local Playwright, local store) by default, and only escalates specific adapters to Cloudflare (§33) when the task needs durability, parallelism, cross-device access, or sharing. The two backends share one normalized adapter interface, so the agent never rewrites the recipe — it only chooses `runtime` and per-adapter `backend` flags. §33 remains the correct *cloud* analysis; this section adds the local path and makes it the default where it exists.

### 34.7 Local dead-ends are the cloud entry points (measured map)

The experiment hit concrete local blocks — and each one is precisely the case where a **Cloudflare primitive unblocks the source**. This is the strongest argument for the hybrid model: local-first does not mean local-only, and the adapter model (§34.1) makes escalation a per-source flip, not a rewrite.

| Local dead-end (measured) | Why it blocks | Cloud primitive that unblocks it | Tradeoff |
|---|---|---|---|
| **DuckDuckGo HTML** returns an anomaly bot-challenge (202 + no results) | DDG serves a CAPTCHA to datacenter/bot traffic | **AI Search** (account-scoped, keyless CF index) or **AI Gateway web search provider** | CF account usage + cost vs. free-but-dead local |
| **StockTwits API** now returns 403 (was keyless) | endpoint went auth-gated | **Browser Run / Kitesurf** logged-in `stocktwits.com` session, or a CF **Worker** with the now-required header/auth the user supplies once | a logged-in session is a user action, not a silent bot |
| **Reddit `.json`** returns 403 from datacenter IPs | IP-based blocking | **Browser Run** (real browser + residential-ish egress) or a CF Worker that caches the **RSS** endpoint server-side | RSS worked but rate-limits fast; cloud adds cache + parallel fan-out |
| **Full-body enrichment** stalls on Google News reader shells + Reddit JS shells | no JS execution locally | **Browser Run / Kitesurf** (renders JS, follows redirects) + **AI Search** (`site:` + snippet retrieval) | browser cost per fetch; still ToS-gray for some sites |
| **X/Twitter keyless** is partial (search-only) | no keyed API | **Browser Run** logged-in session | session refresh + ToS |
| **Social scraping** (TikTok/IG/LinkedIn/XHS) needs keys or cookies | auth-gated | **Browser Run** logged-in sessions (one per network) | fragile selectors + ToS-gray; opt-in only |
| **`yt-dlp` not installed** locally | missing binary | **Sandbox / Containers** runs `yt-dlp`/`ffmpeg` in a CF container | downloading still ToS-gray regardless of where |

**Rule derived from this:** the per-adapter `backend: auto` default should resolve **local-first, but with a *measured block* trigger** — when a source returns a known block signal (bot-challenge, 403 auth-gate, missing binary), `auto` escalates *that one adapter* to its cloud backend rather than failing or silently dropping the source. The §32.9 pitfalls already list the block signals; this table wires each to its cloud unblocker.

---

## 35. Native DSH surface in the registry (what the harness already gives the agent)

The registry is not only Cloudflare tools — it must also catalog the **native DSH harness surface** so the agent knows what it already has (and must not re-implement in Cloudflare). This section is grounded in the harness's own machine-generated API catalog (`packages/extensions/tool-cordis/src/api-catalog.ts`) and the shipped tool packages, verified against this checkout.

### 35.1 The key insight: the harness already introspects itself

DSH ships a **`cordis` tool family** (`@deepseek-ai/dsh-tool-cordis`) whose entire job is runtime self-inspection and dynamic plugin authoring. The agent can already:

- `cordis_inspect_list` — list every inspect provider (host + client).
- `cordis_inspect_query` — read the **exact contract** of any Service, Event, Builtin, Tool schema, theme token, or live Slot tree (host queries local; client queries wait for a page).
- `cordis_inspect_self` — inspect the session's own dynamic plugins/packages (summary → pointer → full source + diagnostics).
- `cordis_define` / `cordis_run` / `cordis_stop` / `cordis_undefine` — define, activate, stop, and permanently remove dynamic Cordis plugins (host + client halves).

**Consequence:** the registry must not duplicate a hand-written, frozen list of native tools. It should point at `cordis_inspect_query` (live truth) **and** keep a curated, searchable *index* of the most-used native surface — the same pattern as §30 metadata: an index that is refreshed, not the source of truth itself.

### 35.2 Native services the agent already has (curated index over `cordis_inspect_query`)

The full catalog is 55 services + 48 events; the registry indexes the subset an agent actually reasons about when deciding **native vs Cloudflare**. Each entry: key, what it does, when to use it.

| Native surface | What it does | Use it when |
|---|---|---|
| `ctx.tools` (`register`, `schemas`, `guard`, `restrict`) | register/inspect/guard the agent's callable tools | deciding whether a new tool is **native** (a `defineTool`) vs **Cloudflare** (a `cf_draft`) — and authoring plugins |
| `ctx.tools` events (`tools/pre-execute`, `tools/post-execute`, `tools/result`) | approval + audit hooks around every tool call | the shared approval gate the UI and agent both use (§25.3) |
| `run_code` (Code Mode) | the ONLY directly-callable tool; all other tools run inside it | any programmatic orchestration the agent writes — and the *local* half of a righthand tool (§26) |
| `ctx.credentials` | single source of truth for secrets (rotation-safe, watcher-driven) | holding `CLOUDFLARE_API_TOKEN` — never bake it into code |
| `ctx.skills` (`register`, `list`) | loadable guidance bundles (model/user-invocable) | shipping the primitive-selection/authoring skills (§19.1) and vendored Cloudflare skills (§18) |
| `ctx.commands` (`register`, `list`, `execute`) | slash commands | `/righthand`, `/rh list` UI entry points (§25.1) |
| `ctx.slots` (declaration-merged `SlotMap`) | client UI insertion points | the registry browser, settings, tool views (§25) |
| `ctx.agents` (`create`, `resume`, `get`, `list`) | spawn/inspect live agents | toolsmith-as-subagent consult (`cf_advise`, §19.2) |
| `ctx.subagents` / `subagent` + `subagent_fork` tools | delegated focused work, forked context | fanning out research/authoring without burning the main context |
| `ctx.workflowEngine` / `workflow` tool | orchestrate many subagents in phases | large multi-agent audits/migrations (§workflow) |
| `ctx.jobs` (`job_list`, `job_output`, `job_kill`) | background job control | long-running deploy/invoke/testing in the background |
| `ctx.goals` (`create_goal`, `get_goal`, `update_goal`) | same-session completion objectives with rounds | a long build-and-test-iterate cycle (exactly the blueprint experiments) |
| `ctx.timer` (`timeout`, `interval`, `throttle`, `debounce`) | fiber-disposable timer helpers | retry/backoff, polling, debounced save — **the native rate-limit/backoff primitive** |
| `ctx.fs` / `read`+`write`+`edit`+`glob`+`grep` | filesystem + code-search | local-first blueprint files, scratch, evidence (§26, §34) |
| `ctx.subprocess` / `pwsh`+`bash`+`terminal` | run local processes | invoking `yt-dlp`/`ffmpeg`/`wrangler dev` locally |
| `ctx.sandbox` / `sandboxPolicy` | host sandbox mode + policy | knowing what file/process access a tool has before assuming it |
| `ctx.storage` / `ctx.storageDomain` | host-scoped durable storage | DSH-side cache of the registry index (not the authoritative store — that is Cloudflare D1) |
| `ctx.approval` (`approval/request`) | user approval flow | the same gate that `tools/pre-execute` surfaces |
| `ctx.locale` / `ctx.theme` | i18n + theming | en/zh UI + shell-consistent styling (§25.1) |

**Do not re-implement these in Cloudflare.** They are the agent's native hands; righthand adds the *Cloudflare* half, not a replacement. The only native capability that is a genuine **gap** righthand fills is *durable, cross-device, shared* tool memory (§15) — which is why the Cloudflare registry exists.

### 35.3 Native tool families (what the agent can already call)

| Family | Tools | Notes |
|---|---|---|
| Code Mode | `run_code` | the transport; all other tools are called *inside* it |
| Filesystem | `read`, `write`, `edit`, `glob`, `grep`, `str_replace_editor` | workspace-scoped |
| Web | `web_search` | keyless general web search |
| Shell | `pwsh`, `bash`, `bash_persistent`, `terminal` | local processes (sandboxed) |
| Delegation | `subagent`, `subagent_fork`, `interrupt_agent`, `list_agents`, `send_message`, `subagent_report` | background/forked children |
| Orchestration | `workflow` | multi-agent fan-out |
| Goals | `create_goal`, `get_goal`, `update_goal` | same-session long-running objectives |
| Jobs | `job_list`, `job_output`, `job_kill` | background command/agent control |
| Ask | `ask_user_question` | clarify/confirm with the user |
| Skills | `skill` | load a skill by name |
| Todo | `todo_write` | structured task list |
| Ralph | `ralph` | fresh-agent iterative loop (explicit opt-in) |
| Cordis | `cordis_inspect_list`, `cordis_inspect_query`, `cordis_inspect_self`, `cordis_define`, `cordis_run`, `cordis_stop`, `cordis_undefine` | **runtime self-inspection + dynamic plugin authoring** |
| Session | `session_query` | query session history |
| LSP | `lsp` | language-server integration |

### 35.3a Recommended plugins (not native — installable, indexed with full metadata)

These two are **not part of the base harness**: they are useful plugins that must be installed to be present. They are listed in the registry as **recommended plugins** with the full §30 metadata contract (keywords/use_cases/capabilities + install/status), so the agent can *discover and recommend* them without ever assuming they are available. **When to use them is a recommendation, not a guarantee** — the agent checks presence before calling.

| Plugin | What it does | When to use it | How / metadata |
|---|---|---|---|
| **Recursive mode** (`recursive_*`) | Scaffolds a run directory with phase receipts, locks artifacts (`recursive_init`/`recursive_lock`/`recursive_status`/`recursive_lint`/`recursive_scratch`/`recursive_closeout`) for a disciplined, auditable multi-phase build | long-running, traceable work that must record decisions/artifacts phase-by-phase (e.g. a multi-step migration or spec-driven build) | kind `plugin`; keywords `recursive, run, receipts, phases, lock, audit, traceability`; use_cases `multi-phase builds, artifact locking, closeout receipts`; source `plugin:recursive` |
| **Paper** (`paper_*` design MCP bridge) | Bridges the Paper design tool into the agent: create artboards, write HTML nodes, screenshot, export JSX/computed styles | visual/UI design work where the agent must read and write designs on a 2D canvas (web/mobile screens, design-system exploration) | kind `plugin`; keywords `paper, design, ui, artboard, canvas, screenshot, jsx, figma-import`; use_cases `UI design, design-to-code, visual review, design tokens`; source `plugin:paper` |

**Rule:** recommended plugins are *discoverable, not assumed*. `cf_status`/boot detect whether each is actually installed and mark its status (`installed` / `not-installed`); `cf_suggest` may *recommend installing* one when the task matches its use_cases, but never emits code that calls it without a presence check.

### 35.4 How the registry represents native entries (fourth entity kind)

Add **Native** as a fourth tab alongside Primitives | Tools | Blueprints (§25.5), with the same §30 metadata contract where useful (keywords/use_cases/capabilities) but a distinct provenance field:

- **kind** = `native` (service | tool | event | slot) — recursive/paper are `kind: plugin`, not native (§35.3a); **source** = `harness:<pkg>`, **live** = `cordis_inspect_query` for the authoritative contract.
- **Read-only by default**: native entries are indexed for discovery, never mutated by righthand — they come from the harness/runtime, not the Cloudflare registry.
- **Search**: native entries are indexed by the same metadata index (§30) so `cf_suggest`/`cf_search`/Cmd-K can answer "do I already have this natively?" before proposing a Cloudflare tool.
- **The `cf_suggest` gate (§27) gains a pre-check**: before recommending a starter, check the Native tab — if a native tool/service already does the job, say so and stop (reuse-before-build, now including the harness itself).
- **Staleness**: the index points at `cordis_inspect_query` for truth; a background refresh re-reads it when the plugin boots or on `cf_status`, so the curated list cannot drift from the runtime.

### 35.5 Rules

1. **Native-first, Cloudflare-second.** The registry's Native tab is the first stop: if the harness already has it (timer, jobs, goals, subagents, workflows, skills, commands, slots, credentials), never rebuild it on Cloudflare.
2. **Live truth, curated index.** `cordis_inspect_query` is authoritative; the registry index is a searchable cache that refreshes on boot/`cf_status`. Never hardcode a frozen native list as if it were the truth.
3. **`cf_suggest` pre-checks Native** before any starter/blueprint recommendation — the reuse gate now spans the harness surface too, not just righthand starters.
4. **The one native gap righthand fills is durable shared memory** (§15): tools/history following the user across workspaces/devices. Everything else native stays native.
