# Task: revise the `think` and `flue` skills in dsh-cloudflare

You are editing the `think` and `flue` skills in the dsh-cloudflare plugin. Both are single-file skills with **no `references/` subdirectory**. Make only the targeted edits below — do not restructure the files, do not add new dependencies, and do not touch the parts listed under "Do not change".

## Files

- `packages/dsh-cloudflare/skills/think/SKILL.md`
- `packages/dsh-cloudflare/skills/flue/SKILL.md`
- `packages/dsh-cloudflare/src/manifest.ts` (verify only — descriptions may need a one-line update, see below)

## Cross-reference skills to stay consistent with (read these first)

- `skills/agents-sdk/` (especially its routing and code-mode references)
- `skills/sandbox-sdk/SKILL.md`
- `skills/durable-objects/references/` (migration gotchas: append-only, `new_sqlite_classes`, `renamed_classes`, `deleted_classes`)
- `skills/workers-best-practices/` (compatibility-flag guidance)
- `skills/wrangler/SKILL.md`

Keep the same voice and formatting conventions as those skills: retrieval-biased, anti-pattern lists, exact `wrangler.jsonc` shapes, no invented API signatures.

## A. Corrections (apply to the existing text)

### A1. `think` — make the `ai` binding conditional
In the quick-start `wrangler.jsonc`, annotate that `"ai": { "binding": "AI" }` is **only required when using Workers AI model ids (`@cf/...`)**. When the model is routed through AI Gateway or an external provider, the binding is unnecessary. Add a one-line note; do not remove the binding from the example.

### A2. `think` — prefer the current routing helper
The quick start uses `routeAgentRequest`. Update it to prefer the current `routeAgent(request, env, "AgentName")` form (as documented in the `agents-sdk` skill), and add a one-line note that `routeAgentRequest` still works as a fallback.

### A3. `flue` — tighten the `nodejs_compat` claim
The skill says `nodejs_compat` is "required by Flue's runtime". Change to: required **only when the agent uses Node.js APIs** (some sandbox/fs features), and note that relying on it can conflict with other compatibility flags — cross-link the `workers-best-practices` skill.

### A4. `flue` — make the rename hazard actionable
Where it says renaming the exported function is a storage-identity change unless `agentName` pins it, add the **required follow-up**: declare `renamed_classes` in migrations when renaming, and note that `deleted_classes` destroys data. Align wording with the `durable-objects` skill gotchas.

## B. Additions (new short sections, same style)

### B1. `think` — add a "Think actions as tools" section
The skill is chat-agent-only. Add a short section covering **using Think actions as standalone tools** (not chat): idempotency keys, human-approval gates, authorization, and the code-execution tool. State explicitly that dsh-righthand uses Think this way via a `think-action` kind — the action is a reusable tool, not necessarily a chat agent. Keep it a concise pointer; do not paste an entire new codebase, but include the minimal action shape if the current docs support it.

### B2. `flue` — add a "wrap a Flue agent as a tool" note
Add a short note: a Flue agent's RPC can be wrapped as a reusable tool via a registry invoke stub (dsh-righthand `flue-agent` kind), so a Flue agent is usable through `cf_invoke` rather than only through its own chat/RPC surface. Keep it concise.

### B3. Both — add a freshness stamp to the retrieval-sources table
Add a "verified" row/line to each retrieval-sources table, e.g. `verified 2026-07 against Think v0.9` and `verified 2026-07 against Flue Cloudflare beta`, so the "prefer retrieval" stance carries an explicit freshness date.

### B4. Both — make the cross-link a bolded first line
Both skills already list `agents-sdk` / `durable-objects` / `sandbox-sdk` / `wrangler` in a "Scope" section. Add a bolded first line near the top (matching the convention in the other vendored skills): "For the underlying primitives load the `agents-sdk` and `durable-objects` skills first."

## C. Do not change (verified correct)

- `think`: tool merge order, server-authoritative `setMessages`, `submitMessages` idempotency, `ThinkWorkflow` via `step.prompt`, `new_sqlite_classes` migration guidance.
- `flue`: `'use agent'` + hooks API, per-agent Durable Object generation and camel-boundary binding naming, `.flue-vite.wrangler.jsonc` merge, append-only migrations, Durable Streams (`runFiber`/`stash`/`onFiberRecovered`), Cloudflare Computer vs Sandbox choice, private agents over service bindings, `@cloudflare/codemode` + `@cloudflare/shell` inside Flue.
- The `hasResources: false` registration and skill `name` fields in `src/manifest.ts`. Only touch `src/manifest.ts` if a description string must be extended to mention the new "actions as tools" / "wrap as tool" capabilities — and if you do, keep it one sentence and retrieval-biased.

## D. Verification (run before finishing)

1. Both `SKILL.md` files still parse as valid YAML front-matter (`name` and `description` keys intact).
2. Every fenced code block has balanced triple backticks, and the language tags (`sh`, `jsonc`, `typescript`, `tsx`, `text`) are unchanged except where an edit requires it.
3. No API signature, config key, or migration tag was invented — every concrete token cross-checks against the `agents-sdk` / `sandbox-sdk` / `durable-objects` / `wrangler` skills or the official docs URLs already listed in each skill.
4. `src/manifest.ts` still compiles (no syntax errors) and both skills still resolve.

## E. Report back

Summarize, per skill, the exact lines changed (corrections) and added (sections), and confirm the "Do not change" items were left untouched. Flag anything you could not verify against a cross-reference source.

