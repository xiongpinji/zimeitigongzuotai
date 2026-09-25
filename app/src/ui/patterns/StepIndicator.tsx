import type { ReactNode } from 'react';
import styles from './StepIndicator.module.css';

export type StepIndicatorStatus = 'pending' | 'active' | 'completed' | 'error';

export interface StepIndicatorStep {
  label: string;
  status: StepIndicatorStatus;
}

export interface StepIndicatorProps {
  steps: StepIndicatorStep[];
}

export function StepIndicator({ steps }: StepIndicatorProps) {
  if (steps.length === 0) {
    return null;
  }

  return (
    <ol className={styles.root}>
      {steps.map((step, index) => (
        <li
          key={`${step.label}-${index}`}
          className={styles.item}
          data-status={step.status}
          aria-current={step.status === 'active' ? 'step' : undefined}
        >
          <span className={styles.marker} aria-hidden="true">
            {renderMarker(step.status)}
          </span>
          <span className={styles.label}>{step.label}</span>
        </li>
      ))}
    </ol>
  );
}

function renderMarker(status: StepIndicatorStatus): ReactNode {
  switch (status) {
    case 'active':
      return <span className={styles.spinner} />;
    case 'completed':
      return (
        <svg className={styles.checkIcon} viewBox="0 0 16 16" fill="none">
          <path
            d="M3.5 8.5 6.5 11.5 12.5 4.5"
            stroke="currentColor"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth="1.8"
          />
        </svg>
      );
    case 'error':
      return <span className={styles.errorGlyph}>!</span>;
    case 'pending':
    default:
      return <span className={styles.dot} />;
  }
}
