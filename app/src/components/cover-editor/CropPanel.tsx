import { useState } from 'react';
import { Button } from '../../ui';
import { AppIcon } from '../AppIcon';
import styles from './CropPanel.module.css';

export type CropAspectChoice =
  | 'free'
  | 'timeline'
  | '16:9'
  | '9:16'
  | '1:1'
  | '4:3'
  | '4:5';

interface CropPanelProps {
  timelineSize: { width: number; height: number };
  onAspectChange: (ratio: number | null) => void;
  onApply: () => void;
  onCancel: () => void;
}

const PRESETS: Array<{ id: CropAspectChoice; label: string }> = [
  { id: 'free', label: '自由' },
  { id: 'timeline', label: '跟随时间线' },
  { id: '16:9', label: '16:9' },
  { id: '9:16', label: '9:16' },
  { id: '1:1', label: '1:1' },
  { id: '4:3', label: '4:3' },
  { id: '4:5', label: '4:5' },
];

export function CropPanel({
  timelineSize,
  onAspectChange,
  onApply,
  onCancel,
}: CropPanelProps) {
  const [active, setActive] = useState<CropAspectChoice>('free');

  function resolve(choice: CropAspectChoice): number | null {
    if (choice === 'free') return null;
    if (choice === 'timeline') {
      if (!timelineSize.width || !timelineSize.height) return 16 / 9;
      return timelineSize.width / timelineSize.height;
    }
    const [w, h] = choice.split(':').map(Number);
    return w / h;
  }

  return (
    <aside className={styles.panel}>
      <div className={styles.header}>裁剪</div>
      <div className={styles.hint}>
        先在画布上点击图片选中，再切换到裁剪工具，将对选中的图层直接裁剪；未选择时默认裁剪背景图。拖拽蓝色裁剪框调整区域，可选择下方比例锁定。
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>比例</div>
        <div className={styles.presetGrid}>
          {PRESETS.map((p) => (
            <Button
              key={p.id}
              type="button"
              size="sm"
              variant={active === p.id ? 'primary' : 'secondary'}
              onClick={() => {
                setActive(p.id);
                onAspectChange(resolve(p.id));
              }}
            >
              {p.id === 'timeline'
                ? `${p.label} (${timelineSize.width}×${timelineSize.height})`
                : p.label}
            </Button>
          ))}
        </div>
      </div>

      <div className={styles.footer}>
        <Button
          variant="secondary"
          size="sm"
          onClick={onCancel}
          leftIcon={<AppIcon name="x" size={12} />}
        >
          取消裁剪
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={onApply}
          leftIcon={<AppIcon name="circle-check-big" size={12} />}
        >
          应用裁剪
        </Button>
      </div>
    </aside>
  );
}
