import { useEffect, useMemo, useRef, useState } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile, toBlobURL } from '@ffmpeg/util';
import Controls from './components/Controls';
import ProgressBar from './components/ProgressBar';
import UploadBox from './components/UploadBox';
import VideoPreview from './components/VideoPreview';
import {
  MB,
  MAX_FILE_SIZE,
  PRESETS,
  PROCESS_CHUNK_SECONDS,
  detectDynamicDelogoFilter,
  getOutputFps,
  getScaledDelogo,
  getVideoMetadata,
  initialState,
} from './lib/watermark';

const MIN_DURATION = 0.5;
const FFMPEG_CDN_BASE = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm';
const JOB_STORAGE_KEY = 'watermark-remover-job-v1';

function getErrorDebugDetails(error) {
  if (!error) return ['Unknown processing error.'];

  const details = [];
  if (error instanceof Error) {
    details.push(`name=${error.name}`);
    details.push(`message=${error.message || 'No error message available.'}`);
    if (error.stack) {
      const firstStackLines = error.stack.split('\n').slice(0, 4).join(' | ');
      details.push(`stack=${firstStackLines}`);
    }
  } else {
    details.push(`nonErrorValue=${String(error)}`);
  }

  return details;
}

function loadSavedJob() {
  try {
    const raw = window.localStorage.getItem(JOB_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function saveJob(job) {
  try {
    window.localStorage.setItem(JOB_STORAGE_KEY, JSON.stringify(job));
  } catch {
    // best effort persistence
  }
}

function clearSavedJob() {
  try {
    window.localStorage.removeItem(JOB_STORAGE_KEY);
  } catch {
    // ignore
  }
}

function getConcatFileList(segmentCount) {
  return Array.from({ length: segmentCount })
    .map((_, index) => `file 'segment-${String(index).padStart(4, '0')}.mp4'`)
    .join('\n');
}

export default function App() {
  const ffmpegRef = useRef(null);
  const isFfmpegLoadedRef = useRef(false);
  const isMountedRef = useRef(false);
  const [state, setState] = useState(initialState);
  const [preset, setPreset] = useState('balanced');
  const [removeEnding, setRemoveEnding] = useState(true);
  const [dynamicDetection, setDynamicDetection] = useState(false);
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState('');
  const [inputPreviewUrl, setInputPreviewUrl] = useState('');
  const [savedJob, setSavedJob] = useState(null);

  const hasInput = Boolean(state.file);

  useEffect(() => {
    isMountedRef.current = true;
    const existingJob = loadSavedJob();
    if (existingJob) {
      setSavedJob(existingJob);
      setPreset(existingJob.preset || 'balanced');
      setRemoveEnding(Boolean(existingJob.removeEnding));
      setDynamicDetection(Boolean(existingJob.dynamicDetection));
    }

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const fileLabel = useMemo(() => {
    if (!state.file) return 'Drop an MP4 file here, or click to browse.';
    return `${state.file.name} (${(state.file.size / MB).toFixed(2)} MB)`;
  }, [state.file]);

  const appendLog = (line) => {
    if (!isMountedRef.current) return;
    setLogs((prev) => [...prev.slice(-180), line]);
  };

  const appendDebugLog = (label, payload = '') => {
    const now = new Date().toISOString();
    const message = payload ? `${label}: ${payload}` : label;
    appendLog(`[debug ${now}] ${message}`);
  };

  const setPublicError = (message, debugDetails = []) => {
    const fallback = 'Processing failed. Please review debug logs below and try again.';
    setError(message || fallback);
    debugDetails.forEach((detail) => appendDebugLog('error-detail', detail));
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
    coreURL: await toBlobURL(cdnAssetUrls.coreURL, 'text/javascript'),
    wasmURL: await toBlobURL(cdnAssetUrls.wasmURL, 'application/wasm'),
  });

  const onFileSelect = async (file) => {
    if (!isMountedRef.current) return;
    setError('');
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.mp4')) {
      setPublicError('Only MP4 files are supported.');
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setPublicError('Max file size is 100 MB.');
      return;
    }

    try {
      const metadata = await getVideoMetadata(file);
      if (!isMountedRef.current) return;

      const outputFps = getOutputFps(metadata.fps);
      setState((prev) => ({
        ...prev,
        file,
        duration: metadata.duration,
        width: metadata.width,
        height: metadata.height,
        fps: outputFps,
        progress: 0,
        status: 'idle',
        outputUrl: '',
      }));

      if (savedJob?.fileName && savedJob.fileName === file.name) {
        appendLog(`Resume context loaded for ${file.name}. Press "Process Video" to continue.`);
      }

      setLogs([]);
      appendDebugLog(
        'input-metadata',
        `duration=${metadata.duration.toFixed(2)} width=${metadata.width} height=${metadata.height} inputFps=${metadata.fps.toFixed(2)} outputFps=${outputFps.toFixed(2)}`,
      );
    } catch (err) {
      if (isMountedRef.current) {
        setPublicError('Could not read video metadata. Please retry with another MP4 file.', getErrorDebugDetails(err));
      }
    }
  };

  const ensureFfmpegLoaded = async () => {
    if (!ffmpegRef.current) {
      ffmpegRef.current = new FFmpeg();
      ffmpegRef.current.on('log', ({ message }) => appendLog(message));
      ffmpegRef.current.on('progress', ({ progress }) => {
        if (!isMountedRef.current) return;
        setState((prev) => ({ ...prev, progress: Math.max(prev.progress, Math.round(progress * 100)) }));
      });
    }

    if (!isFfmpegLoadedRef.current) {
      if (isMountedRef.current) setState((prev) => ({ ...prev, status: 'loading' }));
      const assetUrls = getFfmpegAssetUrls();

      try {
        appendDebugLog('ffmpeg-load', `starting local core load from ${assetUrls.local.coreURL} and ${assetUrls.local.wasmURL}`);
        await ffmpegRef.current.load(assetUrls.local);
        appendDebugLog('ffmpeg-load', 'completed (local assets)');
      } catch (localLoadError) {
        getErrorDebugDetails(localLoadError).forEach((detail) => appendDebugLog('ffmpeg-local-load-error', detail));
        appendDebugLog('ffmpeg-load', `local load failed, switching to CDN assets core=${assetUrls.cdn.coreURL} wasm=${assetUrls.cdn.wasmURL}`);

        const blobifiedCdnAssetUrls = await getBlobifiedCdnAssetUrls(assetUrls.cdn);
        await ffmpegRef.current.load(blobifiedCdnAssetUrls);
        appendDebugLog('ffmpeg-load', 'completed (CDN fallback)');
      }

      isFfmpegLoadedRef.current = true;
    }
  };

  useEffect(() => {
    if (!state.file) {
      setInputPreviewUrl('');
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

  const onClearSavedJob = () => {
    clearSavedJob();
    setSavedJob(null);
    appendLog('Saved resume data was cleared.');
  };

  const onProcess = async () => {
    if (!state.file || !isMountedRef.current) return;
    setError('');
    setLogs([]);

    try {
      await ensureFfmpegLoaded();
      if (isMountedRef.current) {
        setState((prev) => ({ ...prev, status: 'processing', progress: 0 }));
      }

      const ffmpeg = ffmpegRef.current;
      await ffmpeg.writeFile('input.mp4', await fetchFile(state.file));

      const finalDuration = removeEnding ? Math.max(0, state.duration - 2.5) : state.duration;
      const segmentCount = Math.max(1, Math.ceil(finalDuration / PROCESS_CHUNK_SECONDS));
      const fpsArgs = state.fps > 60 ? ['-r', '60'] : [];
      const rect = getScaledDelogo(state.width, state.height);
      const defaultFilter = `delogo=x=${rect.x}:y=${rect.y}:w=${rect.w}:h=${rect.h}`;
      const delogoFilter = dynamicDetection ? await detectDynamicDelogoFilter(state.file, state) : defaultFilter;

      const existingJob = loadSavedJob();
      const canResumeFromCheckpoint =
        existingJob &&
        existingJob.fileName === state.file.name &&
        existingJob.fileSize === state.file.size &&
        existingJob.segmentCount === segmentCount;
      let startSegment = canResumeFromCheckpoint ? existingJob.completedSegments || 0 : 0;

      if (startSegment > 0) {
        appendLog(`Resuming from segment ${startSegment + 1}/${segmentCount}.`);
        appendLog('If this tab was closed, previous temporary FFmpeg chunks are unavailable and processing may restart from zero.');
        startSegment = 0;
      }

      if (removeEnding && finalDuration < MIN_DURATION) {
        appendLog('Ending trim skipped because resulting duration is too short.');
      }

      appendDebugLog('pipeline', `preset=${preset} dynamicDetection=${dynamicDetection} removeEnding=${removeEnding} segments=${segmentCount}`);

      for (let index = startSegment; index < segmentCount; index += 1) {
        const startTime = index * PROCESS_CHUNK_SECONDS;
        const segmentDuration = Math.min(PROCESS_CHUNK_SECONDS, Math.max(0, finalDuration - startTime));
        const segmentName = `segment-${String(index).padStart(4, '0')}.mp4`;

        const args = [
          '-ss',
          `${startTime}`,
          '-i',
          'input.mp4',
          '-vf',
          delogoFilter,
          ...PRESETS[preset],
          ...fpsArgs,
          '-c:v',
          'libx264',
          '-c:a',
          'copy',
          '-t',
          `${Math.max(segmentDuration, MIN_DURATION)}`,
          segmentName,
        ];

        appendLog(`Running segment ${index + 1}/${segmentCount}: ffmpeg ${args.join(' ')}`);
        await ffmpeg.exec(args);

        const completedSegments = index + 1;
        const progress = Math.round((completedSegments / (segmentCount + 1)) * 100);
        setState((prev) => ({ ...prev, progress }));

        const persistedJob = {
          fileName: state.file.name,
          fileSize: state.file.size,
          updatedAt: Date.now(),
          preset,
          removeEnding,
          dynamicDetection,
          segmentCount,
          completedSegments,
          status: 'processing',
        };
        saveJob(persistedJob);
        setSavedJob(persistedJob);
      }

      const concatFile = getConcatFileList(segmentCount);
      await ffmpeg.writeFile('concat-list.txt', concatFile);
      await ffmpeg.exec(['-f', 'concat', '-safe', '0', '-i', 'concat-list.txt', '-c', 'copy', 'output.mp4']);

      const data = await ffmpeg.readFile('output.mp4');
      const outputBlob = new Blob([data.buffer], { type: 'video/mp4' });
      const outputUrl = URL.createObjectURL(outputBlob);

      if (!isMountedRef.current) {
        URL.revokeObjectURL(outputUrl);
        return;
      }

      appendDebugLog('output-file', `bytes=${outputBlob.size}`);
      setState((prev) => ({
        ...prev,
        outputUrl,
        status: 'done',
        progress: 100,
      }));

      const doneJob = {
        fileName: state.file.name,
        fileSize: state.file.size,
        updatedAt: Date.now(),
        preset,
        removeEnding,
        dynamicDetection,
        segmentCount,
        completedSegments: segmentCount,
        status: 'done',
      };
      saveJob(doneJob);
      setSavedJob(doneJob);
    } catch (err) {
      if (isMountedRef.current) {
        setState((prev) => ({ ...prev, status: 'error' }));
        setPublicError(
          'We could not process this video. Please check the FFmpeg logs and debug details below.',
          getErrorDebugDetails(err),
        );
      }
    }
  };

  return (
    <main className="app-shell">
      <header className="hero">
        <p className="eyebrow">NotebookLM Utility</p>
        <h1>Video Watermark Remover</h1>
        <p className="subtext">Fast, client-side MP4 processing with resume metadata saved to local storage.</p>
      </header>

      {savedJob && (
        <section className="resume-banner">
          <p>
            Saved session found for <strong>{savedJob.fileName}</strong>. Last update:{' '}
            {new Date(savedJob.updatedAt).toLocaleString()}.
          </p>
          <div className="banner-actions">
            <button type="button" onClick={onClearSavedJob} className="secondary-btn">
              Clear saved session
            </button>
          </div>
        </section>
      )}

      <section className="card">
        <UploadBox fileLabel={fileLabel} onFileSelect={onFileSelect} />
        <Controls
          preset={preset}
          setPreset={setPreset}
          removeEnding={removeEnding}
          setRemoveEnding={setRemoveEnding}
          dynamicDetection={dynamicDetection}
          setDynamicDetection={setDynamicDetection}
        />

        <div className="cta-row">
          <button type="button" onClick={onProcess} disabled={!hasInput || state.status === 'processing'}>
            {state.status === 'processing' ? 'Processing…' : 'Process Video'}
          </button>
          <small>Output FPS: {state.fps.toFixed(2)} (capped at 60, never upscaled)</small>
        </div>

        <ProgressBar progress={state.progress} status={state.status} />
        {error && <p className="error">{error}</p>}
      </section>

      <VideoPreview inputPreviewUrl={inputPreviewUrl} outputUrl={state.outputUrl} />

      <section className="logs card">
        <h2>FFmpeg Logs</h2>
        <pre>{logs.join('\n')}</pre>
      </section>
    </main>
  );
}
