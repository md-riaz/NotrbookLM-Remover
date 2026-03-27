import { useEffect, useMemo, useRef, useState } from "react";
import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile, toBlobURL } from "@ffmpeg/util";
import Controls from "./components/Controls";
import ProgressBar from "./components/ProgressBar";
import UploadBox from "./components/UploadBox";
import VideoPreview from "./components/VideoPreview";
import {
  MB,
  MAX_FILE_SIZE,
  PRESETS,
  detectDynamicDelogoFilter,
  getScaledDelogo,
  getVideoMetadata,
  initialState,
} from "./lib/watermark";

const MIN_DURATION = 0.5;
const FFMPEG_CDN_BASE =
  "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm";

function getErrorDebugDetails(error) {
  if (!error) return ["Unknown processing error."];

  const details = [];
  if (error instanceof Error) {
    details.push(`name=${error.name}`);
    details.push(`message=${error.message || "No error message available."}`);
    if (error.stack) {
      const firstStackLines = error.stack.split("\n").slice(0, 4).join(" | ");
      details.push(`stack=${firstStackLines}`);
    }
  } else {
    details.push(`nonErrorValue=${String(error)}`);
  }

  return details;
}

export default function App() {
  const ffmpegRef = useRef(null);
  const isFfmpegLoadedRef = useRef(false);
  const isMountedRef = useRef(false);
  const [state, setState] = useState(initialState);
  const [preset, setPreset] = useState("balanced");
  const [removeEnding, setRemoveEnding] = useState(true);
  const [dynamicDetection, setDynamicDetection] = useState(false);
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState("");
  const [inputPreviewUrl, setInputPreviewUrl] = useState("");

  const hasInput = Boolean(state.file);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fileLabel = useMemo(() => {
    if (!state.file) return "Drop an MP4 file here, or click to browse.";
    return `${state.file.name} (${(state.file.size / MB).toFixed(2)} MB)`;
  }, [state.file]);

  const appendLog = (line) => {
    if (!isMountedRef.current) return;
    setLogs((prev) => [...prev.slice(-120), line]);
  };

  const appendDebugLog = (label, payload = "") => {
    const now = new Date().toISOString();
    const message = payload ? `${label}: ${payload}` : label;
    appendLog(`[debug ${now}] ${message}`);
  };

  const setPublicError = (message, debugDetails = []) => {
    const fallback =
      "Processing failed. Please review debug logs below and try again.";
    setError(message || fallback);
    debugDetails.forEach((detail) => appendDebugLog("error-detail", detail));
  };

  const getFfmpegAssetUrls = () => {
    const localBasePath = `${import.meta.env.BASE_URL}ffmpeg/`;

    return {
      local: {
        coreURL: `${localBasePath}ffmpeg-core.js`,
        wasmURL: `${localBasePath}ffmpeg-core.wasm`,
      },
      cdn: {
        coreURL: `${FFMPEG_CDN_BASE}/ffmpeg-core.js`,
        wasmURL: `${FFMPEG_CDN_BASE}/ffmpeg-core.wasm`,
      },
    };
  };

  const getBlobifiedCdnAssetUrls = async (cdnAssetUrls) => ({
    coreURL: await toBlobURL(cdnAssetUrls.coreURL, "text/javascript"),
    wasmURL: await toBlobURL(cdnAssetUrls.wasmURL, "application/wasm"),
  });

  const onFileSelect = async (file) => {
    if (!isMountedRef.current) return;
    setError("");
    if (!file) return;

    if (!file.name.toLowerCase().endsWith(".mp4")) {
      setPublicError("Only MP4 files are supported.");
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setPublicError("Max file size is 100 MB.");
      return;
    }

    try {
      const metadata = await getVideoMetadata(file);
      if (!isMountedRef.current) return;
      setState((prev) => ({
        ...prev,
        file,
        duration: metadata.duration,
        width: metadata.width,
        height: metadata.height,
        progress: 0,
        status: "idle",
        outputUrl: "",
      }));
      setLogs([]);
      appendDebugLog(
        "input-metadata",
        `duration=${metadata.duration.toFixed(2)} width=${metadata.width} height=${metadata.height}`,
      );
    } catch (err) {
      if (isMountedRef.current) {
        setPublicError(
          "Could not read video metadata. Please retry with another MP4 file.",
          getErrorDebugDetails(err),
        );
      }
    }
  };

  const ensureFfmpegLoaded = async () => {
    if (!ffmpegRef.current) {
      ffmpegRef.current = new FFmpeg();
      ffmpegRef.current.on("log", ({ message }) => appendLog(message));
      ffmpegRef.current.on("progress", ({ progress }) => {
        if (!isMountedRef.current) return;
        setState((prev) => ({ ...prev, progress: Math.round(progress * 100) }));
      });
    }

    if (!isFfmpegLoadedRef.current) {
      if (isMountedRef.current)
        setState((prev) => ({ ...prev, status: "loading" }));
      const assetUrls = getFfmpegAssetUrls();

      try {
        appendDebugLog(
          "ffmpeg-load",
          `starting local core load from ${assetUrls.local.coreURL} and ${assetUrls.local.wasmURL}`,
        );
        await ffmpegRef.current.load(assetUrls.local);
        appendDebugLog("ffmpeg-load", "completed (local assets)");
      } catch (localLoadError) {
        getErrorDebugDetails(localLoadError).forEach((detail) =>
          appendDebugLog("ffmpeg-local-load-error", detail),
        );
        appendDebugLog(
          "ffmpeg-load",
          `local load failed, switching to CDN assets core=${assetUrls.cdn.coreURL} wasm=${assetUrls.cdn.wasmURL}`,
        );
        try {
          const blobifiedCdnAssetUrls = await getBlobifiedCdnAssetUrls(
            assetUrls.cdn,
          );
          await ffmpegRef.current.load(blobifiedCdnAssetUrls);
          appendDebugLog("ffmpeg-load", "completed (CDN fallback)");
          appendDebugLog(
            "ffmpeg-load-warning",
            "Using CDN fallback. Add public/ffmpeg assets for offline/local reliability.",
          );
        } catch (cdnLoadError) {
          getErrorDebugDetails(cdnLoadError).forEach((detail) =>
            appendDebugLog("ffmpeg-cdn-load-error", detail),
          );
          throw cdnLoadError;
        }
      }

      isFfmpegLoadedRef.current = true;
    }
  };

  useEffect(() => {
    if (!state.file) {
      setInputPreviewUrl("");
      return;
    }
    const nextUrl = URL.createObjectURL(state.file);
    setInputPreviewUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [state.file]);

  useEffect(
    () => () => {
      if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);
    },
    [state.outputUrl],
  );

  const onProcess = async () => {
    if (!state.file || !isMountedRef.current) return;
    setError("");
    setLogs([]);

    try {
      await ensureFfmpegLoaded();
      if (isMountedRef.current)
        setState((prev) => ({ ...prev, status: "processing", progress: 0 }));

      const ffmpeg = ffmpegRef.current;
      appendDebugLog(
        "input-file",
        `name=${state.file.name} bytes=${state.file.size}`,
      );
      await ffmpeg.writeFile("input.mp4", await fetchFile(state.file));

      const finalDuration = removeEnding
        ? Math.max(0, state.duration - 2.5)
        : state.duration;
      const durationArgs =
        finalDuration >= MIN_DURATION ? ["-t", `${finalDuration}`] : [];
      const rect = getScaledDelogo(state.width, state.height);
      const defaultFilter = `delogo=x=${rect.x}:y=${rect.y}:w=${rect.w}:h=${rect.h}`;
      const delogoFilter = dynamicDetection
        ? await detectDynamicDelogoFilter(state.file, state)
        : defaultFilter;

      const args = [
        "-i",
        "input.mp4",
        "-vf",
        delogoFilter,
        ...PRESETS[preset],
        "-c:v",
        "libx264",
        "-tune",
        "stillimage",
        "-c:a",
        "copy",
        ...durationArgs,
        "output.mp4",
      ];

      if (removeEnding && finalDuration < MIN_DURATION) {
        appendLog(
          "Ending trim skipped because resulting duration is too short.",
        );
      }

      appendDebugLog(
        "pipeline",
        `preset=${preset} dynamicDetection=${dynamicDetection} removeEnding=${removeEnding}`,
      );
      appendLog(`Running: ffmpeg ${args.join(" ")}`);
      await ffmpeg.exec(args);
      const data = await ffmpeg.readFile("output.mp4");
      const outputBlob = new Blob([data.buffer], { type: "video/mp4" });
      const outputUrl = URL.createObjectURL(outputBlob);

      if (!isMountedRef.current) {
        URL.revokeObjectURL(outputUrl);
        return;
      }

      appendDebugLog("output-file", `bytes=${outputBlob.size}`);
      setState((prev) => ({
        ...prev,
        outputUrl,
        status: "done",
        progress: 100,
      }));
    } catch (err) {
      if (isMountedRef.current) {
        setState((prev) => ({ ...prev, status: "error" }));
        setPublicError(
          "We could not process this video. Please check the FFmpeg logs and debug details below.",
          getErrorDebugDetails(err),
        );
      }
    }
  };

  return (
    <main className="container">
      <h1>NotebookLM Video Watermark Remover</h1>
      <p className="subtext">
        Client-side MP4 watermark removal via FFmpeg WASM + delogo.
      </p>

      <UploadBox fileLabel={fileLabel} onFileSelect={onFileSelect} />
      <Controls
        preset={preset}
        setPreset={setPreset}
        removeEnding={removeEnding}
        setRemoveEnding={setRemoveEnding}
        dynamicDetection={dynamicDetection}
        setDynamicDetection={setDynamicDetection}
      />

      <button
        type="button"
        onClick={onProcess}
        disabled={!hasInput || state.status === "processing"}
      >
        {state.status === "processing" ? "Processing…" : "Process Video"}
      </button>

      <ProgressBar progress={state.progress} status={state.status} />

      {error && <p className="error">{error}</p>}

      <VideoPreview
        inputPreviewUrl={inputPreviewUrl}
        outputUrl={state.outputUrl}
      />

      <section className="logs">
        <h2>FFmpeg Logs</h2>
        <pre>{logs.join("\n")}</pre>
      </section>
    </main>
  );
}
