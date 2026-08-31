# blueprint/video-ascii

> Hermes source: ascii-video. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

ASCII video rendering as a share pipeline: ffmpeg renders frames to ASCII, R2 stores the output, a presigned link ships it.

## The recipe

1. render the ASCII frames (background for long renders).
2. exit 0 gates the put.
3. publish, index, share.
4. notify the link.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| render | rh_run / rh_run_bg | long = bg + poll |
| gate | exit code | 0 = artifact exists |
| publish | rh_files_put + rh_store_put | contentType |
| share | rh_files_share + rh_notify_send | the link |

## Limits

rendering is CPU-bound locally - a Worker or GPU is the escalation.