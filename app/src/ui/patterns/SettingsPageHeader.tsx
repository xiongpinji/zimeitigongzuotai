import type { ReactNode } from 'react';
import styles from './SettingsPageHeader.module.css';

export interface SettingsPageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  leading?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
  meta?: ReactNode;
  className?: string;
}

export function SettingsPageHeader({
  actions,
  className,
  description,
  eyebrow,
  leading,
  meta,
  title,
}: SettingsPageHeaderProps) {
  return (
    <header className={joinClassNames(styles.root, className)}>
      <div className={styles.info}>
        {leading ? <div className={styles.leading}>{leading}</div> : null}
        <div className={styles.copy}>
          {eyebrow ? <div className={styles.eyebrow}>{eyebrow}</div> : null}
          <div className={styles.titleRow}>
            <h2 className={styles.title}>{title}</h2>
            {meta ? <div className={styles.meta}>{meta}</div> : null}
          </div>
          {description ? <p className={styles.description}>{description}</p> : null}
        </div>
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  );
}

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ');
}
