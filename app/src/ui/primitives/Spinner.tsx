import type { HTMLAttributes } from 'react';
import styles from './Spinner.module.css';

interface SpinnerProps extends HTMLAttributes<HTMLSpanElement> {
  size?: number;
  color?: string;
}

export function Spinner({
  size = 14,
  color,
  style,
  className,
  ...props
}: SpinnerProps) {
  return (
    <span
      aria-hidden="true"
      {...props}
      className={[styles.spinner, className].filter(Boolean).join(' ')}
      style={{ color, ...style }}
    >
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
      >
        <circle
          cx="12"
          cy="12"
          r="9"
          stroke="currentColor"
          strokeOpacity="0.22"
          strokeWidth="2.25"
        />
        <path
          d="M21 12a9 9 0 0 0-9-9"
          stroke="currentColor"
          strokeLinecap="round"
          strokeWidth="2.25"
        >
          <animateTransform
            attributeName="transform"
            type="rotate"
            from="0 12 12"
            to="360 12 12"
            dur="0.85s"
            repeatCount="indefinite"
          />
        </path>
      </svg>
    </span>
  );
}
