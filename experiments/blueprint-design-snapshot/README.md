# blueprint/design-snapshot

> Hermes source: claude-design / popular-web-designs. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Capture a site's design tokens as data: browse it, extract colors/type/spacing, store the snapshot, generate a reference artifact and publish it.

## The recipe

1. browse the site and extract tokens.
2. store the dated snapshot.
3. generate the reference artifact (agent-built).
4. publish and share.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| browse | browser tools | the harness's own |
| snapshot | rh_store_put | token:<site>:<ts> |
| build | agent + rh_run | the reference artifact |
| publish | rh_files_put + rh_files_share | presigned |

## Limits

capture quality depends on the browser tools; the kit does not restyle, it records.