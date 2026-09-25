import type { CSSProperties, ReactNode } from 'react';
import styles from './FieldGrid.module.css';

export interface FieldGridProps {
  columns?: number;
  className?: string;
  children: ReactNode;
}

export function FieldGrid({ children, className, columns = 2 }: FieldGridProps) {
  const normalizedColumns =
    Number.isFinite(columns) && columns > 0 ? Math.max(1, Math.floor(columns)) : 2;
  const style = {
    '--field-grid-columns': String(normalizedColumns),
  } as CSSProperties;

  return (
    <div className={joinClassNames(styles.root, className)} style={style}>
      {children}
    </div>
  );
}

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ');
}
