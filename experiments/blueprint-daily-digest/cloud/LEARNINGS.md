# blueprint/daily-digest CLOUD learnings log

> Cloud version of the daily-digest blueprint. Local: `../run.ts`.

## Run context

| Field | Value |
|---|---|
| Local | `../run.ts` — HN front page + Google News RSS, extractive summarize |
| Cloud | `cloud/index.js` — Worker, `GET /digest`, `/health` |
| Deploy | wrangler 4.123.0, OAuth |
| Compat | 2026-04-30 |

## 1. Local limitations (cloud fixes)

| Limitation | Detail |
|---|---|
| One-shot | runs once, prints, exits |
| No remote surface | must run locally |
| No scheduling | manual |

## 2. Cloud limitations (measured/predicted)

| Limitation | Detail |
|---|---|
| **No cron/scheduling yet** | the Worker only answers `GET /digest` on demand; a real digest needs Cron Triggers (scheduled) — escalation documented in §31.6 |
| **Extractive ≠ synthesis** | same as local: frequency-scored titles, not an LLM summary. Escalation = Workers AI `ask-ai` (paid) |
| **HN front-page selector is brittle** | local found `class="titlelink"` no longer works; cloud switched to Algolia `tags=front_page` (stable). This is a port-time fix, not a cloud-specific limit. |
| **Google News 503 on CF egress** | measured in research-radar: gnews RSS is rate-limited from CF datacenter IPs → the news half may be empty on cloud. |
| **Isolate boundary** | no persistence between requests (same as web-scraper); each `/digest` is self-contained. |

## 3. Build learnings

- Swapped the brittle HN HTML scrape for Algolia `tags=front_page` — a strictly better keyless adapter (and a fix worth folding back into the local template too).
- Same annotation-stripping discipline as the other workers (no `experimental` flag).

## 4. Run learnings (measured)

Deployed `https://rh-digest.ambiens.workers.dev`, ran `GET /digest`:

| Metric | Value |
|---|---|
| sources | 10 |
| hn (Algolia front_page) | 10 ✅ |
| news (Google News RSS) | **0** — 503 from CF egress (confirms research-radar's gnews finding) |
| top digest item | "AI-Generated GitHub Copilot Autofix Allowed Compromise of Snowflake's Jira" |

**Key finding:** the Algolia swap fixed the brittle HN selector and works from CF egress; Google News RSS is consistently 503 from CF (so the digest's news half is empty on cloud). The local version still gets Google News — another case where cloud egress is *not* strictly better.


## 5. Blueprint guidance update

- Cloud adds **remote + on-demand** digest, but the real value is **Cron + Workers AI synthesis** (both paid escalations). The shipped blueprint defaults to extractive + on-demand, with the escalation points documented.