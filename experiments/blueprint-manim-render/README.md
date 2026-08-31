# blueprint/manim-render

> Hermes source: manim-video. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Math animation renders as a share pipeline: rh_run renders the scene, R2 stores the video, the presigned link ships it.

## The recipe

1. render the scene (background + poll).
2. exit 0 gates the put.
3. publish, index, share.
4. notify the link.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| render | rh_run_bg + poll | manim is slow |
| gate | exit code | 0 = the mp4 exists |
| publish | rh_files_put + rh_store_put | contentType video |
| share | rh_files_share + rh_notify_send | the link |

## Limits

local render times; the scene authoring is the agent's, the kit renders and ships.