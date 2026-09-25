import type { Annotation } from '../../store/script';
import { Button } from '../../ui';
import styles from './AnnotationCard.module.css';

const SEVERITY_CONFIG = {
  error:   { icon: '🔴', label: '错误', color: '#e74c3c' },
  warning: { icon: '🟡', label: '警告', color: '#e67e22' },
  info:    { icon: '🔵', label: '建议', color: '#3498db' },
} as const;

interface AnnotationCardProps {
  annotation: Annotation;
  onAccept: (id: string) => void;
  onDismiss: (id: string) => void;
  onAIRewrite: (id: string) => void;
  style?: React.CSSProperties;
}

export function AnnotationCard({
  annotation,
  onAccept,
  onDismiss,
  onAIRewrite,
  style,
}: AnnotationCardProps) {
  const config = SEVERITY_CONFIG[annotation.severity];

  return (
    <div className={styles.card} style={style}>
      <div className={styles.header} style={{ color: config.color }}>
        <span>{config.icon}</span>
        <span className={styles.title}>{annotation.issue}</span>
      </div>

      {annotation.suggestion && (
        <div className={styles.suggestion}>
          <span className={styles.suggestionIcon}>💡</span>
          <span>{annotation.suggestion}</span>
        </div>
      )}

      <div className={styles.actions}>
        <Button
          variant="success"
          size="xs"
          onClick={() => onAccept(annotation.id)}
        >
          ✓ 接受建议
        </Button>
        <Button
          variant="ghost"
          size="xs"
          onClick={() => onDismiss(annotation.id)}
        >
          忽略
        </Button>
        <Button
          variant="primary"
          size="xs"
          onClick={() => onAIRewrite(annotation.id)}
        >
          AI 重写
        </Button>
      </div>
    </div>
  );
}
