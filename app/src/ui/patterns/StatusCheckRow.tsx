import type { ReactNode } from 'react';
import styles from './StatusCheckRow.module.css';

export type StatusCheckRowStatus = 'ok' | 'warn' | 'error' | 'pending';

export interface StatusCheckRowProps {
  status: StatusCheckRowStatus;
  label: string;
  message?: string;
  actions?: ReactNode;
  className?: string;
}

/**
 * 状态检查行：Settings 页面诊断/检查项的标准行样式。
 * 左侧状态徽章 + 中间 label/message + 右侧操作槽位。
 */
export function StatusCheckRow({
  actions,
  className,
  label,
  message,
  status,
}: StatusCheckRowProps) {
  return (
    <div className={joinClassNames(styles.root, className)}>
      <span
        className={joinClassNames(styles.badge, statusClassName(status))}
        aria-hidden="true"
      >
        <span className={styles.badgeDot} />
      </span>
      <div className={styles.copy}>
        <div className={styles.label}>{label}</div>
        {message ? <div className={styles.message}>{message}</div> : null}
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}

function statusClassName(status: StatusCheckRowStatus): string {
  switch (status) {
    case 'ok':
      return styles.statusOk;
    case 'warn':
      return styles.statusWarn;
    case 'error':
      return styles.statusError;
    case 'pending':
    default:
      return styles.statusPending;
  }
}

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ');
}
