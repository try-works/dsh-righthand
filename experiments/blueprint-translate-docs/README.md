# blueprint/translate-docs

> Hermes source: Translation. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Batch document translation: chunk on boundaries, translate per chunk, store the translations, reassemble and publish via files.

## The recipe

1. chunk the document on boundaries (translate preserves formatting).
2. translate each chunk (one contained call).
3. store chunk translations.
4. reassemble, publish, share.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| chunk | agent | paragraph boundaries |
| translate | rh_text_translate | one call per chunk |
| store | rh_store_put | source:<doc>:<lang> |
| publish | rh_files_put + rh_files_share | presigned link |

## Limits

model quality per language pair is the text family's own ceiling.