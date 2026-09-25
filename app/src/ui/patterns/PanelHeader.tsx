import type { ReactNode } from 'react';
import styles from './PanelHeader.module.css';

export interface PanelHeaderProps {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  leading?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
}

export function PanelHeader({
  actions,
  description,
  eyebrow,
  leading,
  meta,
  title,
}: PanelHeaderProps) {
  return (
    <div className={styles.root}>
      <div className={styles.info}>
        {leading ? <div className={styles.leading}>{leading}</div> : null}
        <div className={styles.copy}>
          {eyebrow ? <div className={styles.eyebrow}>{eyebrow}</div> : null}
          <div className={styles.titleRow}>
            <div className={styles.title}>{title}</div>
            {meta ? <div className={styles.meta}>{meta}</div> : null}
          </div>
          {description ? <div className={styles.description}>{description}</div> : null}
        </div>
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </div>
  );
}
