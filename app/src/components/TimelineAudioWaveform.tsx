import { useEffect, useMemo, useState } from 'react';
import { toFileSrc } from '../lib/utils';
import styles from './TimelineAudioWaveform.module.css';

interface TimelineAudioWaveformProps {
  audioPath: string;
  durationMs: number;
  trackWidth: number;
  trackHeight: number;
  deferLoading?: boolean;
  loadDelayMs?: number;
}

const waveformPeakCache = new Map<string, Promise<number[]>>();

function combineChannelPeaks(peaks: Array<Float32Array | number[]>): number[] {
  const maxLength = peaks.reduce((length, channel) => Math.max(length, channel.length), 0);

  return Array.from({ length: maxLength }, (_, index) =>
    peaks.reduce((peak, channel) => Math.max(peak, Math.abs(channel[index] ?? 0)), 0),
  );
}

async function loadWaveformPeaks(audioPath: string, durationMs: number): Promise<number[]> {
  const cacheKey = `${audioPath}:${durationMs}`;
  const cached = waveformPeakCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const pending = (async () => {
    const { default: WaveSurfer } = await import('wavesurfer.js');
    const host = document.createElement('div');

    host.style.position = 'fixed';
    host.style.left = '-99999px';
    host.style.top = '0';
    host.style.width = '1px';
    host.style.height = '1px';
    host.style.opacity = '0';
    document.body.appendChild(host);

    const wavesurfer = WaveSurfer.create({
      container: host,
      width: 1,
      height: 1,
      waveColor: '#0ea5e9',
      progressColor: '#0ea5e9',
      cursorWidth: 0,
      interact: false,
      hideScrollbar: true,
      backend: 'WebAudio',
      sampleRate: 8_000,
    });

    try {
      await wavesurfer.load(toFileSrc(audioPath));
      const resolution = Math.max(240, Math.min(4_000, Math.round(durationMs / 20)));
      return combineChannelPeaks(wavesurfer.exportPeaks({ maxLength: resolution }));
    } finally {
      wavesurfer.destroy();
      host.remove();
    }
  })().catch((error) => {
    waveformPeakCache.delete(cacheKey);
    throw error;
  });

  waveformPeakCache.set(cacheKey, pending);
  return pending;
}

function sampleWaveformPeaks(peaks: number[], targetLength: number): number[] {
  if (peaks.length === 0 || targetLength <= 0) {
    return [];
  }

  if (peaks.length <= targetLength) {
    return peaks;
  }

  const bucketSize = peaks.length / targetLength;

  return Array.from({ length: targetLength }, (_, bucketIndex) => {
    const start = Math.floor(bucketIndex * bucketSize);
    const end = Math.min(peaks.length, Math.ceil((bucketIndex + 1) * bucketSize));
    let peak = 0;

    for (let index = start; index < end; index += 1) {
      peak = Math.max(peak, peaks[index] ?? 0);
    }

    return peak;
  });
}

