import type { MouseEvent } from 'react';
import { Undo2, Redo2, Plus, Scissors, Magnet, LocateFixed } from 'lucide-react';
import { useTimelineStore, type TimelineStore } from '../../store/timeline';
import { ZoomControls } from './ZoomControls';
import styles from './TimelineToolbar.module.css';

export interface TimelineToolbarProps {
  zoomLevel: number;
  onZoomChange: (zoom: number) => void;
  timelineDurationMs: number;
  viewportWidth: number;
  onFocusPlayhead: () => void;
  snapEnabled: boolean;
  onToggleSnap: () => void;
  onAddTrack: () => void;
  onSplit: () => void;
}

export function TimelineToolbar({
  zoomLevel,
  onZoomChange,
  onFocusPlayhead,
  timelineDurationMs,
  viewportWidth,
  snapEnabled,
  onToggleSnap,
  onAddTrack,
  onSplit,
}: TimelineToolbarProps) {
  const canUndo = useTimelineStore((s: TimelineStore) => s.canUndo);
  const canRedo = useTimelineStore((s: TimelineStore) => s.canRedo);
  const undo = useTimelineStore((s: TimelineStore) => s.undo);
  const redo = useTimelineStore((s: TimelineStore) => s.redo);

  const handle = (fn: () => void) => (e: MouseEvent) => {
    e.preventDefault();
    fn();
  };

  return (
    <div className={styles.toolbar}>
      <div className={styles.group}>
        <button
          type="button"
          className={styles.btn}
          title="撤销 ⌘Z"
          aria-label="撤销"
          disabled={!canUndo}
          onClick={handle(undo)}
        >
          <Undo2 size={14} />
        </button>
        <button
          type="button"
          className={styles.btn}
          title="重做 ⌘⇧Z"
          aria-label="重做"
          disabled={!canRedo}
          onClick={handle(redo)}
        >
          <Redo2 size={14} />
        </button>
        <button
          type="button"
          className={styles.btn}
          title="添加轨道"
          aria-label="添加轨道"
          onClick={handle(onAddTrack)}
        >
          <Plus size={14} />
        </button>
        <button
          type="button"
          className={styles.btn}
          title="分割 S"
          aria-label="分割"
          onClick={handle(onSplit)}
        >
          <Scissors size={14} />
        </button>
      </div>
      <div className={styles.spacer} />
      <div className={styles.group}>
        <button
          type="button"
          className={`${styles.btn}${snapEnabled ? ` ${styles.btnActive}` : ''}`}
          title="磁性对齐"
          aria-label="磁性对齐"
          aria-pressed={snapEnabled}
          onClick={handle(onToggleSnap)}
        >
          <Magnet size={14} />
        </button>
        <button
          type="button"
          className={styles.btn}
          title="定位到播放头"
          aria-label="定位到播放头"
          onClick={handle(onFocusPlayhead)}
        >
          <LocateFixed size={14} />
        </button>
        <ZoomControls
          zoomLevel={zoomLevel}
          onZoomChange={onZoomChange}
          timelineDurationMs={timelineDurationMs}
          viewportWidth={viewportWidth}
        />
      </div>
    </div>
  );
}
