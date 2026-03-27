import { useEffect, useMemo, useRef, useState } from 'react';
import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

const MB = 1024 * 1024;
const MAX_FILE_SIZE = 100 * MB;
const BASE_WIDTH = 1280;
const BASE_HEIGHT = 720;
const BASE_DELOGO = { x: 1104, y: 656, w: 133, h: 22 };

const PRESETS = {
  speed: ['-r', '15', '-crf', '28', '-preset', 'ultrafast'],
  balanced: ['-r', '30', '-crf', '23', '-preset', 'veryfast'],
  quality: ['-crf', '18', '-preset', 'superfast'],
};

const initialState = {
  file: null,
  duration: 0,
  width: BASE_WIDTH,
  height: BASE_HEIGHT,
  progress: 0,
  status: 'idle',
  outputUrl: '',
};

function clampRect(rect, width, height) {
  return {
    x: Math.max(0, Math.min(width - 2, Math.round(rect.x))),
    y: Math.max(0, Math.min(height - 2, Math.round(rect.y))),
    w: Math.max(2, Math.min(width, Math.round(rect.w))),
    h: Math.max(2, Math.min(height, Math.round(rect.h))),
  };
}

function getScaledDelogo(width, height) {
  const scaleX = width / BASE_WIDTH;
  const scaleY = height / BASE_HEIGHT;
  return clampRect(
    {
      x: BASE_DELOGO.x * scaleX,
      y: BASE_DELOGO.y * scaleY,
      w: BASE_DELOGO.w * scaleX,
      h: BASE_DELOGO.h * scaleY,
    },
    width,
    height,
  );
}