function scheduleWaveformLoad(callback: () => void, delayMs: number): () => void {
  let idleId: number | null = null;
  const idleWindow = window as Window & {
    requestIdleCallback?: (cb: () => void, options?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };

  const timeoutId = window.setTimeout(() => {
    if (idleWindow.requestIdleCallback) {
      idleId = idleWindow.requestIdleCallback(callback, { timeout: 2_000 });
      return;
    }
    callback();
  }, Math.max(0, delayMs));

  return () => {
    window.clearTimeout(timeoutId);
    if (idleId !== null) {
      idleWindow.cancelIdleCallback?.(idleId);
    }
  };
}

/**
 * 按"源音频局部区间"采样绘制波形。
 * - sourceDurationMs：源音频总时长
 * - startOffsetMs：clip 对应源文件起点
 * - visibleDurationMs：clip 实际要展示的源长度
 * 用于叠加音频 clip 的波形缩略。
 */
export function TimelineAudioClipWaveform({
  audioPath,
  sourceDurationMs,
  startOffsetMs,
  visibleDurationMs,
  width,
  height,
  inline = true,
  deferLoading = false,
  loadDelayMs = 600,
}: {
  audioPath: string;
  sourceDurationMs: number;
  startOffsetMs: number;
  visibleDurationMs: number;
  width: number;
  height: number;
  inline?: boolean;
  deferLoading?: boolean;
  loadDelayMs?: number;
}) {
  const [peaks, setPeaks] = useState<number[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!audioPath || typeof window === 'undefined' || typeof document === 'undefined') {
      setPeaks(null);
      return;
    }

    if (deferLoading) {
      // 播放中：保留已渲染的波形，仅不发起新的解码，避免柱状图消失。
      return;
    }

    const cancelScheduledLoad = scheduleWaveformLoad(() => {
      void loadWaveformPeaks(audioPath, sourceDurationMs)
        .then((nextPeaks) => {
          if (!cancelled) {
            setPeaks(nextPeaks);
          }
        })
        .catch((error) => {
          console.error('加载音频波形失败:', error);
          if (!cancelled) {
            setPeaks([]);
          }
        });
    }, loadDelayMs);

    return () => {
      cancelled = true;
      cancelScheduledLoad();
    };
  }, [audioPath, sourceDurationMs, deferLoading, loadDelayMs]);

  const barCount = Math.min(600, Math.max(16, Math.floor(width / 2.5)));
  const clipPeaks = useMemo(() => {
    if (!peaks || peaks.length === 0 || sourceDurationMs <= 0) return [] as number[];
    const startRatio = Math.max(0, Math.min(1, startOffsetMs / sourceDurationMs));
    const endRatio = Math.max(
      startRatio,
      Math.min(1, (startOffsetMs + visibleDurationMs) / sourceDurationMs),
    );
    const startIdx = Math.floor(startRatio * peaks.length);
    const endIdx = Math.max(startIdx + 1, Math.ceil(endRatio * peaks.length));
    const slice = peaks.slice(startIdx, Math.min(peaks.length, endIdx));
    return sampleWaveformPeaks(slice, barCount);
  }, [peaks, sourceDurationMs, startOffsetMs, visibleDurationMs, barCount]);

  const maxBarHeight = Math.max(4, height - 6);
  const wrapperStyle = inline
    ? ({
        position: 'relative',
        width,
        height,
        display: 'flex',
        alignItems: 'flex-end',
        gap: '1px',
        padding: '3px 0',
        overflow: 'hidden',
      } as const)
    : undefined;

  if (!audioPath) return null;

  if (!peaks || clipPeaks.length === 0) {
    return (
      <div style={wrapperStyle}>
        <div
          style={{
            width: '100%',
            height: 1,
            background: 'color-mix(in srgb, var(--color-selection-blue) 28%, transparent)',
          }}
        />
      </div>
    );
  }

  return (
    <div style={wrapperStyle}>
      {clipPeaks.map((peak, index) => (
        <span
          key={`clip-peak-${index}`}
          style={{
            flex: '1 0 0',
            minWidth: 1,
            height: `${Math.max(2, Math.round(peak * maxBarHeight))}px`,
            background: 'color-mix(in srgb, var(--color-track-audio, #f0abfc) 80%, white)',
            borderRadius: '999px 999px 2px 2px',
          }}
        />
      ))}
    </div>
  );
}

export function TimelineAudioWaveform({
  audioPath,
  durationMs,
  trackWidth,
  trackHeight,
  deferLoading = false,
  loadDelayMs = 600,
}: TimelineAudioWaveformProps) {
  const [peaks, setPeaks] = useState<number[] | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!audioPath || typeof window === 'undefined' || typeof document === 'undefined') {
      setPeaks(null);
      return;
    }

    if (deferLoading) {
      // 播放中：保留已渲染的波形，仅不发起新的解码，避免柱状图消失。
      return;
    }

    const cancelScheduledLoad = scheduleWaveformLoad(() => {
      void loadWaveformPeaks(audioPath, durationMs)
        .then((nextPeaks) => {
          if (!cancelled) {
            setPeaks(nextPeaks);
          }
        })
        .catch((error) => {
          console.error('加载音频波形失败:', error);
          if (!cancelled) {
            setPeaks([]);
          }
        });
    }, loadDelayMs);

    return () => {
      cancelled = true;
      cancelScheduledLoad();
    };
  }, [audioPath, durationMs, deferLoading, loadDelayMs]);

  const barCount = Math.min(2_400, Math.max(48, Math.floor(trackWidth / 3)));
  const sampledPeaks = useMemo(
    () => sampleWaveformPeaks(peaks ?? [], barCount),
    [barCount, peaks],
  );
  const maxBarHeight = Math.max(8, trackHeight - 10);

  if (!audioPath) {
    return null;
  }

  if (!peaks || sampledPeaks.length === 0) {
    return (
      <div
        data-waveform-shell="true"
        className={[styles.shell, styles.loadingShell].join(' ')}
      >
        <div className={styles.loadingLine} />
      </div>
    );
  }

  return (
    <div
      data-waveform-shell="true"
      className={[styles.shell, styles.peaksShell].join(' ')}
    >
      {sampledPeaks.map((peak, index) => (
        <span
          key={`wave-peak-${index}`}
          className={styles.peak}
          style={{ height: `${Math.max(2, Math.round(peak * maxBarHeight))}px` }}
        />
      ))}
    </div>
  );
}
