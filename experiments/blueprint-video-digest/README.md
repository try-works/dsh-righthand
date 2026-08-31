# blueprint/video-digest

> Hermes source: youtube-content. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Video transcripts become digests: yt-dlp pulls subtitles locally, rh_text_summarise condenses chunk by chunk, the store keeps the digest.

## The recipe

1. fetch subtitles via yt-dlp in collect mode.
2. chunk the transcript on paragraph boundaries.
3. summarise each chunk (one contained call).
4. store the digest and notify once.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| fetch | rh_run | yt-dlp --quiet --skip-download |
| chunk | agent | paragraph boundaries |
| condense | rh_text_summarise | one call per chunk |
| deliver | rh_store_put + rh_notify_send | video:<id> |

## Limits

video downloads need disk space; only subtitles are fetched in this kit.