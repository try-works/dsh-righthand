# blueprint/audio-analysis

> Hermes source: songsee. Righthand-native recipe; see
> `blueprint.json` for the declarative spec.

Audio metrics as receipts: ffmpeg/librosa scripts compute duration, loudness and tempo, the store keeps one receipt per track, the note summarizes.

## The recipe

1. compute the metrics (print numbers only - collect is bounded).
2. receipt per track.
3. summarize the library note.
4. scan by prefix for the catalog.

## Tool matrix

| Step | Tool | Notes |
|---|---|---|
| metrics | rh_run | bounded output |
| receipt | rh_store_put | audio:<id>:<ts> |
| note | rh_text_summarise | the library shape |
| scan | rh_store_list | prefix catalog |

## Limits

local CPU only - heavy analysis belongs to a Worker or GPU box.