import type { ReactNode } from 'react';
import styles from './PillGroup.module.css';

type ButtonSize = 'sm' | 'md' | 'lg';

export interface PillGroupItem<T extends string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

interface PillGroupProps<T extends string> {
  items: Array<PillGroupItem<T>>;
  value: T;
  onChange: (value: T) => void;
  size?: ButtonSize;
  /** 排列方向，默认水平 */
  direction?: 'horizontal' | 'vertical';
  fullWidth?: boolean;
  wrap?: boolean;
  className?: string;
  itemClassName?: string;
}

export function PillGroup<T extends string>({
  className,
  direction = 'horizontal',
  fullWidth = false,
  itemClassName,
  items,
  onChange,
  size = 'sm',
  value,
  wrap = true,
}: PillGroupProps<T>) {
  return (
    <div
      className={joinClassNames(
        styles.root,
        direction === 'vertical' ? styles.vertical : '',
        wrap ? styles.wrap : styles.noWrap,
        fullWidth ? styles.fullWidth : '',
        size === 'sm' ? styles.sm : size === 'lg' ? styles.lg : '',
        className,
      )}
    >
      {items.map((item) => {
        const isActive = item.value === value;

        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className={joinClassNames(
              styles.item,
              isActive ? styles.active : '',
              itemClassName,
            )}
            aria-pressed={isActive}
            disabled={item.disabled}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function joinClassNames(...values: Array<string | undefined>): string {
  return values.filter(Boolean).join(' ');
}
