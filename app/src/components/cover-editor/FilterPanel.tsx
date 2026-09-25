import { Button, Slider } from '../../ui';
import styles from './FilterPanel.module.css';
import type { FilterPreset } from '../../lib/cover-editor/contracts';

interface FilterPanelProps {
  preset: FilterPreset;
  adjustments: {
    brightness: number;
    contrast: number;
    saturation: number;
    temperature: number;
  };
  onPresetChange: (preset: FilterPreset) => void;
  onAdjustmentChange: (
    key: 'brightness' | 'contrast' | 'saturation' | 'temperature',
    value: number,
  ) => void;
}

const PRESETS: Array<{ id: FilterPreset; label: string }> = [
  { id: 'none', label: '原图' },
  { id: 'bw', label: '黑白' },
  { id: 'vivid', label: '鲜艳' },
  { id: 'vintage', label: '复古' },
  { id: 'cool', label: '冷色' },
  { id: 'warm', label: '暖色' },
];

const SLIDERS: Array<{
  key: 'brightness' | 'contrast' | 'saturation' | 'temperature';
  label: string;
}> = [
  { key: 'brightness', label: '亮度' },
  { key: 'contrast', label: '对比度' },
  { key: 'saturation', label: '饱和度' },
  { key: 'temperature', label: '色温' },
];

export function FilterPanel({
  preset,
  adjustments,
  onPresetChange,
  onAdjustmentChange,
}: FilterPanelProps) {
  return (
    <div className={styles.root}>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>滤镜预设</div>
        <div className={styles.presetGrid}>
          {PRESETS.map((p) => (
            <Button
              key={p.id}
              type="button"
              size="sm"
              variant={preset === p.id ? 'primary' : 'secondary'}
              onClick={() => onPresetChange(p.id)}
            >
              {p.label}
            </Button>
          ))}
        </div>
      </div>

      <div className={styles.section}>
        <div className={styles.sectionTitle}>手动调整</div>
        {SLIDERS.map((s) => (
          <div key={s.key} className={styles.slider}>
            <span className={styles.sliderLabel}>{s.label}</span>
            <Slider
              size="sm"
              min={-100}
              max={100}
              step={1}
              value={adjustments[s.key]}
              onChange={(v) => onAdjustmentChange(s.key, v)}
            />
            <span className={styles.value}>{adjustments[s.key]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
