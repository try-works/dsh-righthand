# Mu repository analysis — architecture lessons for righthand

Source: https://github.com/micro/mu (Go, ~1200 go files). This is the
*architecture* read of the repo, not the tool list — that is in
[agent-tool-catalog.md](agent-tool-catalog.md). Each section names the Mu
mechanism, the failure it fixed, and the righthand/DSH equivalent to adopt
or adapt.

## 1. One declaration, every surface derives (internal/service/spec.go)

Every service declares itself once — name, description, page, icon,
endpoints with model-facing docs, cost, permissions, and a Card renderer —
and every surface *derives* from that Spec: MCP tool list, REST reference,
nav, guest allowlists, agent labels, the destructive list, the account-
scoped list, pricing ops, and two documentation tables. Before the Spec
there were **fourteen hand-written lists**, each correct alone and none
aware of the others — the same capability was called search, search_web,
index and web_search at once, and Stream and Chat shared an icon for months
because nothing could notice the repeat.

**Righthand equivalent:** the `rh_*` tool family. Today each tool declares
its description/params/output inline in `defineTool`. The Mu lesson is to
declare the *spec* once and derive the catalogue — in DSH the tool registry
already derives the model-facing list; what righthand should add is the
derived **permissions golden** (§2) and a derived **docs table** (README,
skill, catalog) rather than hand-kept lists.

## 2. Golden-file the derived permissions (test/permissions.golden)

`permissions.golden` records one line per tool — needsAccount, destructive,
bound/open, accountOnly, optionalAuth — and the test fails when any derived
permission moves. The file's own debugging is the guidance: the first
version recorded **nothing** (registering a service is not deriving its
tools — an empty golden that passed, worse than none because it looks like
cover); the second recorded only the derived policy and missed the exact
distinction being collapsed; the third recorded prices and failed on test
order. It now records permissions alone, sees the change, and is stable.

**Righthand equivalent:** `tests/permissions.golden` over every `rh_*` tool
(and, once they exist, the rt_* test tools): one line per tool with the
guard-relevant facts. Refactors that are behaviour-preserving leave the file
untouched; any diff is the list of doors that moved.

## 3. Layer discipline, asserted by test (test/layering_test.go)

Product packages (home, agent, service, admin, account) may import
internal/; internal/ may never import the product, with two exceptions —
the assembly programs. The rule is enforced by a regex test, and the bill
for every past violation is legible: internal/server/hooks.go, seven hundred
lines of function variables whose only job was to hand one package a pointer
to another because they could not import each other. Also: a service may
not import the wallet — asking what something costs is internal/quota, which
knows prices and not balances.

**Righthand equivalent:** the tool modules are already thin consumers over
harness services. The rule to write down: a tool module answers a question
about state; an *agent* (or a digest-type helper) decides which question to
ask — services announce events, agents subscribe (Mu's agent/gate,
agent/work, agent/digest all work this way). In DSH terms that is
`ctx.on(...)` + the session-watcher blueprint, never a tool that imports
another tool's internals — call it by name through `ctx.tools.execute`.

## 4. Agents are accounts; work is assigned, not invoked

An agent is a user in the same address space — it holds an address
(mail/XMPP) and can be written to. Tasks assign work (`service/tasks` holds
it, `agent/work` runs it); a standing instruction falling due and a task
assigned are the same fact. Results always say something: a run that could
not happen is delivered like an answer, because "a standing instruction
that goes quiet looks like the instruction was forgotten."

**Righthand equivalent:** `rh_task_*` (already the top build item in the
catalog doc) + `blueprint/session-watcher` for standing instructions. The
"always say something" rule belongs in the tool descriptions: a failed
scheduled job must produce a visible record, not silence.

## 5. The held state — fail visible, release when in doubt (agent/gate, internal/thread)

A conversation is in the record or it is not; the binary is what made
unsolicited inbound impossible to handle (dropping is undetectable, filing
wakes a paid agent). So: **held** — in the record, visible, searchable, and
nothing acts on it until a judge (one model call per arrival) releases it.
The judge is *reluctant on purpose*: the costly mistake is holding a real
message (the plumber texting he is outside), so the prompt releases when in
doubt. Fail-safe direction: if the model is down, arrivals sit held and
visible — never silently dropped.

**Righthand equivalent:** guard `ask` mode is the local judge; the posture
to copy is: deny loudly and visibly, never silently drop, and when in doubt
let it through. Also relevant to `blueprint/inbound-webhook-pipeline`'s
idempotency dedupe.

## 6. Defensive web: safefetch (SSRF guard) + safety (generation policy)

