import type { CSSProperties } from 'react';
import type { SnapTarget } from '../../lib/timeline-snap';
import styles from '../Timeline.module.css';

export interface SnapGuidesProps {
  targets: SnapTarget[];
  pxPerMs: number;
  sidebarWidth: number;
  /** Snap 虚线的垂直高度（覆盖整个轨道区） */
  height: number;
  /** 相对定位坐标系中的 top 偏移（默认 0） */
  top?: number;
}

/**
 * 在 Timeline 内容层渲染蓝色虚线 snap guides。
 * 位置基于 sidebarWidth + ms * pxPerMs 换算。
 */
export function SnapGuides({
  targets,
  pxPerMs,
  sidebarWidth,
  height,
  top = 0,
}: SnapGuidesProps) {
  if (targets.length === 0) return null;
  return (
    <>
      {targets.map((t, idx) => {
        const style: CSSProperties = {
          left: sidebarWidth + t.ms * pxPerMs,
          top,
          height,
        };
        return (
          <div
            key={`snap-${t.ms}-${t.kind}-${idx}`}
            className={styles.snapGuide}
            style={style}
            data-snap-kind={t.kind}
          />
        );
      })}
    </>
  );
}
