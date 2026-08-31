# blueprint/artifact-publish

> Hermes source: creative/claude-design, popular-web-designs, architecture-diagram, p5js. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

## The recipe

1. **Render**: rh_run the build/render command - exit 0 means the
   artifact exists.
2. **Publish**: rh_files_put with the right contentType (set it at put
   time or the browser renders it wrong).
3. **Index**: one store record beside the blob (file-vault pattern).
4. **Share**: rh_files_share for the time-boxed presigned URL.
5. **Notify**: send the link - the URL is a secret for its window.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| render | `rh_run` | local tools, exit 0 gates the put |
| publish | `rh_files_put` | contentType required |
| index | `rh_store_put` | { contentType, size, at } |
| share | `rh_files_share` | presigned, 60 min default |
| notify | `rh_notify_send` | the link |

Covers any generated artifact: a page, a diagram, a sketch, a deck.
Needs the user's R2 credentials configured (credential-onboarding).