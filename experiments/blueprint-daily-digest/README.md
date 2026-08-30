# blueprint/daily-digest

> Blueprint experiment. See `blueprint.json` for the declarative spec, `LEARNINGS.md` for local findings, `cloud/LEARNINGS.md` for cloud findings.

## What this is

blueprint/daily-digest — a runnable instantiation of the `blueprint/daily-digest` recipe (RESEARCH §31). Local = keyless, zero-install, Node 24 erasable TypeScript. Cloud = the same logic as a Cloudflare Worker.

## Run locally (2 steps: produce evidence, then assert)

```bash
node --experimental-strip-types run.ts      # writes digest.json
node --experimental-strip-types test.ts            # asserts on digest.json
```

## Run the cloud version

```bash
# cloud test (hits the deployed Worker)
node --experimental-strip-types cloud/test.ts https://rh-digest.ambiens.dev

# redeploy (wrangler OAuth)
cd cloud && wrangler deploy
```

## Endpoints (cloud)

- `GET /health` — liveness
- (see `cloud/index.js` for the blueprint-specific routes)

## Escalation path (local → cloud)

1. **extractive summarize** (local, free) → 2. **Algolia instead of brittle HN HTML** (both) → 3. **cron trigger** (cloud) → 4. **Workers AI synthesis** (cloud, paid).

## Measured findings (this experiment)

See `LEARNINGS.md` (local) and `cloud/LEARNINGS.md` (cloud) for the full run log. The headline result is recorded in `cloud/evidence.json`.