`internal/safefetch`: an SSRF-guarded HTTP client for fetching untrusted
URLs — refuses loopback, private ranges, link-local (including the
169.254.169.254 metadata address), and multicast; validates **every
redirect hop**, not just the first; caps response size (2 MiB) and time
(10 s). `internal/safety`: what the instance will not *generate* — one
category refused always and not configurable, one category refused by
default and an operator's decision; a door, not a classifier ("it stops
casual misuse and raises the cost of the rest").

**Righthand equivalent:** the harness's web tools already own SSRF
protection; the blueprint guidance for any righthand fetcher should carry
the checklist (block non-public destinations, revalidate redirects, cap
size/time) and the generation-policy split belongs in the guard/skill
guidance, not per-tool ad hoc.

## 7. Memory is real message history (agent/memory.go)

The conversation went to the model as prose inside one user message, with
assistant turns truncated to 300 chars and the whole blob sent twice. The
model never saw its own turns as its own; truncation made "what was the
third thing you listed?" unanswerable by construction. The fix: turns in
their real roles, nothing truncated, nothing duplicated.

**Righthand equivalent:** already the harness model (the DSH agent loop
does exactly this). For tools that *build prompts* — the digest summarizer,
any rh_text_* tool — the rule is the same: assistant content stays assistant
content, and input caps must be deliberate, not string-worries.

## 8. Cards: a view, not a widget — and time is the missing field (Spec.Card)

Each service can render a Card; the field that mattered was `At` — a
headline from four minutes ago and a forecast are different kinds of thing,
so a card that knows when belongs in a chronology (stream) and one that
does not is a standing view. The Viewer is a struct ("who is looking" is
domain data, not context values), and the zero value is the shared render,
safe to cache; personal renders must never be cached. A card is a view — it
renders and links, holds no state and takes no input.

**Righthand equivalent:** the digest MDX already records `fetchedAt`; the
same discipline generalises — any rh_* summary output should say *when what
it shows happened* so a stream can order it honestly.

## 9. Pricing: price vs limit, and an operator file (quota.json)

An operation is charged when it costs the instance something (a model call
or third-party request); storage and talking-to-your-agent are 0 because
they have no marginal cost — charging taxed exactly the behaviour the
product wants more of. `limit` is a hard per-day count, checked *before*
price, for the operations that reach a stranger — a price stops somebody
who has to pay and does nothing about a loop. quota.json is an operator's
file, not code.

**Righthand equivalent:** the settings namespace is the quota.json slot;
the split belongs in guard rules (a rate/limit axis beside allow/deny/ask).

## 10. Tool scoping: the list follows the token (internal/api/listscope)

Scoping was enforced at dispatch and ignored by tools/list, so a confined
agent was handed every tool definition and found out by trial and error
that almost all were refused — the context cost of the whole catalogue and
none of its use. Fixed: the listing follows the token's scope; an explicit
`?tools=` list can only narrow further.

**Righthand equivalent:** guard rules are the scope; the lesson is that the
*visible* catalogue and the *enforceable* scope must be one mechanism, or
the agent pays context for tools it cannot use.

## 11. Delete the dead switch (one model tier; five flags → two)

Two recurring refactors: the Fast/Best model tier outlived its only control
(nothing sent the field) and was deleted — "a premium tier needs a control,
a price somebody has decided on, and something on the page saying what the
difference buys... not a switch to leave lying around"; and the permission
flags collapsed from five to two because three of them were three ways of
saying the same thing and one was dead code nobody had ever set.

**Righthand equivalent:** every config key in the righthand settings
namespace must have a consumer or go; every guard rule field must have a
meaning a test can see (the golden file is what makes the difference
visible).

## What this means for the righthand build order

> Constraints (2026-08-30): TypeScript only — no Go. Single user — no
> accounts, no rationing: Mu's identity tiers (`requires`) and per-day
> `limit` counts are out; the `destructive` marker and the golden-file
> discipline stay. Tools are built by the user's own agent and run locally
> or on the user's own Cloudflare account.

1. **Spec + golden first**: a permissions.golden over the existing `rh_*`
   tools, then the `destructive` marker it records. This is Mu's own
   ordering — record the answer before changing the model.
2. **`rh_task_*` + `rh_text_*`** (catalog doc §build order) — tasks
   implements §4 (assigned work, always say something), text implements
   §7's prompt discipline.
3. **Data adapters with the safefetch checklist** in the blueprint guidance
   — §6.
4. **Scope = catalogue**: when guard scoping lands, the skill/catalog text
   must reflect the same rule — §10.

