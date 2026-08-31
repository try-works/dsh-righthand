# blueprint/paper-digest CLOUD learnings log

> Cloud version of the paper-digest blueprint. Deployed test build on the
> user's own Cloudflare account (workers.dev, keyless).

## Run context

| Field | Value |
|---|---|
| Worker | `cloud/index.js` - rh-arxiv, `GET /papers?q=&n=`, `/health` |
| Deploy | wrangler 4.123.0, OAuth, workers.dev |
| URL | https://rh-arxiv.ambiens.workers.dev |
| Compat | 2026-08-31 |

## Measured (2026-08-31)

- `/papers?q=agent&n=5` -> 5 entries, unique ids, PASS.
- export.arxiv.org answers from CF egress and the export -> arxiv
  redirect hop is followed by Workers fetch - the guardedFetch
  redirect-revalidation discipline maps to fetch redirect: follow here.
- The Atom `<entry>` parse (title/summary/published/authors/id) worked
  unchanged from the local probe - the XML parse is the only shape
  handling, no account, no key.

## Build learnings

- Stateless by design: the Worker normalizes; the caller (rh_store)
  keeps the rolling window and diffs by arxiv id - the Worker never
  needs bindings.
- No nodejs APIs used (fetch + AbortSignal only); nodejs_compat is
  enabled per best practice but nothing depends on it.

## Blueprint guidance update

- The cloud build turns paper-digest's step 1-2 (fetch + normalize)
  into a remote endpoint; summarise (step 3) stays an rh_text_summarise
  call in the agent, not in the Worker - one model per abstract on the
  agent side keeps the Worker free and keyless.