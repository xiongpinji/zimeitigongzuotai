import styles from './Divider.module.css';

export interface DividerProps {
  label?: string;
  className?: string;
}

export function Divider({ className, label }: DividerProps) {
  return (
    <div className={joinClassNames(styles.root, label ? styles.withLabel : '', className)}>
      <span className={styles.line} />
      {label ? <span className={styles.label}>{label}</span> : null}
      {label ? <span className={styles.line} /> : null}
    </div>
  );
}

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ');
}
