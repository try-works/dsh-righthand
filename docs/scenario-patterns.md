# Scenario patterns - righthand recipes, tested by building

> Every recipe here ran live on 2026-08-31 against the real harness
> services (store, settings, credentials, subprocess, jobs) through the
> agent-facing `rh_*` tools, then the state was cleaned back up. Evidence
> of each run is inline; re-run them any time - they are safe.

## The key conventions (one store, many collections)

`rh_store_*` is one key space. The prefix IS the collection;
`rh_store_list` + a prefix filter is the query language. Conventions:

| Prefix | Collection | Example value shape |
|---|---|---|
| `task:` | task board | `{ state: 'open', result? }` |
| `digest:` | daily digests | `{ top: [...], fetchedAt }` |
| `run:` / `uptime:` / `expense:` | dated logs | one record per date, aggregate by scan |
| `deploy:` / `dns:` / `tidy:` / `smoke:` | receipts and undo trails | `{ before, after, exitCode, at }` |
| anything else | ad-hoc | JSON-serializable only |

Absence is `{ found: false }`, not an error - that is the exists() check.
Every `rh_store_put` returns a global `writes` counter; the increment
sequence is the audit trail.

## The receipt pattern (scenario 4, live-verified)

Build with `rh_run`, keep the result as one receipt key:

```
rh_run { argv: ['node', 'scripts/fetch-digest.mjs', 'tests/fixtures/day2.json', '5'], cwd: 'D:/righthand-test' }
// -> exit 0, stdout = the fetcher's JSON (parse it in the caller)
rh_store_put { key: 'digest:scenario-test:2026-08-31',
               value: { source: 'day2.json', count: 2, fresh: ['4'],
                        top: [{ id: '4', title: '...' }], fetchedAt: '<iso>' } }
rh_store_get { key: 'digest:scenario-test:2026-08-31' }  // found: true, full value back
rh_store_delete { key: 'digest:scenario-test:2026-08-31' } // clean up when done
```

The diff step that makes a digest a digest: fetch today and yesterday,
compare id sets in the caller, store only `fresh` in the receipt.

## Undo trails (scenario 7 pattern)

Any mutating build writes what it is about to change BEFORE doing it,
then the after-state:

```
rh_store_put { key: 'tidy:<ts>', value: { moved: [{ from, to }], at: '<iso>' } }
// ... do the moves with rh_run ...
// revert = read tidy:<ts> and move each { to -> from } in reverse
```

## Settings: the schema wall (live finding)

`rh_settings_set` accepts any patch - including keys the schema does not
define: `{ weeklyBudget: 200 }` returned `applied: true`. But
`rh_settings_get` only ever returns schema-known keys, so the custom key
never comes back. A scenario that needs its own config knob has exactly
two honest options:

1. register the key in the righthand settings schema (a plugin change), or
2. keep the knob in `rh_store` under its own prefix.

Never depend on an unregistered settings key - it looks written and
silently disappears.

## Credentials: the auth gate (scenario 1/2, live-verified)

`rh_credential_describe` is the first step of any Cloudflare scenario and
it answers yes/no without leaking the value:

```
rh_credential_describe { ref: 'CLOUDFLARE_API_TOKEN' }
// { configured: false, writable: true }  -> stop, tell the user what to set
```

`set` stores, `unset` removes, and no output ever contains the secret
(live-verified with a throwaway ref: set -> describe configured:true ->
unset -> configured:false; the value never appeared).

## Exec: collect vs background (live finding)

| | `rh_run` | `rh_run_bg` |
|---|---|---|
| Returns | exit code + bounded stdout/stderr | a job id |
| Use when | you need the output in this turn | the command is long and this turn must go on |
| Polling | - | the job registry reports status/exit (`job_list` / `job_output`) |
| Output capture | yes (bounded) | NOT captured by the local registry - status and exit only |

Live-verified: `rh_run` curl returned HTTP headers + exit 0, and a failing
`node -e` returned exit 3 with stderr. `rh_run_bg` settled completed with
exit 0 and an empty output tail - background is for fire-and-forget and
status polling, collect mode is for answers.

## Cleanup discipline

Scenarios write, verify, then delete their keys - the live runs above
left the store exactly as found (baseline keys only). If a run is a
deliverable rather than a test, the receipt key stays and IS the record.

## Scenario matrix

`D:/righthand-test/SCENARIOS.md` holds the full tool-per-step matrix for
nine scenarios (deploy, DNS, grocery, digest, uptime, workout, downloads
tidy, budget, smoke test). The ones exercised live here: grocery (3),
digest (4), uptime (5), workout (6), plus the credential/settings/exec
cross-cuts shared by the rest.