async function getVideoMetadata(file) {
  const url = URL.createObjectURL(file);
  try {
    const metadata = await new Promise((resolve, reject) => {
      const video = document.createElement('video');
      video.preload = 'metadata';
      video.src = url;
      video.onloadedmetadata = () => {
        resolve({
          duration: Number(video.duration) || 0,
          width: video.videoWidth || BASE_WIDTH,
          height: video.videoHeight || BASE_HEIGHT,
        });
      };
      video.onerror = () => reject(new Error('Could not read video metadata.'));
    });
    return metadata;
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function detectDynamicDelogoFilter(file, metadata) {
  const probeUrl = URL.createObjectURL(file);
  const video = document.createElement('video');
  video.src = probeUrl;
  video.muted = true;
  video.playsInline = true;
  await new Promise((resolve, reject) => {
    video.onloadedmetadata = () => resolve();
    video.onerror = () => reject(new Error('Dynamic watermark detection failed.'));
  });

  const canvas = document.createElement('canvas');
  canvas.width = metadata.width;
  canvas.height = metadata.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    URL.revokeObjectURL(probeUrl);
    throw new Error('Canvas unavailable for dynamic detection.');
  }

  const rect = getScaledDelogo(metadata.width, metadata.height);
  const sampleCount = Math.min(12, Math.max(4, Math.floor(metadata.duration / 3)));
  const markers = [];

  for (let i = 0; i < sampleCount; i += 1) {
    const t = (metadata.duration * i) / Math.max(1, sampleCount - 1);
    video.currentTime = Math.min(Math.max(t, 0), Math.max(metadata.duration - 0.05, 0));
    await new Promise((resolve) => {
      video.onseeked = () => resolve();
    });

    ctx.drawImage(video, 0, 0, metadata.width, metadata.height);
    const data = ctx.getImageData(rect.x, rect.y, rect.w, rect.h).data;
    let variance = 0;
    for (let j = 0; j < data.length; j += 4) {
      const lum = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
      variance += Math.abs(lum - 170);
    }
    variance /= Math.max(1, data.length / 4);
    markers.push({ t, likelyVisible: variance < 60 });
  }

  URL.revokeObjectURL(probeUrl);

  const segments = [];
  let start = null;
  for (let i = 0; i < markers.length; i += 1) {
    if (markers[i].likelyVisible && start === null) {
      start = markers[i].t;
    }
    const closing = !markers[i].likelyVisible || i === markers.length - 1;
    if (start !== null && closing) {
      const end = markers[i].likelyVisible ? markers[i].t : markers[Math.max(i - 1, 0)].t;
      if (end - start >= 0.1) {
        segments.push([start, end + 0.2]);
      }
      start = null;
    }
  }

  if (!segments.length) {
    return `delogo=x=${rect.x}:y=${rect.y}:w=${rect.w}:h=${rect.h}`;
  }

  return segments
    .map(
      ([startTime, endTime]) =>
        `delogo=x=${rect.x}:y=${rect.y}:w=${rect.w}:h=${rect.h}:enable='between(t,${startTime.toFixed(
          2,
        )},${Math.min(endTime, metadata.duration).toFixed(2)})'`,
    )
    .join(',');
}

export default function App() {
  const ffmpegRef = useRef(null);
  const [state, setState] = useState(initialState);
  const [preset, setPreset] = useState('balanced');
  const [removeEnding, setRemoveEnding] = useState(true);
  const [dynamicDetection, setDynamicDetection] = useState(false);
  const [logs, setLogs] = useState([]);
  const [error, setError] = useState('');
  const [inputPreviewUrl, setInputPreviewUrl] = useState('');

  const hasInput = Boolean(state.file);

  const dropzoneText = useMemo(() => {
    if (!state.file) return 'Drop an MP4 file here, or click to browse.';
    return `${state.file.name} (${(state.file.size / MB).toFixed(2)} MB)`;
  }, [state.file]);

  const appendLog = (line) => {
    setLogs((prev) => [...prev.slice(-80), line]);
  };

  const onFileSelect = async (file) => {
    setError('');
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.mp4') || file.type === 'video/quicktime') {
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
      }));
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

    if (!ffmpegRef.current.loaded) {
      setState((prev) => ({ ...prev, status: 'loading' }));
      await ffmpegRef.current.load({
        coreURL: '/ffmpeg/ffmpeg-core.js',
        wasmURL: '/ffmpeg/ffmpeg-core.wasm',
      });
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


  useEffect(() => {
    return () => {
      if (state.outputUrl) URL.revokeObjectURL(state.outputUrl);
    };
  }, [state.outputUrl]);

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
        '-t',
        `${finalDuration}`,
        'output.mp4',
      ];

      appendLog(`Running: ffmpeg ${args.join(' ')}`);
      await ffmpeg.exec(args);
      const data = await ffmpeg.readFile('output.mp4');
      const outputBlob = new Blob([data.buffer], { type: 'video/mp4' });
      const outputUrl = URL.createObjectURL(outputBlob);

      setState((prev) => {
        if (prev.outputUrl) URL.revokeObjectURL(prev.outputUrl);
        return {
          ...prev,
          outputUrl,
          status: 'done',
          progress: 100,
        };
      });
    } catch (err) {
      setError(err.message || 'Processing failed.');
      setState((prev) => ({ ...prev, status: 'error' }));
    }
  };

  return (
    <main className="container">
      <h1>NotebookLM Video Watermark Remover</h1>
      <p className="subtext">Client-side MP4 watermark removal via FFmpeg WASM + delogo.</p>

      <label
        className="upload-box"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          onFileSelect(e.dataTransfer.files?.[0]);
        }}
      >
        <input
          type="file"
          accept=".mp4,video/mp4"
          onChange={(e) => onFileSelect(e.target.files?.[0])}
          hidden
        />
        <span>{dropzoneText}</span>
      </label>

      <section className="controls">
        <label>
          Preset
          <select value={preset} onChange={(e) => setPreset(e.target.value)}>
            <option value="speed">speed</option>
            <option value="balanced">balanced</option>
            <option value="quality">quality</option>
          </select>
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={removeEnding}
            onChange={(e) => setRemoveEnding(e.target.checked)}
          />
          Remove ending watermark (last 2.5s)
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={dynamicDetection}
            onChange={(e) => setDynamicDetection(e.target.checked)}
          />
          Dynamic detection (optional)
        </label>
      </section>

      <button type="button" onClick={onProcess} disabled={!hasInput || state.status === 'processing'}>
        {state.status === 'processing' ? 'Processing…' : 'Process Video'}
      </button>

      <section className="progress-wrap" aria-live="polite">
        <div className="progress-track">
          <div className="progress-bar" style={{ width: `${state.progress}%` }} />
        </div>
        <small>Status: {state.status}</small>
      </section>

      {error && <p className="error">{error}</p>}

      <section className="preview-grid">
        <article>
          <h2>Before</h2>
          {inputPreviewUrl ? <video controls src={inputPreviewUrl} /> : <p>No input selected.</p>}
        </article>
        <article>
          <h2>After</h2>
          {state.outputUrl ? (
            <>
              <video controls src={state.outputUrl} />
              <a href={state.outputUrl} download="output.mp4" className="download-link">
                Download output.mp4
              </a>
            </>
          ) : (
            <p>Process a file to preview output.</p>
          )}
        </article>
      </section>

      <section className="logs">
        <h2>FFmpeg Logs</h2>
        <pre>{logs.join('\n')}</pre>
      </section>
    </main>
  );
}
