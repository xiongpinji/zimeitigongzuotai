import styles from './LoadingOverlay.module.css';

export interface LoadingOverlayProps {
  label?: string;
  visible?: boolean;
}

export function LoadingOverlay({
  label,
  visible = true,
}: LoadingOverlayProps) {
  if (!visible) {
    return null;
  }

  return (
    <div
      className={styles.overlay}
      data-visible={visible}
      role="status"
      aria-live="polite"
      aria-label={label ?? '加载中'}
    >
      <div className={styles.card}>
        <span className={styles.spinner} aria-hidden="true" />
        {label ? <span className={styles.label}>{label}</span> : null}
      </div>
    </div>
  );
}
