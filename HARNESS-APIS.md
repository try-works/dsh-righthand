# HARNESS-APIS.md — the DSH service surface, documented for building tools

> **Purpose**: the authoritative, build-oriented reference for every harness service a tool plugin can use. Each entry shows the exact call signature (from the service source), the shape it returns, the gotcha that matters when building tools, and its **verification status**: ✅ = exercised by my own tests (`tests/dsh-native-tools.spec.ts` or `experiments/`) against the real providers; 📖 = read from source, not yet executed.

**Mount order that works** (from `tests/dsh-native-tools.spec.ts`): `SystemPrompt` → `ToolRuntime` → `Storage` → `storage-json` → `storage-domain` → `credentials-local` → `settings-file` → `jobs-local` → `subprocess-local` → *your tool plugins*. Service packages default-export a `Service` subclass; function plugins (`storage-json`, `storage-domain`) export `name`/`inject`/`apply`. `ctx.plugin()` accepts function, class, or `{apply}` uniformly.

---

## 1. ctx.tools — ToolRuntime ✅

**Define a first-party tool with `defineTool()` (canonical)** — typed args, strict validation, replayable presenters:

```ts
import { defineTool } from '@deepseek-ai/dsh-tools'

const definition = defineTool({
  name: 'my_tool',                    // unique; 'run_code' is reserved
  description: 'Does X',
  parameters: {                       // per-property spec → implicit open object root
    input: { type: 'string', description: 'The input' },
    mode: { type: 'string', enum: ['a', 'b'], default: 'a' },
  },
  output: {
    schema: { type: 'object', properties: { ok: { type: 'boolean' } } },  // supported JSON Schema
    render(args, value) { return [{ type: 'text', text: JSON.stringify(value) }] },
    presentationMeta?(args, value) { return value }  // pure, replayable; top-level calls only
  },
  timeoutMs: 30_000,                  // optional cooperative deadline
  isConcurrencySafe?(args) { return false },  // pure classifier for sibling overlap
  async execute(args, exec) {
    // exec: { callId, name, arguments, agent?, signal, deferContext, concludeTurn }
    return { ok: true }
  },
  finalizeContent?(exec, result) { return undefined },  // last-mile content transform, must not throw
  presentCall?(args) { /* ToolCallView | undefined */ },
  presentResult?(args, result) { /* ToolResultView | undefined */ },
})

ctx.tools.register(definition)   // → the exact disposer; effect-scoped (apply() = dispose on unload)
```

- `output` is **mandatory** and must declare `{ schema, render }` (`presentationMeta?`). `output.schema` must be a supported JSON Schema (no `pattern`/`format`/numeric bounds).
- `parameters` is per-property; `defineTool` compiles it to an implicit open object root, validates args, and freezes them before `execute` (typed as `InferArgs`).
- `isConcurrencySafe(args)` decides parallel-group admission; absent = exclusive scheduling.
- `presentCall`/`presentResult` are pure pending/completed-state presenters; return `undefined` for the generic card.

**Restrict what an agent sees** (scope-based capability filter):

```ts
ctx.tools.restrict({ allow: ['a', 'b'] })   // keep only these global tools
ctx.tools.restrict({ deny: ['dangerous'] })  // remove these
// requires a scoped context (agent.ctx); empty filter throws; 'run_code' cannot be named
```

**Guard every call** (monotonic, after pre-execute):

```ts
ctx.tools.guard((exec) => {
  if (exec.name.startsWith('rh_') && !exec.agent) return 'rh_* tools require an agent'
  return undefined  // allow
})
```

**Hook the pre-execute waterfall** (extensible policy; async allowed — observe `exec.signal`):

```ts
ctx.on('tools/pre-execute', async (exec, next) => {
  if (exec.name === 'deploy' && exec.arguments.production) return { kind: 'deny', reason: 'production needs approval' }
  return next()  // → PreToolDecision
}, { prepend: true })
```

`PreToolDecision` = `{ kind: 'allow' } | { kind: 'deny', reason } | { kind: 'ask', reason? }`. Other events: `'tools/execute'` (around-dispatch; timeout/retry/metrics — may change `exec.signal` only), `'tools/post-execute'`, `'tools/change'`.

**Read the surface** (for the agent system prompt / MCP projection):

```ts
const schemas = ctx.tools.schemas(scope?)  // deep-cloned ToolSchema[] (name, description, parameters)
```

**Invoke a tool programmatically** (tests, composites, SDK):

