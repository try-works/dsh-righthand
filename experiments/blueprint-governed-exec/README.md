# blueprint/governed-exec

> Every high-impact command as a governed, receipted step: guard rules
> gate the prefix, rh_run executes with bounded collected output, the
> store keeps the before/after receipt - the undo trail. See
> `blueprint.json` for the declarative spec.

## What this is

The guard's per-call discipline scaled to whole tasks. The plugin guard
decides whether a prefix may run; this blueprint records what ran and
how to undo it.

## The recipe

1. **Gate**: a guard rule for the destructive prefix, e.g.
   `{ toolPrefix: 'rh_run', mode: 'ask', ask: (args) => args.force }` or
   `mode: 'deny'` for the irreversible set. `destructive: true` on the
   rule documents why - enforcement is still the mode.
2. **Before-receipt**: `rh_store_put { key: 'receipt:<task>:<ts>', value:
   { argv, cwd, at } }`; for mutating steps record what will change
   (e.g. the DNS record as it is now, the files to be moved).
3. **Run**: `rh_run { argv: [...] }` - argv array, no shell
   interpretation; collect mode returns exit code + bounded
   stdout/stderr. `rh_run_bg` for long builds - it reports status/exit
   but not captured output (live-verified).
4. **After-receipt**: overwrite the key with `{ ...before, exitCode,
   ok, summary, at }` - one line saying what happened.
5. **Revert**: read the receipt and move each recorded `{ to -> from }`
   in reverse. Undo quality equals receipt quality.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| auth gate | `rh_credential_describe` | Cloudflare scenarios stop here when unset |
| config | `rh_settings_get` | accountId, zone, bucket from settings |
| gate | guard config | deny/ask per prefix, before dispatch |
| execute | `rh_run` / `rh_run_bg` | collect for answers, bg for fire-and-forget |
| journal | `rh_store_put` / `rh_store_get` | before/after receipt pairs |
| revert | `rh_store_get` + `rh_run` | replay the receipt in reverse |

## Escalation

Golden discipline: derive the guard facts with `guardFactsFor` and pin
them in a golden file (`UPDATE_GOLDEN=1 pnpm test`) - a guard change is
then a visible diff, not a surprise. The plugin does this for its own
37 tools; an agent-built guard should do the same for its own.

## What tests pin

`tests/dsh-native-tools.spec.ts` pins rh_run exit/stdout and the guard
deny path; `tests/permissions.spec.ts` + `permissions.golden` pin every
tool's derived facts. Receipt round-trips ran live 2026-08-31 (digest
scenario: rh_run -> parse -> store -> read back -> delete).