# blueprint/daily-digest — local test learnings

## Outcome

Local version built and ran: gather (HN front page + Google News RSS) → extractive summarize (frequency-based sentence scoring) → emit `digest.json`. News source worked (10 items); **HN returned 0** due to a stale selector. Extractive summarization produced a coherent top-5 (all AI-themed — a reasonable digest for a `technology OR cloud OR AI` query).

## Learnings

1. **HTML selectors are brittle and must be probed, not assumed.** HN front page no longer uses `class=\x22titlelink\x22`; story titles are plain anchors interleaved with `from?site=` domain links and `item?id=` metadata. My selector matched zero. This is the *same* lesson as the scraper blueprint: every adapter needs a live-markup probe + fixture test, never a hardcoded selector from memory.
2. **Extractive summarization works for a *digest*, but it is not a *summary*.** It ranks sentences (titles) by term frequency — good for surfacing the most representative items, useless for generating new prose or cross-article synthesis. The blueprint's `ask-ai` ingredient is the *synthesis* tier; extractive is the honest local stand-in, not a replacement.
3. **The scheduler ingredient is irrelevant locally** — a one-shot run is the local form; cron/Workflow is the cloud (or OS-scheduler) form. The blueprint should note that local `daily` is just a re-run, not a schedule.
4. **Google News RSS is the reliable local gatherer again** (10 items, no key) — reinforces the research-radar finding.
5. **Snippet is empty for both sources** (HN scraper got title only; RSS titles only). A real digest wants 1–2 sentence context per item; that is the full-body-enrichment gap already known from research-radar.

## Blueprint changes to make
- §31.3 daily-digest: mark `scheduler` as cloud/OS-scheduler escalation (local = one-shot re-run); state explicitly that **extractive = local stand-in, ask-ai = synthesis tier**; add the **probe-selector-before-parse** rule to the adapter guidance (carried from research-radar).

## Local vs Cloud limitations

**Local limits:**
- One-shot only — no schedule (OS cron is the local scheduler, not part of the tool).
- Extractive summarize = ranks representative items; does NOT synthesize new prose.
- No snippet enrichment (Google News/Reddit shells) — titles only for most sources.
- Selector/markup brittleness (HN dropped `titlelink`) must be probed each run.

**Cloud limits:**
- ask-ai synthesis + web-search are paid per token/query.
- Cron (Workflows/Cron Triggers) adds scheduling but also cold start + account quotas.
- Full-body enrichment via Browser Run is per-fetch and ToS-gray for some targets.
## DSH-native learnings (righthand-test, 2026-08-30)

Built the digest again as DSH **test tools** on top of the published
`@try-works/dsh-righthand` toolkit (`D:\righthand-test`). These learnings
supersede the extractive/cloud split above: with the toolkit the digest runs
through the agent itself, tool-to-tool.

1. **Tool-to-tool execution is the natural DSH form.** A test tool calls the
   real righthand tools via `ctx.tools.execute({ callId, name, arguments,
   signal })` — `rt_digest_run` = `rh_run` (fetch script) + `rh_store_put`;
   `rt_digest_diff` = `rh_store_get` twice. The result shape is
   `{ isError, value, error }` — read `error.message` on failure, use a
   unique `callId` per nested call (counter + timestamp). This is the
   blueprint's recipe expressed as the agent's own vocabulary.
2. **The synthesis tier is `ctx.llm`, not an external ask-ai service.**
   `ctx.llm.stream({ provider, model, messages, system, maxTokens, signal })`
   + `BlockAssembler` + `createUserMessage` (all from `@deepseek-ai/dsh-llm`).
   Defaults `deepseek-official` / `deepseek-v4-flash` match the harness
   default model. One call per story, JSON-constrained prompt, parse the
   `{...}` window; per-story try/catch so one bad call cannot kill the
   digest. Tests use a stub `LlmAdapter` registered via
   `ctx.llm.registerAdapter(['rt-test'], stub)`.
3. **MDX deliverable through `ctx.fs` + GUI presenters.** Inject `fs`,
   `ctx.fs.resolve(path, { signal })` then `writeText(target, mdx, undefined,
   signal)`. To make the GUI show the file: `presentCall` returns
   `{ card: 'generic', kind: 'edit', locations: [{ path }] }` (this is what
   produces the clickable chip) and `presentResult` returns `{ card: 'diff',
   diffs: [{ path, oldText: null, newText }] }` (inline diff card).
   `presentResult` only sees `result.meta`, so project the file facts via
   `output.presentationMeta(args, value)`.
4. **Module augmentations need explicit type-only imports.** `ctx.fs`,
   `ctx.jobs`, `ctx.skills` etc. typecheck in a src-only build only after
   `import type {} from '@deepseek-ai/dsh-*'` of the owning package — the
   augmentation travels with the import, not the cordis Context.
5. **Reddit access (measured again, same as cloud): JSON is 403, RSS works.**
   `www.reddit.com` and `old.reddit.com` JSON both 403 this IP; redlib
   mirrors are down or Anubis-walled; pullpush comments return 200 but empty
   for fresh posts. Listing RSS `/r/<sub>/top/.rss?t=day&limit=N` works with
   a browser User-Agent + `Accept: application/rss+xml` and spaced requests;
   per-post comment RSS `/r/<sub>/comments/<id>/.rss` works with ~8s spacing
   and 429/403 retry backoff.
6. **RSS parsing traps:** decode HTML entities BEFORE stripping tags
   (`&lt;table&gt;` otherwise survives as `lt;table&gt;`), and handle
   `&#32;` explicitly. The listing content wraps selftext in a
   `submitted by … [link] [comments]` boilerplate row — cut it wherever it
   sits. Comment RSS repeats the post body and AutoMod promotion posts
   ("featured it on our Discord") — filter both before summarizing.
7. **Digest store shape** (survives restarts): key `digest:<date>` or
   `digest:<sub>:<date>`; value `{ date, source, top, stories, summaries,
   fetchedAt }` where each story is `{ id, title, url, points, author,
   article, comments }` and each summary is `{ id, articleSummary,
   commentsSummary }`.