```ts
const result = await ctx.tools.execute({
  callId: 'my-1',
  name: 'my_tool',
  arguments: { input: 'x' },
  signal: new AbortController().signal,
  agent?: Agent,          // on whose behalf
  parent?: ToolExecutionToken,  // marks a transport sub-dispatch
})
// → { isError: false, value, content } | { isError: true, error: { name, message, violations? }, content }
```

**Execution context your tool receives** (`ToolRunContext`):

```ts
exec.callId | exec.name | exec.arguments (frozen) | exec.signal | exec.agent?
exec.deferContext(message)   // append context to the agent loop AFTER this tool's result
exec.concludeTurn()          // mark this success terminal for the turn
```

---

## 2. ctx.storage — storage hub ✅

The hub holds **named backends** + mounted **data forms**. It is NOT a KV store itself — backends register under `ctx.storage.backend`, forms mount under `ctx.storage.<form>`.

```ts
ctx.storage.backend.register('json', backend)   // → disposer; duplicate name throws
ctx.storage.backend.get('json')                  // → StorageBackend (throws backend-not-found)
ctx.storage.backend.names()                      // → string[]
ctx.storage.mount('domain', facility)            // → disposer; duplicate-mount throws
ctx.storage.form('domain')                       // → the mounted facility
ctx.storage.domain                              // getter = form('domain'), present once storage-domain loads
```

A backend may expose `kv?: KvFacet` (whole-unit snapshots + per-record durable writes):

```ts
interface KvFacet {
  open(descriptor: { name, version, tables: string[], hasGlobal }): Promise<KvUnit>
}
interface KvUnit {
  loadAll(): Promise<{ tables: Record<string, Record<string, unknown>>, global: unknown }>
  putRecord(table, key, value): Promise<void>   // durable upsert
  deleteRecord(table, key): Promise<void>        // idempotent
  setGlobal(value): Promise<void>                // only when hasGlobal
  close(): Promise<void>
}
```

**Gotcha**: the unit does NOT serialize concurrent writes — ordering is the caller's job. The domain layer runs one write chain per unit; if you use `kv` directly, do the same.

---

## 3. ctx.storageDomain — ergonomic typed domains ✅

```ts
import { defineDomain, domainTable } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'

const storeDomain = defineDomain({
  name: 'righthand_store',        // must match /^[a-z][a-z0-9_]*$/
  version: 1,                     // non-negative int; medium stamped with other → reject at open
  tables: {
    rows: domainTable('rows', z.object({ value: z.unknown(), updatedAt: z.string() })),
  },
  global: { schema: z.object({ writes: z.number() }), initial: { writes: 0 } },  // optional
})

const domain = await ctx.storageDomain.open(storeDomain)   // caller OWNS the handle
const table = domain.table('rows')                          // NO domain.tables.<name>
await table.put('k1', { value: { a: 1 }, updatedAt: new Date().toISOString() })  // verb is put, not set
table.get('k1')                    // sync from memory; undefined when absent
table.keys()                       // IterableIterator<string>
table.entries()                    // IterableIterator<[string, V]>
table.size
await table.delete('k1')           // → boolean (existed)
await table.update('k1', cur => next)  // atomic RMW on the write chain; missing-key rejects
domain.global.get()                // sync; initial until first set
await domain.global.set({ writes: 1 })
await domain.close()               // YOUR disposer (ctx.effect); facility also closes on unmount
```

**Plugin config**: `{ backend: 'json', routes?: Record<domainName, backendName> }` — the backend is required and per-domain routes override.

**Gotchas**: records are validated by **zod** at the durable read boundary (`invalid-record` names table+key); a global schema accepting `null` throws at `defineDomain` (null is the never-written sentinel); reads are synchronous in-memory after `open` — durability only on write. ✅ verified live in `src/store-tools.ts` + tests.

---

## 4. ctx.credentials — secret store ✅

```ts
import { credentialRef } from '@deepseek-ai/dsh-credentials'
const ref = credentialRef('CLOUDFLARE_API_TOKEN')   // must match POSIX shell identifier /^[A-Za-z_][A-Za-z0-9_]*$/

const resolved = await ctx.credentials.resolve(ref)   // → { value, source } | undefined
const info = await ctx.credentials.describe(ref)      // → { configured, source?, writable } — NEVER the value
await ctx.credentials.set(ref, 'secret')              // durable write; rejects empty value + read-only shadow
await ctx.credentials.unset(ref)                      // remove; no-op when absent; rejects read-only shadow
```

