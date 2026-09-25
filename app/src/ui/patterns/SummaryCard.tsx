import type { ReactNode } from 'react';
import { Card } from '../components/card';
import styles from './SummaryCard.module.css';

export interface SummaryCardProps {
  title: string;
  meta?: string;
  children: ReactNode;
  className?: string;
}

export function SummaryCard({ children, className, meta, title }: SummaryCardProps) {
  return (
    <Card className={joinClassNames(styles.root, className)}>
      <div className={styles.header}>
        <div className={styles.title}>{title}</div>
        {meta ? <div className={styles.meta}>{meta}</div> : null}
      </div>
      <div className={styles.content}>{children}</div>
    </Card>
  );
}

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ');
}
