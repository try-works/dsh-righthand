# @try-works/dsh-righthand

A DeepSeek Harness plugin providing DSH-native **righthand tools** — a durable
KV store, credential/settings management, governed command execution, and a
tool guard. Every tool is built on the harness's own services
(`storageDomain`, `credentials`, `settings`, `subprocess`, `jobs`, `tools`),
not hand-rolled primitives.

## Install

```bash
dsh plugin --profile <profile> add @try-works/dsh-righthand
```

Or apply the overlay directly:

```bash
dsh --profile <profile> --patch ./cordis.patch.yml
```

## Tools

| Tool | Family | Backing service |
|---|---|---|
| `rh_store_put` / `rh_store_get` / `rh_store_delete` / `rh_store_list` | store | `ctx.storageDomain` (domain KV) |
| `rh_credential_describe` / `rh_credential_set` / `rh_credential_unset` | secrets | `ctx.credentials` (values never echoed) |
| `rh_settings_get` / `rh_settings_set` | secrets | `ctx.settings` (namespace `righthand`) |
| `rh_run` | exec | `ctx.subprocess` (collect mode, bounded output) |
| `rh_run_bg` | exec | `ctx.jobs` + `ctx.subprocess` (background job) |
| (policy) | guard | `ctx.tools` `tools/pre-execute` |

## Configuration

```yaml
# cordis.patch.yml
- insert:
    - id: dsh-righthand
      name: '@try-works/dsh-righthand'
      config:
        rules:
          - toolPrefix: 'rh_'
            mode: 'ask'
            ask: (args) => args?.force === true
```

Guard modes: `allow` (pass through), `deny` (block with an error), `ask`
(defer to the policy function). Omitted rules leave the guard inert.

## Settings

Namespace "righthand" (registered by the secrets family):

| Key | Default | Meaning |
|---|---|---|
| `accountId` | "" | Cloudflare account id used by righthand Cloudflare tools |
| `defaultScriptPrefix` | "rh-" | default name prefix for generated workers/scripts |
| `defaultZone` | "" | default Cloudflare zone |

`rh_settings_get` returns the resolved values; `rh_settings_set` merges a
partial patch (persisted by the harness settings provider).

## Packaged skill

The plugin ships the `dsh-righthand` skill
(`skills/dsh-righthand/SKILL.md`, the dsh-plugin packaged-skill standard):
tool-reference tables, store/credential/settings semantics, guard modes, and
service availability. It registers via `ctx.skills` on mount, so the agent's
skill catalog lists it automatically.

## Service availability

The store family needs `ctx.storageDomain`, which the web profile provides
(`storage` + `storage-json` + `storage-domain` rows). In a profile without
it — e.g. the headless bundle — the store tools stay dormant and the other
seven tools still register; the plugin never fails the boot.

## Development

```bash
pnpm install
pnpm test        # boots the real harness services and executes every tool
pnpm typecheck
pnpm build       # tsc -> lib/ (prepack runs this automatically)
```

## License

Apache-2.0
