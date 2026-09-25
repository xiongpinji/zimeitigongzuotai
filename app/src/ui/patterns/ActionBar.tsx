import type { HTMLAttributes, ReactNode } from 'react';
import styles from './ActionBar.module.css';

export interface ActionBarProps extends HTMLAttributes<HTMLDivElement> {
  start?: ReactNode;
  center?: ReactNode;
  end?: ReactNode;
}

export function ActionBar({ center, end, start, className, ...rest }: ActionBarProps) {
  return (
    <div className={[styles.root, className].filter(Boolean).join(' ')} {...rest}>
      <div className={styles.start}>{start}</div>
      <div className={styles.center}>{center}</div>
      <div className={styles.end}>{end}</div>
    </div>
  );
}
