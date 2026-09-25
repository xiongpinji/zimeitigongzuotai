import { useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { Clipboard, Copy } from 'lucide-react';
import { getOverlayMoveDraft, type TrackDragZone } from '../lib/overlay-drag';
import type { OverlayItem } from '../types';
import { clamp, getFileNameFromPath } from '../lib/utils';
import { useTimelineStore } from '../store/timeline';
import { ContextMenu } from '../ui';
import { AppIcon } from './AppIcon';
import { AssetThumbnail } from './AssetThumbnail';
import { TimelineAudioClipWaveform } from './TimelineAudioWaveform';
import styles from './OverlayBlock.module.css';

// Trim handle 命中区域宽度(像素)
const TRIM_HANDLE_WIDTH = 6;

interface OverlayBlockProps {
  overlay: OverlayItem;
  pxPerMs: number;
  trackHeight?: number;
  selected?: boolean;
  /** 当前轨道是否锁定;锁定则不响应任何鼠标交互 */
  trackLocked?: boolean;
  /** 碰撞反馈状态;invalid 时叠加红遮罩 */
  collisionState?: 'none' | 'invalid';
  /** 拖拽预览:覆盖 X 位置(ms),优先级高于 overlay.startMs。仅用于视觉跟随,不写入 store。 */
  dragPreviewStartMs?: number;
  /** 拖拽预览:Y 方向 px 偏移,用于跨轨道视觉移动。 */
  dragPreviewDeltaY?: number;
  /** 拖拽预览:是否处于拖拽状态(控制 opacity/z-index/transform/pointer-events)。 */
  isDragging?: boolean;
  /** 可选的 trim snap 计算函数(Task 13 会注入) */
  computeSnapForTrim?: (candidateMs: number, overlayId: string) => number;
  /** 播放中延迟加载波形，避免 WebAudio 解码抢占预览播放线程。 */
  deferWaveformLoading?: boolean;
  /**
   * Timeline 层的 drag 拦截入口。返回 true 表示外层已接管整个拖拽生命周期，
   * OverlayBlock 将跳过内部的 move-drag 逻辑（trim / select 仍保留）。
   */
  onBeginOverlayDrag?: (
    overlay: OverlayItem,
    event: ReactMouseEvent<HTMLDivElement>,
  ) => boolean;
  getTrackDragZones?: () => TrackDragZone[];
  onTrackHoverChange?: (trackId: string | null) => void;
  onSelect?: () => void;
  onContextMenu?: (event: ReactMouseEvent<HTMLDivElement>) => void;
}

export function OverlayBlock({
  overlay,
  pxPerMs,
  trackHeight = 48,
  selected = false,
  trackLocked = false,
  collisionState = 'none',
  dragPreviewStartMs,
  dragPreviewDeltaY,
  isDragging = false,
  computeSnapForTrim,
  deferWaveformLoading = false,
  onBeginOverlayDrag,
  getTrackDragZones,
  onTrackHoverChange,
  onSelect,
  onContextMenu,
}: OverlayBlockProps) {
  const blockRef = useRef<HTMLDivElement | null>(null);
  const [hoverEdge, setHoverEdge] = useState<'start' | 'end' | null>(null);
  const {
    assets,
    copyOverlay,
    cutOverlay,
    overlayClipboard,
    pasteOverlay,
    removeOverlay,
    timeline,
    updateOverlay,
  } = useTimelineStore();
  const asset = assets.find((item) => item.path === overlay.assetPath);
  const isAICard = overlay.overlayType === 'ai-card';
  const isDefaultBackground = overlay.overlayRole === 'default-background';
  const isTextOverlay = overlay.type === 'text';
  const isAudioOverlay = overlay.type === 'audio';
  const color = isDefaultBackground
    ? 'var(--color-brand-accent)'
    : isAICard
    ? overlay.aiCardData?.style.primaryColor ?? 'var(--color-brand-accent)'
    : isTextOverlay
    ? '#10b981'
    : isAudioOverlay
    ? 'var(--color-track-audio, #f0abfc)'
    : overlay.type === 'video'
      ? 'var(--color-selection-blue-hover)'
      : 'var(--color-brand-warm)';
  const colorGlow = isDefaultBackground
    ? 'color-mix(in srgb, var(--color-brand-accent) 22%, transparent)'
    : isAICard
    ? 'color-mix(in srgb, var(--color-brand-accent) 24%, transparent)'
    : isTextOverlay
    ? 'color-mix(in srgb, #10b981 22%, transparent)'
    : isAudioOverlay
    ? 'color-mix(in srgb, var(--color-track-audio, #f0abfc) 22%, transparent)'
    : overlay.type === 'video'
      ? 'color-mix(in srgb, var(--color-selection-blue-hover) 24%, transparent)'
      : 'color-mix(in srgb, var(--color-brand-warm) 22%, transparent)';
  // 拖拽期间用 dragPreviewStartMs 覆盖 X,避免改 store 污染 undo 历史。
  const effectiveStartMs = dragPreviewStartMs ?? overlay.startMs;
  const left = effectiveStartMs * pxPerMs;
  const width = Math.max(24, overlay.durationMs * pxPerMs);
  const thumbnailWidth = Math.max(0, Math.min(38, width - 26));
  const blockHeight = Math.max(24, trackHeight - 6);
  const showImageThumbnail =
    !isAICard && !isTextOverlay && overlay.type === 'image' && Boolean(asset) && thumbnailWidth >= 24;
  // 不再硬限制素材末端;拖拽路径已由 Timeline.tsx 接管且不做 project 末端 clamp
  const projectDuration = Number.POSITIVE_INFINITY;
  const maxDurationForAsset =
    overlay.type === 'video'
      ? asset?.durationMs ?? overlay.durationMs
      : isAudioOverlay
        ? Math.max(
            overlay.audioData?.sourceDurationMs ?? 0,
            asset?.durationMs ?? 0,
            overlay.durationMs,
          )
        : Number.POSITIVE_INFINITY;
  const label = isDefaultBackground
    ? `默认背景 · ${getFileNameFromPath(overlay.assetPath)}`
    : isAICard
      ? overlay.aiCardData?.title ?? 'AI 卡片'
      : isTextOverlay
        ? overlay.textData?.content?.slice(0, 20) ?? '文字'
        : getFileNameFromPath(overlay.assetPath);
  const badge = isDefaultBackground
    ? 'BG'
    : isAICard
      ? 'AI'
      : isTextOverlay
        ? 'TXT'
        : isAudioOverlay
          ? 'AUD'
          : overlay.type === 'video'
            ? 'VID'
            : 'IMG';
  const canManageOverlay = !isDefaultBackground;
  const canPaste = Boolean(overlayClipboard);

  const beginTrim = (edge: 'start' | 'end', startEvent: ReactMouseEvent<HTMLDivElement>) => {
    startEvent.preventDefault();
    startEvent.stopPropagation();
    const originalStart = overlay.startMs;
    const originalDuration = overlay.durationMs;
    const originalEnd = originalStart + originalDuration;
    const startMouseX = startEvent.clientX;

    const onMove = (ev: globalThis.MouseEvent) => {
      const deltaMs = (ev.clientX - startMouseX) / pxPerMs;
      let newEdgeMs = edge === 'start' ? originalStart + deltaMs : originalEnd + deltaMs;
      if (computeSnapForTrim) {
        newEdgeMs = computeSnapForTrim(newEdgeMs, overlay.id);
      }
      useTimelineStore.getState().trimOverlayClip(overlay.id, edge, newEdgeMs);
    };

    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleMoveMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    if (isDefaultBackground) {
      return;
    }

    // 锁定轨道完全不响应交互
    if (trackLocked) {
      return;
    }

    if ((event.target as HTMLElement).dataset.resize === 'true') {
      return;
    }

    // 命中 trim handle 边缘 → 走 trim 路径,否则 fallthrough 原 move-drag
    if (blockRef.current) {
      const rect = blockRef.current.getBoundingClientRect();
      const offsetX = event.clientX - rect.left;
      const fromStartEdge = offsetX <= TRIM_HANDLE_WIDTH;
      const fromEndEdge = offsetX >= rect.width - TRIM_HANDLE_WIDTH;
      if (fromStartEdge || fromEndEdge) {
        beginTrim(fromStartEdge ? 'start' : 'end', event);
        return;
      }
    }

    // Timeline 层拦截：若外层提供了 onBeginOverlayDrag 并返回 true，
    // 则外层已接管整个拖拽生命周期（drop zone / snap / collision / autoscroll）。
    if (onBeginOverlayDrag && onBeginOverlayDrag(overlay, event)) {
      return;
    }

    event.preventDefault();
    const startX = event.clientX;
    const startY = event.clientY;
    const startMs = overlay.startMs;
    let currentTrackId = overlay.trackId;
    let didMove = false;

    onTrackHoverChange?.(overlay.trackId);

    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      if (
        !didMove &&
        (Math.abs(moveEvent.clientX - startX) > 3 || Math.abs(moveEvent.clientY - startY) > 3)
      ) {
        didMove = true;
      }

      const nextMoveDraft = getOverlayMoveDraft({
        startMs,
        startClientX: startX,
        currentClientX: moveEvent.clientX,
        pxPerMs,
        projectDurationMs: projectDuration,
        overlayDurationMs: overlay.durationMs,
        fallbackTrackId: currentTrackId,
        clientY: moveEvent.clientY,
        trackZones: getTrackDragZones?.() ?? [],
      });

      currentTrackId = nextMoveDraft.trackId;
      onTrackHoverChange?.(nextMoveDraft.trackId);
      updateOverlay(overlay.id, nextMoveDraft);
    };

    const handleMouseUp = () => {
      onTrackHoverChange?.(null);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      if (!didMove) {
        onSelect?.();
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const handleResizeMouseDown = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return;
    }

    if (isDefaultBackground) {
      return;
    }

    event.stopPropagation();
    event.preventDefault();
    const startX = event.clientX;
    const startDuration = overlay.durationMs;

    const handleMouseMove = (moveEvent: globalThis.MouseEvent) => {
      const deltaMs = (moveEvent.clientX - startX) / pxPerMs;
      // 只受媒体原始时长限制(video/audio);不再用 project 末端硬限制
      const nextDuration = clamp(
        Math.round(startDuration + deltaMs),
        500,
        maxDurationForAsset,
      );
      updateOverlay(overlay.id, { durationMs: nextDuration });
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  const resolvedCursor = trackLocked
    ? 'default'
    : hoverEdge === 'start' || hoverEdge === 'end'
      ? 'col-resize'
      : 'grab';

  const blockClassName = [
    styles.root,
    isDefaultBackground ? styles.locked : '',
    selected ? styles.selected : '',
  ].filter(Boolean).join(' ');

  const blockStyle = {
    left,
    width,
    height: blockHeight,
    cursor: resolvedCursor,
    ...(isDragging
      ? {
          transform: dragPreviewDeltaY
            ? `translateY(${dragPreviewDeltaY}px)`
            : undefined,
          opacity: 0.85,
          zIndex: 50,
          transition: 'none',
        }
      : {}),
    ['--overlay-color' as string]: color,
    ['--overlay-glow' as string]: colorGlow,
  };

  const handleMouseMove = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (trackLocked || isDefaultBackground) {
      if (hoverEdge !== null) setHoverEdge(null);
      return;
    }
    const rect = blockRef.current?.getBoundingClientRect();
    if (!rect) return;
    const offsetX = event.clientX - rect.left;
    if (offsetX <= TRIM_HANDLE_WIDTH) {
      if (hoverEdge !== 'start') setHoverEdge('start');
    } else if (offsetX >= rect.width - TRIM_HANDLE_WIDTH) {
      if (hoverEdge !== 'end') setHoverEdge('end');
    } else if (hoverEdge !== null) {
      setHoverEdge(null);
    }
  };

  const handleMouseLeave = () => {
    if (hoverEdge !== null) setHoverEdge(null);
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
    onSelect?.();
    onContextMenu?.(event);
  };

  const audioWaveformWidth = Math.max(0, Math.round(width - 8));
  const audioWaveformHeight = Math.max(12, blockHeight - 10);

  const innerBlock = (
    <>
      <div className={styles.accentLine} />

      {isAudioOverlay && overlay.assetPath ? (
        <div
          style={{
            position: 'absolute',
            left: 4,
            right: 4,
            top: 5,
            bottom: 5,
            pointerEvents: 'none',
            opacity: 0.58,
            overflow: 'hidden',
          }}
        >
          <TimelineAudioClipWaveform
            audioPath={overlay.assetPath}
            sourceDurationMs={
              overlay.audioData?.sourceDurationMs ?? asset?.durationMs ?? overlay.durationMs
            }
            startOffsetMs={overlay.audioData?.trimStartMs ?? 0}
            visibleDurationMs={overlay.durationMs}
            width={audioWaveformWidth}
            height={audioWaveformHeight}
            deferLoading={deferWaveformLoading}
          />
        </div>
      ) : null}

      {showImageThumbnail && asset ? (
        <div
          className={styles.thumbnail}
          style={{ width: thumbnailWidth }}
        >
          <AssetThumbnail asset={asset} />
        </div>
      ) : null}

      <div
        className={[
          styles.content,
          showImageThumbnail ? styles.contentWithThumbnail : styles.contentStandalone,
        ].join(' ')}
      >
        <span className={styles.badge}>{badge}</span>
        {label}
      </div>

      {isDefaultBackground ? null : (
        <div
          data-resize="true"
          onMouseDown={handleResizeMouseDown}
          className={styles.resizeHandle}
        />
      )}

      {collisionState === 'invalid' ? <div className={styles.collisionOverlay} /> : null}
    </>
  );

  const block = (
    <div
      ref={blockRef}
      data-overlay-block="true"
      data-dragging={isDragging ? 'true' : undefined}
      onMouseDown={handleMoveMouseDown}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      onContextMenu={handleContextMenu}
      className={blockClassName}
      style={blockStyle}
    >
      {innerBlock}
    </div>
  );

  if (!canManageOverlay) {
    return block;
  }

  return (
    <ContextMenu>
      <ContextMenu.Trigger asChild>{block}</ContextMenu.Trigger>
      <ContextMenu.Content>
        <ContextMenu.Item
          onSelect={() => {
            copyOverlay(overlay.id);
          }}
        >
          <Copy size={11} className="mr-1 shrink-0" />
          <span>复制</span>
          <ContextMenu.Shortcut>⌘C</ContextMenu.Shortcut>
        </ContextMenu.Item>

        <ContextMenu.Item
          onSelect={() => {
            cutOverlay(overlay.id);
          }}
        >
          <AppIcon name="scissors" size={11} className="mr-1 shrink-0" />
          <span>剪切</span>
          <ContextMenu.Shortcut>⌘X</ContextMenu.Shortcut>
        </ContextMenu.Item>

        <ContextMenu.Item
          disabled={!canPaste}
          onSelect={() => {
            pasteOverlay({
              trackId: overlay.trackId,
              startMs: overlay.startMs + overlay.durationMs,
            });
          }}
        >
          <Clipboard size={11} className="mr-1 shrink-0" />
          <span>粘贴</span>
          <ContextMenu.Shortcut>⌘V</ContextMenu.Shortcut>
        </ContextMenu.Item>

        <ContextMenu.Separator />

        <ContextMenu.Item
          destructive
          onSelect={() => {
            removeOverlay(overlay.id);
          }}
        >
          <AppIcon name="trash-2" size={11} className="mr-1 shrink-0" />
          <span>删除</span>
          <ContextMenu.Shortcut>⌫</ContextMenu.Shortcut>
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu>
  );
}
