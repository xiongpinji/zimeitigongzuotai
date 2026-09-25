import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import styles from './FileDropCard.module.css';

export interface FileDropCardProps extends Omit<HTMLAttributes<HTMLDivElement>, 'title'> {
  eyebrow: string;
  heading: ReactNode;
  value?: ReactNode;
  placeholder: ReactNode;
  accentColor: string;
  icon?: ReactNode;
  action?: ReactNode;
  active?: boolean;
  compact?: boolean;
}

export function FileDropCard({
  accentColor,
  active = false,
  action,
  className,
  compact = false,
  eyebrow,
  heading,
  icon,
  onDragOver,
  placeholder,
  value,
  ...props
}: FileDropCardProps) {
  const content = value ?? placeholder;

  return (
    <div
      className={joinClassNames(
        styles.root,
        compact ? styles.compact : '',
        active ? styles.active : '',
        value ? styles.filled : '',
        className,
      )}
      style={createAccentStyle(accentColor)}
      onDragOver={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onDragOver?.(event);
      }}
      {...props}
    >
      {icon ? <div className={styles.icon}>{icon}</div> : null}
      <div>
        <div className={styles.eyebrow}>{eyebrow}</div>
        <h2 className={styles.title}>{heading}</h2>
      </div>
      <div className={styles.value}>{content}</div>
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}

function createAccentStyle(accentColor: string): CSSProperties {
  return {
    ['--drop-accent' as string]: accentColor,
  };
}

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ');
}
