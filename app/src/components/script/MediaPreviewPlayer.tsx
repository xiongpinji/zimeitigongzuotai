import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Gauge,
  Maximize,
  Music2,
  Pause,
  Play,
  Volume1,
  Volume2,
  VolumeX,
} from 'lucide-react';
import styles from './MediaPreviewPlayer.module.css';

export interface MediaPreviewPlayerHandle {
  seekToMs(ms: number): void;
  playFromMs(ms: number): void;
  getElement(): HTMLMediaElement | null;
}

interface MediaPreviewPlayerProps {
  src: string;
  isAudio?: boolean;
  poster?: string;
  onTimeUpdate?: (currentMs: number) => void;
  onError?: () => void;
  onSeekToMs?: (ms: number) => void;
}

const PLAYBACK_RATES = [0.5, 0.75, 1, 1.25, 1.5, 2] as const;

function formatClock(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '--:--';
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (hours > 0) return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  return `${pad(minutes)}:${pad(seconds)}`;
}

export const MediaPreviewPlayer = forwardRef<MediaPreviewPlayerHandle, MediaPreviewPlayerProps>(
  ({ src, isAudio = false, poster, onTimeUpdate, onError }, ref) => {
    const mediaRef = useRef<HTMLMediaElement | null>(null);
    const trackRef = useRef<HTMLDivElement | null>(null);
    const containerRef = useRef<HTMLDivElement | null>(null);

    const [isPlaying, setIsPlaying] = useState(false);
    const [currentMs, setCurrentMs] = useState(0);
    const [durationMs, setDurationMs] = useState(0);
    const [bufferedMs, setBufferedMs] = useState(0);
    const [volume, setVolume] = useState(1);
    const [muted, setMuted] = useState(false);
    const [playbackRate, setPlaybackRate] = useState(1);
    const [dragging, setDragging] = useState(false);
    const [speedMenuOpen, setSpeedMenuOpen] = useState(false);

    useImperativeHandle(
      ref,
      () => ({
        getElement: () => mediaRef.current,
        seekToMs: (ms: number) => {
          const media = mediaRef.current;
          if (!media) return;
          media.currentTime = Math.max(0, ms / 1000);
        },
        playFromMs: (ms: number) => {
          const media = mediaRef.current;
          if (!media) return;
          media.currentTime = Math.max(0, ms / 1000);
          if (media.paused) {
            void media.play().catch(() => {});
          }
        },
      }),
      [],
    );

    const handleLoadedMetadata = useCallback(() => {
      const media = mediaRef.current;
      if (!media) return;
      // Some ffmpeg-extracted streams report Infinity until seeked. Try once.
      if (!Number.isFinite(media.duration)) {
        try {
          media.currentTime = 1e6;
        } catch {
          /* noop */
        }
        return;
      }
      setDurationMs(media.duration * 1000);
    }, []);

    const handleDurationChange = useCallback(() => {
      const media = mediaRef.current;
      if (!media) return;
      if (Number.isFinite(media.duration)) {
        setDurationMs(media.duration * 1000);
        if (media.currentTime > media.duration) {
          media.currentTime = 0;
        }
      }
    }, []);

    const handleTimeUpdate = useCallback(() => {
      const media = mediaRef.current;
      if (!media) return;
      const ms = media.currentTime * 1000;
      if (!dragging) setCurrentMs(ms);
      onTimeUpdate?.(ms);
    }, [dragging, onTimeUpdate]);

    const handleProgress = useCallback(() => {
      const media = mediaRef.current;
      if (!media) return;
      try {
        if (media.buffered.length > 0) {
          const end = media.buffered.end(media.buffered.length - 1);
          setBufferedMs(end * 1000);
        }
      } catch {
        /* noop */
      }
    }, []);

    const handlePlay = useCallback(() => setIsPlaying(true), []);
    const handlePause = useCallback(() => setIsPlaying(false), []);
    const handleEnded = useCallback(() => setIsPlaying(false), []);
    const handleVolumeChange = useCallback(() => {
      const media = mediaRef.current;
      if (!media) return;
      setVolume(media.volume);
      setMuted(media.muted);
    }, []);

    const togglePlay = useCallback(() => {
      const media = mediaRef.current;
      if (!media) return;
      if (media.paused || media.ended) {
        void media.play().catch(() => {});
      } else {
        media.pause();
      }
    }, []);

    const seekFromClientX = useCallback((clientX: number) => {
      const track = trackRef.current;
      const media = mediaRef.current;
      if (!track || !media) return;
      const rect = track.getBoundingClientRect();
      const ratio = Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
      const duration = Number.isFinite(media.duration) ? media.duration : durationMs / 1000;
      if (!duration) return;
      const next = ratio * duration;
      media.currentTime = next;
      setCurrentMs(next * 1000);
    }, [durationMs]);

    const handleProgressPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      (event.target as Element).setPointerCapture?.(event.pointerId);
      setDragging(true);
      seekFromClientX(event.clientX);
    }, [seekFromClientX]);

    const handleProgressPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      seekFromClientX(event.clientX);
    }, [dragging, seekFromClientX]);

    const handleProgressPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
      if (!dragging) return;
      setDragging(false);
      try {
        (event.target as Element).releasePointerCapture?.(event.pointerId);
      } catch {
        /* noop */
      }
    }, [dragging]);

    const cycleMute = useCallback(() => {
      const media = mediaRef.current;
      if (!media) return;
      media.muted = !media.muted;
    }, []);

    const handleVolumeSliderChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
      const media = mediaRef.current;
      const next = Number(event.target.value) / 100;
      if (!media) return;
      media.volume = next;
      if (next === 0) {
        media.muted = true;
      } else if (media.muted) {
        media.muted = false;
      }
    }, []);

    const setRate = useCallback((rate: number) => {
      const media = mediaRef.current;
      if (!media) return;
      media.playbackRate = rate;
      setPlaybackRate(rate);
      setSpeedMenuOpen(false);
    }, []);

    const toggleFullscreen = useCallback(() => {
      const wrapper = containerRef.current;
      if (!wrapper) return;
      if (document.fullscreenElement) {
        void document.exitFullscreen().catch(() => {});
      } else {
        void wrapper.requestFullscreen?.().catch(() => {});
      }
    }, []);

    useEffect(() => {
      const onKey = (event: KeyboardEvent) => {
        const media = mediaRef.current;
        if (!media) return;
        const target = event.target as HTMLElement | null;
        if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) {
          return;
        }
        if (!containerRef.current?.contains(document.activeElement) && document.activeElement !== document.body) {
          return;
        }
        if (event.code === 'Space') {
          event.preventDefault();
          togglePlay();
        } else if (event.code === 'ArrowLeft') {
          media.currentTime = Math.max(0, media.currentTime - 5);
        } else if (event.code === 'ArrowRight') {
          media.currentTime = Math.min(media.duration || media.currentTime + 5, media.currentTime + 5);
        }
      };
      window.addEventListener('keydown', onKey);
      return () => window.removeEventListener('keydown', onKey);
    }, [togglePlay]);

    useEffect(() => {
      if (!speedMenuOpen) return;
      const onClick = (event: MouseEvent) => {
        if (!containerRef.current?.contains(event.target as Node)) {
          setSpeedMenuOpen(false);
        }
      };
      window.addEventListener('mousedown', onClick);
      return () => window.removeEventListener('mousedown', onClick);
    }, [speedMenuOpen]);

    const playedRatio = durationMs > 0 ? Math.min(1, currentMs / durationMs) : 0;
    const bufferedRatio = durationMs > 0 ? Math.min(1, bufferedMs / durationMs) : 0;
    const volumePercent = Math.round((muted ? 0 : volume) * 100);
    const VolumeIcon = muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

    const mediaProps = useMemo(
      () => ({
        ref: (node: HTMLMediaElement | null) => {
          mediaRef.current = node;
        },
        src,
        preload: 'metadata' as const,
        onLoadedMetadata: handleLoadedMetadata,
        onDurationChange: handleDurationChange,
        onTimeUpdate: handleTimeUpdate,
        onProgress: handleProgress,
        onPlay: handlePlay,
        onPause: handlePause,
        onEnded: handleEnded,
        onVolumeChange: handleVolumeChange,
        onError,
      }),
      [
        handleDurationChange,
        handleEnded,
        handleLoadedMetadata,
        handlePause,
        handlePlay,
        handleProgress,
        handleTimeUpdate,
        handleVolumeChange,
        onError,
        src,
      ],
    );

    // 视频模式下，仅当正在播放且没有交互（拖动 / 速率菜单）时才让控制条自动隐藏，hover 时立刻浮现。
    const autoHideOverlay = !isAudio && isPlaying && !dragging && !speedMenuOpen;
    const overlayClass = isAudio
      ? `${styles.controls} ${styles.controlsAudio}`
      : `${styles.controlsOverlay} ${autoHideOverlay ? styles.controlsAutoHide : ''}`;

    const controls = (
      <div className={overlayClass} onClick={(event) => event.stopPropagation()}>
        <div className={styles.progressRow}>
          <div
            ref={trackRef}
            className={`${styles.progressTrack} ${dragging ? styles.progressTrackDragging : ''}`}
            onPointerDown={handleProgressPointerDown}
            onPointerMove={handleProgressPointerMove}
            onPointerUp={handleProgressPointerUp}
            onPointerCancel={handleProgressPointerUp}
          >
            <div
              className={styles.progressBuffer}
              style={{ width: `${bufferedRatio * 100}%` }}
            />
            <div
              className={styles.progressPlayed}
              style={{ width: `${playedRatio * 100}%` }}
            />
            <div
              className={styles.progressThumb}
              style={{ left: `${playedRatio * 100}%` }}
            />
          </div>
        </div>

        <div className={styles.actionRow}>
          <button
            type="button"
            className={`${styles.iconButton} ${styles.iconButtonPrimary}`}
            onClick={togglePlay}
            aria-label={isPlaying ? '暂停' : '播放'}
          >
            {isPlaying ? <Pause size={16} /> : <Play size={16} />}
          </button>

          <span className={styles.timeLabel}>
            {formatClock(currentMs)} / {formatClock(durationMs)}
          </span>

          <div className={styles.spacer} />

          <div
            className={styles.volumeWrapper}
            onWheel={(event) => {
              const media = mediaRef.current;
              if (!media) return;
              event.preventDefault();
              const delta = event.deltaY > 0 ? -0.05 : 0.05;
              const next = Math.min(1, Math.max(0, media.volume + delta));
              media.volume = next;
              if (next > 0 && media.muted) media.muted = false;
            }}
          >
            <button
              type="button"
              className={styles.iconButton}
              onClick={cycleMute}
              aria-label={muted ? '取消静音' : '静音'}
            >
              <VolumeIcon size={16} />
            </button>
            <input
              type="range"
              min={0}
              max={100}
              step={1}
              value={volumePercent}
              onChange={handleVolumeSliderChange}
              className={styles.volumeSlider}
              style={{ ['--volume-percent' as string]: `${volumePercent}%` }}
              aria-label="音量"
            />
          </div>

          <div className={styles.speedAnchor}>
            <button
              type="button"
              className={styles.speedButton}
              onClick={() => setSpeedMenuOpen((prev) => !prev)}
              aria-label="播放速度"
              title="播放速度"
            >
              <Gauge size={12} style={{ marginRight: 4, verticalAlign: '-1px' }} />
              {playbackRate}x
            </button>
            {speedMenuOpen ? (
              <div className={styles.speedMenu} role="menu">
                {PLAYBACK_RATES.map((rate) => (
                  <button
                    key={rate}
                    type="button"
                    className={`${styles.speedItem} ${rate === playbackRate ? styles.speedItemActive : ''}`}
                    onClick={() => setRate(rate)}
                    role="menuitem"
                  >
                    <span>{rate}x</span>
                    {rate === 1 ? <span style={{ opacity: 0.6, fontSize: 11 }}>正常</span> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>

          {!isAudio ? (
            <button
              type="button"
              className={styles.iconButton}
              onClick={toggleFullscreen}
              aria-label="全屏"
              title="全屏"
            >
              <Maximize size={16} />
            </button>
          ) : null}
        </div>
      </div>
    );

    return (
      <div
        ref={containerRef}
        className={`${styles.shell} ${isAudio ? styles.shellAudio : ''}`}
        tabIndex={-1}
      >
        {isAudio ? (
          <>
            <div className={styles.audioVisual}>
              <Music2 size={28} />
              <span>{isPlaying ? '正在播放' : '音频预览'}</span>
            </div>
            <audio {...mediaProps} className={styles.audioElement} />
            {controls}
          </>
        ) : (
          <div className={styles.videoStage}>
            <video
              {...mediaProps}
              poster={poster}
              className={styles.media}
              onClick={togglePlay}
              playsInline
            />
            {controls}
          </div>
        )}
      </div>
    );
  },
);

MediaPreviewPlayer.displayName = 'MediaPreviewPlayer';