**Build rules**: resolve **per operation** (never cache — rotation-safe); an empty stored value is absent everywhere; `describe` is the safe config-surface read (value never exposed). ✅ verified: `rh_credential_*` in `src/secrets-tools.ts` — secret string asserted to never appear in outputs.

---

## 5. ctx.settings — typed config ✅

```ts
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
const ns = settingsNamespace('righthand')   // lowercase kebab: /^[a-z][a-z0-9-]*$/

const scope = ctx.settings.register(ns, schema, {
  base?: Partial<T>,        // composition-layer defaults below user layer
  applies?: 'live' | 'restart',
  validate?: (value: T) => void,   // cross-field constraint; throw to reject the WRITE
})
scope.get()                                   // schema defaults → base → user layer
scope.watch((next, prev) => {})               // → disposer; async, serialized per callback
await scope.update({ key: 'x' })              // merge patch into user layer + persist
await scope.replace({})                       // wholesale replace; absent keys re-inherit

// provider-level reads/writes:
ctx.settings.describe({ redactSecrets: true })   // SettingsDescriptor[] incl. revision + secrets (redacted)
ctx.settings.get(ns)
await ctx.settings.update(ns, patch, expectedRevision?)  // revision → SettingsConflictError on staleness
await ctx.settings.replace(ns, section, expectedRevision?)
await ctx.settings.mutate(ns, ops, expectedRevision?)    // path-addressed edits
```

✅ verified: `rh_settings_get/set` in `src/secrets-tools.ts`. Schema is schemastery (`z` from `@deepseek-ai/schemastery`); JSON-compatible data only in patches.

---

## 6. ctx.jobs — background work ✅

```ts
ctx.jobs.attachController('my-plugin')   // REQUIRED before start accepts an owner; → disposer

const id = ctx.jobs.start({
  kind: 'bash',            // also the id prefix: '<kind>-N'
  label: 'deploy worker',  // one-line model-facing
  outputLimitBytes?: number,
  owner?: Agent,           // omit → unowned, open to any caller
  run() {
    // return hooks after preflight; throw → nothing registered
    return {
      cancel(reason?: string) { /* synchronous, idempotent, eventually settles done */ },
      done: Promise<JobOutcome>,
      readOutput?(): string,   // consume delta since last call
    }
  },
})

ctx.jobs.list(caller?)          // JobSnapshot[] — caller sees own + unowned only
ctx.jobs.get(id, caller?)       // fresh snapshot; throws unknown/foreign
ctx.jobs.read(id, caller?)      // → { text, snapshot }; terminal read marks reported
ctx.jobs.kill(id, caller?, reason?)  // → 'requested' | 'already-finished'
await ctx.jobs.wait(id, timeoutMs, caller?, signal?)  // settle or timeout; never cancels
ctx.jobs.onJobDone(listener)    // → disposer; per-owner scope
ctx.jobs.onJobsChanged(listener)
```

**JobSnapshot**: `{ id, kind, label, outputLimitBytes?, ownerSession?, status: 'running'|'stopping'|'completed'|'killed'|'failed', detail?, startedAt, finishedAt?, reported }`.

✅ verified: `rh_run_bg` in `src/exec-tools.ts` — job settles `completed`. **Gotcha**: no attached controller → `start` refuses; this bit me until I read `tool-jobs`.

---

## 7. ctx.subprocess — managed child processes ✅

```ts
const exe = await ctx.subprocess.resolveExecutable('node', env?, signal?)  // absolute path or bare PATH name

const handle = ctx.subprocess.spawn({
  argv: ['node', 'script.mjs'],
  cwd: '/path/to/dir',
  stdio: {
    stdin: 'ignore',                              // 'ignore' | 'pipe'
    stdout: { maxBytes: 1_000_000, spill: { maxBytes: 10_000_000 } },  // 'pipe' | 'inherit' | collect object
    stderr: { maxBytes: 100_000 },                // no spill = in-memory tail only
  },
  graceMs: 5000,                                  // terminate escalation + drain bound
  signal: exec.signal,                            // starts terminate escalation on fire
  env: { PATH: '/extra' },                        // merged onto scrubbedParentEnv(); undefined = tombstone
})

handle.pid
handle.collected.stdout?.readFrom(0)  // → { text, nextOffset, lossy, spillPath? } — readFrom(0) after done = batch
handle.collected.stderr?.readFrom(0)
await handle.done                     // → { exitCode: number|null, signal: Signals|null }
handle.terminate()                    // SIGTERM → graceMs → SIGKILL on the TREE; Windows taskkill /T
```

