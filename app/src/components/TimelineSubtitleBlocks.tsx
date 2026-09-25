import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';
import type { SrtEntry } from '../types';
import { clamp } from '../lib/utils';
import { useTimelineStore } from '../store/timeline';
import { hitTestSubtitlesByRect, summarizeSubtitleSelection } from '../lib/subtitle-marquee';
import {
  MANUAL_CARD_KIND_OPTIONS,
  type ManualCardKind,
} from '../lib/manual-card-types';
import { ContextMenu } from '../ui';
import { AppIcon } from './AppIcon';
import styles from './TimelineSubtitleBlocks.module.css';

interface TimelineSubtitleBlocksProps {
  entries: SrtEntry[];
  durationMs: number;
  pxPerMs: number;
  trackHeight: number;
  highlightHint?: string;
  onClickBlock?: () => void;
  onRequestGenerateCard?: (payload: {
    text: string;
    startMs: number;
    endMs: number;
    indices: number[];
    kind?: ManualCardKind;
  }) => void;
}

interface SubtitleBlockLayout {
  id: string;
  index: number;
  left: number;
  width: number;
  text: string;
}

interface MarqueeState {
  active: boolean;
  startX: number;
  currentX: number;
  dragged: boolean;
}

function buildSubtitleLayouts(
  entries: SrtEntry[],
  durationMs: number,
  pxPerMs: number,
): SubtitleBlockLayout[] {
  return entries
    .map((entry) => {
      const startMs = clamp(entry.startMs, 0, durationMs);
      const endMs = clamp(entry.endMs, startMs, durationMs);
      const width = Math.max(2, Math.round((endMs - startMs) * pxPerMs));
      const text = entry.text.replace(/\s+/g, ' ').trim();

      return {
        id: `subtitle-${entry.index}`,
        index: entry.index,
        left: Math.round(startMs * pxPerMs),
        width,
        text,
      };
    })
    .filter((entry) => entry.text.length > 0 && entry.width > 0);
}

const DRAG_THRESHOLD_PX = 4;

