# NotebookLM Video Watermark Remover (Replica)

React + FFmpeg WASM implementation of the NotebookLM watermark remover flow:

- MP4-only upload with drag/drop and 100MB validation
- FFmpeg load with:
  - `/ffmpeg/ffmpeg-core.js`
  - `/ffmpeg/ffmpeg-core.wasm`
- Delogo pipeline with default rectangle: `x=1104:y=656:w=133:h=22` (scaled for non-1280x720)
- Optional dynamic detection via `<video>` + `<canvas>` variance sampling
- Optional ending trim (`duration - 2.5`)
- Presets:
  - speed: `-r 15 -crf 28 -preset ultrafast`
  - balanced: `-r 30 -crf 23 -preset veryfast`
  - quality: `-crf 18 -preset superfast`
- FFmpeg args:
  - `-i input.mp4 -vf <delogoFilter> ...preset -c:v libx264 -tune stillimage -c:a copy -t <finalDuration> output.mp4`

## Run

```bash
npm install
npm run dev
```

> Place FFmpeg core assets in `public/ffmpeg`:
>
> - `public/ffmpeg/ffmpeg-core.js`
> - `public/ffmpeg/ffmpeg-core.wasm`
