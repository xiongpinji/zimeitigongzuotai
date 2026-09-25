import type { ReactNode } from 'react';
import styles from './Eyebrow.module.css';

export interface EyebrowProps {
  children: ReactNode;
  className?: string;
}

export function Eyebrow({ children, className }: EyebrowProps) {
  return (
    <div className={`${styles.eyebrow}${className ? ` ${className}` : ''}`}>
      {children}
    </div>
  );
}