export function TimelineSubtitleBlocks({
  entries,
  durationMs,
  pxPerMs,
  trackHeight,
  highlightHint,
  onClickBlock,
  onRequestGenerateCard,
}: TimelineSubtitleBlocksProps) {
  const layouts = useMemo(
    () => buildSubtitleLayouts(entries, durationMs, pxPerMs),
    [durationMs, entries, pxPerMs],
  );

  const subtitleSelection = useTimelineStore((state) => state.subtitleSelection);
  const setSubtitleSelection = useTimelineStore((state) => state.setSubtitleSelection);
  const clearSubtitleSelection = useTimelineStore((state) => state.clearSubtitleSelection);

  const rootRef = useRef<HTMLDivElement | null>(null);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const marqueeRef = useRef<MarqueeState | null>(null);
  marqueeRef.current = marquee;

  const selectionSet = useMemo(() => new Set(subtitleSelection), [subtitleSelection]);

  const handleMouseDown = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      // 只处理左键
      if (event.button !== 0) return;
      // 右键托管给 ContextMenu.Trigger
      const root = rootRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const x = event.clientX - rect.left;

      const next: MarqueeState = {
        active: true,
        startX: x,
        currentX: x,
        dragged: false,
      };
      setMarquee(next);
      marqueeRef.current = next;
      event.preventDefault();
    },
    [],
  );

  useEffect(() => {
    if (!marquee?.active) return;

    const handleMouseMove = (event: MouseEvent) => {
      const state = marqueeRef.current;
      if (!state?.active) return;
      const root = rootRef.current;
      if (!root) return;
      const rect = root.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const dragged = state.dragged || Math.abs(x - state.startX) >= DRAG_THRESHOLD_PX;
      const next: MarqueeState = { ...state, currentX: x, dragged };
      marqueeRef.current = next;
      setMarquee(next);

      if (dragged) {
        const left = Math.min(state.startX, x);
        const width = Math.abs(x - state.startX);
        const hits = hitTestSubtitlesByRect({
          entries,
          pxPerMs,
          rect: { left, width },
        });
        setSubtitleSelection(hits);
      }
    };

    const handleMouseUp = () => {
      const state = marqueeRef.current;
      if (!state) return;
      if (!state.dragged) {
        // 视为空白点击：清空选择，触发 onClickBlock（保留原字幕检查行为）
        clearSubtitleSelection();
        onClickBlock?.();
      }
      marqueeRef.current = null;
      setMarquee(null);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [
    marquee?.active,
    entries,
    pxPerMs,
    setSubtitleSelection,
    clearSubtitleSelection,
    onClickBlock,
  ]);

  // Esc 清空选择
  useEffect(() => {
    if (subtitleSelection.length === 0) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        clearSubtitleSelection();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [subtitleSelection.length, clearSubtitleSelection]);

  const handleBlockClick = useCallback(
    (event: ReactMouseEvent<HTMLSpanElement>) => {
      // 拖动中不触发 click
      if (marqueeRef.current?.dragged) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
    },
    [],
  );

  const handleGenerateCard = useCallback((kind?: ManualCardKind) => {
    if (subtitleSelection.length === 0) return;
    const summary = summarizeSubtitleSelection(entries, subtitleSelection);
    if (!summary) return;
    onRequestGenerateCard?.({
      text: summary.text,
      startMs: summary.startMs,
      endMs: summary.endMs,
      indices: summary.indices,
      kind,
    });
  }, [entries, subtitleSelection, onRequestGenerateCard]);

  const marqueeOverlay = useMemo(() => {
    if (!marquee?.active || !marquee.dragged) return null;
    const left = Math.min(marquee.startX, marquee.currentX);
    const width = Math.abs(marquee.currentX - marquee.startX);
    return (
      <div
        className={styles.marqueeRect}
        style={{
          left,
          width,
          top: 0,
          height: '100%',
        }}
      />
    );
  }, [marquee]);

  const hasSelection = subtitleSelection.length > 0;

  return (
    <ContextMenu>
      <ContextMenu.Trigger asChild>
        <div
          ref={rootRef}
          className={styles.root}
          onMouseDown={handleMouseDown}
        >
          {highlightHint ? <div className={styles.hint}>{highlightHint}</div> : null}
          {layouts.map((entry) => {
            const selected = selectionSet.has(entry.index);
            return (
              <span
                key={entry.id}
                data-subtitle-entry={entry.id}
                className={[styles.block, selected ? styles.blockSelected : '']
                  .filter(Boolean)
                  .join(' ')}
                role="button"
                tabIndex={0}
                onClick={handleBlockClick}
                style={{
                  left: entry.left,
                  top: Math.max(4, Math.round((trackHeight - 22) / 2)),
                  width: entry.width,
                  cursor: 'pointer',
                }}
              >
                <span
                  className={styles.text}
                  style={{ padding: entry.width >= 24 ? '0 8px' : '0 4px' }}
                >
                  {entry.text}
                </span>
              </span>
            );
          })}
          {marqueeOverlay}
        </div>
      </ContextMenu.Trigger>
      <ContextMenu.Content glass>
        <ContextMenu.Label>
          创建卡片{hasSelection ? `（${subtitleSelection.length} 条字幕）` : ''}
        </ContextMenu.Label>
        {MANUAL_CARD_KIND_OPTIONS.map((item) => (
          <ContextMenu.Item
            key={item.kind}
            disabled={!hasSelection}
            onSelect={() => {
              if (hasSelection) handleGenerateCard(item.kind);
            }}
          >
            <div className={styles.contextMenuItem}>
              <AppIcon name={item.icon} size={14} className={styles.contextMenuIcon} />
              <span className={styles.contextMenuLabel}>创建{item.label}</span>
            </div>
          </ContextMenu.Item>
        ))}
        <ContextMenu.Separator />
        <ContextMenu.Item
          disabled={!hasSelection}
          onSelect={() => {
            if (hasSelection) handleGenerateCard();
          }}
        >
          <div className={styles.contextMenuItem}>
            <AppIcon name="sparkles" size={14} className={styles.contextMenuIcon} />
            <span className={styles.contextMenuLabel}>
              自定义生成...
            </span>
          </div>
        </ContextMenu.Item>
        <ContextMenu.Separator />
        <ContextMenu.Item
          disabled={!hasSelection}
          onSelect={() => {
            if (hasSelection) clearSubtitleSelection();
          }}
        >
          <div className={styles.contextMenuItem}>
            <AppIcon name="x" size={14} className={styles.contextMenuIcon} />
            <span className={styles.contextMenuLabel}>清空选择</span>
          </div>
        </ContextMenu.Item>
      </ContextMenu.Content>
    </ContextMenu>
  );
}