**Env hygiene is built in**: `scrubbedParentEnv()` strips `KEY/PASSWORD/SECRET/TOKEN` + `DSH_*` (also `SENSITIVE_ENV_PATTERN`); `spawnTerminal(spec)` allocates a real PTY (native dep). ✅ verified: `rh_run` in `src/exec-tools.ts` (node --version → exit 0 + stdout).

---

## 8. ctx.systemPrompt — agent-visible sections ✅

```ts
ctx.systemPrompt.section({ name: 'my-section', order: 115, text: 'Instructions…' })  // → disposer
ctx.systemPrompt.context({ name, order, text })       // contextual blocks
ctx.systemPrompt.suppressRuntimeContext()             // remove runtime defaults
ctx.systemPrompt.tools((ctx) => ({ tools: [...schemas] }))  // tool provider
ctx.systemPrompt.variable('name', (ctx) => 'value')   // template variable
const assembled = await ctx.systemPrompt.assemble(ctx?)  // → PromptAssembly (for tests/debug)
```

`order` places the section relative to `PERSONA_ORDER` / `TOOL_ORDER_REST` (115 = right after tools; the `tool-workflow` plugin uses 115). ✅ mounted in tests; order semantics verified via research-reading.

---

## 9. Composition wiring (what the tests proved)

```ts
const ctx = new Context()
await ctx.plugin(SystemPrompt)
await ctx.plugin(ToolRuntime, { mode: 'native' })
await ctx.plugin(Storage)
await ctx.plugin(StorageJson, { root: join(tmp, 'storage') })   // function plugin
await ctx.plugin(StorageDomain, { backend: 'json' })            // function plugin
await ctx.plugin(LocalCredentialProvider, { path, watch: false })
await ctx.plugin(FileSettingsProvider, { path, watch: false })
await ctx.plugin(LocalJobRegistry, {})
await ctx.plugin(LocalSubprocessRuntime, {})
await ctx.plugin(storeTools)   // …your tool plugins
```

**Everything in this file was read from the service source** (`D:\deepseek-harness\packages\…`) and the ✅ entries were additionally executed through the real providers by `tests/dsh-native-tools.spec.ts` (7/7) and the `experiments/blueprint-*` kits.

---

## 10. Finding other sessions + messaging them (session lookup surface)

### 10.0 The session lookup API: `ctx.typert.lookups` (the name you asked for) 📖

"session_lookup" is not a standalone tool or function — it is the **Typert lookup** registered by the session store under the key `'session'`. It turns a wire identity (`sessionId`) into a live `Session` object, and the Host composition swaps the default policy with a resolver that also cold-resumes persisted sessions.

```ts
// Look up the provider by its runtime key (registered by dsh-session's SessionStore):
const lookup = ctx.typert.lookups.get('session')
// lookup = { parameter: 'session', wire: 'sessionId',
//           hostTypeSymbol: '@deepseek-ai/dsh-session#Session',
//           wireTypeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
//           resolve(sessionId) }

// Resolve a wire id to its live Session (default policy: ctx.sessions.get):
const session = lookup?.resolve(sessionId)   // Session | undefined | Promise<Session | undefined>
```

**Provider registration** (`packages/core/session/src/index.ts`):

```ts
ctx.inject(['typert'], (typeCtx) => {
  typeCtx.typert.lookups.register('session', {
    parameter: 'session',      // source parameter name the weak parser recognizes
    wire: 'sessionId',         // wire field that replaces the Host object parameter
    hostTypeSymbol: '@deepseek-ai/dsh-session#Session',
    wireTypeSymbol: '@deepseek-ai/dsh-session/types#SessionId',
    resolve: sessionId => this.get(sessionId),   // default: live in-memory only
  })
})
```

**Host composition override** (`packages/api/remotes/src/agent-lookup.ts`) — the real production policy: live reuse, then cold resume, deduplicated, subagent-fenced:

```ts
typeCtx.typert.lookups.configure('session', async sessionId =>
  (await resolveAgent(sessionId)).session,   // resolveAgent: live Agent ?? cold-resume; throws TypertLookupFailure
)
```

`TypertLookupRegistry` API:

