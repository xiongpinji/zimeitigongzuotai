import { useId } from 'react';
import { cn } from '../lib/utils';
import styles from './ColorField.module.css';

export interface ColorFieldProps {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  className?: string;
  labelClassName?: string;
  swatchClassName?: string;
  showValue?: boolean;
  formatValue?: (value: string) => string;
}

export function ColorField({
  label,
  value,
  onChange,
  disabled = false,
  className,
  labelClassName,
  swatchClassName,
  showValue = false,
  formatValue,
}: ColorFieldProps) {
  const fieldId = useId();
  const displayValue = formatValue ? formatValue(value) : value;

  return (
    <div className={cn(styles.root, className)}>
      {label ? (
        <label htmlFor={fieldId} className={cn(styles.label, labelClassName)}>
          {label}
        </label>
      ) : null}
      <div
        className={cn(styles.swatch, showValue ? styles.swatchDetailed : '', swatchClassName)}
      >
        <span
          className={cn(styles.preview, showValue ? styles.previewDetailed : '')}
          style={{ background: value }}
          aria-hidden="true"
        />
        {showValue ? <span className={styles.value}>{displayValue}</span> : null}
        <input
          id={fieldId}
          type="color"
          className={styles.input}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.currentTarget.value)}
        />
      </div>
    </div>
  );
}
