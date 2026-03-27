export const MB = 1024 * 1024;
export const MAX_FILE_SIZE = 100 * MB;
export const BASE_WIDTH = 1280;
export const BASE_HEIGHT = 720;
export const BASE_DELOGO = { x: 1104, y: 656, w: 133, h: 22 };

export const PRESETS = {
  speed: ['-r', '15', '-crf', '28', '-preset', 'ultrafast'],
  balanced: ['-r', '30', '-crf', '23', '-preset', 'veryfast'],
  quality: ['-crf', '18', '-preset', 'superfast'],
};

export const initialState = {
  file: null,
  duration: 0,
  width: BASE_WIDTH,
  height: BASE_HEIGHT,
  progress: 0,
  status: 'idle',
  outputUrl: '',
};

export function clampRect(rect, width, height) {
  return {
    x: Math.max(0, Math.min(width - 2, Math.round(rect.x))),
    y: Math.max(0, Math.min(height - 2, Math.round(rect.y))),
    w: Math.max(2, Math.min(width, Math.round(rect.w))),
    h: Math.max(2, Math.min(height, Math.round(rect.h))),
  };
}

export function getScaledDelogo(width, height) {
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

export async function getVideoMetadata(file) {
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


const SEEK_EPSILON = 0.001;
const SEEK_TIMEOUT_MS = 1500;
const SEEK_MAX_OFFSET_SECONDS = 0.05;
const WATERMARK_LUMA_REFERENCE = 170;
const WATERMARK_VARIANCE_THRESHOLD = 60;
const MIN_SEGMENT_DURATION_SECONDS = 0.1;
const SEGMENT_PADDING_SECONDS = 0.2;

function waitForSeek(video, targetTime) {
  if (Math.abs(video.currentTime - targetTime) < SEEK_EPSILON) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    const handleSeeked = () => {
      cleanup();
      resolve();
    };

    const timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, SEEK_TIMEOUT_MS);

    const cleanup = () => {
      window.clearTimeout(timer);
      video.removeEventListener('seeked', handleSeeked);
    };

    video.addEventListener('seeked', handleSeeked);
  });
}

export async function detectDynamicDelogoFilter(file, metadata) {
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
    const safeTime = Math.min(Math.max(t, 0), Math.max(metadata.duration - SEEK_MAX_OFFSET_SECONDS, 0));
    video.currentTime = safeTime;
    await waitForSeek(video, safeTime);

    ctx.drawImage(video, 0, 0, metadata.width, metadata.height);
    const data = ctx.getImageData(rect.x, rect.y, rect.w, rect.h).data;
    let variance = 0;
    for (let j = 0; j < data.length; j += 4) {
      const lum = 0.299 * data[j] + 0.587 * data[j + 1] + 0.114 * data[j + 2];
      variance += Math.abs(lum - WATERMARK_LUMA_REFERENCE);
    }
    variance /= Math.max(1, data.length / 4);
    markers.push({ t, likelyVisible: variance < WATERMARK_VARIANCE_THRESHOLD });
  }

  URL.revokeObjectURL(probeUrl);

  const segments = [];
  let start = null;
  for (let i = 0; i < markers.length; i += 1) {
    if (markers[i].likelyVisible && start === null) start = markers[i].t;
    const closing = !markers[i].likelyVisible || i === markers.length - 1;

    if (start !== null && closing) {
      const end = markers[i].likelyVisible ? markers[i].t : markers[Math.max(i - 1, 0)].t;
      if (end - start >= MIN_SEGMENT_DURATION_SECONDS) {
        segments.push([start, end + SEGMENT_PADDING_SECONDS]);
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