```ts
ctx.typert.lookups.register(key, provider)      // → disposer; throws 'already registered' on duplicate
ctx.typert.lookups.configure(key, resolver)     // → disposer; composition-owned override (restores default on dispose); may precede register
ctx.typert.lookups.get(key)                     // → TypertLookupProvider | undefined
ctx.typert.lookups.keys()                       // → snapshot of registered keys
ctx.typert.lookups.definitions()                // → stable wire declarations (survive provider unload)
ctx.typert.lookups.subscribe(listener)          // → disposer; observe later lookup changes
```

`TypertLookupProvider<Host, Wire>` = `{ parameter, wire, hostTypeSymbol, wireTypeSymbol, resolve(id: Wire): Host | undefined | Promise<Host | undefined> }`.

**Use it in a tool/plugin**: `const lookup = ctx.typert.lookups.get('session')` → `const session = await lookup?.resolve(SessionId(id))` → then message it via §10.3/§10.4. The lookup answers *which session*, the messaging verbs deliver to it.

---

> **Layering note:** §10.0 is the lookup API (`ctx.typert.lookups.get('session').resolve(id)`). The remaining sections are the surrounding surfaces the lookup feeds: the **query service** (§10.1 — find/list/read/trace), the **in-memory stores** (§10.2 — `ctx.sessions`/`ctx.agents` live lookup), the **messaging verbs** (§10.3/§10.4 — `Agent.followup`/`ctx.subagents.followup`/`session.prompt`), and the **model-facing `session_*` tools** (§10.5 — workspace-authorized, same cwd).

### 10.1 Find: `ctx.sessionQuery` (unified live-preferred query) 📖

```ts
await ctx.sessionQuery.listSessions(signal?)                     // → SessionRecord[] (newest-first, cloned)
await ctx.sessionQuery.filterSessions(filters, signal?)          // → SessionRecord[] (ANDed predicates)
await ctx.sessionQuery.searchSessions(request, exec?)            // → SessionSearchPage<SessionSearchHit> (full-text)
await ctx.sessionQuery.searchEvents(request, exec?)              // → SessionEventSearchPage (within one session)
await ctx.sessionQuery.readSession(sessionId)                    // → SessionLogSnapshot (header + full raw log)
await ctx.sessionQuery.readSurface(sessionId)                    // → SessionSurfaceSnapshot (current model surface)
await ctx.sessionQuery.readTitle(sessionId, signal?)             // → SessionTitleSnapshot | undefined
await ctx.sessionQuery.readTitleSnapshots(ids, signal?)          // → SessionTitleObservationResult[] (per-id, isolated)
await ctx.sessionQuery.listEvents(sessionId)                     // → SessionEventRecord[] (ascending seq)
await ctx.sessionQuery.filterEvents(sessionId, filters)          // → SessionEventSearchDocument[]
await ctx.sessionQuery.traceSession(sessionId, signal?)          // → SessionLineageTrace (ancestors + descendants)
await ctx.sessionQuery.traceEvent(request, signal?)              // → SessionEventTraceObservation
await ctx.sessionQuery.readEvent(request, signal?)               // → SessionEventWindow (full event + neighbors)
```

**`SessionRecord`** = `{ header: SessionHeader, live: boolean, persisted: boolean }` — live = in `ctx.sessions`, persisted = materialized by the persistence backend. Reads are **live-preferred** (live record wins; else persistence).

**`SessionResultFilter`** (session-level, ANDed; `values` are ORed):

```ts
{ kind: 'id', values: SessionId[] } | { kind: 'cwd', values: (string | null)[] }
| ({ kind: 'created-at' } & { from?, to? }) | { kind: 'parent', values: (SessionId | null)[] }
| { kind: 'availability', values: ('live' | 'persisted')[] }
```

### 10.2 Find (live only): `ctx.sessions` + `ctx.agents` 📖

```ts
ctx.sessions.get(id)          // → Session | undefined (live in-memory only)
ctx.sessions.list()           // → Session[] (creation order, fresh array)
ctx.agents.get(id)            // → Agent | undefined (live agent = live session + driver)
ctx.agents.list()             // → Agent[] (registration order)
ctx.agents.roots()            // → Agent[] (top-level agents, no owning parent)
```

`ctx.sessions` only sees **live** sessions in this process; persisted-but-cold sessions require `ctx.sessionQuery` (§10.1) or the host RPC (`session.list`, §10.4).

### 10.3 Message: live-agent verbs + the `send_message` tool 📖

