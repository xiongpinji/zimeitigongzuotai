import type { ReactNode } from 'react';
import styles from './Field.module.css';

export interface FieldProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  children: ReactNode;
}

export function Field({ children, error, hint, label, required = false }: FieldProps) {
  return (
    <div className={styles.root}>
      {label ? (
        <div className={styles.labelRow}>
          <span className={styles.label}>{label}</span>
          {required ? <span className={styles.required}>*</span> : null}
        </div>
      ) : null}
      <div className={styles.control}>{children}</div>
      {error ? <div className={styles.error}>{error}</div> : null}
      {!error && hint ? <div className={styles.hint}>{hint}</div> : null}
    </div>
  );
}
