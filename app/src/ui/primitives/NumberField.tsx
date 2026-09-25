import { useCallback, useEffect, useId, useState, type ChangeEvent, type FocusEvent } from 'react';
import { Minus, Plus } from 'lucide-react';
import { cn } from '../lib/utils';
import { Field } from './Field';
import styles from './NumberField.module.css';

export interface NumberFieldProps {
  /** 字段标签。省略时不渲染外层 Field 包裹。 */
  label?: string;
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  /** 后缀单位文字，如 "s"、"px" */
  unit?: string;
  /** 禁用状态 */
  disabled?: boolean;
  className?: string;
  stepperClassName?: string;
}

export function NumberField({
  label,
  max,
  min,
  onChange,
  step = 1,
  unit,
  value,
  disabled = false,
  className,
  stepperClassName,
}: NumberFieldProps) {
  const fieldId = useId();
  const [draftValue, setDraftValue] = useState(() => formatNumber(value));

  useEffect(() => {
    const nextValue = formatNumber(value);
    setDraftValue((currentValue) => (currentValue === nextValue ? currentValue : nextValue));
  }, [value]);

  const clamp = useCallback(
    (v: number) => clampValue(v, min, max),
    [min, max],
  );

  const commitValue = useCallback(
    (nextValue: number) => {
      const clamped = clamp(nextValue);
      setDraftValue(formatNumber(clamped));
      if (clamped !== value) {
        onChange(clamped);
      }
    },
    [clamp, onChange, value],
  );

  const handleDecrement = useCallback(() => {
    commitValue(value - step);
  }, [commitValue, step, value]);

  const handleIncrement = useCallback(() => {
    commitValue(value + step);
  }, [commitValue, step, value]);

  const handleChange = (event: ChangeEvent<HTMLInputElement>) => {
    const nextDraft = event.currentTarget.value;
    setDraftValue(nextDraft);

    const parsedValue = parseDraft(nextDraft);
    if (parsedValue === null) {
      return;
    }

    const clampedValue = clamp(parsedValue);
    if (clampedValue !== parsedValue) {
      setDraftValue(formatNumber(clampedValue));
    }
    if (clampedValue !== value) {
      onChange(clampedValue);
    }
  };

  const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
    const parsedValue = parseDraft(event.currentTarget.value);
    if (parsedValue === null) {
      setDraftValue(formatNumber(value));
      return;
    }

    commitValue(parsedValue);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      handleIncrement();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      handleDecrement();
    }
  };

  const isAtMin = typeof min === 'number' && value <= min;
  const isAtMax = typeof max === 'number' && value >= max;

  const stepper = (
    <div className={cn(styles.stepper, stepperClassName)}>
      <button
        type="button"
        className={`${styles.stepBtn} ${styles.stepBtnDec}`}
        onClick={handleDecrement}
        disabled={disabled || isAtMin}
        tabIndex={-1}
        aria-label="减少"
      >
        <Minus size={14} />
      </button>
      <input
        id={fieldId}
        className={styles.value}
        inputMode="decimal"
        min={min}
        max={max}
        step={step}
        type="number"
        value={draftValue}
        disabled={disabled}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
      />
      <button
        type="button"
        className={`${styles.stepBtn} ${styles.stepBtnInc}`}
        onClick={handleIncrement}
        disabled={disabled || isAtMax}
        tabIndex={-1}
        aria-label="增加"
      >
        <Plus size={14} />
      </button>
    </div>
  );

  /* 无 label — 仅渲染步进器（可选带 unit） */
  if (!label) {
    if (unit) {
      return (
        <div className={cn(styles.root, styles.rootInline, className)}>
          {stepper}
          <span className={styles.unit}>{unit}</span>
        </div>
      );
    }
    return <div className={cn(styles.root, className)}>{stepper}</div>;
  }

  /* 有 label — 包裹在 Field 中 */
  const control = unit ? (
    <div className={`${styles.root} ${styles.rootInline}`}>
      {stepper}
      <span className={styles.unit}>{unit}</span>
    </div>
  ) : (
    stepper
  );

  return (
    <Field label={<label htmlFor={fieldId}>{label}</label>}>
      <div className={className}>{control}</div>
    </Field>
  );
}

function clampValue(value: number, min?: number, max?: number): number {
  let nextValue = value;
  if (typeof min === 'number') {
    nextValue = Math.max(min, nextValue);
  }
  if (typeof max === 'number') {
    nextValue = Math.min(max, nextValue);
  }
  return nextValue;
}

function formatNumber(value: number): string {
  return Number.isFinite(value) ? String(value) : '';
}

function parseDraft(value: string): number | null {
  const trimmedValue = value.trim();
  if (
    trimmedValue === '' ||
    trimmedValue === '-' ||
    trimmedValue === '.' ||
    trimmedValue === '-.' ||
    trimmedValue.endsWith('.')
  ) {
    return null;
  }
  const parsedValue = Number(trimmedValue);
  return Number.isFinite(parsedValue) ? parsedValue : null;
}