```ts
// Agent inbox verbs (live agent only):
agent.followup(message)   // queue an ordinary follow-up turn + wake the driver (own turn)
agent.steer(message)      // steering for the nearest step boundary
agent.inject(message)     // model-facing context for the next pre-step; does NOT wake
agent.send(message, target, wakeup)  // explicit inbox target + wake flag
// message: UserMessage (createUserMessage({ content: ContentBlock[], source }))
```

**To message a *durable child* by session id** (cold-resumable, the `send_message` tool):

```ts
import { SessionId } from '@deepseek-ai/dsh-session'
const messageId = await ctx.subagents.followup(
  parent,                    // the EXACT live direct parent authorizing delivery
  SessionId(childId),        // durable child session id
  [{ type: 'text', text: '…' }],
  { source: { kind: 'coordinator', form: 'relay', senderSessionId: parent.id }, signal },
)
```

The model-facing `send_message` tool (`subagent_id` + `message`) is exactly this call: `exec.agent` is the authority, the child id is a `SessionId`, and delivery is FIFO into the child's Agent inbox (wakes a `waiting` child; cold-resumes an absent one). A failure means the message was NOT delivered. `interrupt_agent` is the paired stop verb.

### 10.4 Message (host wire): `session.*` RPC 📖

The GUI uses the host API proxy, not `ctx.*` directly. The unary methods (source of truth: `packages/host/apiproxy/src/api/sessions.ts`):

```ts
session.list({ cursor? })            // → { items: SessionSummary[] } (updatedAt desc)
session.search({ query }, signal)    // → { items: SessionSearchItem[], hasMore } (≤20 sessions)
session.history({ sessionId, beforeSeq?, maxMessages? })  // → { events, hasMore, projections? }
session.prompt({ sessionId, mode: 'queue' | 'steer', content, clientTimeZone? })  // → { accepted: true }
session.fork({ sessionId, atSeq? })  // → { sessionId } (child)
session.rename({ sessionId, title }) // → { title, seq }
session.create({ workspaceId? | cwd?, sessionId?, agentPreset? })  // → { sessionId }
```

`session.prompt` is the **wire-level "message this session"**: it sends `ContentBlock[]` verbatim (`mode: queue→send, steer→steer`) to an ordinary session's Agent after durable host admission. Session-backed subagents reject with `agent-busy` and use `subagent.prompt` instead.

### 10.5 Model-facing tools (the actual `session_*` surface) 📖

`tool-session-query` registers five workspace-scoped tools — **authorization is same-cwd**: a caller may only touch its own session or another session whose header `cwd` equals its own.

| Tool | Purpose | Key parameters |
|---|---|---|
| `session_search` | cross-session full-text; strongest event per session | `query` + optional `session_ids`, `availability`, `created_at_*`, `event_*` filters |
| `session_event_search` | within one session | `session_id?` (omit = current), `query` + event filters |
| `session_trace` | lineage (ancestors + descendants) | `session_id?` |
| `session_event_trace` | replacements/relationships of one event | `session_id?`, `seq` |
| `session_event_read` | full event + neighbors | `session_id?`, `seq`, `before?`, `after?` |

### 10.6 Cross-session *mentions* (the host-normalized read-only path) 📖

`ctx.sessionReferenceResolver` prepares **bounded, read-only snapshots** of other sessions as sourced context (not live mutation). This is the @mention flow, not the message flow:

```ts
await ctx.sessionReferenceResolver.listCandidates(agent, query?, limit?, signal?)
  // → [{ sessionId, label, cwd?, createdAt }] — self excluded, ranked by cwd affinity
await ctx.sessionReferenceResolver.prepare(agent, content, references, signal?)
  // → { content, additionalContext? } — one aggregated '## Referenced sessions' UserMessage
```

URI/markdown helpers: `encodeSessionReferenceUri` / `decodeSessionReferenceUri` (`dsh-session:<base64url(JSON.stringify(sessionId))>`), `formatSessionReferenceMention` (`@[label](uri)`), `parseSessionReferenceText`.

### 10.7 Which surface to use when

- **Model needs to find + read prior work** → the `session_*` tools (workspace-authorized, §10.5).
- **Plugin/service needs exact reads/traces** → `ctx.sessionQuery` (§10.1) — no workspace boundary of its own; *you* enforce the policy.
- **Need to push a message into another agent** → live `Agent.followup/inject/steer` (§10.3); durable child by id → `ctx.subagents.followup` (the `send_message` tool).
- **GUI/host wants to list/search/send across sessions** → `session.list/search/prompt` RPC (§10.4).
- **Attach another session's context to a message without mutating it** → `sessionReferenceResolver.prepare` (§10.6).