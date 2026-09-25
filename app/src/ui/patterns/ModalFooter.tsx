import type { ReactNode } from 'react';
import { Button } from '../components/button';
import styles from './ModalFooter.module.css';

export type ModalFooterConfirmVariant = 'primary' | 'danger';

export interface ModalFooterProps {
  onCancel?: () => void;
  onConfirm?: () => void;
  cancelLabel?: string;
  confirmLabel?: string;
  confirmDisabled?: boolean;
  confirmLoading?: boolean;
  confirmVariant?: ModalFooterConfirmVariant;
  extra?: ReactNode;
}

export function ModalFooter({
  cancelLabel = '取消',
  confirmDisabled = false,
  confirmLoading = false,
  confirmLabel = '确定',
  confirmVariant = 'primary',
  extra,
  onCancel,
  onConfirm,
}: ModalFooterProps) {
  const hasExtra = extra !== undefined && extra !== null;
  const showCancel = typeof onCancel === 'function';
  const showConfirm = typeof onConfirm === 'function';

  if (!hasExtra && !showCancel && !showConfirm) {
    return null;
  }

  return (
    <div className={styles.root}>
      {hasExtra ? <div className={styles.extra}>{extra}</div> : null}
      {showCancel ? (
        <Button variant="secondary" onClick={onCancel}>
          {cancelLabel}
        </Button>
      ) : null}
      {showConfirm ? (
        <Button
          variant={confirmVariant === 'danger' ? 'destructive' : 'primary'}
          disabled={confirmDisabled}
          loading={confirmLoading}
          onClick={onConfirm}
        >
          {confirmLabel}
        </Button>
      ) : null}
    </div>
  );
}
