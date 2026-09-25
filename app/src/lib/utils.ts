export function msToFrame(ms: number, fps: number): number {
  return Math.floor((ms / 1000) * fps);
}

export function frameToMs(frame: number, fps: number): number {
  return Math.round((frame / fps) * 1000);
}

export function formatTime(ms: number): string {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

/**
 * 按刻度粒度格式化时码，用于时间轴尺随缩放展示不同精度。
 * stepMs >= 1000 → mm:ss
 * stepMs >= 100  → mm:ss.f
 * stepMs >= 10   → mm:ss.ff
 * 其他           → mm:ss.fff
 */
export function formatTimecode(ms: number, stepMs: number): string {
  const safeMs = Math.max(0, ms);
  const totalSeconds = Math.floor(safeMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const base = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  if (stepMs >= 1000) {
    return base;
  }
  const remainder = Math.round(safeMs - totalSeconds * 1000);
  if (stepMs >= 100) {
    return `${base}.${Math.floor(remainder / 100)}`;
  }
  if (stepMs >= 10) {
    return `${base}.${String(Math.floor(remainder / 10)).padStart(2, '0')}`;
  }
  return `${base}.${String(remainder).padStart(3, '0')}`;
}

export function getFileNameFromPath(filePath: string): string {
  const normalizedPath = filePath.replace(/\\/g, '/');
  return normalizedPath.split('/').pop() || filePath;
}

function encodePosixPath(filePath: string): string {
  const leadingSlash = filePath.startsWith('/') ? '/' : '';
  const pathWithoutLeadingSlash = leadingSlash ? filePath.slice(1) : filePath;
  return `${leadingSlash}${pathWithoutLeadingSlash.split('/').map(encodeURIComponent).join('/')}`;
}

export function toFileSrc(filePath: string): string {
  if (!filePath) {
    return '';
  }

  if (
    filePath.startsWith('file://') ||
    filePath.startsWith('http://') ||
    filePath.startsWith('https://')
  ) {
    return filePath;
  }

  if (/^[a-zA-Z]:[\\/]/.test(filePath)) {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const drive = normalizedPath.slice(0, 2);
    const rest = normalizedPath.slice(2);
    return `file:///${drive}${encodePosixPath(rest)}`;
  }

  if (filePath.startsWith('\\\\')) {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const withoutPrefix = normalizedPath.slice(2);
    return `file://${withoutPrefix.split('/').map(encodeURIComponent).join('/')}`;
  }

  // macOS/Linux 文件名允许反斜杠本身，不能把 "\n" 这类内容误当成路径分隔符。
  return `file://${encodePosixPath(filePath)}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * 在渲染进程中通过 HTMLAudioElement 读取音频文件的真实时长（毫秒）。
 * 用作 Electron 主进程 getVideoMetadata 失败时的兜底来源。
 */
export function readAudioDurationMs(filePath: string): Promise<number> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined') {
      resolve(0);
      return;
    }

    const audio = new window.Audio();
    audio.preload = 'metadata';
    let settled = false;

    const cleanup = () => {
      audio.src = '';
      audio.onloadedmetadata = null;
      audio.onerror = null;
    };

    const timeoutId = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('读取音频时长超时'));
    }, 8_000);

    audio.onloadedmetadata = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      const seconds = Number.isFinite(audio.duration) ? audio.duration : 0;
      cleanup();
      resolve(Math.max(0, Math.round(seconds * 1000)));
    };

    audio.onerror = () => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      cleanup();
      reject(new Error(`音频解码失败: ${filePath}`));
    };

    audio.src = toFileSrc(filePath);
  });
}

const MIN_TIMELINE_DURATION_MS = 1_000;

interface TimelineDurationLike {
  podcast?: { durationMs?: number };
  overlays?: Array<{
    startMs: number;
    durationMs: number;
    overlayRole?: string;
  }>;
}

/**
 * 计算时间轴的有效总时长。
 *
 * 优先级：max(口播音频时长, 任意 overlay 的结束时间, 1s 兜底)。
 *
 * 没有口播素材时，仍要保证 Player / 时间轴尺子能容纳已经添加的动画卡片、
 * 媒体 overlay 等内容，否则会出现「5 秒动画只播放 1 秒就到结尾」的问题。
 */
export function getEffectiveTimelineDurationMs(timeline: TimelineDurationLike | null | undefined): number {
  if (!timeline) {
    return MIN_TIMELINE_DURATION_MS;
  }

  const podcastDuration = Number.isFinite(timeline.podcast?.durationMs)
    ? Math.max(0, Math.round(timeline.podcast?.durationMs ?? 0))
    : 0;

  let overlayMaxEnd = 0;
  if (Array.isArray(timeline.overlays)) {
    for (const overlay of timeline.overlays) {
      if (!overlay) {
        continue;
      }
      // 默认背景的 durationMs 本身就是从时间轴长度推导出来的，
      // 不能再反过来用它做时间轴长度计算，否则会变成自我引用。
      if (overlay.overlayRole === 'default-background') {
        continue;
      }
      const start = Number.isFinite(overlay.startMs) ? Math.max(0, overlay.startMs) : 0;
      const duration = Number.isFinite(overlay.durationMs) ? Math.max(0, overlay.durationMs) : 0;
      const end = start + duration;
      if (end > overlayMaxEnd) {
        overlayMaxEnd = end;
      }
    }
  }

  return Math.max(MIN_TIMELINE_DURATION_MS, podcastDuration, overlayMaxEnd);
}
