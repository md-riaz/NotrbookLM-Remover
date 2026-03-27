import { useEffect, useMemo, useRef, useState } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';
import Controls from './components/Controls';
import ProgressBar from './components/ProgressBar';
import UploadBox from './components/UploadBox';
import VideoPreview from './components/VideoPreview';
import {
  MB,
  MAX_FILE_SIZE,
  PRESETS,
  detectDynamicDelogoFilter,
  getScaledDelogo,
  getVideoMetadata,
  initialState,
} from './lib/watermark';

export default function App() {
  const ffmpegRef = useRef(null);
  const isFfmpegLoadedRef = useRef(false);
  const [state, setState] = useState(initialState);
  const [preset, setPreset] = useState('balanced');
  const [removeEnding, setRemoveEnding] = useState(true);
  const [dynamicDetection, setDynamicDetection] = useState(false);
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState('');
  const [inputPreviewUrl, setInputPreviewUrl] = useState('');

  const hasInput = Boolean(state.file);

  const fileLabel = useMemo(() => {
    if (!state.file) return 'Drop an MP4 file here, or click to browse.';
    return `${state.file.name} (${(state.file.size / MB).toFixed(2)} MB)`;
  }, [state.file]);

  const appendLog = (line) => setLogs((prev) => [...prev.slice(-80), line]);

  const onFileSelect = async (file) => {
    setError('');
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.mp4')) {
      setError('Only MP4 files are supported.');
      return;
    }

    if (file.size > MAX_FILE_SIZE) {
      setError('Max file size is 100 MB.');
      return;
    }

    try {
      const metadata = await getVideoMetadata(file);
      setState((prev) => ({
        ...prev,
        file,
        duration: metadata.duration,
        width: metadata.width,
        height: metadata.height,
        progress: 0,
        status: 'idle',
        outputUrl: '',
      }));
      setLogs([]);
    } catch (err) {
      setError(err.message);
    }
  };

  const ensureFfmpegLoaded = async () => {
    if (!ffmpegRef.current) {
      ffmpegRef.current = new FFmpeg();
      ffmpegRef.current.on('log', ({ message }) => appendLog(message));
      ffmpegRef.current.on('progress', ({ progress }) => {
        setState((prev) => ({ ...prev, progress: Math.round(progress * 100) }));
      });
    }

    if (!isFfmpegLoadedRef.current) {
      setState((prev) => ({ ...prev, status: 'loading' }));
      await ffmpegRef.current.load({
        coreURL: '/ffmpeg/ffmpeg-core.js',
        wasmURL: '/ffmpeg/ffmpeg-core.wasm',
      });
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

  const MIN_DURATION = 0.5;

  const onProcess = async () => {
    if (!state.file) return;
    setError('');
    setLogs([]);

    try {
      await ensureFfmpegLoaded();
      setState((prev) => ({ ...prev, status: 'processing', progress: 0 }));

      const ffmpeg = ffmpegRef.current;
      await ffmpeg.writeFile('input.mp4', await fetchFile(state.file));

      const finalDuration = removeEnding ? Math.max(0, state.duration - 2.5) : state.duration;
      const durationArgs = finalDuration >= MIN_DURATION ? ['-t', `${finalDuration}`] : [];
      const rect = getScaledDelogo(state.width, state.height);
      const defaultFilter = `delogo=x=${rect.x}:y=${rect.y}:w=${rect.w}:h=${rect.h}`;
      const delogoFilter = dynamicDetection
        ? await detectDynamicDelogoFilter(state.file, state)
        : defaultFilter;

      const args = [
        '-i',
        'input.mp4',
        '-vf',
        delogoFilter,
        ...PRESETS[preset],
        '-c:v',
        'libx264',
        '-tune',
        'stillimage',
        '-c:a',
        'copy',
        ...durationArgs,
        'output.mp4',
      ];

      if (removeEnding && finalDuration < MIN_DURATION) {
        appendLog('Ending trim skipped because resulting duration is too short.');
      }
      appendLog(`Running: ffmpeg ${args.join(' ')}`);
      await ffmpeg.exec(args);
      const data = await ffmpeg.readFile('output.mp4');
      const outputBlob = new Blob([data.buffer], { type: 'video/mp4' });
      const outputUrl = URL.createObjectURL(outputBlob);

      setState((prev) => ({
        ...prev,
        outputUrl,
        status: 'done',
        progress: 100,
      }));
    } catch (err) {
      setError(err.message || 'Processing failed.');
      setState((prev) => ({ ...prev, status: 'error' }));
    }
  };

  return (
    <main className="container">
      <h1>NotebookLM Video Watermark Remover</h1>
      <p className="subtext">Client-side MP4 watermark removal via FFmpeg WASM + delogo.</p>

      <UploadBox fileLabel={fileLabel} onFileSelect={onFileSelect} />
      <Controls
        preset={preset}
        setPreset={setPreset}
        removeEnding={removeEnding}
        setRemoveEnding={setRemoveEnding}
        dynamicDetection={dynamicDetection}
        setDynamicDetection={setDynamicDetection}
      />

      <button type="button" onClick={onProcess} disabled={!hasInput || state.status === 'processing'}>
        {state.status === 'processing' ? 'Processing…' : 'Process Video'}
      </button>

      <ProgressBar progress={state.progress} status={state.status} />

      {error && <p className="error">{error}</p>}

      <VideoPreview inputPreviewUrl={inputPreviewUrl} outputUrl={state.outputUrl} />

      <section className="logs">
        <h2>FFmpeg Logs</h2>
        <pre>{logs.join('\n')}</pre>
      </section>
    </main>
  );
}
