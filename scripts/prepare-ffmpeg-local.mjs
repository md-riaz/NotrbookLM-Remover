import { mkdir, copyFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");

const filesToCopy = [
  {
    source: resolve(
      projectRoot,
      "node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.js",
    ),
    target: resolve(projectRoot, "public/ffmpeg/ffmpeg-core.js"),
  },
  {
    source: resolve(
      projectRoot,
      "node_modules/@ffmpeg/core/dist/esm/ffmpeg-core.wasm",
    ),
    target: resolve(projectRoot, "public/ffmpeg/ffmpeg-core.wasm"),
  },
];

async function prepareLocalFfmpegAssets() {
  await mkdir(resolve(projectRoot, "public/ffmpeg"), { recursive: true });

  await Promise.all(
    filesToCopy.map(async ({ source, target }) => {
      await copyFile(source, target);
    }),
  );

  process.stdout.write("Prepared local FFmpeg core assets in public/ffmpeg.\n");
}

prepareLocalFfmpegAssets().catch((error) => {
  process.stderr.write(
    `Failed to prepare local FFmpeg assets: ${error.message}\n`,
  );
  process.exitCode = 1;
});
