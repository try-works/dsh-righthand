# blueprint/image-pipeline

> Hermes source: Media. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Image transforms as a pipeline: ffmpeg/ImageMagick run the transform, exit 0 gates the publish, R2 stores, the presigned link ships.

## The recipe

1. transform (resize, convert, strip).
2. exit 0 means the file exists - gate the put.
3. publish and index.
4. share and notify.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| transform | rh_run | collect, bounded |
| gate | exit code | 0 = the artifact exists |
| publish | rh_files_put + rh_store_put | contentType at put |
| share | rh_files_share + rh_notify_send | the link |

## Limits

local tooling (ffmpeg/ImageMagick) must be installed - a red receipt says so.