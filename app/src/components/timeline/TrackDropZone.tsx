import { forwardRef } from 'react';
import styles from '../Timeline.module.css';

export interface TrackDropZoneProps {
  /** 屏幕顺序的 gap 索引:0 = 最顶第一条轨道之前,N = 最底最后一条轨道之后 */
  gapIndex: number;
  /** 拖拽活跃期间 → 展开显示 */
  active: boolean;
  /** 当前 hover 命中此 gap → 高亮 */
  highlighted: boolean;
}

/**
 * 拖拽 overlay 时在每两条 visual 轨道的交界处显示的"释放新建轨道"提示。
 * 始终 0 高度不撑开布局;hover 命中时显示一条灰色虚线。
 */
export const TrackDropZone = forwardRef<HTMLDivElement, TrackDropZoneProps>(
  function TrackDropZone({ gapIndex, active, highlighted }, ref) {
    return (
      <div
        ref={ref}
        className={styles.trackDropZone}
        data-active={active ? 'true' : 'false'}
        data-highlighted={highlighted ? 'true' : 'false'}
        data-gap-index={gapIndex}
        aria-hidden
      >
        <div className={styles.trackDropZoneLine} />
      </div>
    );
  },
);
