# blueprint/draft-queue

> Hermes source: Communication. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Drafts with a tone check before release: write to the store, classify the tone against the target, rewrite until it matches, release via notify or files.

## The recipe

1. write the draft with a target tone.
2. classify the current tone.
3. rewrite until the label matches (the rewrite is the agent's).
4. release: store the final and notify or publish.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| draft | rh_store_put | draft:<slug> |
| check | rh_text_classify | verbatim tone labels |
| rewrite | agent | tools verify only |
| release | rh_notify_send / rh_files_put | the final |

## Limits

release channels are notify or presigned files - no mail/social without the keyless route.