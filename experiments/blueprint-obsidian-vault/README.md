# blueprint/obsidian-vault

> Hermes source: obsidian. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

The agent-notebook pattern over a real Obsidian vault: scan markdown via rh_run, index into the store, recall by prefix, compact long notes.

## The recipe

1. scan the vault via rh_run.
2. index titles and paths into the store.
3. recall by prefix scan.
4. compact long notes with the original kept.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| scan | rh_run | vault path, bounded |
| index | rh_store_put | note:<slug> |
| recall | rh_store_get / rh_store_list | prefix scan |
| compact | rh_text_summarise | original kept |

## Limits

read-only by default; writes need the user's own editor or an explicit rh_run write step.