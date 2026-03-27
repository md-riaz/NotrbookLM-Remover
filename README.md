# NotebookLM Video Watermark Remover (Replica)

React + FFmpeg WASM implementation of the NotebookLM watermark remover flow.

## Features

- MP4-only upload with drag/drop and 100MB validation.
- Service worker enabled for cached app shell and faster repeat loads.
- FFmpeg local core loading (`public/ffmpeg`) with automatic CDN fallback.
- Delogo pipeline with default rectangle `x=1104:y=656:w=133:h=22` (auto-scaled for non-1280x720 videos).
- Optional dynamic detection via `<video>` + `<canvas>` variance sampling.
- Optional ending trim (`duration - 2.5s`).
- Processing checkpoints are saved in `localStorage`, while segment outputs are persisted in `IndexedDB` so processing can resume after reload/tab close.
- Segment-based processing to keep progress durable and improve perceived performance.
- Output FPS handling:
  - never upscales low-FPS inputs,
  - caps FPS at 60 when source FPS is higher than 60.

## Profiles

- **Speed**: `-crf 28 -preset ultrafast`
- **Balanced**: `-crf 23 -preset veryfast`
- **Quality**: `-crf 18 -preset superfast`

## Run

```bash
npm install
npm run dev
```

`npm run dev` and `npm run build` automatically run `npm run prepare:ffmpeg` to copy local core assets from `node_modules/@ffmpeg/core/dist/esm` into `public/ffmpeg`.

> If local assets are unavailable (for example if `prepare:ffmpeg` has not run yet), the app falls back to jsDelivr (`@ffmpeg/core@0.12.10`).
