import type { ReactNode } from 'react';
import { Button, ColorField, Input, NumberField } from '../../ui';
import { AppIcon } from '../AppIcon';
import styles from './Inspector.module.css';
import type { CoverTextOverlay } from '../../lib/cover-editor/contracts';

interface InspectorProps {
  selectedText: CoverTextOverlay | null;
  onUpdateText: (patch: Partial<CoverTextOverlay>) => void;
  onRemoveText: () => void;
  fontFamilyPicker: ReactNode;
}

export function Inspector({
  selectedText,
  onUpdateText,
  onRemoveText,
  fontFamilyPicker,
}: InspectorProps) {
  if (!selectedText) {
    return (
      <aside className={styles.panel}>
        <div className={styles.empty}>在画布上选择文字以编辑属性</div>
      </aside>
    );
  }

  return (
    <aside className={styles.panel}>
      <div className={styles.header}>文字属性</div>

      <div className={styles.row}>
        <span className={styles.label}>内容</span>
        <Input
          size="sm"
          value={selectedText.text}
          onChange={(e) => onUpdateText({ text: e.target.value })}
        />
      </div>

      <div className={styles.row}>
        <span className={styles.label}>字体</span>
        {fontFamilyPicker}
      </div>

      <div className={styles.row}>
        <span className={styles.label}>字号</span>
        <NumberField
          value={selectedText.fontSize}
          onChange={(v) => onUpdateText({ fontSize: v || 48 })}
          min={8}
          max={200}
          unit="px"
        />
      </div>

      <div className={styles.row}>
        <span className={styles.label}>颜色</span>
        <ColorField
          value={selectedText.color}
          onChange={(v) => onUpdateText({ color: v })}
        />
      </div>

      <div className={styles.row}>
        <span className={styles.label}>描边色</span>
        <ColorField
          value={selectedText.strokeColor ?? '#000000'}
          onChange={(v) => onUpdateText({ strokeColor: v })}
        />
      </div>

      <div className={styles.row}>
        <span className={styles.label}>描边宽</span>
        <NumberField
          value={selectedText.strokeWidth ?? 0}
          onChange={(v) => onUpdateText({ strokeWidth: v })}
          min={0}
          max={20}
          unit="px"
        />
      </div>

      <div className={styles.row}>
        <span className={styles.label}>对齐</span>
        <div className={styles.alignGroup}>
          {(['left', 'center', 'right'] as const).map((a) => (
            <Button.Icon
              key={a}
              variant={selectedText.align === a ? 'primary' : 'ghost'}
              onClick={() => onUpdateText({ align: a })}
              aria-label={`对齐${a}`}
            >
              <AppIcon name={`align-${a}`} size={14} />
            </Button.Icon>
          ))}
        </div>
      </div>

      <Button
        variant="destructive"
        size="sm"
        onClick={onRemoveText}
        className={styles.danger}
        leftIcon={<AppIcon name="trash-2" size={12} />}
      >
        删除图层
      </Button>
    </aside>
  );
}
